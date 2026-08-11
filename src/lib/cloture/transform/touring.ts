// src/lib/cloture/transform/touring.ts
//
// TRANSFORMATION « derrière » pour une mission Touring COMEX (Olivier 2026-08-11).
//
// C'est le seul vrai spécifique par assistance : le chauffeur ne la voit jamais.
// Elle traduit { issue + motif + données du tronc commun } en langage COMEX et
// rejoue `closeTouringMission()` — la fonction DÉJÀ éprouvée en production, on ne
// réimplémente rien du protocole.
//
// Garde-fous :
//   • le code de fin visé est intersecté avec `LST_CODE_END_MIS` du dossier ;
//     si COMEX ne l'autorise pas, on le dit au lieu d'envoyer un code refusé ;
//   • un motif d'une AUTRE branche que l'issue est rejeté (branches étanches) ;
//   • un déplacement pour rien n'encode AUCUN code panne (confirmé Olivier
//     2026-08-11) : le motif EST le code de fin d'annulation. On envoie donc les
//     trois codes VIDES — il n'y a pas eu de panne constatée.

import { loginComex, getComexMissionDetail, closeTouringMission } from '@/lib/touring/comex'
import { findMotif, catchAllOf } from '@/lib/cloture/motifs'
import { branchOf, outcomeIsRem, OUTCOMES, type Outcome } from '@/lib/cloture/outcomes'

export interface ComexKeys { CID_DOS: string; CID_SEQ_ACTION: string }

export interface TransformInput {
  outcome:   Outcome
  /** Codes de la clôture précédente (livraison : on reprend la 1re jambe). */
  prefill?:  { cause: string; desc: string; result: string } | null
  motifKey?: string | null
  /** Déplacement pour rien : code d'annulation choisi par le chauffeur. */
  dprCode?:  string | null
  vin?:      string | null
  km?:       number | null
  /** Garage de la liste COMEX (CID_INTV) — dépose d'un remorquage. */
  toCidIntv?: string | null
  /** Dépose à une adresse libre (encodée dans le commentaire de fin de mission). */
  manualAddress?: { nom?: string; rue?: string; num?: string; cp?: string; loc?: string } | null
  /** Commentaire déjà formaté (garage de la liste). */
  comment?:  string | null
}

export interface TransformResult {
  ok: boolean
  finCode?: string
  codes?: { cause: string; desc: string; result: string } | null
  statusBefore?: string | null
  statusAfter?: string | null
  error?: string
}

/** Parse les clés COMEX stockées dans `raw_content` de la fiche. */
export function parseComexKeys(raw: string | null | undefined): ComexKeys | null {
  try {
    const c = JSON.parse(raw || '{}')
    const CID_DOS = String(c?.CID_DOS || '').trim()
    const CID_SEQ_ACTION = String(c?.CID_SEQ_ACTION || '').trim()
    return CID_DOS && CID_SEQ_ACTION ? { CID_DOS, CID_SEQ_ACTION } : null
  } catch { return null }
}

/** Codes de fin réellement autorisés par COMEX sur ce dossier. */
async function allowedFinCodes(keys: ComexKeys): Promise<string[]> {
  try {
    const session = await loginComex('user')
    const dRes: any = await getComexMissionDetail(session, keys)
    const d = (dRes?.content || dRes || {}) as Record<string, any>
    return String(d.LST_CODE_END_MIS || '').split(';').map(s => s.trim()).filter(Boolean)
  } catch { return [] }
}

export async function transformTouring(keys: ComexKeys, input: TransformInput): Promise<TransformResult> {
  const def = OUTCOMES[input.outcome]
  if (!def) return { ok: false, error: 'Issue inconnue' }

  // ── Codes panne : selon la branche de l'issue, jamais mélangées ────────────
  const branch = branchOf(input.outcome)
  let codes: { cause: string; desc: string; result: string }
  if (branch) {
    const motif = input.motifKey ? findMotif(branch, input.motifKey) : undefined
    if (!motif) return { ok: false, error: 'Motif absent ou hors branche' }
    codes = motif.touring
  } else if (input.outcome === 'delivered') {
    // Livraison : la panne a déjà été encodée sur la jambe dépannage. On reprend
    // ces codes (comme le prefill de l'écran actuel) — le chauffeur ne ré-encode rien.
    codes = input.prefill || catchAllOf('remorquage').touring
  } else {
    // Déplacement pour rien : AUCUN code panne (Olivier). Le chauffeur n'a rien
    // constaté — le motif est porté par le code de fin d'annulation.
    codes = { cause: '', desc: '', result: '' }
  }

  // ── Code de fin de mission ────────────────────────────────────────────────
  let finCode = def.fin || ''
  if (input.outcome === 'dpr') {
    finCode = String(input.dprCode || '').trim()
    if (!finCode) return { ok: false, error: 'Motif de déplacement pour rien manquant' }
  }

  const allowed = await allowedFinCodes(keys)
  if (allowed.length > 0 && !allowed.includes(finCode)) {
    return {
      ok: false, finCode,
      error: `Touring n'autorise pas ce type de clôture sur ce dossier (codes possibles : ${allowed.join(', ')})`,
    }
  }

  // ── Destination d'un remorquage : garage de la liste ou adresse libre ──────
  let comment = String(input.comment || '')
  if (outcomeIsRem(input.outcome) && !input.toCidIntv && input.manualAddress) {
    const a = input.manualAddress
    const nom = String(a.nom || '').trim() || 'x'
    comment = `// ADRESSE TO REM MAN : ${nom} ${a.rue || 'x'} ${a.num || 'x'} ${a.cp || 'x'} ${a.loc || 'x'} //`
  }

  const r = await closeTouringMission(keys, {
    finCode,
    cause: codes.cause, desc: codes.desc, result: codes.result,
    vin: input.vin ?? null,
    km: input.km ?? null,
    comment,
    toCidIntv: input.toCidIntv || null,
  })

  return {
    ok: r.ok, finCode, codes,
    statusBefore: r.statusBefore, statusAfter: r.statusAfter,
    error: r.ok ? undefined : (r.error || 'Clôture refusée par Touring'),
  }
}
