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
export const maxDuration = 60   // la réponse part en < 1 s ; le traitement continue en arrière-plan (waitUntil)

/**
 * Detecte l action a partir de l event_type (champ francais ou anglais).
 * Robuste a la casse et aux variations FR/NL/EN.
 */
function detectAction(eventType: string | null): 'import' | 'cancel' | 'accepted' | 'step' | 'invoice' | 'skip' {
  if (!eventType) return 'skip'
  const e = eventType.toLowerCase()

  // Nouveaux déclencheurs activables chez Kaze (Olivier 10/09/2026) : acceptation
  // confirmée, étape complétée, factures — journalisés sur la fiche, sans ré-import.
  if (/invoice|factur/.test(e)) return 'invoice'
  if (/proposal_accepted|proposition.*accept|accept.*proposal/.test(e)) return 'accepted'
  if (/step_completed|etape|step/.test(e)) return 'step'

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

  // 3) Extraction event_type + job_id.
  //    Olivier 2026-06-18 : Kaze envoie en réalité une ENVELOPPE :
  //      { payload: { id|job_id, title, status, ... }, trigger: "job_provider_assigned"|
  //        "job_proposal_proposed"|..., webhook_id, notification_id, created_at }
  //    Avant, on lisait event_type/id au niveau racine → toujours null → tous les
  //    webhooks étaient "skip" → AUCUNE mission Kaze importée/reliée (incident go-live).
  //    On lit donc `trigger` + l'id imbriqué (payload.payload.id pour les events job,
  //    payload.payload.job_id pour les proposals). Fallbacks conservés par sécurité.
  const inner = payload?.payload || {}
  const eventType = (
    payload?.trigger    ||   // format réel Kaze
    payload?.event_type ||
    payload?.event      ||
    payload?.type       ||
    payload?.action     ||
    payload?.eventName  ||
    null
  )
  const kazeJobId = (
    inner?.id           ||   // events job (job_provider_assigned, task_updated…)
    inner?.job_id       ||   // events proposal (job_proposal_proposed…)
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

  // Olivier 2026-06-19 : id de PROPOSITION (≠ job). Envoyé par l'event
  // job_proposal_proposed sous inner.proposal_id. On le mémorise sur la mission
  // pour pouvoir accepter ensuite via l'appli web (/job_proposals/{id}/accept).
  const proposalId = inner?.proposal_id || payload?.proposal_id || null

  // Kaze attend une réponse 20x en moins de 10 s, sinon il désactive le webhook
  // (bandeau de leur écran, 10/09/2026). L'import d'un job (lecture Kaze +
  // création de fiche + géocodage) peut dépasser : on répond tout de suite, le
  // traitement continue en arrière-plan (waitUntil), l'événement est déjà en base.
  const work = (async () => {
  if (action !== 'skip' && kazeJobId) {
    try {
      if (action === 'accepted' || action === 'step' || action === 'invoice') {
        const sb3 = createAdminClient()
        const { data: m } = await sb3.from('incoming_missions').select('id, mission_number').eq('kaze_job_id', kazeJobId).eq('dossier_leg', false).maybeSingle()
        if (m) {
          const st = String(inner?.status || payload?.status || '')
          const notes = action === 'accepted' ? 'Kaze ↙ proposition acceptée confirmée par Kaze'
            : action === 'step' ? `Kaze ↙ étape complétée${inner?.step_name || inner?.step ? ' : ' + (inner?.step_name || inner?.step) : ''}${st ? ' (statut ' + st + ')' : ''}`
            : `Kaze ↙ facture : ${eventType}${inner?.number || inner?.reference ? ' ' + (inner?.number || inner?.reference) : ''}${inner?.amount ? ' · ' + inner.amount : ''}`
          await sb3.from('mission_logs').insert({ mission_id: m.id, action: action === 'invoice' ? 'kaze_invoice' : action === 'step' ? 'kaze_step' : 'kaze_synced', notes, metadata: { event_type: eventType, webhook_event_id: eventId ?? null } }).then(() => {}, () => {})
          if (eventId) await sb3.from('kaze_webhook_events').update({ mission_id: m.id, processed_at: new Date().toISOString() }).eq('id', eventId).then(() => {}, () => {})
        }
      } else if (action === 'import') {
        result.import = await importKazeJob(kazeJobId, { webhookEventId: eventId })
        // Stocke le proposal_id sur la mission importée (best-effort).
        const importedId = (result.import as any)?.mission_id
        if (proposalId && importedId) {
          try {
            const sb2 = createAdminClient()
            await sb2.from('incoming_missions').update({ kaze_proposal_id: proposalId }).eq('id', importedId)
          } catch (e: any) {
            console.warn('[kaze-webhook] set kaze_proposal_id failed:', e?.message)
          }
        }
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
  console.log(`[kaze-webhook] event=${eventType ?? 'unknown'} job=${kazeJobId ?? 'none'} action=${action} ${Date.now() - t0}ms`)
  })()
  try { const { waitUntil } = await import('@vercel/functions'); waitUntil(work) } catch { await work }

  return NextResponse.json({ ok: true, ...result, background: true }, { status: 200 })
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
