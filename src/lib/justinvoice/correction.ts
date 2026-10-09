// src/lib/justinvoice/correction.ts
//
// CORRECTION D'UN DOSSIER JUSTINVOICE EXISTANT (Olivier 09/10/2026).
// Le bureau de taxation demande une correction (« besoin d'une correction ») : on corrige l'état de frais (même
// numéro) et on renvoie la version corrigée DANS LE MÊME DOSSIER — jamais un nouveau dépôt. Première fois à la main
// le 09/10 (535059-26, EDF-2026-0024) ; ce module refait exactement ce que fait le formulaire « Add extra files » du
// portail :
//   1. connexion au portail (code par mail) ;
//   2. /coststateslistservice/ : référence « 535059-26 » → identifiant interne + statut ;
//   3. statut « Correction nécessaire » (étape 2) → on soumet au statut « Correction soumise » (/stepservice/?step=3) ;
//   4. /documentservice/ : version actuelle de chaque pièce → on envoie la version suivante ;
//   5. POST JSON au flux Azure lu dans la page (le `sig` de l'URL autorise).
// Pièces : CostState = état de frais (PDF reconstruit depuis VD Soft), Claim = réquisitoire, Approval = approbation.
// Le portail n'accepte que des PDF.

import { justInvoiceLogin, type JustInvoiceSession } from './login'
import { renderEtatFraisFromRow } from '@/lib/missions/saisie-dossier'

const PORTAL = 'https://justinvoice.just.fgov.be'
export type CorrectionDoc = 'CostState' | 'Claim' | 'Approval'

export interface CorrectionResult { ok: boolean; error?: string; ref?: string; sent?: string[]; status?: string }

async function login(): Promise<JustInvoiceSession> {
  try { return await justInvoiceLogin() } catch {
    // Le code par mail peut être relu trop tôt (ancien code) : une seconde tentative suffit en pratique.
    await new Promise(r => setTimeout(r, 15000))
    return justInvoiceLogin()
  }
}

const json = async (s: JustInvoiceSession, path: string) => {
  const r = await s.fetch(`${PORTAL}${path}`, { headers: { Accept: 'application/json' } })
  return JSON.parse(await r.text())
}

async function download(sb: any, path: string): Promise<Buffer | null> {
  const { data } = await sb.storage.from('mission-remarks').download(path)
  return data ? Buffer.from(await data.arrayBuffer()) : null
}

export async function submitJustInvoiceCorrection(
  sb: any, dossierId: string, efId: string, opts: { docs: CorrectionDoc[]; comment: string },
): Promise<CorrectionResult> {
  const { data: ef } = await sb.from('saisie_etats_frais').select('id, numero, justinvoice_ref, status_note, validation_doc_path, dossier_id').eq('id', efId).eq('dossier_id', dossierId).maybeSingle()
  if (!ef) return { ok: false, error: 'État de frais introuvable.' }
  if (!ef.justinvoice_ref) return { ok: false, error: 'Cet état de frais n’a pas de dossier JustInvoice.' }
  const docs = [...new Set(opts.docs)]
  if (!docs.length) return { ok: false, error: 'Choisis au moins une pièce à renvoyer.' }

  const { data: d } = await sb.from('saisie_dossiers').select('mission_id').eq('id', dossierId).maybeSingle()
  const { data: m } = d?.mission_id ? await sb.from('incoming_missions').select('requisitoire_doc_path, mission_number').eq('id', d.mission_id).maybeSingle() : { data: null }

  // Pièces, préparées AVANT toute connexion (rien ne part si une pièce manque).
  const pieces = new Map<CorrectionDoc, { name: string; content: Buffer }>()
  if (docs.includes('CostState')) {
    const { pdf } = await renderEtatFraisFromRow(sb, dossierId, efId)
    pieces.set('CostState', { name: `etat-de-frais-${ef.numero}-corrige.pdf`, content: pdf })
  }
  if (docs.includes('Claim')) {
    const p = m?.requisitoire_doc_path
    if (!p || !/\.pdf$/i.test(p)) return { ok: false, error: 'Réquisitoire absent ou pas en PDF : JustInvoice n’accepte que des PDF.' }
    const b = await download(sb, p); if (!b) return { ok: false, error: 'Réquisitoire illisible.' }
    pieces.set('Claim', { name: `requisitoire-${m?.mission_number || ef.numero}.pdf`, content: b })
  }
  if (docs.includes('Approval')) {
    const p = ef.validation_doc_path
    if (!p || !/\.pdf$/i.test(p)) return { ok: false, error: 'Approbation absente ou pas en PDF.' }
    const b = await download(sb, p); if (!b) return { ok: false, error: 'Approbation illisible.' }
    pieces.set('Approval', { name: `approbation-${ef.numero}.pdf`, content: b })
  }

  const s = await login()
  const list = await json(s, '/coststateslistservice/')
  const claim = (list.results || []).find((c: any) => String(c.Name).trim() === ef.justinvoice_ref)
  if (!claim) return { ok: false, error: `Dossier ${ef.justinvoice_ref} introuvable sur le portail.` }
  const step = String(claim.StatusStep ?? claim.statusStep ?? '') === '2'
    ? (await json(s, '/stepservice/?step=3')).results?.[0]?.Id
    : claim.StatusId
  if (!step) return { ok: false, error: 'Statut de correction introuvable sur le portail.' }

  const before = (await json(s, `/documentservice/?id=${claim.Id}`)).results || []
  const versions = (t: string) => before.filter((x: any) => x.DocType === t).length
  const page = await (await s.fetch(`${PORTAL}/overview/files/?id=${claim.Id}&files=`)).text()
  const flow = page.match(/var requestURL = "([^"]+)"/)?.[1]
  if (!flow) return { ok: false, error: 'Formulaire de correction du portail introuvable.' }

  const files = [...pieces].map(([docType, p]) => ({ docType, docVersion: versions(docType) + 1, fileName: p.name, content: p.content.toString('base64') }))
  const res = await fetch(flow, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: PORTAL, referer: `${PORTAL}/` },
    body: JSON.stringify({ costStateId: claim.Id, step, comments: String(opts.comment || '').slice(0, 1000), files }),
  })
  if (!res.ok) return { ok: false, error: `Le portail a refusé l’envoi (${res.status}).` }

  // Contrôle : les nouvelles versions sont visibles (le flux met quelques secondes).
  let after: any[] = []
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 5000))
    after = (await json(s, `/documentservice/?id=${claim.Id}`)).results || []
    if (files.every(f => after.filter((x: any) => x.DocType === f.docType).length >= f.docVersion)) break
  }
  const okDocs = files.filter(f => after.filter((x: any) => x.DocType === f.docType).length >= f.docVersion).map(f => f.docType)
  if (okDocs.length !== files.length) return { ok: false, error: 'Envoyé, mais le portail n’affiche pas encore la nouvelle version : vérifie le dossier dans quelques minutes.' }

  const label: Record<string, string> = { CostState: 'état de frais', Claim: 'réquisitoire', Approval: 'approbation' }
  const note = `Correction envoyée sur JustInvoice le ${new Date().toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' })} (${okDocs.map(t => label[t]).join(', ')}).`
  await sb.from('saisie_etats_frais').update({ status: 'depose', status_note: note }).eq('id', efId)
  await sb.from('saisie_dossiers').update({ state: 'justinvoice', updated_at: new Date().toISOString() }).eq('id', dossierId)
  if (d?.mission_id) await sb.from('mission_logs').insert({ mission_id: d.mission_id, action: 'justinvoice_correction', notes: `${ef.numero} : ${note}${opts.comment ? ` Commentaire : « ${opts.comment} »` : ''}` }).then(() => {}, () => {})
  return { ok: true, ref: ef.justinvoice_ref, sent: okDocs.map(t => label[t]), status: 'Correction soumise' }
}
