// src/lib/print/zebra-raw.ts
//
// Helper d impression "raw ZPL" : VD Soft compose le ZPL et l envoie au PC
// zebra-serveur qui le forwarde directement a l imprimante.
//
// Olivier 2026-06-03 (audit J-2 W1) : ajout queue resiliente. Si le PC est
// offline / l imprimante en bourrage, le ZPL est mis en queue (print_queue)
// et le cron /api/cron/print-queue retentera toutes les 2 min jusqu a ce
// que ca passe. Plus de perte d etiquette silencieuse.

import { createAdminClient } from '@/lib/supabase'

const ZEBRA_URL = process.env.ZEBRA_REMOTE || ''

export interface RawPrintResult {
  ok:     boolean
  error?: string
  status?: number
  queued?: boolean   // true si mis en queue suite a echec
}

interface PrintOptions {
  /** Mission liee pour tracability dans la queue */
  missionId?: string | null
  /** Contexte de l etiquette : 'parc_label', 'rel_label', etc. */
  context?: string
  /** Si true, ne fait pas de fallback queue (use case : test imprimante). */
  skipQueue?: boolean
}

/**
 * Tentative d impression directe via PC zebra-serveur.
 * Pas de fallback queue (utilise par le cron print-queue qui retiente).
 */
async function tryPrintDirect(zpl: string): Promise<RawPrintResult> {
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

/**
 * Envoie un ZPL au PC zebra-serveur. Si l impression directe echoue (PC
 * offline, imprimante en panne, etc.), le ZPL est mis en queue. Le cron
 * /api/cron/print-queue retiente toutes les 2 min jusqu au succes.
 *
 * Renvoie ok=true si succes immediat, queued=true si mis en queue.
 */
export async function printZPLRaw(zpl: string, opts: PrintOptions = {}): Promise<RawPrintResult> {
  const direct = await tryPrintDirect(zpl)
  if (direct.ok) return direct
  if (opts.skipQueue) return direct  // test imprimante : pas de queue

  // Echec direct -> queue pour retry
  try {
    const sb = createAdminClient()
    await sb.from('print_queue').insert({
      mission_id:    opts.missionId || null,
      zpl,
      context:       opts.context || null,
      status:        'pending',
      attempts:      1,
      last_error:    direct.error || 'inconnu',
      next_retry_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),  // retry dans 2 min
    })
    console.warn(`[printZPLRaw] Echec direct (${direct.error}), mis en queue`)
    return { ok: false, queued: true, error: `Impression differee (en queue) : ${direct.error}`, status: 202 }
  } catch (e: any) {
    console.error('[printZPLRaw] queue insert echec:', e?.message)
    return direct  // double echec : retourne l erreur originale
  }
}

/** Pour usage cron print-queue : retry une entree existante. */
export async function tryPrintQueueEntry(zpl: string): Promise<RawPrintResult> {
  return tryPrintDirect(zpl)
}
