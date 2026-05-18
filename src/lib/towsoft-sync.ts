// src/lib/towsoft-sync.ts
//
// Synchronisation Towsoft via le workflow GitHub Action existant (repo
// verviers-qr). Reutilise la meme infra que Verviers-QR : on declenche
// le workflow `towsoft-parc.yml` qui execute un Puppeteer headless pour
// changer le parc d'une mission Towsoft.
//
// Aucun changement infra requis : on POST a l'API GitHub Actions avec
// un token PAT (scope workflow:write).
//
// Env var requise sur Vercel : GITHUB_TOKEN (Personal Access Token,
// scope `workflow` sur le repo Olivier-Herman/verviers-qr).
//
// Async best-effort : si Towsoft fail, on log mais on ne bloque pas
// l'action Odoo principale (Odoo reste la source de verite).

/** Mapping state_id Odoo → nom de parc Towsoft (copie Verviers-QR 2026). */
const PARC_MAPPING_TOWSOFT: Record<number, string> = {
  17: 'L FOURRIÈRE - ZONE L MAL GARÉE',
  13: '2026 - I 2026 FOURRIÈRE - ZONE I (DOMAINE)',
  11: '2026 - F 2026 - FOURRIÈRE - ZONE F',
  19: 'LABO FOURRIERE SAISIE LABO',
  5:  '2026-A 2026 - ZONE A (ACCIDENT)',
  6:  '2026 - B 2026 - FOURRIÈRE - ZONE B',
  8:  '2026 - B* 2026 - FOURRIÈRE - ZONE B* - VÉHICULE VIP',
  7:  '2026 - C 2026 - FOURRIÈRE - ZONE C',
  9:  '2026 - D 2026 - FOURRIÈRE - ZONE D (VÉHICULE ÉTRANGER)',
  10: '2026 - E 2026 - FOURRIÈRE - ZONE E',
  12: '2026 - G 2026 - FOURRIÈRE - ZONE G',
  14: '2026 - H 2026 - FOURRIÈRE - ZONE H',
  25: 'S FOURRIÈRE SAISIE CYCLO (RACHID)',
  26: '2026 - BOX 2026 - BOX',
}

const REPO_OWNER    = 'Olivier-Herman'
const REPO_NAME     = 'verviers-qr'
const WORKFLOW_FILE = 'towsoft-parc.yml'
const REF           = 'main'

/**
 * Declenche le workflow GitHub Action pour changer le parc dans Towsoft.
 * Retourne true si declenche, false sinon (best-effort, ne throw pas).
 */
export async function triggerTowsoftParcChange(opts: {
  missionNumber: string | number
  toStateId:     number
}): Promise<{ triggered: boolean; reason?: string }> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return { triggered: false, reason: 'GITHUB_TOKEN manquant' }

  const missionNumber = String(opts.missionNumber || '').trim()
  if (!missionNumber || missionNumber === '0') {
    return { triggered: false, reason: 'Pas de mission Towsoft sur ce vehicule' }
  }

  const parcName = PARC_MAPPING_TOWSOFT[opts.toStateId]
  if (!parcName) {
    return { triggered: false, reason: `state_id ${opts.toStateId} non mappe vers Towsoft` }
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization:   `Bearer ${token}`,
          Accept:          'application/vnd.github+json',
          'Content-Type':  'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          ref:    REF,
          inputs: { mission_number: missionNumber, parc_name: parcName },
        }),
      }
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { triggered: false, reason: `GitHub ${res.status}: ${text.slice(0, 200)}` }
    }
    return { triggered: true }
  } catch (e: any) {
    return { triggered: false, reason: e?.message || 'fetch fail' }
  }
}
