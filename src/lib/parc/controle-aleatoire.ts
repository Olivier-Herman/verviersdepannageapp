// src/lib/parc/controle-aleatoire.ts — contrôle aléatoire du parc (Olivier 17/11/2026, maquette
// https://claude.ai/artifact/1DStEWrJtFLfHRLRe3E2Dv validée).
//
// Au lieu des inventaires complets : le mardi et le jeudi à une heure tirée au sort entre 10 h et 15 h, le samedi entre
// 10 h et 11 h (heure de Bruxelles), 15 véhicules du parc à scanner. Une fenêtre s'ouvre au bureau (réglage
// controle_parc_user_ids = Jona ; Mobi en plus seulement si son agenda indique « Verviers Dépannage » à ce moment-là).
// On peut la repousser de 15 min, pas l'ignorer. « Faire le contrôle avec mon téléphone » envoie une notification qui
// ouvre les scans un par un (scanner l'étiquette, « Pas trouvé », « autre zone »). Le premier qui lance le contrôle le
// prend. Un véhicule pas trouvé arrive au bureau avec des pistes (levée, dernier contrôle, factures, mails, Domaine…).
//
// Tirage : levée de saisie définitive depuis plus de 7 jours = toujours ; Transit > 14 nuits, jamais contrôlé ou contrôle
// > 60 j (au-delà de 15 nuits) = priorité ; le reste au hasard, 3 fois plus de chances au-delà de 15 nuits. Jamais un véhicule vu présent depuis moins
// de 14 jours. Hors tirage : zones T (garagiste), S (cyclos), dépôt de Verviers, et véhicules déjà non localisés.

import type { createAdminClient } from '@/lib/supabase'
import { nightsBetween } from '@/lib/parc/nights'
import { sendNotification } from '@/lib/notifications/send'

type Sb = ReturnType<typeof createAdminClient>
export const NOTIF_BUREAU = 'controle_parc_aleatoire'
export const NOTIF_TEL = 'controle_parc_scan'
const NB = 15
const DAY = 86_400_000
// Plages (heure de Bruxelles) : jour de la semaine (0 = dimanche) → [début, fin) en minutes.
const PLAGES: Record<number, [number, number]> = { 2: [600, 900], 4: [600, 900], 6: [600, 660] }

const bxl = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]))
  return { wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(p.weekday)), jour: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) % 24 * 60 + Number(p.minute) }
}
/** Instant UTC d'une heure de Bruxelles donnée (jour AAAA-MM-JJ, minutes depuis minuit). */
function instantBxl(jour: string, minutes: number): Date {
  const guess = new Date(`${jour}T00:00:00Z`).getTime() + minutes * 60_000
  for (const off of [60, 120]) { const t = new Date(guess - off * 60_000); const b = bxl(t); if (b.jour === jour && b.min === minutes) return t }
  return new Date(guess - 60 * 60_000)
}

// ── Tirage ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Tire { mission_id: string; raison: string; zone: string | null; vu_avant_at: string | null }

export async function tirerVehicules(sb: Sb, nb = NB): Promise<Tire[]> {
  const { data } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, parc_zone_key, parked_at, created_at, levee_saisie_at, levee_saisie_type, police_levee_saisie_ok, parc_verified_at, parc_verified_present')
    .eq('status', 'parked').eq('dossier_leg', false)
  const now = Date.now()
  // « Vu » = dernier contrôle présent sur la fiche, ou dernier scan du contrôle complet du parc (table parc_controle_items).
  const vus = new Map<string, number>()
  for (let from = 0; ; from += 1000) {
    const { data: sc } = await sb.from('parc_controle_items').select('mission_id, scanned_at').not('mission_id', 'is', null).not('scanned_at', 'is', null).order('scanned_at', { ascending: false }).range(from, from + 999)
    for (const x of (sc || []) as any[]) { const t = Date.parse(x.scanned_at); if (t > (vus.get(x.mission_id) || 0)) vus.set(x.mission_id, t) }
    if (!sc || sc.length < 1000) break
  }
  for (const m of (data || []) as any[]) {
    const fiche = m.parc_verified_present === true && m.parc_verified_at ? Date.parse(m.parc_verified_at) : 0
    const t = Math.max(fiche, vus.get(m.id) || 0)
    m.vu_at = t ? new Date(t).toISOString() : null
  }
  // Hors tirage, comme le contrôle complet : T (chez le garagiste), S (cyclos), dépôt de Verviers (pas de scan sur place).
  const cands = ((data || []) as any[]).filter(m => !['T', 'S', 'Verviers'].includes(String(m.parc_zone_key || '')))
    .filter(m => !(m.vu_at && now - Date.parse(m.vu_at) < 14 * DAY))
  const nuits = (m: any) => nightsBetween(m.parked_at || m.created_at)
  const raisons = (m: any): { force: boolean; prio: boolean; txt: string[] } => {
    const txt: string[] = []
    const levee = (m.levee_saisie_at && (m.levee_saisie_type === 'definitive' || (!m.levee_saisie_type && m.police_levee_saisie_ok))) ? Math.floor((now - Date.parse(m.levee_saisie_at)) / DAY) : -1
    const force = levee > 7
    if (force) txt.push(`levée il y a ${levee} j, toujours au parc`)
    const transit = String(m.parc_zone_key || '') === 'Transit' && nuits(m) > 14
    if (transit) txt.push(`en Transit depuis ${nuits(m)} nuits`)
    if (!m.parc_zone_key) txt.push('sans zone')
    const jamais = !m.vu_at && nuits(m) > 15   // un véhicule récent n'est pas prioritaire (Olivier : contrôlé moins souvent)
    if (jamais) txt.push('jamais contrôlé')
    const vieux = !!m.vu_at && nuits(m) > 15 && now - Date.parse(m.vu_at) > 60 * DAY
    if (vieux) txt.push(`dernier contrôle il y a ${Math.floor((now - Date.parse(m.vu_at)) / DAY)} j`)
    if (!txt.length) txt.push(`${nuits(m)} nuits au parc`)
    else if (!force && !transit) txt.push(`${nuits(m)} nuits`)
    return { force, prio: transit || jamais || vieux || !m.parc_zone_key, txt }
  }
  const choisis: any[] = []
  const prendre = (liste: any[], n: number, poids: (m: any) => number) => {
    const pool = liste.filter(m => !choisis.includes(m))
    while (n-- > 0 && pool.length) {
      const total = pool.reduce((s, m) => s + poids(m), 0)
      let r = Math.random() * total, i = 0
      for (; i < pool.length - 1; i++) { r -= poids(pool[i]); if (r <= 0) break }
      choisis.push(pool.splice(i, 1)[0])
    }
  }
  const info = new Map(cands.map(m => [m.id, raisons(m)]))
  const poidsAge = (m: any) => (nuits(m) > 15 ? 3 : 1)
  prendre(cands.filter(m => info.get(m.id)!.force), nb, () => 1)                                    // toujours
  prendre(cands.filter(m => info.get(m.id)!.prio), Math.max(0, Math.min(10, nb) - choisis.length), poidsAge)   // priorité
  prendre(cands, nb - choisis.length, poidsAge)                                                   // le reste
  return choisis.map(m => ({ mission_id: m.id, raison: info.get(m.id)!.txt.join(' · '), zone: m.parc_zone_key || null, vu_avant_at: m.vu_at || null }))
}

async function rangerParZone(sb: Sb, tires: Tire[]): Promise<Tire[]> {
  const { data: zs } = await sb.from('parc_zones').select('key, sort_order')
  const rang = new Map<string, number>((zs || []).map((z: any) => [String(z.key), Number(z.sort_order ?? 999)]))
  return tires.map((t, i) => ({ t, i })).sort((a, b) =>
    (rang.get(String(a.t.zone)) ?? 999) - (rang.get(String(b.t.zone)) ?? 999) || String(a.t.zone || '').localeCompare(String(b.t.zone || '')) || a.i - b.i,
  ).map(x => x.t)
}

// ── Planning et envoi (tâche toutes les 5 min) ────────────────────────────────────────────────────────────────────
async function destinataires(_sb: Sb): Promise<string[]> {
  const { getBusinessList } = await import('@/lib/settings/business')
  const ids = new Set((await getBusinessList('controle_parc_user_ids').catch(() => [] as string[])).filter(Boolean))
  // Mobi : seulement quand son agenda indique « Verviers Dépannage » à ce moment-là (Olivier 17/11/2026).
  try {
    const { mobiEnHeuresVD } = await import('@/lib/notif/heures-mobi')
    if (await mobiEnHeuresVD()) for (const u of await getBusinessList('controle_parc_agenda_user_ids').catch(() => [] as string[])) if (u) ids.add(u)
  } catch { /* agenda illisible : seulement les comptes ci-dessus */ }
  return [...ids]
}

export async function tickControleParc(sb: Sb, opts: { force?: boolean } = {}): Promise<Record<string, any>> {
  const now = new Date(), b = bxl(now)
  const plage = PLAGES[b.wd]
  if (!plage && !opts.force) return { skipped: 'pas un jour de contrôle' }
  const { jourOuvrable } = await import('@/lib/paiements/fournisseurs')
  if (!opts.force && b.wd !== 6 && !jourOuvrable(now)) return { skipped: 'jour férié' }
  let { data: c } = await sb.from('parc_controles_aleatoires').select('*').eq('jour', b.jour).maybeSingle()
  if (!c) {
    const [a, z] = plage || [b.min, b.min + 1]
    const minute = opts.force ? b.min : a + Math.floor(Math.random() * (z - a))
    const prevu = instantBxl(b.jour, minute)
    const ins = await sb.from('parc_controles_aleatoires').insert({ jour: b.jour, prevu_at: prevu.toISOString() }).select('*').single()
    c = ins.data
    if (!c) return { skipped: 'création impossible', error: ins.error?.message }
  }
  if (c.status !== 'prevu') return { controle: c.id, status: c.status }
  if (!opts.force && now.getTime() < Date.parse(c.prevu_at)) return { controle: c.id, prevu_at: c.prevu_at }
  // C'est l'heure : on réserve le contrôle (un seul passage de la tâche le prend), puis tirage et fenêtre au bureau.
  const group = `cp-${c.id}`
  const { data: pris } = await sb.from('parc_controles_aleatoires').update({ status: 'demande', demande_at: now.toISOString(), request_group: group }).eq('id', c.id).eq('status', 'prevu').select('id')
  if (!pris?.length) return { controle: c.id, deja: true }
  // Rangés par zone, dans l'ordre du parc (Olivier 17/11/2026 : « ne pas courir dans tous les sens dans le parking »).
  const tires = await rangerParZone(sb, await tirerVehicules(sb))
  if (!tires.length) { await sb.from('parc_controles_aleatoires').update({ status: 'termine', termine_at: now.toISOString() }).eq('id', c.id); return { controle: c.id, vide: true } }
  await sb.from('parc_aleatoire_items').insert(tires.map((t, i) => ({ controle_id: c.id, mission_id: t.mission_id, ordre: i + 1, raison: t.raison, zone_attendue: t.zone, vu_avant_at: t.vu_avant_at })))
  const users = await destinataires(sb)
  let recus = 0
  for (const u of users) {
    const r: any = await sendNotification(u, NOTIF_BUREAU, {
      title: '🔍 Contrôle du parc : 15 véhicules à scanner',
      body: 'Ouvre le contrôle sur ton téléphone. Tu peux le repousser de 15 minutes, mais il doit se faire.',
      action_url: '/fourriere/controle-aleatoire/' + c.id,
      data: { modal: true, kind: 'controle_parc', controle_id: c.id, request_group: group },
    }).catch(() => null)
    if (r?.ok) recus++
  }
  // Personne ne l'a reçu (17/11/2026 : réglage des destinataires absent, contrôle parti dans le vide sans que personne
  // le sache) : Mobi est prévenu tout de suite, quel que soit son agenda.
  if (!recus) {
    try {
      const { getBusinessNumber } = await import('@/lib/settings/business')
      const { notifierTelegram } = await import('@/lib/notif/heures-mobi')
      const chat = await getBusinessNumber('telegram_chat_mobi')
      await notifierTelegram(chat, `⚠️ Contrôle aléatoire du parc : la fenêtre n'a pu être envoyée à personne (${users.length ? 'envoi refusé' : 'aucun destinataire dans les réglages'}). Les 15 véhicules sont tirés : ouvre ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'}/fourriere/controle-aleatoire/${c.id}`, [], undefined, { urgent: true })
    } catch (e: any) { console.error('[controle-parc] alerte impossible :', e?.message) }
  }
  return { controle: c.id, envoye_a: recus, destinataires: users.length, vehicules: tires.length }
}

// ── Lecture ───────────────────────────────────────────────────────────────────────────────────────────────────────
export async function lireControle(sb: Sb, id: string) {
  const { data: c } = await sb.from('parc_controles_aleatoires').select('*').eq('id', id).maybeSingle()
  if (!c) return null
  const { data: items } = await sb.from('parc_aleatoire_items').select('*').eq('controle_id', id).order('ordre')
  const ids = (items || []).map((i: any) => i.mission_id)
  const { data: ms } = ids.length ? await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, source, parc_zone_key, parked_at, created_at, levee_saisie_at, status, driver_photos').in('id', ids) : { data: [] as any[] }
  const par = new Map((ms || []).map((m: any) => [m.id, m]))
  return { controle: c, items: (items || []).map((i: any) => ({ ...i, fiche: par.get(i.mission_id) || null })) }
}

// ── Démarrage et réponses ─────────────────────────────────────────────────────────────────────────────────────────
export async function demarrer(sb: Sb, id: string, user: { id: string; name: string | null }): Promise<{ ok: boolean; error?: string; deja?: string | null }> {
  const now = new Date().toISOString()
  const { data } = await sb.from('parc_controles_aleatoires').update({ status: 'en_cours', started_at: now, started_by: user.id, started_by_name: user.name }).eq('id', id).eq('status', 'demande').select('id, request_group')
  if (!data?.length) {
    const { data: c } = await sb.from('parc_controles_aleatoires').select('status, started_by, started_by_name').eq('id', id).maybeSingle()
    if (c?.status === 'en_cours' && c.started_by === user.id) return { ok: true }
    return { ok: false, deja: c?.started_by_name || null, error: c?.status === 'en_cours' ? `Déjà lancé par ${c.started_by_name || 'quelqu’un'}.` : 'Ce contrôle est terminé.' }
  }
  // Fenêtre fermée chez les autres ; elle reste ouverte chez celui qui a lancé (suivi en direct).
  await sb.from('notifications_log').update({ responded_at: now, read_at: now }).eq('notif_type', NOTIF_BUREAU).is('responded_at', null)
    .eq('payload->data->>request_group', data[0].request_group).neq('user_id', user.id)
  await sendNotification(user.id, NOTIF_TEL, {
    title: '🔍 Contrôle du parc : 15 véhicules',
    body: 'Touchez pour commencer les scans.',
    action_url: `/fourriere/controle-aleatoire/${id}`,
    data: { kind: 'controle_parc_scan', controle_id: id },
  }).catch(() => {})
  return { ok: true }
}

const cleDuQr = (txt: string): { uuid?: string; numero?: number } => {
  const t = String(txt || '').trim()
  const m = t.match(/\/qr\/mission\/([A-Za-z0-9-]+)/i)
  if (m) return /^\d+$/.test(m[1]) ? { numero: Number(m[1]) } : { uuid: m[1] }
  const v = t.match(/\/v\/(\d+)/)
  if (v) return { numero: Number(v[1]) }
  if (/^\d+$/.test(t)) return { numero: Number(t) }
  return {}
}

async function finSiComplet(sb: Sb, id: string) {
  const { data: rest } = await sb.from('parc_aleatoire_items').select('id').eq('controle_id', id).is('resultat', null).limit(1)
  if ((rest || []).length) return false
  const now = new Date().toISOString()
  const { data: c } = await sb.from('parc_controles_aleatoires').update({ status: 'termine', termine_at: now }).eq('id', id).neq('status', 'termine').select('request_group')
  if (c?.length) await sb.from('notifications_log').update({ responded_at: now, read_at: now }).eq('notif_type', NOTIF_BUREAU).is('responded_at', null).eq('payload->data->>request_group', c[0].request_group)
  return true
}

/** Réponse du téléphone pour un véhicule. */
export async function repondre(sb: Sb, id: string, itemId: string, user: { id: string; name: string | null }, r: { action: 'scan'; qr: string } | { action: 'absent' } | { action: 'autre_zone'; zone: string }):
  Promise<{ ok: boolean; error?: string; autre?: string; termine?: boolean }> {
  const { data: it } = await sb.from('parc_aleatoire_items').select('*').eq('id', itemId).eq('controle_id', id).maybeSingle()
  if (!it) return { ok: false, error: 'Véhicule introuvable dans ce contrôle.' }
  const now = new Date().toISOString()
  const { data: m } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, odoo_helpdesk_id, parc_zone_key').eq('id', it.mission_id).single()
  if (r.action === 'scan') {
    const k = cleDuQr(r.qr)
    const bon = (k.uuid && k.uuid === m!.id) || (k.numero && (k.numero === m!.mission_number || k.numero === (m as any).odoo_helpdesk_id))
    if (!bon) {
      let autre = 'une étiquette non reconnue'
      if (k.uuid || k.numero) {
        const q = sb.from('incoming_missions').select('mission_number, vehicle_plate, parc_zone_key')
        const { data: o } = k.uuid ? await q.eq('id', k.uuid).maybeSingle() : await q.or(`mission_number.eq.${k.numero},odoo_helpdesk_id.eq.${k.numero}`).limit(1).maybeSingle()
        if (o) autre = `${o.vehicle_plate || 'sans plaque'} (#${o.mission_number}${o.parc_zone_key ? `, zone ${o.parc_zone_key}` : ''})`
      }
      return { ok: false, autre, error: `Ce n’est pas le bon véhicule : tu as scanné ${autre}.` }
    }
    await sb.from('parc_aleatoire_items').update({ resultat: 'present', repondu_at: now }).eq('id', it.id)
    await sb.from('incoming_missions').update({ parc_verified_at: now, parc_verified_present: true, parc_verified_by: user.id }).eq('id', m!.id)
    await sb.from('mission_logs').insert({ mission_id: m!.id, actor_id: user.id, action: 'parc_verified', notes: `Contrôle aléatoire du parc : présent${m!.parc_zone_key ? ` en zone ${m!.parc_zone_key}` : ''} (scan de ${user.name || '—'}).` })
  } else if (r.action === 'autre_zone') {
    const zone = String(r.zone || '').trim().slice(0, 20)
    if (!zone) return { ok: false, error: 'Zone obligatoire.' }
    await sb.from('parc_aleatoire_items').update({ resultat: 'autre_zone', zone_trouvee: zone, repondu_at: now }).eq('id', it.id)
    await sb.from('incoming_missions').update({ parc_zone_key: zone, parc_row_number: null, parc_slot_index: null, parc_verified_at: now, parc_verified_present: true, parc_verified_by: user.id, updated_at: now }).eq('id', m!.id)
    await sb.from('mission_logs').insert({ mission_id: m!.id, actor_id: user.id, action: 'parc_transfer', notes: `Contrôle aléatoire du parc : trouvé en zone ${zone} (attendu ${it.zone_attendue || '—'}) par ${user.name || '—'}.`, metadata: { from_zone_key: it.zone_attendue, to_zone_key: zone, source: 'controle_aleatoire' } })
  } else {
    await sb.from('parc_aleatoire_items').update({ resultat: 'absent', repondu_at: now }).eq('id', it.id)
    await sb.from('incoming_missions').update({ parc_verified_at: now, parc_verified_present: false, parc_verified_by: user.id }).eq('id', m!.id)
    await sb.from('mission_logs').insert({ mission_id: m!.id, actor_id: user.id, action: 'parc_verified', notes: `Contrôle aléatoire du parc : PAS TROUVÉ (attendu en zone ${it.zone_attendue || '—'}), signalé par ${user.name || '—'}. Recherche à faire au bureau.` })
  }
  return { ok: true, termine: await finSiComplet(sb, id) }
}

// ── Pistes de recherche pour un véhicule pas trouvé ──────────────────────────────────────────────────────────────
export interface Piste { icone: string; texte: string }
export async function pistes(sb: Sb, itemId: string): Promise<Piste[]> {
  const { data: it } = await sb.from('parc_aleatoire_items').select('mission_id, vu_avant_at').eq('id', itemId).single()
  const { data: m } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, vehicle_vin, source, levee_saisie_at, levee_saisie_type, invoice_odoo_id, domaine_remise_date').eq('id', it!.mission_id).single()
  const out: Piste[] = []
  const d = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' }) : '—'
  if (m!.levee_saisie_at) out.push({ icone: '🔓', texte: `Levée de saisie ${m!.levee_saisie_type === 'temporaire' ? 'temporaire' : 'définitive'} le ${d(m!.levee_saisie_at)} : le propriétaire pouvait venir le chercher.` })
  out.push({ icone: '👁️', texte: it!.vu_avant_at ? `Dernier contrôle « présent » avant celui-ci : le ${d(it!.vu_avant_at)}.` : 'Jamais contrôlé présent avant ce contrôle.' })
  if (m!.domaine_remise_date) out.push({ icone: '🏛️', texte: `Remis au Domaine le ${d(m!.domaine_remise_date)} : vérifier les ventes d’épaves.` })
  const { data: vente } = await sb.from('domaine_ventes_epaves').select('vente_date, firm, sortie_reelle_date').eq('matched_mission_id', m!.id).limit(1).maybeSingle()
  if (vente) out.push({ icone: '🚛', texte: `Vendu par le Domaine le ${d(vente.vente_date)} à ${vente.firm || '—'}${vente.sortie_reelle_date ? `, sortie notée le ${d(vente.sortie_reelle_date)}` : ', sortie pas encore notée'}.` })
  try {
    const { odooRpc } = await import('@/lib/odoo')
    const plaque = String(m!.vehicle_plate || '').split('/')[0].trim()
    const dom: any[] = m!.invoice_odoo_id ? [['id', '=', m!.invoice_odoo_id]] : plaque ? ['|', ['invoice_origin', 'ilike', plaque], ['ref', 'ilike', plaque]] : []
    if (dom.length) {
      const inv: any[] = await odooRpc('account.move', 'search_read', [[['move_type', 'in', ['out_invoice', 'out_refund']], ...dom]], { fields: ['name', 'invoice_date', 'amount_total', 'payment_state', 'partner_id'], limit: 5 })
      if (inv.length) for (const f of inv) out.push({ icone: '🧾', texte: `Facture ${f.name} du ${d(f.invoice_date)} à ${f.partner_id?.[1] || '—'} : ${f.amount_total} € (${f.payment_state === 'paid' || f.payment_state === 'in_payment' ? 'payée' : 'pas payée'}).` })
      else out.push({ icone: '🧾', texte: 'Aucune facture à cette plaque.' })
    }
  } catch { /* ERP injoignable : pas de piste facture */ }
  const { data: logs } = await sb.from('mission_logs').select('created_at, action, notes').eq('mission_id', m!.id).in('action', ['visitor', 'restitution', 'force_status_to_invoice', 'levee_saisie', 'parc_transfer', 'domaine_sortie', 'note']).order('created_at', { ascending: false }).limit(4)
  for (const l of logs || []) out.push({ icone: '📋', texte: `${d(l.created_at)} : ${String(l.notes || l.action).slice(0, 160)}` })
  try {
    const { searchAllMailboxes } = await import('@/lib/graph-mail-search')
    const plaque = String(m!.vehicle_plate || '').split('/')[0].trim()
    if (plaque.length >= 5) {
      const hits: any[] = await searchAllMailboxes(plaque, 4)
      for (const h of hits) out.push({ icone: '✉️', texte: `Mail ${h.mailboxLabel || ''} : « ${String(h.subject || '').slice(0, 90)} »` })
    }
  } catch { /* boîtes injoignables */ }
  return out
}

/** Décision au bureau pour un véhicule pas trouvé. */
export async function resoudre(sb: Sb, itemId: string, user: { id: string; name: string | null }, r: { choix: 'retrouve'; zone: string } | { choix: 'restitue' | 'domaine'; date: string } | { choix: 'epave' | 'recherche' }, note?: string): Promise<{ ok: boolean; error?: string }> {
  const { data: it } = await sb.from('parc_aleatoire_items').select('*').eq('id', itemId).maybeSingle()
  if (!it || it.resultat !== 'absent') return { ok: false, error: 'Ce véhicule n’est pas à rechercher.' }
  const now = new Date().toISOString()
  const qui = user.name || '—'
  const memo = note ? ` — ${String(note).slice(0, 300)}` : ''
  if (r.choix === 'retrouve') {
    const zone = String(r.zone || '').trim().slice(0, 20); if (!zone) return { ok: false, error: 'Zone obligatoire.' }
    await sb.from('incoming_missions').update({ status: 'parked', parc_zone_key: zone, parc_verified_at: now, parc_verified_present: true, parc_verified_by: user.id, updated_at: now }).eq('id', it.mission_id)
    await sb.from('mission_logs').insert({ mission_id: it.mission_id, actor_id: user.id, action: 'parc_transfer', notes: `Retrouvé en zone ${zone} après le contrôle aléatoire (${qui})${memo}.` })
  } else if (r.choix === 'restitue' || r.choix === 'domaine') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? `${r.date}T11:00:00.000Z` : now
    const { data: m } = await sb.from('incoming_missions').select('status').eq('id', it.mission_id).single()
    if (m?.status === 'parked') {
      const { exitParcNow } = await import('@/lib/parc/exit-parc')
      const ex: any = await exitParcNow(sb, it.mission_id, { id: user.id, name: user.name }, r.choix === 'restitue' ? 'restitution' : 'sortie', `contrôle aléatoire : ${r.choix === 'restitue' ? 'restitué au propriétaire' : 'vendu ou remis au Domaine'}${memo}`)
      if (!ex.ok) return { ok: false, error: ex.error }
    }
    await sb.from('incoming_missions').update({ completed_at: date }).eq('id', it.mission_id)
    await sb.from('incoming_missions').update({ parc_exit_at: date }).eq('parent_mission_id', it.mission_id).eq('dossier_leg', true).not('parc_exit_at', 'is', null)
  } else if (r.choix === 'epave') {
    const { scratchMission } = await import('@/lib/missions/scratch')
    const s: any = await scratchMission(sb, it.mission_id, user.id, `contrôle aléatoire : parti chez un épaviste${memo}`)
    if (!s.ok) return { ok: false, error: s.error }
  } else {
    await sb.from('incoming_missions').update({ status: 'unlocated', unlocated_at: now, unlocated_zone: it.zone_attendue, updated_at: now }).eq('id', it.mission_id).eq('status', 'parked')
    await sb.from('mission_logs').insert({ mission_id: it.mission_id, actor_id: user.id, action: 'unlocated', notes: `Pas trouvé au contrôle aléatoire, recherche en cours (${qui})${memo}.` })
  }
  await sb.from('parc_aleatoire_items').update({ resolution: r.choix, resolution_note: note || null, resolu_at: now, resolu_by: user.id }).eq('id', itemId)
  return { ok: true }
}
