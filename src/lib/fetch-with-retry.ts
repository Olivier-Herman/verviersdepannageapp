// src/lib/fetch-with-retry.ts
//
// Olivier 2026-06-03 (audit J-2 W6) : wrapper fetch avec timeout + retry
// exponentiel + logs identifiables. A utiliser pour TOUS les appels externes
// (Odoo, TowSoft, Browserless, Kaze, GitHub Actions, Graph Microsoft).
//
// Avant : les fetch externes n avaient ni timeout (= function Vercel bloquee
// 5 min si service externe lent), ni retry (= 429/5xx transients =
// echec definitif), ni logs identifiables.

export interface FetchWithRetryOptions extends RequestInit {
  /** Timeout en ms (defaut 15000) */
  timeoutMs?: number
  /** Nombre de tentatives max (defaut 3 = 1 initial + 2 retries) */
  maxAttempts?: number
  /** Delay entre retries en ms (defaut 1000, backoff exponentiel) */
  retryDelayMs?: number
  /** Prefixe pour les logs (ex: '[Odoo]', '[TowSoft]') */
  logPrefix?: string
  /** Status HTTP a retry (defaut 429, 500-599) */
  retryOnStatus?: (status: number) => boolean
}

const DEFAULT_TIMEOUT_MS    = 15000
const DEFAULT_MAX_ATTEMPTS  = 3
const DEFAULT_RETRY_DELAY   = 1000

/**
 * Fetch avec timeout (AbortSignal) + retry exponentiel sur erreurs
 * transients (429, 5xx, timeout, ECONNRESET). Throw si echec definitif.
 */
export async function fetchWithRetry(
  url: string,
  opts: FetchWithRetryOptions = {},
): Promise<Response> {
  const timeoutMs    = opts.timeoutMs    ?? DEFAULT_TIMEOUT_MS
  const maxAttempts  = opts.maxAttempts  ?? DEFAULT_MAX_ATTEMPTS
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY
  const logPrefix    = opts.logPrefix    ?? '[fetch]'
  const retryOnStatus = opts.retryOnStatus ?? ((s: number) => s === 429 || (s >= 500 && s < 600))

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      const res = await fetch(url, {
        ...opts,
        signal: opts.signal || controller.signal,
      })
      clearTimeout(timeoutId)

      // Si retry-able status, on retry (sauf dernier essai)
      if (retryOnStatus(res.status) && attempt < maxAttempts) {
        const delay = retryDelayMs * Math.pow(2, attempt - 1)
        console.warn(`${logPrefix} ${url} -> ${res.status} (retry ${attempt}/${maxAttempts} dans ${delay}ms)`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      return res
    } catch (e: any) {
      lastError = e
      const isTimeout = e?.name === 'AbortError' || /timeout/i.test(e?.message || '')
      const isNetwork = /ECONN|fetch failed|network/i.test(e?.message || '')

      if ((isTimeout || isNetwork) && attempt < maxAttempts) {
        const delay = retryDelayMs * Math.pow(2, attempt - 1)
        console.warn(`${logPrefix} ${url} -> ${e?.message || 'reseau'} (retry ${attempt}/${maxAttempts} dans ${delay}ms)`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw e
    }
  }

  throw lastError || new Error(`${logPrefix} ${url} : echec apres ${maxAttempts} tentatives`)
}
