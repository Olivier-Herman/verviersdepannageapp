// Envoi best-effort d'un plantage côté client vers /api/client-error (Olivier 21/10/2026).
export function reportClientError(error: any, where: string) {
  try {
    const body = JSON.stringify({ message: String(error?.message || error), stack: String(error?.stack || ''), digest: error?.digest || null, url: typeof location !== 'undefined' ? location.pathname : '', where })
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }))
    else fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  } catch { /* jamais bloquant */ }
}
