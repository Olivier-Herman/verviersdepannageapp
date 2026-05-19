// src/app/api/webhooks/kaze/[secret]/route.ts
//
// Endpoint webhook recu de Kaze (IMA Benelux).
//
// URL configuree cote Kaze :
//   https://app.verviersdepannage.com/api/webhooks/kaze/<KAZE_WEBHOOK_SECRET>
//
// Strategie :
//   1. Verifier le secret dans le path (Kaze ne supporte pas de signature)
//   2. Logger le payload brut dans kaze_webhook_events (audit + replay)
//   3. Repondre 200 OK le plus vite possible (Kaze coupe a 15 sec)
//   4. Le traitement (insert/update mission) sera plug dans un step suivant
//      une fois qu on aura sonde une vraie mission IMA pour decouvrir le
//      schema du workflow.
//
// Securite : la cle KAZE_WEBHOOK_SECRET est un secret URL (token aleatoire
// 32+ chars). A regenerer si suspicion de fuite (et a mettre a jour cote Kaze).

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const runtime     = 'nodejs'
export const maxDuration = 10

export async function POST(req: NextRequest, { params }: { params: { secret: string } }) {
  // 1) Verification du secret
  const expected = process.env.KAZE_WEBHOOK_SECRET
  if (!expected) {
    console.error('[kaze-webhook] KAZE_WEBHOOK_SECRET non configure')
    return NextResponse.json({ error: 'Misconfigured' }, { status: 500 })
  }
  if (params.secret !== expected) {
    console.warn(`[kaze-webhook] secret invalide (recu : ${params.secret.slice(0, 6)}...)`)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 2) Lecture du payload
  let payload: any = null
  try {
    payload = await req.json()
  } catch {
    payload = { _parse_error: true, raw: await req.text().catch(() => '') }
  }

  // 3) Best-effort extraction des champs cles (a affiner quand on aura
  //    vu le vrai format Kaze)
  const eventType = (
    payload?.event_type ||
    payload?.event      ||
    payload?.type       ||
    payload?.action     ||
    null
  )
  const kazeJobId = (
    payload?.job_id     ||
    payload?.job?.id    ||
    payload?.data?.id   ||
    payload?.id         ||
    null
  )

  // 4) Audit en BDD (insert non bloquant : si Supabase est lent, on log
  //    l erreur mais on repond 200 quand meme pour ne pas faire disable
  //    le webhook par Kaze)
  try {
    const sb = createAdminClient()
    const { error: dbErr } = await sb
      .from('kaze_webhook_events')
      .insert({
        event_type:  eventType,
        kaze_job_id: kazeJobId,
        payload,
      })
    if (dbErr) {
      console.error('[kaze-webhook] insert audit failed:', dbErr.message)
    }
  } catch (e: any) {
    console.error('[kaze-webhook] audit exception:', e?.message)
  }

  // 5) Ack
  console.log(`[kaze-webhook] received event=${eventType ?? 'unknown'} job_id=${kazeJobId ?? 'none'}`)
  return NextResponse.json({ ok: true }, { status: 200 })
}

// Kaze peut envoyer en POST ou PUT (cf UI : Request Method = post|put).
// On accepte les deux pour rester tolerant.
export const PUT = POST

// GET pour test manuel + future eventuelle validation de l URL par Kaze.
export async function GET(_req: NextRequest, { params }: { params: { secret: string } }) {
  const expected = process.env.KAZE_WEBHOOK_SECRET
  if (!expected || params.secret !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json({ ok: true, ready: true, hint: 'POST event payload here' })
}
