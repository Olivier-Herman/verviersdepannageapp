// src/lib/print/zebra-raw.ts
//
// Helper d impression "raw ZPL" : VD Soft compose le ZPL et l envoie au PC
// zebra-serveur qui le forwarde directement a l imprimante.
//
// Coexiste avec lib/print/zebra.ts (qui envoie un JSON metier au PC qui
// compose lui-meme le ZPL). Pendant la phase de test parallele, les deux
// flows fonctionnent en parallele :
//   - /print       (existant) : { qrUrl, motif, date, note } -> PC compose ZPL
//   - /print-raw   (nouveau)  : { zpl: "^XA...^XZ" }         -> PC forwarde
//
// Une fois valide cote design, on pourra basculer toute la prod sur ce flow.
// Cf [[etiquette-decouplage-odoo]] pour la vision long terme.

const ZEBRA_URL = process.env.ZEBRA_REMOTE || ''

export interface RawPrintResult {
  ok:     boolean
  error?: string
  status?: number
}

/**
 * Envoie un ZPL deja compose au PC zebra-serveur (endpoint /print-raw).
 * Best effort : timeout 10s, n echoue pas l app si l imprimante n est pas joignable.
 */
export async function printZPLRaw(zpl: string): Promise<RawPrintResult> {
  if (!zpl || !zpl.includes('^XA')) {
    return { ok: false, error: 'ZPL invalide (doit contenir ^XA)', status: 400 }
  }
  if (!ZEBRA_URL) {
    return { ok: false, error: 'ZEBRA_REMOTE non configure', status: 500 }
  }

  try {
    const res = await fetch(`${ZEBRA_URL.replace(/\/$/, '')}/print-raw`, {
      method: 'POST',
      headers: {
        'Content-Type':              'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ zpl }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) {
      return { ok: false, error: data?.error || `Imprimante ${res.status}`, status: 502 }
    }
    return { ok: true }
  } catch (e: any) {
    console.error('[printZPLRaw]', e.message)
    return { ok: false, error: e.message || 'Erreur impression', status: 500 }
  }
}
