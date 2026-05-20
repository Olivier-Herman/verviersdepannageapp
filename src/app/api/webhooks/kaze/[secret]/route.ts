// src/app/api/webhooks/kaze/[secret]/route.ts
//
// Endpoint webhook recu de Kaze (IMA Benelux).
//
// URL configuree cote Kaze :
//   https://app.verviersdepannage.com/api/webhooks/kaze/<KAZE_WEBHOOK_SECRET>
//
// Strategie :
//   1. Verifier le secret dans le path (Kaze ne supporte pas de signature HMAC)
//   2. Logger le payload brut dans kaze_webhook_events (audit + replay)
//   3. Dispatch selon l event_type :
//      - import   : Mission proposee / Prestataire assigne / Mise a jour donnees
//      - cancel   : Tache annulee / Mission proposee annulee / Proposition expiree
//      - skip     : autres events (logues mais pas traites)
//   4. Repondre 200 OK avant 15 sec (sinon Kaze desactive le webhook)
//
// Securite : le secret URL (KAZE_WEBHOOK_SECRET, ~64 chars hex) sert
// d authentification. A regenerer si suspicion de fuite + update cote Kaze.

import { NextRequest, NextResponse }       from 'next/server'
import { createAdminClient }                from '@/lib/supabase'
import { importKazeJob, cancelKazeJob }     from '@/lib/kaze/import'

export const dynamic     = 'force-dynamic'
export const runtime     = 'nodejs'
export const maxDuration = 14   // < 15s limite Kaze

/**
 * Detecte l action a partir de l event_type (champ francais ou anglais).
 * Robuste a la casse et aux variations FR/NL/EN.
 */
function detectAction(eventType: string | null): 'import' | 'cancel' | 'skip' {
  if (!eventType) return 'skip'
  const e = eventType.toLowerCase()

  // Annulations : prioritaire (peut contenir aussi "mission" ou "task")
  if (/cancel|annul|reject|rejet|expir|verlop/.test(e)) return 'cancel'

  // Imports : creation/maj de mission
  if (/perform|prestataire|assign|propos|update|data_updated|mise.a.jour|task_updated|task_created/.test(e)) {
    return 'import'
  }

  return 'skip'
}

export async function POST(req: NextRequest, { params }: { params: { secret: string } }) {
  const t0 = Date.now()

  // 1) Verification secret
  const expected = process.env.KAZE_WEBHOOK_SECRET
  if (!expected) {
    console.error('[kaze-webhook] KAZE_WEBHOOK_SECRET non configure')
    return NextResponse.json({ error: 'Misconfigured' }, { status: 500 })
  }
  if (params.secret !== expected) {
    console.warn(`[kaze-webhook] secret invalide (recu : ${params.secret.slice(0, 6)}...)`)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 2) Lecture payload
  let payload: any = null
  try {
    payload = await req.json()
  } catch {
    payload = { _parse_error: true, raw: await req.text().catch(() => '') }
  }

  // 3) Extraction event_type + job_id (best-effort, plusieurs noms possibles
  //    selon ce qu envoie Kaze)
  const eventType = (
    payload?.event_type ||
    payload?.event      ||
    payload?.type       ||
    payload?.action     ||
    payload?.eventName  ||
    null
  )
  const kazeJobId = (
    payload?.job_id     ||
    payload?.job?.id    ||
    payload?.data?.id   ||
    payload?.task?.id   ||
    payload?.id         ||
    null
  )

  // 4) Audit : insert immediatement pour ne rien perdre
  let eventId: string | undefined
  try {
    const sb = createAdminClient()
    const { data, error: dbErr } = await sb
      .from('kaze_webhook_events')
      .insert({ event_type: eventType, kaze_job_id: kazeJobId, payload })
      .select('id')
      .single()
    if (dbErr) console.error('[kaze-webhook] insert audit failed:', dbErr.message)
    else eventId = data?.id
  } catch (e: any) {
    console.error('[kaze-webhook] audit exception:', e?.message)
  }

  // 5) Dispatch action
  const action = detectAction(eventType)
  let result: any = { action, event: eventType, job_id: kazeJobId }

  if (action !== 'skip' && kazeJobId) {
    try {
      if (action === 'import') {
        result.import = await importKazeJob(kazeJobId, { webhookEventId: eventId })
      } else if (action === 'cancel') {
        result.cancel = await cancelKazeJob(kazeJobId, {
          webhookEventId: eventId,
          reason: `Annulation Kaze : ${eventType}`,
        })
      }
    } catch (e: any) {
      console.error(`[kaze-webhook] dispatch action=${action} failed:`, e?.message)
      result.error = e?.message
    }
  } else if (action !== 'skip' && !kazeJobId) {
    console.warn(`[kaze-webhook] action=${action} mais kazeJobId manquant — skip`)
  }

  const durationMs = Date.now() - t0
  console.log(`[kaze-webhook] event=${eventType ?? 'unknown'} job=${kazeJobId ?? 'none'} action=${action} ${durationMs}ms`)

  return NextResponse.json({ ok: true, ...result }, { status: 200 })
}

// Kaze peut envoyer en POST ou PUT (cf UI : Request Method = post|put).
export const PUT = POST

// GET pour test manuel + future eventuelle validation de l URL par Kaze.
export async function GET(_req: NextRequest, { params }: { params: { secret: string } }) {
  const expected = process.env.KAZE_WEBHOOK_SECRET
  if (!expected || params.secret !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json({ ok: true, ready: true, hint: 'POST event payload here' })
}
