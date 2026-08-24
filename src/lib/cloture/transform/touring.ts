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
import { splitAddress } from '@/lib/address-parts'

export interface ComexKeys { CID_DOS: string; CID_SEQ_ACTION: string }

/** Destination en champs séparés, telle que COMEX la range (TO_RUE, TO_CP…). */
interface ComexToAddress {
  nom?: string; rue?: string; numRue?: string; cp?: string; loc?: string
  lat?: number | null; lng?: number | null
}

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
  /** Destination telle qu'elle vit sur la fiche VD Soft — dernier recours quand
   *  ni garage COMEX ni adresse manuelle n'ont été transmis (cas de la LIVRAISON,
   *  où le chauffeur ne rechoisit pas une destination déjà connue). */
  ficheDestination?: string | null
  ficheDestinationName?: string | null
  ficheDestinationLat?: number | null
  ficheDestinationLng?: number | null
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
    // Livraison. Deux cas :
    //   • jambe REM issue d'un DSP → les codes ont été encodés à la 1re clôture,
    //     on les reprend et le chauffeur ne ré-encode rien ;
    //   • REM envoyé DIRECTEMENT par Touring → aucun code antérieur : le chauffeur
    //     a choisi un motif. Sans lui on clôturerait en « cause inconnue », ce qui
    //     pollue la facturation BKO. Olivier 2026-08-11.
    const chosen = input.motifKey ? findMotif('remorquage', input.motifKey) : undefined
    if (chosen)            codes = chosen.touring
    else if (input.prefill) codes = input.prefill
    else return { ok: false, error: 'Motif de remorquage manquant (aucun code à reprendre)' }
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

  // Le 05 (mise en parc) ne figure dans LST_CODE_END_MIS qu'une fois la « Fin
  // Technique Dépôt » faite — et c'est closeTouringMission qui l'arme juste après
  // (endTech FL_TECH_END_MIS:1). On ne le refuse donc pas sur son absence.
  const UNLOCKED_BY_END_TECH = finCode === '05'
  const allowed = await allowedFinCodes(keys)
  if (!UNLOCKED_BY_END_TECH && allowed.length > 0 && !allowed.includes(finCode)) {
    return {
      ok: false, finCode,
      error: `Touring n'autorise pas ce type de clôture sur ce dossier (codes possibles : ${allowed.join(', ')})`,
    }
  }

  // ── OÙ EST PARTI LE VÉHICULE — ON LE DIT TOUJOURS ─────────────────────────
  // Touring nous écrit régulièrement « Pourriez-vous nous communiquer l'adresse
  // de destination svp ? » (7 mails depuis le 28/07 : 1DOV823, MAT125, 2HSF833,
  // SUJM1012, 2DNK746, GZB63T…). La raison est ici.
  //
  // Le commentaire de destination n'était fabriqué QUE sur la transformation en
  // remorquage, et seulement si le chauffeur avait tapé une adresse manuelle.
  // Sur la LIVRAISON — l'issue « véhicule livré à destination », le moment même
  // où l'on annonce l'arrivée — `outcomeIsRem('delivered')` est faux : on ne
  // remplissait donc AUCUN champ d'adresse et aucun commentaire. Touring recevait
  // une clôture de remorquage sans destination, et devait la demander par mail.
  //
  // Désormais : toute issue qui déplace le véhicule dit où il est allé, et à
  // défaut d'adresse saisie on reprend celle de la fiche.
  const déplaceLeVéhicule = outcomeIsRem(input.outcome) || input.outcome === 'delivered'

  // On construit la destination en CHAMPS SÉPARÉS — rue, numéro, code postal,
  // localité, coordonnées — parce que c'est de ces champs que dépendent leurs
  // automatisations. Quand ils sont vides, Touring inscrit « CHECK ADDRESS » et
  // nous écrit. Le commentaire reste, mais en doublure lisible, pas en substitut.
  let toAddress: ComexToAddress | null = null
  if (déplaceLeVéhicule && !input.toCidIntv) {
    const a = input.manualAddress
    if (a && (a.rue || a.cp || a.loc)) {
      toAddress = {
        nom: String(a.nom || '').trim(), rue: String(a.rue || '').trim(),
        numRue: String(a.num || '').trim(), cp: String(a.cp || '').trim(),
        loc: String(a.loc || '').trim(),
      }
    } else if (String(input.ficheDestination || '').trim()) {
      // La fiche ne porte qu'une ligne : on la découpe pour remplir leurs champs.
      const p = splitAddress(input.ficheDestination)
      if (p.street || p.zip || p.city) {
        toAddress = {
          nom: String(input.ficheDestinationName || '').trim(),
          rue: p.street, numRue: p.number, cp: p.zip, loc: p.city,
          lat: input.ficheDestinationLat ?? null, lng: input.ficheDestinationLng ?? null,
        }
      }
    }
  }

  let comment = String(input.comment || '')
  if (!comment && toAddress) {
    const v = (x?: string | null) => (String(x || '').trim() || 'x')
    comment = `// ADRESSE TO REM MAN : ${v(toAddress.nom)} ${v(toAddress.rue)} ${v(toAddress.numRue)} ${v(toAddress.cp)} ${v(toAddress.loc)} //`
  }

  const r = await closeTouringMission(keys, {
    finCode,
    cause: codes.cause, desc: codes.desc, result: codes.result,
    vin: input.vin ?? null,
    km: input.km ?? null,
    comment,
    toCidIntv: input.toCidIntv || null,
    toAddress,
  })

  return {
    ok: r.ok, finCode, codes,
    statusBefore: r.statusBefore, statusAfter: r.statusAfter,
    error: r.ok ? undefined : (r.error || 'Clôture refusée par Touring'),
  }
}
