// src/lib/assistant/veille.ts
//
// VEILLE DE MAX (Olivier 14/10/2026, maquette validée) : Max repère les missions figées et
// pose la question à la personne qui les a attribuées (ou au bureau si personne), avec un
// explicatif détaillé et des réponses en boutons ; « Autre chose » ouvre la conversation.
//   - attribuée sans pointage depuis plus de 6 h ;
//   - sans chauffeur depuis plus de 4 h (hors rendez-vous planifié) ;
//   - commandes des sources « à trier » (Car Parts) : liste « À faire / Déjà fait ».
// Ne relance pas la même question tant qu'elle est réglée ou remise à plus tard (max_veille).
// Deux profils d'une même personne (même odoo_partner_id) reçoivent les mêmes questions.
import type { createAdminClient } from '@/lib/supabase'

type Sb = ReturnType<typeof createAdminClient>
const H = 3600_000
export const SEUIL_ATTRIBUEE_H = 6
export const SEUIL_SANS_CHAUFFEUR_H = 4
const ATTRIBUEE = ['assigned', 'accepted', 'in_progress', 'delivering']
const SANS_CHAUFFEUR = ['new', 'dispatching']

export interface VeilleCard {
  id: string; kind: 'figee_attribuee' | 'figee_sans_chauffeur' | 'tri_commandes'
  mission: { id: string; numero: number | null; plaque: string | null; type: string | null; source: string | null; statut: string; lieu: string | null; destination: string | null; chauffeur: string | null; recue: string | null }
  depuis_h: number; dernier_pointage: string | null; attribuee_par: string | null; pour_moi: boolean
  titre: string; message: string
  faits: string[]; raisonnement: string[]; alertes: string[]; verifie: string[]
  reponses: { id: string; libelle: string; effet: string; principale?: boolean }[]
}

const fmt = (iso?: string | null) => iso ? new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—'
const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Heures où Max relance : lun-ven 8 h-19 h, sam 9 h-14 h (Bruxelles). */
export function inWorkHours(d = new Date()): boolean {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(d)
  const wd = p.find(x => x.type === 'weekday')?.value || '', h = Number(p.find(x => x.type === 'hour')?.value) % 24
  if (['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(wd)) return h >= 8 && h < 19
  if (wd === 'Sat') return h >= 9 && h < 14
  return false
}

/** Les profils d'une même personne : même odoo_partner_id. */
export async function aliasIds(sb: Sb, userId: string): Promise<string[]> {
  const { data: me } = await sb.from('users').select('id, odoo_partner_id').eq('id', userId).maybeSingle()
  if (!me?.odoo_partner_id) return [userId]
  const { data } = await sb.from('users').select('id').eq('odoo_partner_id', me.odoo_partner_id).eq('active', true)
  return Array.from(new Set([userId, ...(data || []).map((u: any) => u.id)]))
}

/** Le départ est-il un de nos dépôts ? (même rue + même code postal, numéro ignoré) */
function depotMatch(depots: { name: string; address: string }[], addr?: string | null): string | null {
  if (!addr) return null
  const a = norm(addr)
  for (const d of depots) {
    const m = norm(d.address).match(/^(.*?)\s*\d+[a-z]?\s*,\s*(\d{4})/)
    if (!m) continue
    const street = m[1].replace(/^(rue|avenue|av|route|rte|chaussee|place)\s+/, '').trim()
    if (street.length >= 4 && a.includes(street) && a.includes(m[2])) return d.name
  }
  return null
}

const lastPointage = (m: any) => [m.loaded_at, m.on_site_at, m.on_way_at, m.accepted_at, m.assigned_at, m.received_at].filter(Boolean).sort().pop() || null

/** Construit (et enregistre) les questions ouvertes, puis rend celles de cette personne. */
export async function veilleCards(sb: Sb, userId: string, opts: { bureau: boolean } = { bureau: true }): Promise<VeilleCard[]> {
  const now = Date.now()
  const mine = await aliasIds(sb, userId)
  const { getBusinessList } = await import('@/lib/settings/business')
  const triSources = await getBusinessList('max_veille_tri_sources').catch(() => [] as string[])
  const COLS = 'id, source_format, touring_accepted_at, touring_onroad_at, vab_closed_at, mission_number, vehicle_plate, vehicle_brand, vehicle_model, mission_type, source, status, incident_address, destination_address, assigned_to, assigned_at, accepted_at, on_way_at, on_site_at, loaded_at, received_at, intervention_date, parent_mission_id, external_id, dossier_number, billed_to_name'
  const { data: cand } = await sb.from('incoming_missions').select(COLS)
    .in('status', [...ATTRIBUEE, ...SANS_CHAUFFEUR]).eq('dossier_leg', false).is('archived_at', null)
    .not('external_id', 'like', 'PROCESSING_%').not('external_id', 'like', 'UNKNOWN_SENDER_%')
    .order('received_at', { ascending: true }).limit(400)
  const stuck: { m: any; kind: VeilleCard['kind']; since: number }[] = []
  for (const m of cand || []) {
    const last = lastPointage(m), since = last ? (now - Date.parse(last)) / H : 0
    if (triSources.includes(String(m.source))) { if (SANS_CHAUFFEUR.includes(m.status)) stuck.push({ m, kind: 'tri_commandes', since }); continue }
    if (ATTRIBUEE.includes(m.status) && m.assigned_to && since >= SEUIL_ATTRIBUEE_H) stuck.push({ m, kind: 'figee_attribuee', since })
    else if (SANS_CHAUFFEUR.includes(m.status) && !m.assigned_to && since >= SEUIL_SANS_CHAUFFEUR_H && !(m.intervention_date && Date.parse(m.intervention_date) > now)) stuck.push({ m, kind: 'figee_sans_chauffeur', since })
  }
  if (!stuck.length) return []

  // Qui a attribué (dernier « dispatched » avec un auteur) ?
  const ids = stuck.map(s => s.m.id)
  const { data: logs } = await sb.from('mission_logs').select('mission_id, actor_id, created_at').in('mission_id', ids).in('action', ['dispatched', 'assigned', 'reassigned']).not('actor_id', 'is', null).order('created_at', { ascending: true })
  const assigner: Record<string, string> = {}
  for (const l of logs || []) assigner[l.mission_id] = l.actor_id
  // Questions déjà posées.
  const { data: prev } = await sb.from('max_veille').select('id, mission_id, kind, owner_user_id, status, snooze_until, created_at').in('mission_id', ids).order('created_at', { ascending: false })
  const prevBy: Record<string, any> = {}
  for (const p of prev || []) { const k = `${p.mission_id}|${p.kind}`; if (!prevBy[k]) prevBy[k] = p }
  const open: { row: any; s: typeof stuck[number] }[] = []
  for (const s of stuck) {
    const k = `${s.m.id}|${s.kind}`, p = prevBy[k]
    if (p?.status === 'reglee') continue
    if (p?.status === 'plus_tard' && p.snooze_until && Date.parse(p.snooze_until) > now) continue
    if (p?.status === 'ouverte') { open.push({ row: p, s }); continue }
    const { data: row } = await sb.from('max_veille').insert({ mission_id: s.m.id, kind: s.kind, owner_user_id: s.kind === 'figee_attribuee' ? (assigner[s.m.id] || null) : null }).select('id, mission_id, kind, owner_user_id, status').single()
    if (row) open.push({ row, s })
  }
  // Mission attribuée → seulement à qui l'a attribuée (tous ses profils). Sans chauffeur ou à
  // trier → seulement au dispatch titulaire (réglage max_veille_dispatch_users, sans Jona — 15/10), jamais à Mobi
  // (Olivier 14/10/2026 : « il ne faut pas m'envoyer les notif de Momo a moi »).
  const forMe = open.filter(o => o.row.owner_user_id ? mine.includes(o.row.owner_user_id) : opts.bureau)
  if (!forMe.length) return []

  const [{ data: users }, { data: depots }] = await Promise.all([
    sb.from('users').select('id, name'),
    sb.from('depots').select('name, address'),
  ])
  const nm = Object.fromEntries((users || []).map((u: any) => [u.id, u.name]))
  const out: VeilleCard[] = []
  for (const { row, s } of forMe) {
    const m = s.m
    const plaque = m.vehicle_plate || null
    const chauffeur = m.assigned_to ? nm[m.assigned_to] || null : null
    const par = row.owner_user_id ? nm[row.owner_user_id] || null : null
    const last = lastPointage(m)
    const isRel = /rel/i.test(String(m.mission_type || '')) || !!m.parent_mission_id
    const mission = { id: m.id, numero: m.mission_number, plaque, type: m.mission_type, source: m.source, statut: m.status, lieu: m.incident_address, destination: m.destination_address, chauffeur, recue: m.received_at }
    const faits: string[] = [], raisonnement: string[] = [], alertes: string[] = []
    let twin: any = null
    const verifie = ['dernier pointage', 'qui a attribué la mission']
    faits.push(`Fiche #${m.mission_number ?? '?'} · ${plaque || 'sans plaque'} · ${[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || 'véhicule ?'} · ${m.source || '?'} · ${m.mission_type || '?'}`)
    faits.push(`Départ : ${m.incident_address || '—'}${m.destination_address ? ` → ${m.destination_address}` : ''}`)
    faits.push(`Reçue ${fmt(m.received_at)}${chauffeur ? ` · chauffeur : ${chauffeur}` : ' · aucun chauffeur'}${par ? ` · attribuée par ${par}` : ''}`)
    // État chez l'assistance (ce que VD Soft en sait).
    if (m.touring_accepted_at || m.source_format === 'comex') {
      verifie.push('état chez Touring')
      const { data: cx } = await sb.from('touring_comex_dossiers').select('in_comex, verdict, accepted_at').eq('mission_id', m.id).maybeSingle()
      faits.push(`Chez Touring : ${m.touring_accepted_at ? `acceptée ${fmt(m.touring_accepted_at)}` : 'pas encore acceptée'}${m.touring_onroad_at ? `, « en route » envoyé ${fmt(m.touring_onroad_at)}` : ''}${cx ? (cx.in_comex ? ' · toujours dans COMEX' : ' · plus dans les listes COMEX') : ''} → ${m.touring_onroad_at ? 'Touring attend la suite' : 'à suivre'}`)
    }
    if (m.vab_closed_at) faits.push(`Chez VAB : clôturée ${fmt(m.vab_closed_at)}`)
    if (last) faits.push(`Dernier pointage : ${fmt(last)} (il y a ${Math.round(s.since)} h)${m.loaded_at ? ' · véhicule chargé' : ''}`)
    // Fiches jumelles (même plaque, 5 jours autour).
    if (plaque && plaque.replace(/[^A-Za-z0-9]/g, '').length >= 4) {
      verifie.push('fiches de la même plaque')
      const p = plaque.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
      const like = '%' + p.split('').join('%') + '%'
      const t = Date.parse(m.received_at || new Date().toISOString())
      const { data: twins } = await sb.from('incoming_missions').select('id, mission_number, source, status, mission_type, incident_address, destination_address, received_at, invoice_number, billed_to_name, assigned_to, parent_mission_id')
        .ilike('vehicle_plate', like).neq('id', m.id).eq('dossier_leg', false).not('status', 'in', '("cancelled","ignored")')
        .gte('received_at', new Date(t - 5 * 24 * H).toISOString()).lte('received_at', new Date(t + 5 * 24 * H).toISOString()).limit(5)
      // Les fiches du même dossier (fiche d'origine d'une relivraison, autres relivraisons) ne sont pas suspectes.
      const sameDossier = (tw: any) => tw.id === m.parent_mission_id || tw.parent_mission_id === m.id || (!!m.parent_mission_id && tw.parent_mission_id === m.parent_mission_id)
      for (const tw of (twins || []).filter((tw: any) => !sameDossier(tw))) {
        if (!twin) twin = tw
        faits.push(`Autre fiche de la même plaque : #${tw.mission_number} · ${tw.source} · ${tw.mission_type} · ${fmt(tw.received_at)} · ${tw.status}${tw.assigned_to ? ` · ${nm[tw.assigned_to] || ''}` : ''}${tw.destination_address ? ` · déposée : ${tw.destination_address}` : ''} · ${tw.invoice_number ? `facturée ${tw.invoice_number}` : 'pas encore facturée'}${tw.billed_to_name ? ` · client : ${tw.billed_to_name}` : ''}`)
        raisonnement.push(`#${tw.mission_number} concerne la même voiture : soit un doublon, soit l'étape suivante (relivraison). Une fusion ferait disparaître le lien avec l'assistance : à trancher avec Max dans « Autre chose ».`)
      }
    }
    // Une relivraison part normalement du dépôt : pas d'indice à en tirer.
    const dep = isRel && m.parent_mission_id ? null : depotMatch(depots || [], m.incident_address)
    if (dep) { verifie.push('adresse de départ'); raisonnement.push(`Le départ est notre dépôt de ${dep} : la voiture est sans doute déjà chez nous (relivraison d'un véhicule qu'on a ?).`) }
    // Incohérence lieu : la jumelle a déposé ailleurs que notre dépôt.
    if (dep) for (const f of faits) if (/déposée : /.test(f) && !depotMatch(depots || [], f.split('déposée : ')[1])) alertes.push(`La voiture a été déposée ailleurs (${f.split('déposée : ')[1].split(' · ')[0]}) mais cette mission part de notre dépôt : vérifier où elle est.`)

    let titre = '', message = ''
    const reponses: VeilleCard['reponses'] = []
    if (s.kind === 'figee_attribuee') {
      titre = `${isRel ? 'Relivraison' : 'Mission'} sans pointage depuis ${Math.round(s.since)} h`
      message = `${par ? `Tu as donné cette ${isRel ? 'relivraison' : 'mission'} à ${chauffeur || 'un chauffeur'} le ${fmt(m.assigned_at || m.accepted_at)}.` : `Elle est à ${chauffeur || 'un chauffeur'}.`} Dernier pointage ${fmt(last)}${m.loaded_at ? ' (chargé)' : ', pas chargée'} et depuis plus rien. Il se passe quoi ?`
      if (isRel && !m.loaded_at && m.parent_mission_id) reponses.push({ id: 'remettre_a_relivrer', libelle: `${chauffeur || 'Le chauffeur'} ne peut pas, remets-la à relivrer`, effet: 'La relivraison est retirée au chauffeur et remise en réserve sur le dossier ; le véhicule reste au parc dans « À relivrer ». Le chauffeur est prévenu.', principale: true })
      else if (!m.loaded_at) reponses.push({ id: 'retirer', libelle: 'Retire-la au chauffeur', effet: 'La mission repasse « à dispatcher » sans chauffeur ; le chauffeur est prévenu.', principale: true })
      reponses.push({ id: 'relancer', libelle: `Relance ${chauffeur || 'le chauffeur'}`, effet: 'Le chauffeur reçoit une notification « ta mission est toujours ouverte ».' })
      reponses.push({ id: 'plus_tard', libelle: 'C’est prévu plus tard', effet: 'Je ne t’en reparle pas avant 12 h.' })
    } else if (s.kind === 'figee_sans_chauffeur') {
      titre = `Sans chauffeur depuis ${Math.round(s.since)} h`
      message = `Cette mission ${m.source || ''} attend depuis ${fmt(m.received_at)}, personne dessus. On fait quoi ?`
      if (twin) {
        const couvert = twin.invoice_number || /sia_couvert/i.test(String(twin.source)) || /touring|vab|axa|allianz|mondial|ethias|ima|europ/i.test(String(twin.billed_to_name || ''))
        reponses.push({ id: `rattacher:${twin.id}`, libelle: `C’est la relivraison d’un véhicule qu’on a (#${twin.mission_number})`, effet: `Cette commande devient la relivraison du dossier #${twin.mission_number} avec ses numéros d’assistance (la clôture partira chez eux)${twin.status === 'parked' ? ', en réserve dans « À relivrer »' : ', à attribuer'}.${couvert ? '' : ' Le premier remorquage est non couvert et pas facturé : je te demanderai si l’assistance le prend aussi en charge.'}`, principale: true })
      }
      reponses.push({ id: 'je_men_occupe', libelle: 'Je m’en occupe', effet: 'Tu l’attribues toi-même ; je ne t’en reparle pas avant 4 h.', principale: !twin })
      reponses.push({ id: 'plus_tard', libelle: 'C’est prévu plus tard', effet: 'Je ne t’en reparle pas avant 12 h.' })
    } else {
      titre = 'Commande à trier'
      message = `Commande ${m.source || ''} en attente depuis ${fmt(m.received_at)}. Elle est encore à faire ?`
      reponses.push({ id: 'a_faire', libelle: 'À faire', effet: 'Elle reste à dispatcher ; je ne te la redemande pas avant 7 jours.', principale: true })
      reponses.push({ id: 'deja_fait', libelle: 'Déjà fait', effet: 'Elle passe en « à facturer » (faite sans pointage dans l’app), avec la remarque.' })
    }
    out.push({ id: row.id, kind: s.kind, mission, depuis_h: Math.round(s.since), dernier_pointage: last, attribuee_par: par, pour_moi: !!row.owner_user_id, titre, message, faits, raisonnement, alertes, verifie, reponses })
  }
  // Les miennes d'abord, puis les plus anciennes ; les commandes à trier à la fin.
  const rank = (c: VeilleCard) => (c.kind === 'tri_commandes' ? 2 : c.pour_moi ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b) || b.depuis_h - a.depuis_h)
}

/** Applique la réponse choisie. Renvoie une phrase de Max pour la carte. */
export async function answerVeille(sb: Sb, cardId: string, reponse: string, user: { id: string; name: string }): Promise<string> {
  const { data: row } = await sb.from('max_veille').select('*').eq('id', cardId).maybeSingle()
  if (!row) throw new Error('Question introuvable.')
  if (row.status !== 'ouverte') return 'Déjà réglé par quelqu’un d’autre 👍'
  const { data: m } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, assigned_to, status, loaded_at').eq('id', row.mission_id).maybeSingle()
  if (!m) throw new Error('Fiche introuvable.')
  const now = new Date().toISOString()
  const close = (status: 'reglee' | 'plus_tard', hours?: number) => sb.from('max_veille').update({ status, answer: reponse, answered_by: user.id, answered_at: now, snooze_until: hours ? new Date(Date.now() + hours * H).toISOString() : null }).eq('id', cardId)
  const log = (notes: string) => sb.from('mission_logs').insert({ mission_id: m.id, actor_id: user.id, action: 'max_veille', notes }).then(() => {}, () => {})
  if (reponse === 'remettre_a_relivrer') {
    const { remettreARelivrer } = await import('@/lib/missions/unrelivrer')
    const r = await remettreARelivrer(sb, m.id, user, 'chauffeur indisponible (réponse à Max)')
    await close('reglee'); return `C’est fait 🙌 Relivraison retirée${r.driver ? ` à ${r.driver}` : ''} et remise dans « À relivrer ».`
  }
  if (reponse === 'retirer') {
    if (m.loaded_at) throw new Error('Le véhicule est chargé : on ne retire pas la mission.')
    await sb.from('incoming_missions').update({ status: 'dispatching', assigned_to: null, assigned_at: null, accepted_at: null, on_way_at: null, truck_id: null, updated_at: now }).eq('id', m.id)
    if (m.assigned_to) { const { sendNotification } = await import('@/lib/notifications/send'); await sendNotification(m.assigned_to, 'mission_retiree', { title: `Mission retirée — ${m.vehicle_plate || ''}`, body: `Le bureau a retiré la mission #${m.mission_number ?? ''} : tu ne dois plus la faire.`, mission_id: m.id, action_url: '/mission' }).catch(() => {}) }
    await log(`${user.name} via Max : mission retirée au chauffeur, repasse à dispatcher.`)
    await close('reglee'); return 'C’est fait : elle repasse « à dispatcher », le chauffeur est prévenu.'
  }
  if (reponse === 'relancer') {
    if (m.assigned_to) { const { sendNotification } = await import('@/lib/notifications/send'); await sendNotification(m.assigned_to, 'mission_retiree', { title: `Mission toujours ouverte — ${m.vehicle_plate || ''}`, body: `La mission #${m.mission_number ?? ''} est toujours ouverte : tu la fais quand ? Pense à pointer.`, mission_id: m.id, action_url: `/mission/${m.id}` }).catch(() => {}) }
    await log(`${user.name} via Max : chauffeur relancé.`)
    await close('plus_tard', 6); return 'Relancé 📣 Je repasse dans 6 h si rien ne bouge.'
  }
  if (reponse.startsWith('rattacher:')) {
    const dossierId = reponse.split(':')[1]
    const { rattacherRelivraison } = await import('@/lib/missions/unrelivrer')
    const r = await rattacherRelivraison(sb, m.id, dossierId, user)
    await close('reglee')
    const { data: d } = await sb.from('incoming_missions').select('source, invoice_number, billed_to_name').eq('id', dossierId).maybeSingle()
    const couvert = !!d?.invoice_number || /sia_couvert/i.test(String(d?.source)) || /touring|vab|axa|allianz|mondial|ethias|ima|europ/i.test(String(d?.billed_to_name || ''))
    const base = `C’est fait 🙌 Rattachée au dossier #${r.dossier ?? ''} comme relivraison${r.mode === 'reserve' ? ', en réserve dans « À relivrer »' : ', à attribuer'}.`
    return couvert ? `${base} Le premier remorquage est déjà couvert ou facturé : rien à demander de plus.` : `${base} Le premier remorquage est non couvert et pas encore facturé : demande à l’assistance si elle le prend aussi en charge. Si oui, dis-le-moi dans la discussion et je mets le dossier à son nom.`
  }
  if (reponse === 'plus_tard') { await close('plus_tard', 12); return 'Ok, je t’en reparle dans 12 h si rien ne bouge ⏰' }
  if (reponse === 'je_men_occupe') { await close('plus_tard', 4); return 'Top, je te laisse faire 👍' }
  if (reponse === 'a_faire') { await log(`${user.name} via Max : commande toujours à faire.`); await close('plus_tard', 24 * 7); return 'Noté : elle reste à faire.' }
  if (reponse === 'deja_fait') {
    await sb.from('incoming_missions').update({ status: 'to_invoice', completed_at: now, updated_at: now }).eq('id', m.id).in('status', SANS_CHAUFFEUR)
    await sb.from('mission_remarks').insert({ mission_id: m.id, text: `Faite sans pointage dans l’app — confirmé par ${user.name} (Max, ${new Date().toLocaleDateString('fr-BE')}).`, created_by: user.id }).then(() => {}, () => {})
    await log(`${user.name} via Max : commande déjà faite → à facturer.`)
    await close('reglee'); return 'Noté : elle passe en « à facturer ».'
  }
  if (reponse === 'autre') { await close('plus_tard', 12); return 'Ok, on en parle dans la discussion.' }
  throw new Error('Réponse inconnue.')
}
