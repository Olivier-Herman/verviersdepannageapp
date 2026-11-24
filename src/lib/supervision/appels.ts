// src/lib/supervision/appels.ts — appels de la téléphonie Teams dans les rapports de suivi (Olivier 24/11/2026).
// La centrale (numéro général) aiguille vers les services (Dépannage Service, Fourrière service, Rent a car, Suivi
// dépannage, Administratif, Francofolies…), où des personnes connectées prennent les appels. Ce qui compte surtout :
// les personnes. Microsoft ne garde le journal que 30 jours : chaque passage relève les appels dans
// `supervision_appels`, d'où les rapports de semaine et de mois sont tirés.
//
// Lecture d'un appel entrant (callRecords + sessions, vérifié sur les appels du 24/11) :
//   • « TEL → compte » : le compte appelé est un standard (centrale ou service) ;
//   • « personne → (vide) » d'une durée ≥ seuil : cette personne a eu l'appelant en ligne (la 1re a décroché, les
//     suivantes ont repris l'appel : transfert) ;
//   • « TEL → TEL » : renvoi vers un numéro extérieur (GSM de garde) ;
//   • aucune personne ni renvoi : appel perdu.
// Appels émis : journal téléphonique (getPstnCalls, user_out ; ucap_out du robot d'appel du dispatch = agents).
// Appels internes : appel Teams entre deux personnes, sans numéro extérieur.

import type { createAdminClient } from '@/lib/supabase'
import type { Action, Config } from '@/lib/supervision'

type Sb = ReturnType<typeof createAdminClient>

export interface CfgAppels {
  comptes: Record<string, string>     // nom Teams d'une personne → nom du rapport (« Momo - VD » → « Momo »)
  services: Record<string, string>    // nom Teams d'un standard → nom du service (« VD - RAC SA » → « Rent a car »)
  centrale: string[]                  // noms Teams de la centrale (numéro général)
  robots: string[]                    // comptes qui appellent seuls (robot d'appel du dispatch) → agents de Mobi
  exclus: string[]                    // standards d'autres sociétés (CP Recycling)
  seuil_s: number                     // durée minimale pour compter « en ligne »
  numeros_robots?: Record<string, string>   // numéros qui appellent seuls (9 derniers chiffres → libellé) : pas des clients
}

export interface Appel {
  id: string
  debut: string
  fin: string | null
  sens: 'entrant' | 'sortant' | 'interne'
  service: string | null
  numero: string | null
  parts: { nom: string; qui: string | null; debut: string; sec: number }[]   // personnes en ligne, dans l'ordre
  decroche_par: string | null
  attente_s: number | null
  perdu: boolean
  renvoi_externe: boolean
}

const G = 'https://graph.microsoft.com/v1.0'
const userNom = (e: any): string | null => e?.identity?.user?.displayName || null
const tel = (e: any): string | null => e?.identity?.phone?.id || null
const sec = (s: any) => Math.max(0, Math.round((+new Date(s.endDateTime) - +new Date(s.startDateTime)) / 1000))

async function graphJson(url: string, essai = 0): Promise<any> {
  const { getAppOnlyToken } = await import('@/lib/graph-mail-search')
  const tok = await getAppOnlyToken(essai > 0)
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' })
  if (r.status === 401 && essai === 0) return graphJson(url, 1)
  if (r.status === 429 && essai < 3) { await new Promise(res => setTimeout(res, 2000 * (essai + 1))); return graphJson(url, essai + 1) }
  if (!r.ok) throw new Error(`Téléphonie ${r.status} : ${(await r.text()).slice(0, 120)}`)
  return r.json()
}

/** Décode un appel détaillé (avec ses sessions). null = appel émis (vient du journal téléphonique) ou hors périmètre. */
export function decoder(d: any, ca: CfgAppels): Appel | null {
  const sessions = [...(d.sessions || [])].sort((a: any, b: any) => String(a.startDateTime).localeCompare(String(b.startDateTime)))
  const orgTel = tel(d.organizer_v2) || tel(d.organizer)
  const aTel = sessions.some(s => tel(s.caller) || tel(s.callee))
  // Standards appelés (TEL → compte) ; le service retenu est le dernier atteint hors centrale.
  const standards = sessions.filter(s => tel(s.caller) && userNom(s.callee)).map(s => userNom(s.callee)!)
  if (standards.some(n => ca.exclus.includes(n))) return null
  const serviceTeams = [...standards].reverse().find(n => !ca.centrale.includes(n)) || standards[0] || null
  const parts: Appel['parts'] = []
  for (const s of sessions) {
    const n = userNom(s.caller)
    if (!n || userNom(s.callee) || tel(s.callee) || standards.includes(n) || ca.robots.includes(n)) continue
    const duree = sec(s)
    if (duree < (ca.seuil_s || 3)) continue
    const p = parts.find(x => x.nom === n)
    if (p) p.sec = Math.max(p.sec, duree); else parts.push({ nom: n, qui: ca.comptes[n] || null, debut: s.startDateTime, sec: duree })
  }
  const renvoi = sessions.some(s => tel(s.caller) && tel(s.callee) && sec(s) >= (ca.seuil_s || 3))
  if (orgTel) {
    // Annonce automatique (centrale Touring « vous avez reçu une nouvelle mission ») : comptée à part, jamais perdue.
    const robot = ca.numeros_robots?.[orgTel.replace(/\D/g, '').slice(-9)]
    if (robot) return { id: d.id, debut: d.startDateTime, fin: d.endDateTime || null, sens: 'entrant', service: `Robot : ${robot}`, numero: orgTel, parts: [], decroche_par: null, attente_s: null, perdu: false, renvoi_externe: false }
    return {
      id: d.id, debut: d.startDateTime, fin: d.endDateTime || null, sens: 'entrant',
      service: serviceTeams ? (ca.services[serviceTeams] || (ca.centrale.includes(serviceTeams) ? 'Centrale' : serviceTeams)) : null,
      numero: orgTel, parts, decroche_par: parts[0] ? (parts[0].qui || parts[0].nom) : (renvoi ? 'Renvoi vers un GSM' : null),
      attente_s: parts[0] ? Math.max(0, Math.round((+new Date(parts[0].debut) - +new Date(d.startDateTime)) / 1000)) : null,
      perdu: !parts.length && !renvoi, renvoi_externe: renvoi,
    }
  }
  if (!aTel && d.type === 'peerToPeer') {
    // Appel interne (d'une personne à une autre ; les réunions Teams n'en sont pas) : toutes les personnes présentes, durée = session la plus longue de chacune.
    const gens = new Map<string, number>()
    for (const s of sessions) for (const e of [s.caller, s.callee]) { const n = userNom(e); if (n) gens.set(n, Math.max(gens.get(n) || 0, sec(s))) }
    if (gens.size < 2) return null
    return {
      id: d.id, debut: d.startDateTime, fin: d.endDateTime || null, sens: 'interne', service: null, numero: null,
      parts: [...gens].map(([nom, s]) => ({ nom, qui: ca.comptes[nom] || null, debut: d.startDateTime, sec: s })), decroche_par: null, attente_s: null, perdu: false, renvoi_externe: false,
    }
  }
  return null
}

/** Relève les appels de [d1, d2] et les enregistre (idempotent). */
export async function releverAppels(sb: Sb, cfg: Config, d1: string, d2: string): Promise<{ n: number; erreurs: string[] }> {
  const ca = (cfg as any).appels as CfgAppels | undefined
  if (!ca) return { n: 0, erreurs: [] }
  const lignes: Appel[] = [], erreurs: string[] = []
  // 1. Appels détaillés (entrants et internes).
  try {
    let url: string | null = `${G}/communications/callRecords?$filter=startDateTime ge ${d1} and startDateTime lt ${d2}`
    const ids: string[] = []
    while (url) { const j = await graphJson(url); ids.push(...(j.value || []).map((x: any) => x.id)); url = j['@odata.nextLink'] || null }
    for (let i = 0; i < ids.length; i += 8) {
      const lot = await Promise.all(ids.slice(i, i + 8).map(id => graphJson(`${G}/communications/callRecords/${id}?$expand=sessions`).catch(e => { erreurs.push(String(e?.message || e).slice(0, 100)); return null })))
      for (const d of lot) { const a = d && decoder(d, ca); if (a) lignes.push(a) }
    }
  } catch (e: any) { erreurs.push(`Appels détaillés : ${String(e?.message || e).slice(0, 120)}`) }
  // 2. Appels émis vers l'extérieur.
  try {
    let url: string | null = `${G}/communications/callRecords/getPstnCalls(fromDateTime=${d1},toDateTime=${d2})`
    while (url) {
      const j = await graphJson(url)
      for (const c of j.value || []) {
        const n = String(c.userDisplayName || '')
        const robot = ca.robots.includes(n)
        if (!(c.callType === 'user_out' || (c.callType === 'ucap_out' && robot))) continue
        lignes.push({
          id: `pstn:${c.id}`, debut: c.startDateTime, fin: c.endDateTime || null, sens: 'sortant', service: null, numero: c.calleeNumber || null,
          parts: [{ nom: n, qui: robot ? 'Agents' : (ca.comptes[n] || null), debut: c.startDateTime, sec: Number(c.duration || 0) }],
          decroche_par: null, attente_s: null, perdu: Number(c.duration || 0) < (ca.seuil_s || 3), renvoi_externe: false,
        })
      }
      url = j['@odata.nextLink'] || null
    }
  } catch (e: any) { erreurs.push(`Appels émis : ${String(e?.message || e).slice(0, 120)}`) }
  for (let i = 0; i < lignes.length; i += 500) {
    const { error } = await sb.from('supervision_appels').upsert(lignes.slice(i, i + 500).map(a => ({ ...a, releve_at: new Date().toISOString() })), { onConflict: 'id' })
    if (error) erreurs.push(`Enregistrement des appels : ${error.message}`)
  }
  return { n: lignes.length, erreurs }
}

export async function lireAppels(sb: Sb, d1: string, d2: string): Promise<Appel[]> {
  const out: Appel[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from('supervision_appels').select('*').gte('debut', d1).lt('debut', d2).order('id').range(off, off + 999)
    if (error) throw new Error(`Appels : ${error.message}`)
    out.push(...(data || []) as Appel[]); if ((data || []).length < 1000) break
  }
  return out
}

/** Les appels deviennent des actions des personnes (pour leurs rapports, leur présence et leur indice). */
export function actionsAppels(appels: Appel[], poids: Record<string, number>): Action[] {
  const out: Action[] = []
  const duree = (s: number) => s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : `${s} s`
  for (const a of appels) for (const [i, p] of a.parts.entries()) {
    if (!p.qui) continue
    const cat = a.sens === 'entrant' ? 'appel_recu' : a.sens === 'sortant' ? 'appel_emis' : 'appel_interne'
    if (a.sens === 'sortant' && a.perdu) continue
    const titre = a.sens === 'entrant' ? `${i ? 'Appel repris (transfert)' : 'Appel décroché'} — ${a.service || 'standard'}` : a.sens === 'sortant' ? 'Appel émis' : `Appel interne avec ${a.parts.filter(x => x.nom !== p.nom).map(x => x.qui || x.nom).join(', ')}`
    out.push({ at: p.debut, qui: p.qui, cat, titre, detail: [a.numero, duree(p.sec)].filter(Boolean).join(' · '), points: poids[cat] ?? (cat === 'appel_interne' ? 0 : 1), cleUnique: `appel:${a.id}:${p.qui}` })
    // La fin de l'appel compte aussi pour la présence.
    out.push({ at: new Date(+new Date(p.debut) + p.sec * 1000).toISOString(), qui: p.qui, cat: 'appel_fin', titre: 'fin d’appel', points: 0, cleUnique: `appelfin:${a.id}:${p.qui}` })
  }
  return out
}

// ── Rapport téléphone ──────────────────────────────────────────────────────────────────────────────────────────
export function rapportTelephone(appels: Appel[], fmt: { esc: (s: string) => string; table: (t: string[], l: string[][]) => string; tuiles: (l: [string, string][]) => string; heure: (iso: string) => string }, parJour: boolean): string {
  const { esc, table, tuiles, heure } = fmt
  const mn = (s: number) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ' h ' : ''}${Math.round((s % 3600) / 60)} min`
  const robots = appels.filter(a => a.sens === 'entrant' && String(a.service || '').startsWith('Robot : '))
  const ent = appels.filter(a => a.sens === 'entrant' && !robots.includes(a)), sor = appels.filter(a => a.sens === 'sortant' && !a.perdu), int = appels.filter(a => a.sens === 'interne')
  const dec = ent.filter(a => a.parts.length), perdus = ent.filter(a => a.perdu), renv = ent.filter(a => !a.parts.length && a.renvoi_externe)
  const transf = ent.filter(a => a.parts.length > 1)
  const att = dec.map(a => a.attente_s || 0)
  const pct = (n: number, t: number) => t ? `${Math.round(100 * n / t)} %` : '—'
  let html = `<h3 style="margin:20px 0 4px">📞 Téléphone</h3>` + tuiles([
    ['Appels reçus', String(ent.length)], ['Décrochés', `${dec.length} (${pct(dec.length, ent.length)})`], ['Perdus', `${perdus.length} (${pct(perdus.length, ent.length)})`],
    ['Renvoyés vers un GSM', String(renv.length)], ['Transférés', String(transf.length)], ['Attente moyenne', att.length ? `${Math.round(att.reduce((a, b) => a + b, 0) / att.length)} s` : '—'],
    ['Appels émis', String(sor.length)], ['Internes', String(int.length)],
  ])
  if (robots.length) {
    const g: Record<string, number> = {}; for (const a of robots) { const k = String(a.service).slice(8); g[k] = (g[k] || 0) + 1 }
    html += `<p style="font-size:12px;color:#475569;margin:0 0 8px">Non comptés ci-dessus : ${Object.entries(g).map(([k, n]) => `${n} ${esc(k)}`).join(', ')}.</p>`
  }
  // Par service.
  const services = [...new Set(ent.map(a => a.service || 'Inconnu'))].sort()
  html += `<p style="margin:8px 0 2px"><b>Par service</b></p>` + table(['Service', 'Reçus', 'Décrochés', 'Perdus', 'Renvoi GSM', 'Attente moy.', 'Durée moy.', 'Pris par'], services.map(s => {
    const l = ent.filter(a => (a.service || 'Inconnu') === s), d = l.filter(a => a.parts.length)
    const qui: Record<string, number> = {}; for (const a of d) { const k = a.decroche_par || '?'; qui[k] = (qui[k] || 0) + 1 }
    const dur = d.map(a => a.parts.reduce((x, p) => x + p.sec, 0))
    return [esc(s), String(l.length), String(d.length), l.filter(a => a.perdu).length ? `<b style="color:#b91c1c">${l.filter(a => a.perdu).length}</b>` : '0', String(l.filter(a => !a.parts.length && a.renvoi_externe).length),
      d.length ? `${Math.round(d.reduce((x, a) => x + (a.attente_s || 0), 0) / d.length)} s` : '—', dur.length ? mn(dur.reduce((a, b) => a + b, 0) / dur.length) : '—',
      Object.entries(qui).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k)} ${n}`).join(', ')]
  }))
  // Par personne.
  const gens = [...new Set(appels.flatMap(a => a.parts.map(p => p.qui || p.nom)))].sort()
  html += `<p style="margin:8px 0 2px"><b>Par personne</b></p>` + table(['Personne', 'Décrochés', 'Repris (transfert)', 'Temps reçu', 'Émis', 'Temps émis', 'Internes', 'Total au téléphone'], gens.map(g => {
    const m = (a: Appel) => a.parts.filter(p => (p.qui || p.nom) === g)
    const d1 = ent.filter(a => a.parts[0] && (a.parts[0].qui || a.parts[0].nom) === g), rep = ent.filter(a => a.parts.slice(1).some(p => (p.qui || p.nom) === g))
    const tr = ent.reduce((x, a) => x + m(a).reduce((y, p) => y + p.sec, 0), 0), te = sor.reduce((x, a) => x + m(a).reduce((y, p) => y + p.sec, 0), 0)
    const ti = int.reduce((x, a) => x + m(a).reduce((y, p) => y + p.sec, 0), 0)
    return [esc(g), String(d1.length), String(rep.length), mn(tr), String(sor.filter(a => m(a).length).length), mn(te), String(int.filter(a => m(a).length).length), `<b>${mn(tr + te + ti)}</b>`]
  }))
  // Heures de pointe.
  const parH: Record<string, { n: number; p: number }> = {}
  for (const a of ent) { const k = heure(a.debut).slice(0, 2) + ' h'; const x = (parH[k] ||= { n: 0, p: 0 }); x.n++; if (a.perdu) x.p++ }
  const hs = Object.keys(parH).sort()
  if (hs.length) html += `<p style="margin:8px 0 2px"><b>Appels reçus par heure</b></p>` + table(hs, [hs.map(k => `${parH[k].n}${parH[k].p ? ` <span style="color:#b91c1c">(${parH[k].p} perdus)</span>` : ''}`)])
  // Appels perdus : rappelés ou non (un appel émis vers le même numéro dans les 4 heures).
  if (perdus.length) {
    // Regroupés par numéro : un même numéro qui raccroche à répétition (robot d'une assistance, par exemple) se voit
    // d'un coup d'œil. « Rappelé » = un appel émis vers ce numéro dans les 4 heures ; « repris » = ce numéro a rappelé
    // et a été décroché.
    const meme = (x: string | null, y: string | null) => !!x && !!y && x.replace(/\D/g, '').slice(-9) === y.replace(/\D/g, '').slice(-9)
    const quand = (iso: string) => parJour ? heure(iso) : new Date(iso).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
    const groupes = new Map<string, Appel[]>()
    for (const a of [...perdus].sort((x, y) => x.debut.localeCompare(y.debut))) { const k = (a.numero || '?').replace(/\D/g, '').slice(-9) || a.numero || '?'; groupes.set(k, [...(groupes.get(k) || []), a]) }
    let sans = 0
    const lignes = [...groupes.values()].sort((a, b) => b.length - a.length).map(l => {
      const dernier = l[l.length - 1]
      const masque = /anonym/i.test(dernier.numero || '')
      const rappel = sor.find(s => meme(s.numero, dernier.numero) && s.debut > dernier.debut && +new Date(s.debut) - +new Date(dernier.debut) < 4 * 3600e3)
      const repris = ent.find(a => a.parts.length && meme(a.numero, dernier.numero) && a.debut > dernier.debut)
      if (!rappel && !repris && !masque) sans++
      return [esc(dernier.numero || '?'), String(l.length), l.map(a => quand(a.debut)).join(', '), esc([...new Set(l.map(a => a.service || '—'))].join(', ')),
        rappel ? `rappelé à ${heure(rappel.debut)} par ${esc(rappel.parts[0]?.qui || rappel.parts[0]?.nom || '?')}` : repris ? `a rappelé, pris par ${esc(repris.decroche_par || '?')} à ${heure(repris.debut)}` : masque ? 'numéro masqué' : '<b style="color:#b91c1c">non</b>']
    })
    html += `<p style="margin:8px 0 2px"><b>Appels perdus : ${perdus.length} (${groupes.size} numéros), dont ${sans} numéros sans suite</b></p>` +
      table(['Numéro', 'Fois', 'Quand', 'Service', 'Suite'], lignes.slice(0, 40))
  }
  return html
}
