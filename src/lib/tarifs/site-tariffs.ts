// Grilles affichées sur le site public et lues par l'assistant : construites
// depuis source_tariff_lines (frais de justice = police_saisie, mal garée =
// police_mg), plus aucune copie manuelle (lot B « sans valeurs en dur »).
import { createAdminClient } from '@/lib/supabase'

export interface SiteTarifLine { poste: string; base: string; htva: string; tvac: string }
const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const line = (poste: string, base: string, htva: number): SiteTarifLine => ({ poste, base, htva: eur(htva), tvac: eur(Math.round(htva * 121) / 100) })
let cache: { at: number; v: { fourriere: SiteTarifLine[]; malGaree: SiteTarifLine[] } } | null = null

export async function getSiteTariffs(): Promise<{ fourriere: SiteTarifLine[]; malGaree: SiteTarifLine[] }> {
  if (cache && Date.now() - cache.at < 300_000) return cache.v
  const sb = createAdminClient()
  const { data, error } = await sb.from('source_tariff_lines').select('source, kind, name, default_price, vehicle_class, effective_to')
    .in('source', ['police_saisie', 'police_mg']).eq('mission_type', 'remorquage')
  if (error) throw new Error(`Grille tarifaire illisible : ${error.message}`)
  const live = (data || []).filter((l: any) => !l.effective_to || new Date(l.effective_to).getTime() > Date.now())
  const pick = (source: string, kind: string, cls: string | null, nameRe?: RegExp) => live.find((l: any) => l.source === source && l.kind === kind && (cls === null ? !l.vehicle_class : l.vehicle_class === cls) && (!nameRe || nameRe.test(String(l.name || ''))) && !/cyclo|moto/i.test(String(l.name || '')))
  const price = (l: any) => l ? Number(l.default_price || 0) : null
  const pec = price(pick('police_saisie', 'SERV-PEC', 'car')), km = price(pick('police_saisie', 'SERV-KM', 'car'))
  const gardSaisie = price(pick('police_saisie', 'SERV-PARC', 'car', /^(?!.*hors)/i)), admin = price(pick('police_saisie', 'SERV-DIV', 'car'))
  const gardHors = price(pick('police_saisie', 'SERV-PARC', null, /hors/i))
  const mgPec = price(pick('police_mg', 'SERV-PEC', null)), mgVan = price(pick('police_mg', 'SERV-PEC', 'van')), mgGard = price(pick('police_mg', 'SERV-PARC', null))
  const fourriere: SiteTarifLine[] = []
  if (pec != null) fourriere.push(line('Prise en charge du véhicule (enlèvement), 15 km inclus', 'forfait, une fois', pec))
  if (km != null) fourriere.push(line('Kilomètre au-delà des 15 km inclus', 'par kilomètre', km))
  if (gardSaisie != null) fourriere.push(line('Gardiennage pendant la saisie', 'par jour entamé', gardSaisie))
  if (admin != null) fourriere.push(line('Frais administratifs', 'forfait, une fois', admin))
  if (gardHors != null) fourriere.push(line('Gardiennage après la levée de saisie', 'par jour entamé', gardHors))
  const malGaree: SiteTarifLine[] = []
  if (mgPec != null) malGaree.push(line('Enlèvement d’une voiture', 'forfait, une fois', mgPec))
  if (mgVan != null) malGaree.push(line('Enlèvement d’une camionnette', 'forfait, une fois', mgVan))
  if (mgGard != null) malGaree.push(line('Gardiennage', 'par jour entamé', mgGard))
  const v = { fourriere, malGaree }
  cache = { at: Date.now(), v }
  return v
}
