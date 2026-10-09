// src/lib/requisitoire/levee-auto.ts
//
// LEVÉE DE SAISIE RATTACHÉE SEULE QUAND C'EST SÛR (Olivier 06/10/2026).
// Une levée peut arriver avant le réquisitoire : c'est courant, elle se rattache quand même.
//
// Sûr =
//   - la fiche est trouvée sans hésitation : réf SAI-<fiche> dans l'objet, ou UNE seule fiche
//     police qui a la même plaque, le même VIN ou le même n° de PV ;
//   - c'est une fiche de saisie ;
//   - la date de levée est lue et n'est pas avant l'intervention ; SANS DATE dans le document, c'est la date
//     du mail qui compte (Olivier 09/10/2026, Skoda 1TTZ315 : « peut être récupéré… » sans date) ;
//   - l'ordre est normal : une fiche reçoit au plus une levée TEMPORAIRE puis une DÉFINITIVE.
//     Sans mention « temporaire », la levée est définitive.
// Cas anormal (deuxième levée du même type, définitive puis temporaire, date absente ou
// incohérente, plusieurs fiches possibles) = ALARME sur l'écran des utilisateurs fourrière,
// avec l'explication, les documents et les choix ; le premier qui décide ferme l'alarme
// pour tous, la décision est journalisée.
// Sans fiche trouvée : la levée reste dans la file des réquisitoires, comme avant.
// Rejeu des 88 levées passées : 32 rattachées seules, toutes justes ; 17 alarmes.

import { getBusinessList } from '@/lib/settings/business'
import { sendNotificationToMany } from '@/lib/notifications/send'
import { attachRequisitoire, mailDate } from './attach'
import { moveMessageToFolder, AUTO_MANAGED_FOLDER } from './graph'

const BUCKET = 'mission-remarks'
const ALARM = 'levee_saisie_alarme'
const norm = (v: any) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const tl = (t: string) => (t === 'temporaire' ? 'temporaire' : 'définitive')
const fr = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—')

/** Avis de non-remise de la messagerie : jamais une levée. */
export const isBounce = (from?: string | null, subject?: string | null) =>
  /MicrosoftExchange|postmaster|mailer-daemon/i.test(from || '') || /^\s*(Non remis|Undeliverable|Delivery has failed)/i.test(subject || '')

type Fiche = { id: string; mission_number: number | null; vehicle_plate: string | null; vehicle_brand: string | null; vehicle_model: string | null; source: string | null; incident_at: string | null }
type Decision =
  | { kind: 'auto'; fiche: Fiche; type: 'temporaire' | 'definitive'; date: string; fromMail?: boolean }
  | { kind: 'alarm'; reason: string; explanation: string; fiche?: Fiche; choices?: Fiche[]; type: 'temporaire' | 'definitive'; date: string | null; prevDoc?: string | null }
  | { kind: 'queue'; why: string }

const FICHE_COLS = 'id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, source, incident_at'
const label = (f: Fiche) => `#${f.mission_number ?? '—'} (${f.vehicle_plate || 'sans plaque'}${f.vehicle_brand ? ` · ${[f.vehicle_brand, f.vehicle_model].filter(Boolean).join(' ')}` : ''})`

/** Décide, sans rien écrire, ce que devient une levée reçue. */
export async function decideLevee(sb: any, intake: any): Promise<Decision> {
  const ex = intake.extracted || {}
  const type: 'temporaire' | 'definitive' = ex.levee_type === 'temporaire' ? 'temporaire' : 'definitive'
  const read = /^\d{4}-\d{2}-\d{2}$/.test(String(ex.levee_date || '')) ? String(ex.levee_date) : null
  // Pas de date dans le document : la date du mail fait foi (Olivier 09/10/2026).
  const date = read || mailDate(intake.received_at)

  // 1. La fiche
  let fiches: Fiche[] = []
  const sai = /SAI-0*(\d{3,})/i.exec(intake.subject || '')
  if (sai) {
    const { data } = await sb.from('incoming_missions').select(FICHE_COLS).eq('mission_number', Number(sai[1])).eq('dossier_leg', false).is('archived_at', null).maybeSingle()
    if (data) fiches = [data]
  } else {
    const ids = new Set<string>(((intake.candidates as any[]) || []).filter(c => (c.reasons || []).some((r: string) => r.startsWith('Plaque') || r.startsWith('VIN'))).map(c => c.mission_id))
    const pv = norm(ex.pv_number)
    if (pv.length >= 6) {
      const { data } = await sb.from('incoming_missions').select('id, police_pv_number').ilike('source', '%police%').is('archived_at', null).ilike('police_pv_number', `%${pv.slice(-8)}%`).limit(5)
      for (const d of data || []) if (norm(d.police_pv_number).includes(pv)) ids.add(d.id)
    }
    if (ids.size) {
      const { data } = await sb.from('incoming_missions').select(FICHE_COLS).in('id', [...ids]).eq('dossier_leg', false)
      fiches = data || []
    }
  }
  if (!fiches.length) return { kind: 'queue', why: 'aucune fiche trouvée par la plaque, le VIN, le PV ou la référence SAI-' }
  if (fiches.length > 1) {
    return { kind: 'alarm', reason: 'plusieurs fiches', type, date, choices: fiches,
      explanation: `Levée ${tl(type)} reçue : ${fiches.length} fiches correspondent (${fiches.map(label).join(', ')}). Choisis la bonne fiche.` }
  }
  const f = fiches[0]
  if (!/saisie/.test(f.source || '')) return { kind: 'queue', why: `la fiche ${label(f)} n'est pas une saisie` }

  // 2. La date
  if (!date) return { kind: 'alarm', reason: 'date absente', type, date, fiche: f, explanation: `Levée ${tl(type)} reçue pour la fiche ${label(f)}, mais ni le document ni le mail ne donnent de date. Indique la date avant de rattacher.` }
  if (f.incident_at && date < String(f.incident_at).slice(0, 10)) {
    return { kind: 'alarm', reason: 'date incohérente', type, date, fiche: f, explanation: `Levée ${tl(type)} du ${fr(date)} reçue pour la fiche ${label(f)}, mais l'intervention date du ${fr(f.incident_at)} : la levée serait antérieure à la saisie.` }
  }

  // 3. L'ordre des levées : une temporaire, puis une définitive
  const { data: prev } = await sb.from('mission_levees').select('levee_type, levee_date, doc_path, autorite, created_at').eq('mission_id', f.id).order('created_at')
  const same = (prev || []).filter((p: any) => p.levee_type === type).pop()
  if (same) {
    return { kind: 'alarm', reason: `deuxième levée ${tl(type)}`, type, date, fiche: f, prevDoc: same.doc_path,
      explanation: `Deuxième levée ${tl(type)} reçue pour la fiche ${label(f)} : déjà levée le ${fr(same.levee_date)}${same.autorite ? ` (${same.autorite})` : ''}. Renvoi du même document, ou nouvelle levée ?` }
  }
  if (type === 'temporaire' && (prev || []).some((p: any) => p.levee_type === 'definitive')) {
    const d = (prev || []).filter((p: any) => p.levee_type === 'definitive').pop()
    return { kind: 'alarm', reason: 'temporaire après définitive', type, date, fiche: f, prevDoc: d?.doc_path,
      explanation: `Levée temporaire reçue pour la fiche ${label(f)}, alors qu'une levée définitive est déjà enregistrée (${fr(d?.levee_date)}). Ordre anormal.` }
  }
  return { kind: 'auto', fiche: f, type, date, fromMail: !read }
}


async function fourriereUsers(sb: any): Promise<string[]> {
  const { data: mods } = await sb.from('user_modules').select('user_id').eq('module_id', 'fourriere').eq('granted', true)
  const ids = [...new Set((mods || []).map((m: any) => m.user_id))]
  if (!ids.length) return []
  const { data: us } = await sb.from('users').select('id, role').in('id', ids).eq('active', true)
  const exclus = await getBusinessList('fourriere_alarme_exclus_user_ids').catch(() => [] as string[])
  return (us || []).filter((u: any) => u.role !== 'driver' && !exclus.includes(u.id)).map((u: any) => u.id)
}

async function signed(sb: any, path?: string | null): Promise<string | null> {
  if (!path) return null
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 14 * 86400)
  return data?.signedUrl || null
}

/** Traite une levée reçue : rattachement seul, alarme fourrière, ou file d'attente. Une seule fois par levée. */
export async function handleLevee(sb: any, intakeId: string): Promise<'auto' | 'alarm' | 'queue' | 'skip'> {
  const { data: intake } = await sb.from('requisitoire_intake').select('*').eq('id', intakeId).maybeSingle()
  if (!intake || intake.doc_type !== 'levee_saisie' || !['pending', 'to_verify'].includes(intake.status)) return 'skip'
  if (intake.extracted?._levee_auto) return 'skip'   // déjà décidé (rattachée, alarme ou laissée en file)
  const d = await decideLevee(sb, intake)
  const mark = async (extra: Record<string, any>) => sb.from('requisitoire_intake').update({ extracted: { ...(intake.extracted || {}), _levee_auto: { at: new Date().toISOString(), ...extra } } }).eq('id', intakeId)

  if (d.kind === 'queue') { await mark({ result: 'file', why: d.why }); return 'queue' }

  if (d.kind === 'auto') {
    await mark({ result: 'auto', mission_id: d.fiche.id })
    const r = await attachRequisitoire(sb, intakeId, d.fiche.id, null, { leveeDate: d.date, leveeType: d.type, mode: 'auto' })
    if (r.ok) {
      await sb.from('mission_logs').insert({ mission_id: d.fiche.id, action: 'levee_saisie_auto', notes: `🔓 Levée de saisie ${tl(d.type)} du ${fr(d.date)}${d.fromMail ? ' (date du mail : aucune date dans le document)' : ''} rattachée automatiquement (reçue par mail : « ${String(intake.subject || '').slice(0, 120)} »).` }).then(() => {}, () => {})
      return 'auto'
    }
    // Refus du rattachement (fiche volet gardiennage…) : une personne tranche.
    return raise(sb, intake, { kind: 'alarm', reason: 'rattachement refusé', type: d.type, date: d.date, fiche: d.fiche, explanation: `Levée ${tl(d.type)} pour la fiche ${label(d.fiche)} : le rattachement automatique a été refusé (${r.error}).` }, mark)
  }
  return raise(sb, intake, d, mark)
}

async function raise(sb: any, intake: any, d: Extract<Decision, { kind: 'alarm' }>, mark: (x: Record<string, any>) => Promise<any>): Promise<'alarm'> {
  const group = `lv-${intake.id}`
  await mark({ result: 'alarme', reason: d.reason, request_group: group })
  await sb.from('requisitoire_intake').update({ status: 'to_verify', error: `Alarme fourrière : ${d.reason}` }).eq('id', intake.id)
  const users = await fourriereUsers(sb)
  const [docUrl, prevUrl] = await Promise.all([signed(sb, intake.doc_path), signed(sb, d.prevDoc)])
  const plate = d.fiche?.vehicle_plate || (d.choices?.[0]?.vehicle_plate) || intake.extracted?.plaque || 'sans plaque'
  if (users.length) {
    await sendNotificationToMany(users, ALARM, {
      title: `⚠️ Levée de saisie à vérifier — ${plate}`,
      body: d.explanation,
      action_url: '/fourriere/requisitoires',
      ...(d.fiche ? { mission_id: d.fiche.id } : {}),
      data: {
        modal: true, non_blocking: true, kind: 'levee_alarme', request_group: group, intake_id: intake.id, reason: d.reason, explanation: d.explanation,
        levee_type: d.type, levee_date: d.date, subject: intake.subject || null, from: intake.from_addr || null,
        doc_url: docUrl, prev_doc_url: prevUrl,
        fiche: d.fiche ? { id: d.fiche.id, label: label(d.fiche) } : null,
        choices: (d.choices || []).map(c => ({ id: c.id, label: label(c) })),
      },
    }).catch(() => {})
  }
  if (d.fiche) await sb.from('mission_logs').insert({ mission_id: d.fiche.id, action: 'levee_saisie_alarme', notes: `⚠️ ${d.explanation} — alarme envoyée aux utilisateurs fourrière.` }).then(() => {}, () => {})
  return 'alarm'
}

/** Décision d'un utilisateur fourrière sur l'alarme. Le premier qui décide ferme l'alarme pour tous. */
export async function decideLeveeAlarm(sb: any, notifId: string, userId: string, body: { levee_action?: string; mission_id?: string; levee_date?: string }): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const { data: n } = await sb.from('notifications_log').select('id, notif_type, payload').eq('id', notifId).eq('user_id', userId).maybeSingle()
  const d = n?.payload?.data || {}
  if (!n || n.notif_type !== ALARM || !d.intake_id) return { ok: false, error: 'Notification inconnue' }
  const now = new Date().toISOString()
  const closeGroup = () => sb.from('notifications_log').update({ responded_at: now, read_at: now }).eq('notif_type', ALARM).is('responded_at', null).eq('payload->data->>request_group', d.request_group)
  const { data: intake } = await sb.from('requisitoire_intake').select('id, status, mailbox, source_email_id, subject, extracted, received_at').eq('id', d.intake_id).maybeSingle()
  if (!intake || !['pending', 'to_verify'].includes(intake.status)) { await closeGroup(); return { ok: true, already: true } }
  const { data: me } = await sb.from('users').select('name').eq('id', userId).maybeSingle()
  const who = me?.name || '—'

  if (body.levee_action === 'ignore') {
    await sb.from('requisitoire_intake').update({ status: 'ignored', error: `Ignorée (doublon) par ${who}`, attached_by: userId, attached_at: now }).eq('id', intake.id)
    if (intake.mailbox && intake.source_email_id) await moveMessageToFolder(intake.mailbox, intake.source_email_id, AUTO_MANAGED_FOLDER).catch(() => {})
    if (d.fiche?.id) await sb.from('mission_logs').insert({ mission_id: d.fiche.id, actor_id: userId, action: 'levee_saisie_alarme_ignoree', notes: `Alarme levée de saisie (${d.reason}) : ${who} a ignoré le document (doublon).` }).then(() => {}, () => {})
    await closeGroup()
    return { ok: true }
  }
  if (body.levee_action === 'attach') {
    const target = body.mission_id || d.fiche?.id
    if (!target) return { ok: false, error: 'Choisis la fiche.' }
    if (d.choices?.length && body.mission_id && !d.choices.some((c: any) => c.id === body.mission_id)) return { ok: false, error: 'Fiche hors des choix proposés.' }
    const date = body.levee_date || d.levee_date || mailDate(intake.received_at)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { ok: false, error: 'Indique la date de levée.' }
    const r = await attachRequisitoire(sb, intake.id, target, userId, { leveeDate: date, leveeType: d.levee_type, mode: 'manuel' })
    if (!r.ok) return { ok: false, error: r.error }
    await sb.from('mission_logs').insert({ mission_id: target, actor_id: userId, action: 'levee_saisie_alarme_rattachee', notes: `Alarme levée de saisie (${d.reason}) : ${who} a rattaché la levée ${tl(d.levee_type)} du ${fr(date)}.` }).then(() => {}, () => {})
    await closeGroup()
    return { ok: true }
  }
  return { ok: false, error: 'Action inconnue' }
}
