// src/lib/sam/copilote.ts — Sam, copilote du chauffeur (Olivier 14/10/2026, maquette validée le 14/10).
//
// Sam ne répond plus seulement quand on l'appelle : un passage planifié (cron sam-copilote, toutes les
// 2 min) regarde les missions en cours et, dès qu'il voit ce qui va bloquer le chauffeur, lui écrit le
// PREMIER avec les choix en boutons. Un choix touché = la réponse du chauffeur ; VD Soft exécute
// lui-même (liste fermée ci-dessous), avec les droits du chauffeur. Jamais de clôture, d'encaissement ni
// d'annulation à sa place.
//
// Cas : lieu d'intervention / destination non reconnus (adresses Google proposées), Siabis sans scénario,
// Siabis non couvert sans montant à encaisser, véhicule chargé depuis longtemps sans « Arrivé ».
// Une alerte par problème et par mission (table sam_alertes) ; résolue d'elle-même quand le problème
// disparaît ; sans réponse après 10 min, le dispatch est prévenu.
//
// Textes écrits ici (fr + sq), sans appel d'IA : instantané, et le chauffeur peut ensuite écrire
// librement à Sam, qui reprend la conversation normalement.

import { createAdminClient } from '@/lib/supabase'
import { agentDeService } from './core'
import { recordCopilote } from './journal'

type Sb = ReturnType<typeof createAdminClient>
type Lang = 'fr' | 'sq'
export type Bouton = { libelle: string; valeur: string }
type Kind = 'adresse_intervention' | 'adresse_destination' | 'garage_agree' | 'siabis_scenario' | 'snc_montant' | 'pas_arrive'

const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com').replace(/\/$/, '')
const SIABIS = ['police_snc', 'sia_couvert']
const isRem = (t: string | null | undefined) => /remorq|^rem|rem\+|relivraison|^rel$|transport/i.test(String(t || ''))
const minDepuis = (iso: string | null | undefined) => (iso ? (Date.now() - new Date(iso).getTime()) / 60_000 : 0)
const prenom = (n: string | null | undefined) => String(n || '').trim().split(/\s+/)[0] || ''

// ── Détection ─────────────────────────────────────────────────────────────────

interface Probleme { kind: Kind; texte: string; boutons: Bouton[]; donnees?: any }

/** Minutes de trajet estimées entre le chargement et la destination, sans aucun service payant : vol d'oiseau × 1,3
 *  (les routes ne sont pas droites) à 70 km/h de moyenne ; null si une position manque. */
export function trajetEstimeMin(m: { incident_lat?: any; incident_lng?: any; destination_lat?: any; destination_lng?: any }): number | null {
  const a = [Number(m.incident_lat), Number(m.incident_lng)], b = [Number(m.destination_lat), Number(m.destination_lng)]
  if ([m.incident_lat, m.incident_lng, m.destination_lat, m.destination_lng].some(x => x == null) || [...a, ...b].some(x => !Number.isFinite(x))) return null
  const R = 6371, rad = (d: number) => d * Math.PI / 180
  const s = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2
  const km = 2 * R * Math.asin(Math.min(1, Math.sqrt(s))) * 1.3
  return Math.round(km / 70 * 60)
}
function delaiPasArrive(m: any, defaut: number): number {
  const t = trajetEstimeMin(m)
  return t == null ? defaut : t + 30
}

export async function detecter(sb: Sb, m: any, lang: Lang, pasArriveMin: number): Promise<Probleme | null> {
  const L = (fr: string, sq: string) => (lang === 'sq' ? sq : fr)
  const p = prenom(m.driver_name)
  const plaque = m.vehicle_plate || L('le véhicule', 'automjeti')
  const { ensureMissionCoords, placesCandidates } = await import('@/lib/geocode/server')

  // 1. Lieu d'intervention sans position (avant le chargement).
  if (['accepted', 'in_progress'].includes(m.status) && !m.loaded_at && m.incident_address && m.incident_lat == null && minDepuis(m.accepted_at) >= 1) {
    const fixed = await ensureMissionCoords(sb, m.id).catch(() => null)   // autoroute, adresse simple : réglé sans le déranger
    if (!fixed?.incident) {
      const cands = await placesCandidates([m.incident_address, m.incident_city].filter(Boolean).join(', '), { max: 3, proche: true })
      return {
        kind: 'adresse_intervention', donnees: { candidats: cands },
        texte: L(`${p ? `${p}, l` : 'L'}e lieu d'intervention « ${m.incident_address} » n'est pas reconnu sur la carte : la navigation et le prix ne se calculent pas.${cands.length ? ' C\'est l\'un de ceux-ci ?' : ' Écris-moi la bonne adresse.'}`,
                 `${p ? `${p}, v` : 'V'}endi i ndërhyrjes « ${m.incident_address} » nuk njihet në hartë: navigimi dhe çmimi nuk llogariten.${cands.length ? ' A është një nga këto?' : ' Më shkruaj adresën e saktë.'}`),
        boutons: [...cands.map((c, i) => ({ libelle: `📍 ${c.label}`, valeur: `addr:incident:${i}` })), { libelle: L('Aucune, je t\'écris l\'adresse', 'Asnjë, ta shkruaj adresën'), valeur: 'addr:aucune' }],
      }
    }
  }

  // 2 bis. Touring « réseau agréé » (« centrale de pneu ») : un garage DE LA LISTE TOURING, pas la société du même
  //    nom trouvée sur la carte (Olivier 29/10/2026, 2HGW277). Proposé dès qu'il est sur place, avant le chargement.
  if (isRem(m.mission_type) && ['in_progress', 'delivering'].includes(m.status) && (m.on_site_at || m.loaded_at)) {
    const { destinationReseauAgree, garagesAgrees } = await import('@/lib/touring/garages-agrees')
    if (destinationReseauAgree(m)) {
      const { count: choisi } = await sb.from('mission_logs').select('id', { count: 'exact', head: true }).eq('mission_id', m.id).eq('action', 'touring_garage_choisi')
      if (!choisi) {
        const cands = await garagesAgrees(m, 4).catch(() => [])
        if (cands.length) return {
          kind: 'garage_agree', donnees: { candidats: cands },
          texte: L(`Touring veut ${plaque} dans un garage de son réseau agréé (« ${m.destination_address || 'réseau agréé'} »), pas n'importe lequel. Lequel ?${cands[0].demande ? ` Le premier est à ${cands[0].label.split(',').pop()?.trim()}, comme demandé par le client ; les autres sont les plus proches.` : ' Voici les plus proches.'}`,
                   `Touring e do ${plaque} në një garazh të rrjetit të tij të miratuar (« ${m.destination_address || 'rrjeti i miratuar'} »). Cilin?${cands[0].demande ? ' I pari është ai që kërkoi klienti, të tjerët janë më të afërt.' : ' Ja më të afërtit.'}`),
          boutons: [...cands.map((c, i) => ({ libelle: `🔧 ${c.nom} (${c.label.split(',').pop()?.trim()})`, valeur: `addr:destination:${i}` })), { libelle: L('Un autre, je t\'écris lequel', 'Një tjetër, ta shkruaj'), valeur: 'addr:aucune' }],
        }
      }
    }
  }

  // 2. Destination sans position (remorquage, une fois sur place ou chargé).
  if (isRem(m.mission_type) && ['in_progress', 'delivering'].includes(m.status) && (m.on_site_at || m.loaded_at)
      && m.destination_address && (m.destination_lat == null || m.destination_lng == null)) {
    const fixed = await ensureMissionCoords(sb, m.id).catch(() => null)
    if (!fixed?.destination) {
      const cands = await placesCandidates(m.destination_address, { max: 3, rayonKm: 250 })   // relivraisons lointaines (Anvers, Cologne) comprises
      return {
        kind: 'adresse_destination', donnees: { candidats: cands },
        texte: L(`La destination « ${m.destination_address} » n'est pas reconnue sur la carte : sans elle, le km et le prix ne se calculent pas.${cands.length ? ' C\'est l\'une de celles-ci ?' : ' Écris-moi la bonne adresse.'}`,
                 `Destinacioni « ${m.destination_address} » nuk njihet në hartë: pa të, km dhe çmimi nuk llogariten.${cands.length ? ' A është një nga këto?' : ' Më shkruaj adresën e saktë.'}`),
        boutons: [...cands.map((c, i) => ({ libelle: `📍 ${c.label}`, valeur: `addr:destination:${i}` })), { libelle: L('Aucune, je t\'écris l\'adresse', 'Asnjë, ta shkruaj adresën'), valeur: 'addr:aucune' }],
      }
    }
  }

  // 3. Siabis sur place sans scénario.
  //    10 min et pas 2 : l'écran « Qu'est-ce qu'on fait ? » est déjà ouvert sur place, le chauffeur parle d'abord
  //    à la police ou au client (Olivier 28/10/2026 : 12 relances en un mois, souvent trop tôt).
  if (SIABIS.includes(m.source) && !m.snc_scenario && m.on_site_at && minDepuis(m.on_site_at) >= 10 && ['in_progress', 'delivering'].includes(m.status)) {
    const sc = m.source === 'sia_couvert'
    const charge = !!m.loaded_at
    const dest = m.destination_address ? ` (${String(m.destination_address).split(',')[0]})` : ''
    const boutons: Bouton[] = [
      sc ? { libelle: L(`🚛 Remorquage direct${dest}`, `🚛 Rimorkim direkt${dest}`), valeur: 'scen:rem_direct' }
         : { libelle: L(`🚛 Remorquage, le client paie maintenant${dest}`, `🚛 Rimorkim, klienti paguan tani${dest}`), valeur: 'scen:rem_client' },
      { libelle: L('🏢 Remorquage vers notre dépôt', '🏢 Rimorkim drejt depos sonë'), valeur: 'scen:rem_depot' },
      ...(charge ? [] : [{ libelle: L('🔧 Dépannage sur place', '🔧 Riparim në vend'), valeur: 'scen:dsp' }]),
    ]
    return {
      kind: 'siabis_scenario', boutons,
      texte: L(`Tu es ${charge ? 'chargé' : 'sur place'} pour le Siabis ${sc ? 'couvert' : 'non couvert'} ${plaque}, mais le scénario n'est pas choisi : sans lui, ${sc ? 'la facture' : 'pas de montant à encaisser'} et pas de clôture. Tu fais quoi ?`,
               `Je ${charge ? 'ngarkuar' : 'në vend'} për Siabis ${sc ? 'të mbuluar' : 'të pambuluar'} ${plaque}, por skenari nuk është zgjedhur: pa të, nuk ka mbyllje. Çfarë po bën?`),
    }
  }

  // 4. Siabis non couvert : montant à encaisser toujours vide.
  if (m.source === 'police_snc' && ['rem_client', 'rem_direct', 'dsp'].includes(m.snc_scenario || '') && m.amount_to_collect == null && !m.payment_amount
      && ((m.loaded_at && m.status === 'delivering') || (m.snc_scenario === 'dsp' && minDepuis(m.on_site_at) >= 10))) {
    const sansDest = m.snc_scenario !== 'dsp' && (m.destination_lat == null || m.destination_lng == null)
    return {
      kind: 'snc_montant',
      texte: L(`Le client doit payer sur place, mais le montant n'est pas calculé${sansDest ? ' : la destination n\'a pas de position' : ''}. ${sansDest ? 'Quand tu es arrivé, appuie sur « Arrivé à destination » sur ta fiche : je prends ta position et le montant se calcule.' : 'Je préviens le dispatch pour le fixer.'}`,
               `Klienti duhet të paguajë në vend, por shuma nuk është llogaritur${sansDest ? ': destinacioni nuk ka pozicion' : ''}. ${sansDest ? 'Kur të arrish, shtyp « Arrita në destinacion » në fishë: marr pozicionin tënd dhe shuma llogaritet.' : 'Po njoftoj dispeçerin për ta caktuar.'}`),
      boutons: sansDest
        ? [{ libelle: L('📂 Ouvrir ma fiche', '📂 Hap fishën'), valeur: 'open' }, { libelle: L('Pas encore arrivé', 'Ende nuk kam arritur'), valeur: 'ok' }]
        : [{ libelle: L('OK, j\'attends le dispatch', 'OK, pres dispeçerin'), valeur: 'disp' }],
    }
  }

  // 5. Chargé depuis longtemps, jamais « Arrivé à destination ». Délai = trajet estimé + 30 min quand les deux
  //    positions sont connues (Olivier 28/10/2026 : un long trajet est normal), sinon le réglage (90 min).
  if (m.status === 'delivering' && m.loaded_at && minDepuis(m.loaded_at) >= delaiPasArrive(m, pasArriveMin) && !SIABIS.includes(m.source)) {
    const ou = m.destination_address ? String(m.destination_address).split(',').slice(0, 2).join(',') : L('la destination', 'destinacioni')
    return {
      kind: 'pas_arrive',
      texte: L(`${plaque} est chargé depuis ${Math.round(minDepuis(m.loaded_at))} min. Tu es arrivé à ${ou} ?`,
               `${plaque} është ngarkuar prej ${Math.round(minDepuis(m.loaded_at))} min. A ke arritur në ${ou}?`),
      boutons: [
        { libelle: L('✅ Oui, je l\'ai déposé', '✅ Po, e kam lënë'), valeur: 'arr:oui' },
        { libelle: L('🚛 Pas encore, je suis en route', '🚛 Ende jo, jam në rrugë'), valeur: 'ok' },
        { libelle: L('🔁 La destination a changé', '🔁 Destinacioni ka ndryshuar'), valeur: 'addr:aucune' },
      ],
    }
  }
  return null
}

// ── Passage planifié ──────────────────────────────────────────────────────────

export async function tickCopilote(opts: { dryRun?: boolean } = {}): Promise<{ missions: number; envoyees: number; resolues: number; dispatch: number; apercu?: string[] }> {
  const sb = createAdminClient()
  const stats: { missions: number; envoyees: number; resolues: number; dispatch: number; apercu?: string[] } = { missions: 0, envoyees: 0, resolues: 0, dispatch: 0, apercu: [] }
  const { getBusinessNumber } = await import('@/lib/settings/business')
  const pasArriveMin = await getBusinessNumber('sam_copilote_pas_arrive_min').catch(() => 90)
  const { data: ms, error } = await sb.from('incoming_missions')
    .select('id, mission_number, source, status, mission_type, assigned_to, vehicle_plate, incident_address, incident_city, incident_lat, destination_address, destination_lat, destination_lng, snc_scenario, amount_to_collect, payment_amount, accepted_at, on_site_at, loaded_at, incident_lng, raw_content, destination_name, incident_description, touring_actions')
    .in('status', ['accepted', 'in_progress', 'delivering']).not('assigned_to', 'is', null).limit(80)
  if (error) throw new Error(`Missions illisibles : ${error.message}`)
  const { data: ouvertes } = await sb.from('sam_alertes').select('id, mission_id, kind, user_id, created_at, answered_at, resolved_at, dispatch_notified_at').is('resolved_at', null)
  // Mission sortie des statuts actifs (terminée, annulée…) : ses alertes sont closes — mission terminée = problème
  // réglé (Olivier 29/10/2026), sinon l'alerte se rouvrait encore 2 h dans la fenêtre Aide.
  if (!opts.dryRun) {
    const actives = new Set((ms || []).map(m => m.id))
    for (const a of (ouvertes || []).filter(a => !actives.has(a.mission_id))) { await sb.from('sam_alertes').update({ resolved_at: new Date().toISOString() }).eq('id', a.id); stats.resolues++ }
  }
  const users = new Map<string, any>()
  for (const m of ms || []) {
    stats.missions++
    let u = users.get(m.assigned_to)
    if (!u) { const { data } = await sb.from('users').select('id, name, language, role, roles, active').eq('id', m.assigned_to).maybeSingle(); u = data; users.set(m.assigned_to, u) }
    const chauffeur = u?.active && (u.role === 'driver' || (Array.isArray(u.roles) && u.roles.includes('driver')))
    if (!chauffeur) continue
    const lang: Lang = u.language === 'sq' ? 'sq' : 'fr'
    let pb: Probleme | null = null
    try { pb = await detecter(sb, { ...m, driver_name: u.name }, lang, pasArriveMin) } catch (e: any) { console.warn('[copilote] détection', m.id, e?.message) }
    if (opts.dryRun) { if (pb) stats.apercu!.push(`${u.name} #${m.mission_number} ${m.vehicle_plate || ''} [${pb.kind}] ${pb.texte} → ${pb.boutons.map(b => b.libelle).join(' | ')}`); continue }
    const ouvertesM = (ouvertes || []).filter(a => a.mission_id === m.id)
    // Problème disparu (adresse corrigée, scénario choisi…) : alertes closes.
    for (const a of ouvertesM) if (!pb || a.kind !== pb.kind) { await sb.from('sam_alertes').update({ resolved_at: new Date().toISOString() }).eq('id', a.id); stats.resolues++ }
    if (!pb) continue
    const deja = ouvertesM.find(a => a.kind === pb!.kind)
    if (deja) {
      // Pas de réponse en 10 min : le dispatch prend le relais (une fois).
      if (!deja.answered_at && !deja.dispatch_notified_at && minDepuis(deja.created_at) >= 10) {
        await sb.from('sam_alertes').update({ dispatch_notified_at: new Date().toISOString() }).eq('id', deja.id)
        const { sendNotificationToRoles } = await import('@/lib/notifications/send')
        await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'sam_sans_reponse', {
          title: `💬 ${u.name || 'Un chauffeur'} ne répond pas à Sam`,
          body: `#${m.mission_number ?? ''} ${m.vehicle_plate || ''} : ${pb.texte}`.slice(0, 240),
          action_url: `/dispatch/${m.id}`, mission_id: m.id,
        }).catch(() => {})
        stats.dispatch++
      }
      continue
    }
    // Déjà signalé puis résolu pour ce problème : on ne revient pas à la charge (unique mission+kind).
    const { data: ancienne } = await sb.from('sam_alertes').select('id').eq('mission_id', m.id).eq('kind', pb.kind).maybeSingle()
    if (ancienne) continue
    await envoyer(sb, m, u, lang, pb)
    stats.envoyees++
  }
  return stats
}

async function envoyer(sb: Sb, m: any, u: any, lang: Lang, pb: Probleme) {
  const agent = await agentDeService().catch(() => 'Sam')
  const { data: link } = await sb.from('telegram_links').select('chat_id').eq('user_id', u.id).maybeSingle()
  const canal = 'app' as const
  const convId = await recordCopilote({ userId: u.id, missionId: m.id, canal, agent, messages: [{ role: 'agent', texte: pb.texte }] })
  const { data: al } = await sb.from('sam_alertes').insert({ mission_id: m.id, user_id: u.id, kind: pb.kind, agent, texte: pb.texte, boutons: pb.boutons, donnees: pb.donnees || null, conversation_id: convId }).select('id').single()
  await sb.from('mission_logs').insert({ mission_id: m.id, action: 'sam_copilote', notes: `${agent} a écrit au chauffeur : ${pb.texte}`, metadata: { kind: pb.kind, auto: true } }).then(() => {}, () => {})
  const { sendNotification } = await import('@/lib/notifications/send')
  await sendNotification(u.id, 'sam_copilote', { title: `💬 ${agent}`, body: pb.texte.slice(0, 180), action_url: `/mission/${m.id}`, mission_id: m.id }).catch(() => {})
  if (link?.chat_id && al?.id) {
    const { tgSend } = await import('./telegram')
    await tgSend(Number(link.chat_id), pb.texte, pb.boutons.map((b, i) => [{ text: b.libelle, data: `cp:${al.id}:${i}` }]), agent).catch(() => {})
  }
}

// ── Réponse du chauffeur ─────────────────────────────────────────────────────

/** Alerte en attente de réponse pour la fenêtre Aide (la plus récente, moins de 2 h). */
export async function alerteEnAttente(userId: string) {
  const { data } = await createAdminClient().from('sam_alertes').select('id, agent, texte, boutons, mission_id, created_at')
    .eq('user_id', userId).is('answered_at', null).is('resolved_at', null)
    .gte('created_at', new Date(Date.now() - 2 * 3600_000).toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data as { id: number; agent: string; texte: string; boutons: Bouton[]; mission_id: string } | null
}

/** Le chauffeur touche un choix. Renvoie le message de Sam et, au besoin, un lien à ouvrir. */
export async function repondreAlerte(userId: string, alerteId: number, index: number, canal: 'app' | 'telegram'): Promise<{ texte: string; agent: string; openUrl?: string | null }> {
  const sb = createAdminClient()
  const { data: a } = await sb.from('sam_alertes').select('*').eq('id', alerteId).eq('user_id', userId).maybeSingle()
  const { data: u } = await sb.from('users').select('language').eq('id', userId).maybeSingle()
  const L = (fr: string, sq: string) => (u?.language === 'sq' ? sq : fr)
  if (!a) return { texte: L('Ce choix n\'est plus valable.', 'Kjo zgjedhje nuk vlen më.'), agent: 'Sam' }
  const b: Bouton | undefined = (a.boutons || [])[index]
  if (!b) return { texte: L('Ce choix n\'est plus valable.', 'Kjo zgjedhje nuk vlen më.'), agent: a.agent || 'Sam' }
  if (a.answered_at || a.resolved_at) return { texte: L('C\'est déjà réglé 👍', 'Është rregulluar tashmë 👍'), agent: a.agent || 'Sam' }
  await sb.from('sam_alertes').update({ answered_at: new Date().toISOString(), answer: b.valeur }).eq('id', a.id)
  const { data: m } = await sb.from('incoming_missions').select('*').eq('id', a.mission_id).maybeSingle()
  let texte = '', openUrl: string | null = null, resolu = true
  const [act, x, y] = b.valeur.split(':')
  try {
    if (act === 'addr' && x !== 'aucune') {
      const c = (a.donnees?.candidats || [])[Number(y)]
      if (!c) throw new Error('adresse')
      const r = await fetch(`${APP_URL()}/api/missions/driver-action`, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.NEXTAUTH_SECRET || '', 'x-internal-actor': userId },
        body: JSON.stringify({ mission_id: a.mission_id, action: 'update_address', field: x === 'incident' ? 'incident' : 'destination', value: c.label, lat: c.lat, lng: c.lng }),
      })
      if (!r.ok) throw new Error(`refusé (${r.status})`)
      if (c.cidPrx) {   // garage du réseau agréé Touring : retenu pour la clôture
        await sb.from('incoming_missions').update({ destination_name: c.nom }).eq('id', a.mission_id)
        await sb.from('mission_logs').insert({ mission_id: a.mission_id, actor_id: userId, action: 'touring_garage_choisi', notes: `Garage du réseau agréé Touring choisi avec ${a.agent || 'Sam'} : ${c.label}`, metadata: { cidPrx: c.cidPrx, nom: c.nom } }).then(() => {}, () => {})
      }
      texte = L(`C'est corrigé ✅ ${x === 'incident' ? 'Lieu d\'intervention' : 'Destination'} : ${c.label}. Le km et le prix se calculent.`, `U korrigjua ✅ ${x === 'incident' ? 'Vendi i ndërhyrjes' : 'Destinacioni'}: ${c.label}. Km dhe çmimi llogariten.`)
    } else if (act === 'addr') {
      texte = L('D\'accord. Écris-moi ici la bonne adresse (rue, numéro, commune), je la corrige.', 'Në rregull. Më shkruaj këtu adresën e saktë (rruga, numri, komuna), unë e korrigjoj.')
      resolu = false
    } else if (act === 'scen' && m) {
      const scen = x
      const upd: Record<string, any> = { snc_scenario: scen, mission_type: scen === 'dsp' ? 'depannage' : 'remorquage', updated_at: new Date().toISOString() }
      if (m.source === 'police_snc') {   // rem_depot : montant seulement si plaque étrangère (calculé dans amount.ts)
        const { computeSncAmountToCollect } = await import('@/lib/snc/amount')
        const amt = await computeSncAmountToCollect(m, scen as any).catch(() => null)
        if (amt != null && amt > 0) upd.amount_to_collect = amt
      }
      await sb.from('incoming_missions').update(upd).eq('id', m.id)
      await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: userId, action: 'snc_scenario', notes: `Scénario Siabis choisi avec ${a.agent || 'Sam'} : ${b.libelle}`, metadata: { scenario: scen, via: 'sam_copilote' } }).then(() => {}, () => {})
      const montant = upd.amount_to_collect ? L(` Montant à encaisser : ${Number(upd.amount_to_collect).toFixed(2)} € TVAC, le bouton est sur ta fiche.`, ` Shuma për t'u arkëtuar: ${Number(upd.amount_to_collect).toFixed(2)} € me TVSH, butoni është në fishë.`) : ''
      texte = L(`Enregistré ✅ ${b.libelle.replace(/^\S+\s/, '')}.${montant}`, `U regjistrua ✅ ${b.libelle.replace(/^\S+\s/, '')}.${montant}`)
      openUrl = `${APP_URL()}/mission/${m.id}`
    } else if (act === 'arr') {
      texte = L('Parfait. Ouvre ta fiche et appuie sur « Arrivé à destination » pour terminer.', 'Shumë mirë. Hap fishën dhe shtyp « Arrita në destinacion » për të përfunduar.')
      openUrl = `${APP_URL()}/mission/${a.mission_id}`
    } else if (act === 'open') {
      texte = L('Je t\'ouvre ta fiche.', 'Po ta hap fishën.'); openUrl = `${APP_URL()}/mission/${a.mission_id}`; resolu = false
    } else if (act === 'disp') {
      const { sendNotificationToRoles } = await import('@/lib/notifications/send')
      await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'sam_sans_reponse', { title: `💶 Montant à fixer`, body: `#${m?.mission_number ?? ''} ${m?.vehicle_plate || ''} : Siabis non couvert sans montant à encaisser, le chauffeur attend.`, action_url: `/dispatch/${a.mission_id}`, mission_id: a.mission_id }).catch(() => {})
      texte = L('Le dispatch est prévenu, il fixe le montant.', 'Dispeçeri u njoftua, ai cakton shumën.')
    } else {
      texte = L('OK, bonne route 👍', 'OK, rrugë të mbarë 👍'); resolu = act === 'ok' && a.kind === 'pas_arrive'
    }
  } catch (e: any) {
    texte = L(`Je n'ai pas pu le faire (${e?.message || 'erreur'}). Corrige-le sur ta fiche ou appelle le dispatch.`, `Nuk munda ta bëj (${e?.message || 'gabim'}). Korrigjoje në fishë ose telefono dispeçerin.`)
    resolu = false
  }
  if (resolu) await sb.from('sam_alertes').update({ resolved_at: new Date().toISOString() }).eq('id', a.id)
  await recordCopilote({ userId, missionId: a.mission_id, canal, agent: a.agent || 'Sam', messages: [{ role: 'chauffeur', texte: b.libelle }, { role: 'agent', texte }] })
  return { texte, agent: a.agent || 'Sam', openUrl }
}
