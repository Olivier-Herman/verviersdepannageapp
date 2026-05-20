// src/lib/kaze/close-job.ts
//
// Cloture complete d un job Kaze (assigned → completed) en remplissant
// chaque step du workflow IMA Benelux.
//
// Decouvert le 2026-05-20 :
//   Le pattern Kaze :
//   1. PUT widgets requis du current_step (skip_version_check + location)
//   2. PUT step.completed = true (current_step avance)
//   3. Repeter pour chaque step jusqu a status="completed"
//
//   Steps IMA (workflow 7e63b240-e277-42bd-bbf9-7ba89447baee) :
//   job_info → navigation_to → unnecessaryintervention → photo_arrival
//   → cri → signature_beneficiaire → notation → delivery_step → photos_end
//   → workshop_signature → COMPLETED
//
// Strategie photos/signatures :
//   - Photos : on upload 1x un PNG blanc 1x1, on l attache a TOUS les widget_photo
//     du step (Kaze accepte la meme image pour plusieurs slots).
//   - Signatures : meme principe (PNG blanc) pour signature_beneficiaire et
//     workshop_signature. Les chauffeurs Verviers font rarement signer sauf
//     en cas de probleme via discharge_sig (mais c est un autre flow).
//
// V2 future : reutiliser les vraies photos/signatures du chauffeur depuis
//   driver_photos / discharge_sig pour audit qualite.

import { uploadFile, performerUpdateTemplate, performerCompleteStep, getJobFull } from './client'

// PNG 1x1 transparent (70 octets)
const BLANK_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

function blankPngBuffer(): Buffer {
  return Buffer.from(BLANK_PNG_BASE64, 'base64')
}

interface CloseResult {
  ok:         boolean
  status:     string | null
  steps_done: string[]
  error?:     string
}

/**
 * Map une action chauffeur VD Soft au step Kaze cible (inclus) qu il faut
 * atteindre. L index correspond a la position dans job.steps[] (workflow IMA).
 *
 *   0: job_info                  status=assigned → started apres
 *   1: navigation_to             → status devient 'started'
 *   2: unnecessaryintervention
 *   3: photo_arrival
 *   4: cri
 *   5: signature beneficiaire    (UUID variable)
 *   6: notation                  (UUID variable)
 *   7: delivery_step
 *   8: photos_end
 *   9: workshop_signature        → status devient 'completed'
 */
export function actionToTargetStepIndex(action: string): number {
  const map: Record<string, number> = {
    on_way:            1,   // navigation_to complete → status=started
    on_site:           3,   // photo_arrival complete
    load_vehicle:      4,   // cri complete
    start_delivery:    4,
    arrive_stop:       4,
    depart_stop:       4,
    park:              9,   // termine tout (REM finie en depot)
    complete_delivery: 9,   // termine tout (REL livree)
    completed:         9,   // termine tout
  }
  return map[action] ?? -1
}

/**
 * Fait avancer le workflow Kaze jusqu au step `targetStepIndex` inclus.
 * Si targetStepIndex >= 9, ferme completement la mission.
 * Best-effort : retourne ok=true meme si on n a pas tout fini, du moment qu on
 * a progresse.
 *
 * @param jobId UUID du job Kaze
 * @param targetStepIndex 0-9 selon KNOWN_STEP_ORDER
 */
export async function advanceKazeJob(
  jobId:            string,
  targetStepIndex:  number,
  opts:             { location?: string } = {},
): Promise<CloseResult> {
  return runKazeWorkflow(jobId, targetStepIndex, opts)
}

/**
 * Wrapper compat : ferme completement un job Kaze (status=completed).
 * Equivalent a advanceKazeJob(jobId, 9).
 */
export async function closeKazeJob(
  jobId: string,
  opts:  { location?: string } = {},
): Promise<CloseResult> {
  return runKazeWorkflow(jobId, 9, opts)
}

async function runKazeWorkflow(
  jobId:            string,
  targetStepIndex:  number,
  opts:             { location?: string } = {},
): Promise<CloseResult> {
  const location = opts.location || '50.593186,5.873229'
  const stepsDone: string[] = []
  const maxIters = 12  // securite : pas plus que le nombre de steps + marge

  console.log(`[kaze-close] start jobId=${jobId}`)

  // Upload 1 seul PNG blanc qu on reutilise pour toutes les photos/signatures
  let blankSignedId: string
  try {
    blankSignedId = await uploadFile(blankPngBuffer(), 'placeholder.png', 'image/png')
    console.log(`[kaze-close] PNG uploaded (signed_id : ${blankSignedId.slice(0, 40)}...)`)
  } catch (e: any) {
    console.error(`[kaze-close] upload PNG failed:`, e.message)
    return { ok: false, status: null, steps_done: [], error: `Upload blank PNG échoué : ${e.message}` }
  }

  for (let iter = 0; iter < maxIters; iter++) {
    let job: any
    try {
      job = await getJobFull(jobId)
    } catch (e: any) {
      console.error(`[kaze-close] iter ${iter}: getJob failed:`, e.message)
      return { ok: false, status: null, steps_done: stepsDone, error: `getJob échoué : ${e.message}` }
    }

    const steps   = job.steps as Array<{ id: string; label?: string }> | undefined
    const curStep = job.current_step_id as string | null
    const curIdx  = steps && curStep ? steps.findIndex(s => s.id === curStep) : -1

    console.log(`[kaze-close] iter ${iter}: status=${job.status} step=${curStep} (idx ${curIdx}/${targetStepIndex})`)

    if (job.status === 'completed') {
      return { ok: true, status: 'completed', steps_done: stepsDone }
    }
    if (job.status === 'cancelled' || job.status === 'rejected') {
      return { ok: false, status: job.status, steps_done: stepsDone, error: `Mission ${job.status} cote Kaze` }
    }

    // On est arrive ou au-dela du step cible — on s arrete
    if (curIdx > targetStepIndex) {
      console.log(`[kaze-close] target step ${targetStepIndex} atteint (current ${curIdx}), stop`)
      return { ok: true, status: job.status, steps_done: stepsDone }
    }

    const currentStep = job.current_step_id
    if (!currentStep) {
      return { ok: false, status: job.status, steps_done: stepsDone, error: 'Pas de current_step (workflow figé ?)' }
    }

    const stepNode = findStep(job.workflow, currentStep)
    if (!stepNode) {
      return { ok: false, status: job.status, steps_done: stepsDone, error: `Step ${currentStep} introuvable dans workflow` }
    }

    try {
      await fillAndCompleteStep(jobId, stepNode, blankSignedId, location)
      stepsDone.push(currentStep)
      console.log(`[kaze-close] step ${currentStep} (${stepNode.type}) — done`)
    } catch (e: any) {
      console.error(`[kaze-close] step ${currentStep} failed:`, e.message)
      return { ok: false, status: job.status, steps_done: stepsDone, error: `Step ${currentStep} échoué : ${e.message}` }
    }

    // Petite pause pour eviter rate limit (max 2 fail/180s)
    await new Promise(r => setTimeout(r, 200))
  }

  return { ok: false, status: null, steps_done: stepsDone, error: 'Max iterations atteintes sans completion' }
}

/** Cherche un step par id dans l arbre workflow. */
function findStep(node: any, targetId: string): any {
  if (!node || typeof node !== 'object') return null
  if (node.id === targetId) return node
  for (const c of node.children || []) {
    const r = findStep(c, targetId)
    if (r) return r
  }
  return null
}

/** Remplit les widgets requis d un step + le marque comme completed. */
async function fillAndCompleteStep(
  jobId:    string,
  stepNode: any,
  signedId: string,  // signed_id du PNG blanc reutilise
  location: string,
): Promise<void> {
  const stepId   = stepNode.id
  const stepType = stepNode.type

  // 1) Remplir les widgets selon le type de template
  let widgetsData: Record<string, any> = {}

  if (stepType === 'template_photo') {
    // Tous les widget_photo de ce step doivent avoir un signed_id
    for (const w of stepNode.photos || []) {
      if (w.type === 'widget_photo') {
        widgetsData[w.id] = { data: [{ signed_id: signedId }] }
      }
    }
  } else if (stepType === 'template_signature') {
    // Signature directement sur le step
    widgetsData[stepId] = { signature: [{ signed_id: signedId }] }
  } else if (stepType === 'template_blank') {
    // Pour blank : detecter si y a des widget_select requis (ex motives_unnecessaryintervention)
    walkChildren(stepNode, (w) => {
      if (w.type === 'widget_select' && !widgetsData[w.id]) {
        const opts = w.options_list || []
        if (opts.length > 0) {
          // Heuristique : prendre la 1ere option qui ressemble a "OK / possible / oui"
          // Sinon fallback : 1ere option
          const positive = opts.find((o: string) =>
            /peux intervenir|possible|oui|ok|garage ima/i.test(o)
          ) || opts[0]
          widgetsData[w.id] = { data: { value: [positive] } }
        }
      }
    })
  }
  // template_job_info, template_navigation : pas de widgets a remplir, juste completed

  // PUT widgets s il y en a
  if (Object.keys(widgetsData).length > 0) {
    await performerUpdateTemplate(jobId, stepId, widgetsData, location)
  }

  // 2) Marquer le step comme completed (sauf si deja avance par le PUT precedent)
  // On tente toujours — si le step est deja completed Kaze renverra 422
  // que l on attrape silencieusement.
  try {
    await performerCompleteStep(jobId, stepId, location)
  } catch (e: any) {
    if (!/forbidden|cannot be modified|deja|already/i.test(e.message)) {
      throw e
    }
    // Sinon : step deja completed, c est OK (PUT widgets a fait avancer)
  }
}

/** Walks the children tree, calling cb on each node. */
function walkChildren(node: any, cb: (n: any) => void) {
  for (const c of node.children || []) {
    cb(c)
    walkChildren(c, cb)
  }
}
