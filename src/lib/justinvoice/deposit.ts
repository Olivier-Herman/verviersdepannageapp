// src/lib/justinvoice/deposit.ts
//
// Dépôt d'UN état de frais accepté sur JustInvoice (créance SPF Justice) :
// état de frais SIGNÉ (validation_doc_path) → CostState + Approval ; réquisitoire
// de la fiche → Claim. Comments = #mission - EDF. Stocke le n° de dossier retour
// (justinvoice_ref) et passe l'état de frais en 'depose'.
// Partagé par le bouton du cockpit et par l'automate (mode Auto). Olivier 2026-09-03.

import { submitJustInvoiceClaim } from '@/lib/justinvoice/claim'

export interface DepositResult { ok: boolean; ref?: string | null; numero?: string; error?: string; raw?: string }

async function dl(sb: any, path: string): Promise<Buffer | null> {
  const { data } = await sb.storage.from('mission-remarks').download(path)
  if (!data) return null
  return Buffer.from(await data.arrayBuffer())
}

export async function depositEtatFrais(sb: any, dossierId: string, efId?: string | null): Promise<DepositResult> {
  const { data: d } = await sb.from('saisie_dossiers').select('*').eq('id', dossierId).maybeSingle()
  if (!d) return { ok: false, error: 'Dossier introuvable' }

  // On dépose l'état de frais ciblé (efId) ou, à défaut, le + ancien 'accepte'.
  const sel = 'id, numero, validation_doc_path, status'
  const { data: efRow } = efId
    ? await sb.from('saisie_etats_frais').select(sel).eq('dossier_id', dossierId).eq('id', efId).maybeSingle()
    : await sb.from('saisie_etats_frais').select(sel).eq('dossier_id', dossierId).eq('status', 'accepte').order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!efRow) return { ok: false, error: 'Aucun état de frais accepté à déposer (scanne d\'abord le retour signé).' }
  if (efRow.status !== 'accepte') return { ok: false, error: `Cet état de frais est « ${efRow.status} », pas « accepté ».` }
  if (!efRow.validation_doc_path) return { ok: false, error: 'État de frais signé manquant sur cet état de frais.' }

  let reqPath: string | null = null
  let missionNumber: number | null = null
  if (d.mission_id) {
    const { data: m } = await sb.from('incoming_missions').select('requisitoire_doc_path, mission_number').eq('id', d.mission_id).maybeSingle()
    reqPath = m?.requisitoire_doc_path || null
    missionNumber = m?.mission_number ?? null
  }
  if (!reqPath) return { ok: false, error: 'Réquisitoire manquant sur la fiche.' }

  const [ef, reqBuf] = await Promise.all([dl(sb, efRow.validation_doc_path), dl(sb, reqPath)])
  if (!ef || !reqBuf) return { ok: false, error: 'Téléchargement des documents échoué.' }

  const comments = `${missionNumber != null ? '#' + missionNumber : (d.dossier_ref || '')}${efRow.numero ? ' - ' + efRow.numero : ''}`.trim()
  const res = await submitJustInvoiceClaim({
    comments,
    etatFrais: ef,
    requisitoire: reqBuf,
    etatFraisName: `etat-de-frais-${efRow.numero || d.vehicle_plate || 'saisie'}.pdf`,
    requisitoireName: `requisitoire-${d.vehicle_plate || 'saisie'}.pdf`,
  })
  if (!res.ok) return { ok: false, error: res.error || 'Dépôt refusé', raw: res.raw }

  const now = new Date().toISOString()
  await sb.from('saisie_etats_frais').update({ status: 'depose', justinvoice_ref: res.ref || null }).eq('id', efRow.id)
  await sb.from('saisie_dossiers').update({ justinvoice_ref: res.ref || null, state: 'justinvoice', updated_at: now }).eq('id', dossierId)
  if (d.mission_id) {
    await sb.from('mission_remarks')
      .insert({ mission_id: d.mission_id, text: `📤 État de frais ${efRow.numero} déposé sur JustInvoice${res.ref ? ` — dossier ${res.ref}` : ''}` })
      .then(() => {}, () => {})
  }
  return { ok: true, ref: res.ref, numero: efRow.numero }
}
