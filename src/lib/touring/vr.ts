// src/lib/touring/vr.ts
//
// Droits « véhicule de remplacement / taxi / shuttle » du membre Touring.
// COMEX expose des drapeaux par mission dans rest/Mission/detail/get (dispo dès
// l'acceptation). Valeurs observées : 9 = proposable, 10 = proactif (offert
// d'office), 0 = non. Sémantique à CONFIRMER en test terrain (Olivier 2026-08-03).
// Pur (aucun import serveur) → utilisable côté serveur (map) et client (UI).

export interface VrRights {
  vr:         number
  vr_taxi:    number
  shuttle_vr: number
  shuttle:    number
  taxi:       number
  proactive:  number
}

/** Extrait les drapeaux VR bruts depuis le détail COMEX (rest/Mission/detail/get). */
export function mapComexVr(d: Record<string, any>): VrRights {
  const n = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
  return {
    vr:         n(d.FL_DEMANDE_VR),
    vr_taxi:    n(d.FL_DEMANDE_VR_TAXI),
    shuttle_vr: n(d.FL_DEMANDE_SHUTTLE_VR),
    shuttle:    n(d.FL_DEMANDE_SHUTTLE),
    taxi:       n(d.FL_DEMANDE_TAXI),
    proactive:  n(d.FL_VR_PROACTIVE),
  }
}

const isOn = (v?: number) => v === 9 || v === 10   // proposable ou proactif

const FLAG_LABELS: { key: keyof VrRights; label: string }[] = [
  { key: 'vr',         label: 'VR (véhicule de remplacement)' },
  { key: 'vr_taxi',    label: 'VR + taxi' },
  { key: 'shuttle_vr', label: 'Shuttle + VR' },
  { key: 'shuttle',    label: 'Shuttle' },
  { key: 'taxi',       label: 'Taxi' },
]

export interface VrView {
  any:       boolean
  proactive: boolean
  eligible:  { key: string; label: string; proactive: boolean }[]
  /** Résumé court pour le chauffeur (ex. « VR + taxi »). */
  short:     string
}

/** Interprète les droits VR pour l'affichage. Retourne null si inconnu. */
export function interpretVr(r?: VrRights | null): VrView | null {
  if (!r) return null
  const eligible = FLAG_LABELS
    .filter(f => isOn(r[f.key] as number))
    .map(f => ({ key: f.key, label: f.label, proactive: (r[f.key] as number) === 10 }))
  const proactive = eligible.some(e => e.proactive) || r.proactive === 10
  // Résumé court : VR si l'un des VR-types, + taxi/shuttle.
  const hasVr      = isOn(r.vr) || isOn(r.vr_taxi) || isOn(r.shuttle_vr)
  const hasTaxi    = isOn(r.taxi) || isOn(r.vr_taxi)
  const hasShuttle = isOn(r.shuttle) || isOn(r.shuttle_vr)
  const parts = [hasVr && 'VR', hasTaxi && 'taxi', hasShuttle && 'shuttle'].filter(Boolean) as string[]
  return { any: eligible.length > 0, proactive, eligible, short: parts.join(' + ') }
}
