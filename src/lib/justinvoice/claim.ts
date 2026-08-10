// src/lib/justinvoice/claim.ts
//
// Dépôt d'une créance sur JustInvoice (SPF Justice) — UN seul POST JSON vers le
// flux Power Automate (le `sig` de l'URL autorise, pas de cookie/login requis).
// Cf capture 2026-08-10 [[project_justinvoice_spf_justice]].
//
// docType : CostState = état de frais · Claim = réquisitoire · Approval = état de
// frais (l'agent approuve sur l'état de frais → même document, règle Olivier).

// Constantes (GUID non secrets). Le flow URL (avec le sig qui autorise) est en env.
const FLOW_URL         = process.env.JUSTINGOV_FLOW_URL || ''
const SERVICE_PROVIDER = process.env.JUSTINGOV_SERVICE_PROVIDER || '89793e39-2a5c-ed11-9562-000d3ab1109c'
const STEP             = process.env.JUSTINGOV_STEP || 'f23b04f8-3636-ec11-8c64-000d3a2ed0c0'
const OFFICE_LIEGE     = '43f92681-513d-ec11-8c63-000d3a4a00f5'
const TYPE_TOWAGE      = '5fbf9243-593d-ec11-8c63-000d3a4a00f5'

export interface JustInvoiceClaimInput {
  comments: string
  /** État de frais signé (PDF) → CostState + Approval. */
  etatFrais: Buffer
  /** Réquisitoire (PDF) → Claim. */
  requisitoire: Buffer
  /** Bureau de validation (GUID) — défaut Liège. */
  validationOffice?: string
  etatFraisName?: string
  requisitoireName?: string
}

export interface JustInvoiceClaimResult {
  ok: boolean
  ref?: string | null        // n° de dossier renvoyé (ex 527906-26)
  status: number
  raw?: string
  error?: string
}

function extractRef(text: string): string | null {
  // n° JustInvoice type "527906-26" ou champ claim/reference/number dans le JSON.
  try {
    const j = JSON.parse(text)
    const cand = j.claim || j.claimNumber || j.reference || j.number || j.id || j.result || null
    if (cand && /\d{4,}-\d{1,3}/.test(String(cand))) return String(cand)
    if (cand) return String(cand)
  } catch {}
  const m = text.match(/\b\d{5,}-\d{1,3}\b/)
  return m ? m[0] : null
}

/** Dépose la créance. NE crée une vraie créance QUE si appelé pour de bon. */
export async function submitJustInvoiceClaim(input: JustInvoiceClaimInput): Promise<JustInvoiceClaimResult> {
  if (!FLOW_URL) return { ok: false, status: 0, error: 'JUSTINGOV_FLOW_URL manquant (endpoint + sig)' }

  const efB64 = input.etatFrais.toString('base64')
  const files = [
    { docType: 'CostState', docVersion: 1, fileName: input.etatFraisName || 'etat-de-frais.pdf', content: efB64 },
    { docType: 'Claim',     docVersion: 1, fileName: input.requisitoireName || 'requisitoire.pdf', content: input.requisitoire.toString('base64') },
    { docType: 'Approval',  docVersion: 1, fileName: input.etatFraisName || 'etat-de-frais.pdf', content: efB64 },
  ]
  const body = {
    serviceProvider: SERVICE_PROVIDER,
    step: STEP,
    validationOffice: input.validationOffice || OFFICE_LIEGE,
    serviceType: TYPE_TOWAGE,
    comments: input.comments,
    notifications: 'Yes',
    files,
  }

  let res: Response
  try {
    res = await fetch(FLOW_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'origin': 'https://justinvoice.just.fgov.be',
        'referer': 'https://justinvoice.just.fgov.be/',
      },
      body: JSON.stringify(body),
    })
  } catch (e: any) {
    return { ok: false, status: 0, error: `Réseau : ${e?.message || e}` }
  }

  const raw = await res.text().catch(() => '')
  if (!res.ok) return { ok: false, status: res.status, raw: raw.slice(0, 500), error: `HTTP ${res.status}` }
  return { ok: true, status: res.status, ref: extractRef(raw), raw: raw.slice(0, 500) }
}
