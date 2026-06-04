// src/lib/log.ts
//
// Olivier 2026-06-03 (audit J-2 W4) : helper de logging applicatif vers
// la table error_logs (lue depuis /admin/logs).
//
// A appeler depuis les routes API avant chaque NextResponse.json(500),
// en plus du console.error qui reste pour Vercel logs.

import { createAdminClient } from '@/lib/supabase'

export type LogLevel = 'error' | 'warn' | 'info'

export interface LogPayload {
  level?:    LogLevel
  route?:    string
  message:   string
  metadata?: Record<string, any>
  userId?:   string | null
  userEmail?: string | null
}

/**
 * Logue une erreur applicative. Best-effort : ne fail pas si l INSERT plante
 * (sinon on cree un loop infini de logs sur log echec). On laisse aussi
 * console.error pour Vercel.
 */
export async function logError(payload: LogPayload): Promise<void> {
  try {
    const sb = createAdminClient()
    await sb.from('error_logs').insert({
      level:      payload.level || 'error',
      route:      payload.route || null,
      message:    payload.message.slice(0, 2000),  // safe truncate
      metadata:   payload.metadata || null,
      user_id:    payload.userId || null,
      user_email: payload.userEmail || null,
    })
  } catch (e: any) {
    // Best-effort : on tombe juste sur le console
    console.error('[log] insert error_logs echec:', e?.message)
  }
}

/** Helper qui logue + retourne un message pour la console. */
export function logErrorFireForget(payload: LogPayload): void {
  // Fire and forget (pas d await), pour ne pas bloquer la response API
  void logError(payload)
}
