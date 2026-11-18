// src/lib/dispatch/observateur.ts — agent observateur du dispatch (Olivier 18/11/2026, palier 1 de l'auto-dispatch).
//
// À chaque attribution faite par un dispatcheur, l'agent note en silence ce qu'il aurait proposé et compare. Il ne
// propose rien à l'écran et ne touche à aucune mission. Temps de route réels seulement (jamais à vol d'oiseau) ; un
// chauffeur libre sans position récente est supposé sur la route du retour au dépôt, puis au dépôt.
// Accord = même chauffeur, ou chauffeur choisi à 5 minutes près du meilleur. Bilan chaque lundi dans la Supervision.
import { createAdminClient } from '@/lib/supabase'
import { classerChauffeurs } from './proposition'

const TOLERANCE_MIN = 5
// Hors comparaison (Olivier 18/11/2026) : ce qui se planifie (relivraisons, trajets à vide, transports, missions à une
// heure fixée) — le plus proche n'y est pas forcément le bon choix. Ces attributions restent notées, sans accord.
const PLANIFIES = new Set(['relivraison', 'rel', 'trajet_vide', 'transport'])

export async function observerAttribution(missionId: string, driverId: string, actorId: string | null): Promise<void> {
  const sb = createAdminClient()
  try {
    const { data: m } = await sb.from('incoming_missions').select('mission_type, source, intervention_date').eq('id', missionId).maybeSingle()
    const type = String(m?.mission_type || '').toLowerCase()
    const planifiee = PLANIFIES.has(type) || (!!m?.intervention_date && Date.parse(m.intervention_date) > Date.now() + 60 * 60000)
    if (planifiee) {
      await sb.from('dispatch_observations').insert({ mission_id: missionId, attribue_a: driverId, attribue_par: actorId, mission_type: m?.mission_type || null, source: m?.source || null, accord: null, erreur: 'mission planifiée : hors comparaison' })
      return
    }
    const c = await classerChauffeurs(missionId, { retourDepot: true })
    if ('erreur' in c) { await sb.from('dispatch_observations').insert({ mission_id: missionId, attribue_a: driverId, attribue_par: actorId, erreur: c.erreur }); return }
    const avec = c.liste.filter(x => x.eta_min != null).sort((a, b) => a.eta_min! - b.eta_min!)
    const choisi = c.liste.find(x => x.id === driverId) || null
    const meilleur = avec[0] || null
    const rang = choisi?.eta_min != null ? avec.findIndex(x => x.id === driverId) + 1 : null
    const ecart = choisi?.eta_min != null && meilleur ? choisi.eta_min - meilleur.eta_min! : null
    await sb.from('dispatch_observations').insert({
      mission_id: missionId, attribue_a: driverId, attribue_par: actorId,
      periode: c.nuit ? 'nuit' : 'jour', mission_type: m?.mission_type || null, source: m?.source || null,
      choisi_eta: choisi?.eta_min ?? null, choisi_rang: rang, choisi_occupe: choisi?.occupe ?? null,
      agent_choix: meilleur?.id || null, agent_eta: meilleur?.eta_min ?? null, ecart_min: ecart,
      accord: ecart == null ? null : (meilleur!.id === driverId || ecart <= TOLERANCE_MIN),
      estimee: !!(choisi?.estimee || meilleur?.estimee),
      classement: avec.slice(0, 8).map(x => ({ id: x.id, nom: x.nom, eta: x.eta_min, occupe: x.occupe, estimee: !!x.estimee, raison: x.raison })),
      erreur: choisi ? (c.raison || null) : 'chauffeur choisi hors des chauffeurs en service connus',
    })
  } catch (e: any) {
    console.error('[observateur dispatch]', e?.message || e)
    await sb.from('dispatch_observations').insert({ mission_id: missionId, attribue_a: driverId, attribue_par: actorId, erreur: String(e?.message || e).slice(0, 300) }).then(() => {}, () => {})
  }
}

/** Bilan des 7 derniers jours (texte, première ligne = titre). null s'il n'y a rien à dire. */
export async function bilanObservateur(jours = 7): Promise<string | null> {
  const sb = createAdminClient()
  const depuis = new Date(Date.now() - jours * 864e5).toISOString()
  const { data } = await sb.from('dispatch_observations').select('*').gte('observed_at', depuis).order('observed_at').limit(3000)
  const obs = data || []
  if (!obs.length) return null
  const ids = Array.from(new Set(obs.flatMap((o: any) => [o.attribue_a, o.attribue_par, o.agent_choix]).filter(Boolean)))
  const { data: us } = await sb.from('users').select('id, name').in('id', ids)
  const nom = (id: string | null) => (us || []).find((u: any) => u.id === id)?.name || '?'
  const { data: ms } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, incident_city').in('id', obs.map((o: any) => o.mission_id))
  const fiche = (id: string) => { const m = (ms || []).find((x: any) => x.id === id); return m ? `#${m.mission_number}${m.vehicle_plate ? ' ' + m.vehicle_plate : ''}${m.incident_city ? ', ' + m.incident_city : ''}` : '' }
  const lis = obs.filter((o: any) => o.accord != null), ok = lis.filter((o: any) => o.accord)
  const pct = (a: number, b: number) => b ? `${Math.round(100 * a / b)} %` : '—'
  const L: string[] = [`🧭 Agent observateur du dispatch : ${obs.length} attributions, accord ${pct(ok.length, lis.length)}`]
  L.push(`${lis.length} attributions comparables sur ${obs.length} (les autres : pas d'estimation possible pour le chauffeur choisi).`)
  const parQui = new Map<string, any[]>()
  for (const o of lis) parQui.set(o.attribue_par || '-', [...(parQui.get(o.attribue_par || '-') || []), o])
  for (const [q, v] of parQui) L.push(`• ${nom(q === '-' ? null : q)} : ${v.length} comparables, accord ${pct(v.filter((o: any) => o.accord).length, v.length)}`)
  for (const p of ['jour', 'nuit']) { const v = lis.filter((o: any) => o.periode === p); if (v.length) L.push(`• De ${p} : accord ${pct(v.filter((o: any) => o.accord).length, v.length)} sur ${v.length}`) }
  const des = lis.filter((o: any) => !o.accord).sort((a: any, b: any) => (b.ecart_min || 0) - (a.ecart_min || 0))
  if (des.length) {
    L.push('', `Désaccords : ${des.length}, soit ${des.reduce((s: number, o: any) => s + (o.ecart_min || 0), 0)} minutes de route d'écart au total. Les plus grands :`)
    for (const o of des.slice(0, 8)) L.push(`• ${fiche(o.mission_id)} : ${nom(o.attribue_a)} choisi (${o.choisi_eta} min${o.choisi_occupe ? ', occupé' : ''}), l'agent aurait pris ${nom(o.agent_choix)} (${o.agent_eta} min)${o.estimee ? ' — position estimée' : ''}`)
    const paires = new Map<string, number>()
    for (const o of des) { const k = `${nom(o.attribue_a)} plutôt que ${nom(o.agent_choix)}`; paires.set(k, (paires.get(k) || 0) + 1) }
    const rep = [...paires].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 4)
    if (rep.length) { L.push('', 'Ce qui se répète :'); for (const [k, n] of rep) L.push(`• ${k} : ${n} fois`) }
  }
  L.push('', 'L\'agent ne fait qu\'observer : aucune mission n\'a été touchée. Les temps sont des trajets routiers ; un chauffeur libre sans position récente est supposé sur la route du retour au dépôt.')
  return L.join('\n')
}
