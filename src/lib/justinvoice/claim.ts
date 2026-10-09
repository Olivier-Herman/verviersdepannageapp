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

/**
 * Adresse ACTIVE du flux de dépôt, lue sur la page « Start Claim » du portail (connexion par code mail).
 * Le SPF Justice a déplacé le flux (09/10/2026 : ancienne adresse logic.azure « trigger is not enabled », nouvelle
 * sur powerplatform.com) : l'adresse en dur ne suffit plus. La ligne commentée « // var requestURL » est ignorée.
 */
export async function resolveClaimFlowUrl(): Promise<string | null> {
  const { justInvoiceLogin } = await import('./login')
  let s
  try { s = await justInvoiceLogin() } catch { await new Promise(r => setTimeout(r, 15000)); s = await justInvoiceLogin() }
  const page = await (await s.fetch('https://justinvoice.just.fgov.be/overview/claim/')).text()
  const live = page.replace(/\/\/[^\n]*?var requestURL[^;\n]*;/g, '')
  return live.match(/var requestURL = "([^"]+)"/)?.[1] || null
}

async function storedFlowUrl(): Promise<string> {
  try {
    const { createAdminClient } = await import('@/lib/supabase')
    const { data } = await createAdminClient().from('app_settings').select('value').eq('key', 'justinvoice_flow_url').maybeSingle()
    return data?.value ? JSON.parse(data.value) : ''
  } catch { return '' }
}
async function storeFlowUrl(url: string) {
  try {
    const { createAdminClient } = await import('@/lib/supabase')
    await createAdminClient().from('app_settings').upsert({ key: 'justinvoice_flow_url', value: JSON.stringify(url) }, { onConflict: 'key' })
  } catch { /* non bloquant */ }
}

/** Dépose la créance. NE crée une vraie créance QUE si appelé pour de bon. */
export async function submitJustInvoiceClaim(input: JustInvoiceClaimInput): Promise<JustInvoiceClaimResult> {
  let flowUrl = (await storedFlowUrl()) || FLOW_URL
  if (!flowUrl) { flowUrl = (await resolveClaimFlowUrl()) || ''; if (flowUrl) await storeFlowUrl(flowUrl) }
  if (!flowUrl) return { ok: false, status: 0, error: 'Adresse de dépôt JustInvoice introuvable' }

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

  const post = (url: string) => fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': 'https://justinvoice.just.fgov.be',
      'referer': 'https://justinvoice.just.fgov.be/',
    },
    body: JSON.stringify(body),
  })
  let res: Response
  try { res = await post(flowUrl) } catch (e: any) { return { ok: false, status: 0, error: `Réseau : ${e?.message || e}` } }
  let raw = await res.text().catch(() => '')
  // Flux déplacé / désactivé par le SPF : on relit l'adresse active sur le portail et on réessaie UNE fois
  // (le refus arrive avant tout traitement : aucun risque de double créance).
  if (!res.ok && /NotEnabled|WorkflowNotFound|AuthorizationFailed|DirectApiAuthorizationRequired/i.test(raw)) {
    const fresh = await resolveClaimFlowUrl().catch(() => null)
    if (fresh && fresh !== flowUrl) {
      await storeFlowUrl(fresh)
      try { res = await post(fresh); raw = await res.text().catch(() => '') } catch (e: any) { return { ok: false, status: 0, error: `Réseau : ${e?.message || e}` } }
    }
  }
  if (!res.ok) return { ok: false, status: res.status, raw: raw.slice(0, 500), error: `HTTP ${res.status}${/NotEnabled/i.test(raw) ? ' — adresse de dépôt désactivée par le SPF Justice' : ''}` }
  return { ok: true, status: res.status, ref: extractRef(raw), raw: raw.slice(0, 500) }
}
