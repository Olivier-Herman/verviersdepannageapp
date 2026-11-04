// src/lib/missions/gop.ts
//
// Garantie de paiement d'une assistance (« GOP Roadside Assistance - 2026 05055750.pdf » d'Allianz).
// Olivier 04/11/2026 : « quand on reçoit une garantie de paiement ainsi, ça doit se placer
// automatiquement dans la fiche ». Le PDF dit qui paie, jusqu'à combien (TVAC), sous quelle
// référence, et pour quel client le solde. On le lit, on le joint à la fiche couverte et on le
// garde dans mission_guarantees pour la facturation (facture plafonnée + solde au client).
//
// Quelle fiche ? 1) celle de l'affectation citée (n° de mission 39…) ; 2) sinon le véhicule
// (plaque ou VIN) : c'est alors le remorquage déjà fait par nous (police, accident…) que
// l'assistance reprend. Une fiche de la même assistance sous une AUTRE affectation est une autre
// prise en charge (la relivraison de 1ABV287) : jamais celle-là. Doute → rien n'est placé,
// la garantie attend une vérification et Mobi est prévenu.

import Anthropic from '@anthropic-ai/sdk'
import { aiClient } from '@/lib/ai/usage'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

const BUCKET = 'mission-remarks'
const ACTIVE_EXCLUDED = '("cancelled","ignored","parse_error")'

export type GopAttachment = { name?: string; contentType?: string; contentBytes?: string }

export type GopData = {
  dossier_ref: string | null
  assistance_mission: string | null
  plate: string | null
  vin: string | null
  amount_ttc: number | null
  client_name: string | null
  client_address: string | null
  client_phone: string | null
  incident_at: string | null
  payer: string | null
}

/** La pièce jointe « GOP … .pdf » d'un mail Allianz, sinon null. */
export function gopAttachment(fromEmail: string, attachments: GopAttachment[]): GopAttachment | null {
  if (!/@allianz/i.test(fromEmail || '')) return null
  return attachments.find(a => /^GOP\b.*\.pdf$/i.test(String(a.name || '').trim()) && a.contentBytes) || null
}

export async function readGop(pdfBase64: string): Promise<GopData> {
  const client = aiClient('missions/gop', { apiKey: process.env.ANTHROPIC_API_KEY! }) as Anthropic
  const prompt = `Ceci est une garantie de paiement d'une compagnie d'assistance adressée à un dépanneur.
Réponds en JSON STRICT, sans texte autour :
{"payer":"entité qui garantit (ex. AWP P&C S.A. - Belgian Branch)","dossier_ref":"n° de dossier tel qu'écrit","assistance_mission":"n° de mission (chiffres seuls)","plate":"plaque","vin":"NIV/VIN","amount_ttc":<montant garanti TVA comprise, nombre>,"client_name":"…","client_address":"rue, CP ville","client_phone":"…","incident_at":"date et heure de l'incident telles qu'écrites"}
Une donnée absente = null. Ne devine rien. Si le montant est indiqué hors TVA, mets null.`
  const res = await client.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 800, messages: [{ role: 'user', content: [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
    { type: 'text', text: prompt },
  ] }] })
  const t = res.content.find(b => b.type === 'text')
  if (!t || t.type !== 'text') throw new Error('Garantie illisible')
  const j = JSON.parse(t.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, ''))
  const s = (v: any) => (v == null || String(v).trim() === '' ? null : String(v).trim())
  const amt = Number(String(j.amount_ttc ?? '').replace(',', '.'))
  return {
    dossier_ref: s(j.dossier_ref), assistance_mission: s(j.assistance_mission)?.replace(/\D/g, '') || null,
    plate: s(j.plate)?.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null, vin: s(j.vin)?.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null,
    amount_ttc: Number.isFinite(amt) && amt > 0 ? Math.round(amt * 100) / 100 : null,
    client_name: s(j.client_name), client_address: s(j.client_address), client_phone: s(j.client_phone),
    incident_at: s(j.incident_at), payer: s(j.payer),
  }
}

/** Fiche couverte par la garantie, ou la raison du doute. */
export async function findGopMission(sb: any, g: GopData): Promise<{ id: string; mission_number: number; how: string; reprise: boolean } | { id: null; why: string }> {
  if (g.assistance_mission) {
    const { data } = await sb.from('incoming_missions').select('id, mission_number')
      .eq('external_id', g.assistance_mission).not('status', 'in', ACTIVE_EXCLUDED).order('id').limit(1)
    if (data?.[0]) return { ...data[0], how: `affectation ${g.assistance_mission}`, reprise: false }
  }
  const keys: string[] = []
  if (g.plate && g.plate.length >= 4) keys.push(`vehicle_plate.ilike.${g.plate}`)
  if (g.vin && g.vin.length >= 11) keys.push(`vehicle_vin.ilike.${g.vin}`)
  if (!keys.length) return { id: null, why: 'ni affectation connue, ni plaque, ni VIN lisibles' }
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString()
  const { data } = await sb.from('incoming_missions')
    .select('id, mission_number, source, external_id, received_at')
    .or(keys.join(',')).eq('dossier_leg', false).gte('received_at', since)
    .not('status', 'in', ACTIVE_EXCLUDED).order('received_at')
  // Une fiche de l'assistance sous une autre affectation = autre prise en charge.
  const cands = (data || []).filter((m: any) => !/^39\d{12}$/.test(String(m.external_id || '')))
  if (cands.length === 1) return { id: cands[0].id, mission_number: cands[0].mission_number, how: `véhicule ${g.plate || g.vin}`, reprise: !['mondial', 'allianz'].includes(cands[0].source) }
  if (!cands.length) return { id: null, why: `aucune fiche récente pour ${g.plate || g.vin} hors autres affectations de l'assistance` }
  return { id: null, why: `${cands.length} fiches possibles pour ${g.plate || g.vin} (${cands.map((m: any) => m.mission_number).join(', ')})` }
}

const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Lit la garantie, la place sur sa fiche (remarque + PDF + montant garanti) et la garde. */
export async function intakeGop(sb: any, opts: { att: GopAttachment; sourceEmailId: string; fromEmail: string; receivedAt: string }): Promise<{ placed: boolean; reprise?: boolean; missionId?: string; missionNumber?: number; why?: string; dossierKnown?: boolean }> {
  const { data: seen } = await sb.from('mission_guarantees').select('mission_id, status').eq('source_email_id', opts.sourceEmailId).maybeSingle()
  if (seen) return { placed: seen.status === 'placed', missionId: seen.mission_id || undefined, dossierKnown: true }

  const g = await readGop(opts.att.contentBytes!)
  // La même garantie renvoyée deux fois (même dossier, même affectation, même montant) : une seule fois.
  if (g.dossier_ref && g.assistance_mission) {
    const { data: twin } = await sb.from('mission_guarantees').select('mission_id, status').eq('dossier_ref', g.dossier_ref)
      .eq('assistance_mission', g.assistance_mission).eq('amount_ttc', g.amount_ttc ?? -1).limit(1)
    if (twin?.[0]) return { placed: twin[0].status === 'placed', missionId: twin[0].mission_id || undefined, dossierKnown: true }
  }
  const hit = await findGopMission(sb, g)
  const buf = Buffer.from(opts.att.contentBytes!, 'base64')
  const fileName = `Garantie ${g.payer?.split(/\s[-–]\s/)[0] || 'assistance'} ${g.dossier_ref || ''}.pdf`.replace(/\s+/g, ' ').trim()
  const assistance = g.payer || 'Allianz Partners'

  // Le PDF est toujours gardé, même si la fiche reste à trouver.
  let docPath: string | null = `garanties/${Date.now()}_${(g.dossier_ref || 'gop').replace(/\W+/g, '')}.pdf`
  if ((await sb.storage.from(BUCKET).upload(docPath, buf, { contentType: 'application/pdf' })).error) docPath = null
  // Mission de l'assistance elle-même (sa GOP accompagne chaque affectation) : gardée, sans
  // remarque ni montant sur la fiche, la facturation passe par l'assistance comme d'habitude.
  if (hit.id && !hit.reprise) {
    await sb.from('mission_logs').insert({ mission_id: hit.id, action: 'guarantee_received', notes: `Garantie de paiement ${g.dossier_ref || ''} reçue (${g.amount_ttc != null ? `${eur(g.amount_ttc)} € TVAC` : 'montant non lu'})`, metadata: { from: opts.fromEmail, doc_path: docPath } })
  }
  // Reprise d'un remorquage à nous (police, accident…) : tout est mis sur la fiche.
  if (hit.id && hit.reprise) {
    const plafond = g.amount_ttc != null ? `jusqu’à ${eur(g.amount_ttc)} € TVAC` : 'montant à lire sur le document'
    const solde = g.client_name ? ` Le solde au-delà est à charge du client ${g.client_name}${g.client_address ? ` (${g.client_address})` : ''}${g.client_phone ? `, ${g.client_phone}` : ''}.` : ''
    const text = `💶 GARANTIE DE PAIEMENT reçue le ${new Date(opts.receivedAt).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' })} : ${assistance} garantit ce remorquage ${plafond} (la relivraison éventuelle est une autre prise en charge). Facture à adresser avec la référence de dossier ${g.dossier_ref || '?'}${g.assistance_mission ? ` (mission ${g.assistance_mission})` : ''}.${solde}`
    const { data: rem } = await sb.from('mission_remarks').insert({ mission_id: hit.id, text }).select('id').single()
    if (rem && docPath) {
      await sb.from('mission_remark_attachments').insert({ remark_id: rem.id, file_path: docPath, file_name: fileName, file_size: buf.length, mime_type: 'application/pdf' })
    }
    const { data: m } = await sb.from('incoming_missions').select('remarks_billing, amount_guaranteed').eq('id', hit.id).single()
    const upd: any = { remarks_billing: [m?.remarks_billing, text].filter(Boolean).join('\n') }
    // Le champ de la fiche est HTVA : la garantie est donnée TVAC.
    if (g.amount_ttc != null && m?.amount_guaranteed == null) upd.amount_guaranteed = Math.round(g.amount_ttc / 1.21 * 100) / 100
    await sb.from('incoming_missions').update(upd).eq('id', hit.id)
    await sb.from('mission_logs').insert({ mission_id: hit.id, action: 'guarantee_received', notes: `Garantie de paiement ${g.dossier_ref || ''} placée automatiquement (${hit.how})`, metadata: { from: opts.fromEmail } })
  }

  await sb.from('mission_guarantees').insert({
    mission_id: hit.id, assistance, dossier_ref: g.dossier_ref, assistance_mission: g.assistance_mission,
    plate: g.plate, vin: g.vin, amount_ttc: g.amount_ttc, client_name: g.client_name, client_address: g.client_address,
    client_phone: g.client_phone, incident_at: g.incident_at, doc_path: docPath, source_email_id: opts.sourceEmailId,
    status: hit.id ? 'placed' : 'to_verify', placed_how: hit.id ? hit.how : (hit as any).why,
  })
  if (hit.id) return { placed: true, reprise: hit.reprise, missionId: hit.id, missionNumber: hit.mission_number }
  // Une autre affectation d'un dossier connu (avance de fonds, affectation remplacée…) n'est pas une alerte.
  const digits = (g.dossier_ref || '').replace(/\D/g, '')
  const { data: known } = digits.length >= 8 ? await sb.from('incoming_missions').select('id').eq('dossier_number', digits).limit(1) : { data: [] }
  return { placed: false, why: (hit as any).why, dossierKnown: !!known?.length }
}

/** GOP arrivée avant sa fiche : reliée à la fiche de l'affectation créée entre-temps. */
export async function linkPendingGop(sb: any, sourceEmailId: string): Promise<boolean> {
  const { data: g } = await sb.from('mission_guarantees').select('id, assistance_mission, dossier_ref, amount_ttc, doc_path')
    .eq('source_email_id', sourceEmailId).is('mission_id', null).maybeSingle()
  if (!g?.assistance_mission) return false
  const { data: m } = await sb.from('incoming_missions').select('id').eq('external_id', g.assistance_mission)
    .not('status', 'in', ACTIVE_EXCLUDED).order('id').limit(1)
  if (!m?.[0]) return false
  await sb.from('mission_guarantees').update({ mission_id: m[0].id, status: 'placed', placed_how: `affectation ${g.assistance_mission}` }).eq('id', g.id)
  await sb.from('mission_logs').insert({ mission_id: m[0].id, action: 'guarantee_received', notes: `Garantie de paiement ${g.dossier_ref || ''} reçue (${g.amount_ttc != null ? `${eur(Number(g.amount_ttc))} € TVAC` : 'montant non lu'})`, metadata: { doc_path: g.doc_path } })
  return true
}
