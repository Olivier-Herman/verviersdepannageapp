// src/lib/missions/dossier-consistency.ts
//
// Contrôle de cohérence d'encodage : un même NUMÉRO DE DOSSIER porté par des
// VÉHICULES différents est anormal (probable erreur d'encodage) → warning.
//
// Vaut pour TOUTES les sources (Olivier 2026-07-28). Clé dossier = partie avant
// le premier '/' : pour VAB "8370687/34866862" → dossier "8370687" (le suffixe
// après '/' = n° d'intervention). Pour les autres sources sans '/', la clé = le
// dossier entier. On groupe PAR SOURCE pour éviter les collisions fortuites
// entre numérotations de systèmes différents.

/** Clé dossier = partie avant le premier '/'. null si vide. */
export function dossierPrefix(dossier: string | null | undefined): string | null {
  const s = String(dossier || '').trim()
  if (!s) return null
  const pre = s.split('/')[0].trim()
  return pre || null
}

/** Normalise une plaque pour comparaison (maj, sans espaces/tirets). */
function normPlate(p: string | null | undefined): string {
  return String(p || '').toUpperCase().replace(/[\s-]/g, '').trim()
}

// Fiches mortes/requalifiées : exclues de la détection (duplicatas Touring
// neutralisés, annulations…). Sinon 128 faux « à lier » au lieu de ~14.
const DEAD_STATUSES = new Set(['cancelled', 'canceled', 'ignored'])

export interface DossierKey { source: string; prefix: string }

// vehicle_mismatch : même dossier, véhicules différents → erreur d'encodage.
// should_link      : même dossier + même véhicule, ≥2 fiches NON liées entre
//                    elles (via parent_mission_id) → probablement à lier/fusionner.
export type DossierConflictType = 'vehicle_mismatch' | 'should_link'

export interface DossierConflict {
  source: string
  prefix: string
  type: DossierConflictType
  missions: { id: string; mission_number: number | null; plate: string | null; parent?: string | null }[]
}

/**
 * Pour une liste de clés (source, préfixe dossier), retourne les groupes
 * incohérents : véhicules différents (vehicle_mismatch) OU même véhicule non lié
 * (should_link). Interroge TOUTES les missions de ces préfixes (pas seulement
 * celles fournies). Clé de retour : `${source}::${prefix}`.
 */
export async function findDossierConflicts(
  sb: any,
  keys: DossierKey[],
): Promise<Map<string, DossierConflict>> {
  const out = new Map<string, DossierConflict>()
  const prefixes = Array.from(new Set(keys.map(k => k.prefix).filter(Boolean)))
  if (prefixes.length === 0) return out

  const wanted = new Set(keys.map(k => `${(k.source || '').toLowerCase()}::${k.prefix}`))

  // Batch les préfixes (évite une URL .or() démesurée si la liste est longue).
  const CHUNK = 40
  const rows: any[] = []
  for (let i = 0; i < prefixes.length; i += CHUNK) {
    const slice = prefixes.slice(i, i + CHUNK)
    const ors = slice.map(p => `dossier_number.like.${p}/*,dossier_number.eq.${p}`).join(',')
    const { data } = await sb
      .from('incoming_missions')
      .select('id, mission_number, dossier_number, vehicle_plate, source, parent_mission_id, status')
      .or(ors)
    if (data) rows.push(...data)
  }

  const byKey = new Map<string, { id: string; mission_number: number | null; plate: string | null; parent: string | null }[]>()
  for (const m of rows) {
    if (DEAD_STATUSES.has(String(m.status || '').toLowerCase())) continue  // fiches annulées/ignorées exclues
    const pre = dossierPrefix(m.dossier_number)
    if (!pre) continue
    const key = `${(m.source || '').toLowerCase()}::${pre}`
    if (!wanted.has(key)) continue
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push({ id: m.id, mission_number: m.mission_number, plate: m.vehicle_plate, parent: m.parent_mission_id })
  }

  for (const [key, missions] of byKey) {
    const [source, prefix] = key.split('::')
    const distinctPlates = new Set(missions.map(x => normPlate(x.plate)).filter(Boolean))
    if (distinctPlates.size >= 2) {
      out.set(key, { source, prefix, type: 'vehicle_mismatch', missions })
      continue
    }
    // Même véhicule, ≥2 fiches : hint « à lier » SAUF si déjà liées entre elles
    // (chaîne parent/enfant connectée : ≥ size-1 arêtes internes).
    if (missions.length >= 2) {
      const idSet = new Set(missions.map(x => x.id))
      const linkEdges = missions.filter(x => x.parent && idSet.has(x.parent)).length
      if (linkEdges < missions.length - 1) {
        out.set(key, { source, prefix, type: 'should_link', missions })
      }
    }
  }
  return out
}
