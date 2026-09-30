// Anomalies à traiter au bureau (Olivier 30/09/2026) : par camion, par ordre de gravité.
// Un même problème signalé plusieurs fois = une seule ligne (en rouge). Les remarques
// (niveau 1) sont pour information et ne restent que jusqu'au check suivant du camion.
// « Corrigé » prévient sur son téléphone chaque chauffeur qui l'avait signalé.
import { sendPushToUser } from '@/lib/push'
import { LEVEL_LABEL_FR } from './levels'
import { photoUrl } from './server'

const STOP = new Set(['le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'l', 'd', 'a', 'au', 'aux', 'et', 'en', 'sur', 'cote', 'est', 'pas', 'plus', 'tres'])
const tokens = (t: string) => new Set(String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w)))
/** Même problème : titres quasi identiques (mots en commun), sur le même camion. */
export function sameProblem(a: string, b: string): boolean {
  const A = tokens(a), B = tokens(b)
  if (!A.size || !B.size) return false
  let inter = 0; A.forEach(w => { if (B.has(w)) inter++ })
  return inter / Math.min(A.size, B.size) >= 0.75 || inter / new Set([...A, ...B]).size >= 0.5
}

type Row = { id: string; check_id: string; title: string; description: string | null; level: number; photos: string[]; created_at: string
  check: { truck_plate: string; truck_name: string | null; driver_id: string | null; driver_name: string | null; created_at: string; mileage: number } }

export async function openAnomalies(sb: any) {
  const [{ data: open }, { data: checks }] = await Promise.all([
    sb.from('truck_check_anomalies').select('id, check_id, title, description, level, photos, created_at, check:truck_checks!inner(truck_plate, truck_name, driver_id, driver_name, created_at, mileage)')
      .is('resolved_at', null).gte('level', 2).order('created_at', { ascending: false }).limit(1000),
    sb.from('truck_checks').select('id, truck_plate, truck_name, driver_name, created_at, mileage').order('created_at', { ascending: false }).limit(1000),
  ])
  // Dernier check par camion : ses remarques sont les seules affichées.
  const latest = new Map<string, any>()
  for (const c of checks || []) if (!latest.has(c.truck_plate)) latest.set(c.truck_plate, c)
  const latestIds = [...latest.values()].map(c => c.id)
  const { data: remarks } = latestIds.length
    ? await sb.from('truck_check_anomalies').select('id, check_id, title, description, created_at').in('check_id', latestIds).eq('level', 1)
    : { data: [] }

  const trucks = new Map<string, any>()
  const truck = (plate: string) => {
    if (!trucks.has(plate)) { const l = latest.get(plate); trucks.set(plate, { plate, name: l?.truck_name || null, last: l ? { at: l.created_at, km: l.mileage, driver: l.driver_name } : null, groups: [] as any[], remarks: [] as any[] }) }
    return trucks.get(plate)
  }
  for (const a of (open || []) as Row[]) {
    const t = truck(a.check.truck_plate)
    let g = t.groups.find((x: any) => sameProblem(x.title, a.title))
    if (!g) { g = { key: a.id, title: a.title, description: a.description, level: a.level, ids: [], reports: [], photos: [] }; t.groups.push(g) }
    g.ids.push(a.id)
    g.level = Math.max(g.level, a.level)
    g.reports.push({ check_id: a.check_id, driver: a.check.driver_name, at: a.check.created_at })
    g.photos.push(...(a.photos || []).map(p => photoUrl(sb, p)))
    if (!g.description && a.description) g.description = a.description
  }
  for (const r of remarks || []) {
    const c = [...latest.values()].find(x => x.id === r.check_id)
    if (c) truck(c.truck_plate).remarks.push({ id: r.id, title: r.title, description: r.description, check_id: r.check_id, driver: c.driver_name, at: c.created_at })
  }
  const list = [...trucks.values()].filter(t => t.groups.length || t.remarks.length)
  for (const t of list) {
    for (const g of t.groups) { g.count = g.reports.length; g.first_at = g.reports[g.reports.length - 1].at; g.drivers = [...new Set(g.reports.map((r: any) => r.driver).filter(Boolean))] }
    t.groups.sort((a: any, b: any) => b.level - a.level || b.count - a.count || a.first_at.localeCompare(b.first_at))
    t.max = t.groups[0]?.level || 0
  }
  list.sort((a, b) => b.max - a.max || b.groups.length - a.groups.length || a.plate.localeCompare(b.plate))
  const counts: Record<number, number> = { 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const t of list) for (const g of t.groups) counts[g.level]++
  return { trucks: list, counts }
}

export async function recentFixed(sb: any) {
  const { data } = await sb.from('truck_check_anomalies').select('id, title, level, resolved_at, resolution_note, driver_notified_at, resolver:users!truck_check_anomalies_resolved_by_fkey(name), check:truck_checks!inner(truck_plate, driver_name)')
    .not('resolved_at', 'is', null).gte('level', 2).order('resolved_at', { ascending: false }).limit(40)
  return data || []
}

const PUSH = {
  fr: (t: string, plate: string, note: string) => ({ title: `✅ Réparé : ${t}`, body: `${plate}${note ? ` · ${note}` : ''} · Merci pour ton signalement !` }),
  sq: (t: string, plate: string, note: string) => ({ title: `✅ U riparua: ${t}`, body: `${plate}${note ? ` · ${note}` : ''} · Faleminderit për sinjalizimin!` }),
}

/** Marque corrigé (hors remarques) et prévient chaque chauffeur qui l'avait signalé. */
export async function resolveAnomalies(sb: any, ids: string[], note: string, userId: string) {
  const clean = String(note || '').trim().slice(0, 300) || null
  const { data: rows, error } = await sb.from('truck_check_anomalies')
    .update({ resolved_at: new Date().toISOString(), resolved_by: userId, resolution_note: clean })
    .in('id', ids).is('resolved_at', null).gte('level', 2)
    .select('id, title, level, check_id, check:truck_checks!inner(truck_plate, driver_id)')
  if (error) throw new Error(error.message)
  const byDriver = new Map<string, any>()
  for (const r of rows || []) if (r.check?.driver_id && r.check.driver_id !== userId && !byDriver.has(r.check.driver_id)) byDriver.set(r.check.driver_id, r)
  if (byDriver.size) {
    const { data: users } = await sb.from('users').select('id, language').in('id', [...byDriver.keys()])
    const lang = new Map((users || []).map((u: any) => [u.id, u.language === 'sq' ? 'sq' : 'fr']))
    await Promise.all([...byDriver.entries()].map(async ([driverId, r]) => {
      const msg = PUSH[(lang.get(driverId) || 'fr') as 'fr' | 'sq'](r.title, r.check.truck_plate, clean || '')
      const res = await sendPushToUser(driverId, { ...msg, url: `/check-vehicule/rapport/${r.check_id}`, tag: `truck-fix-${r.id}` }).catch(() => null)
      if (res && res.sent > 0) await sb.from('truck_check_anomalies').update({ driver_notified_at: new Date().toISOString() }).in('id', (rows || []).filter((x: any) => x.check?.driver_id === driverId).map((x: any) => x.id))
    }))
  }
  return { resolved: (rows || []).length, notified: byDriver.size, label: (rows || [])[0] ? LEVEL_LABEL_FR[(rows || [])[0].level] : null }
}

export async function openCount(sb: any): Promise<number> {
  const { count } = await sb.from('truck_check_anomalies').select('id', { count: 'exact', head: true }).is('resolved_at', null).gte('level', 2)
  return count || 0
}
