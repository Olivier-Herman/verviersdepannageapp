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

import { uploadFile, performerUpdateTemplate, performerCompleteStep, getJobFull, assignPerformer } from './client'

// PNG 1x1 transparent (70 octets) — fallback quand aucune photo/signature dispo
const BLANK_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

function blankPngBuffer(): Buffer {
  return Buffer.from(BLANK_PNG_BASE64, 'base64')
}

/**
 * Detecte si un Buffer contient une image HEIC/HEIF (format iPhone).
 * Magic bytes : 4 octets "ftyp" en position 4, suivi du subtype (heic/heix/mif1/etc).
 */
function isHeic(buf: Buffer): boolean {
  if (buf.length < 12) return false
  const ftyp = buf.slice(4, 8).toString('ascii')
  if (ftyp !== 'ftyp') return false
  const subtype = buf.slice(8, 12).toString('ascii').toLowerCase()
  return ['heic', 'heix', 'mif1', 'heis', 'msf1', 'hevc', 'hevx'].includes(subtype)
}

/**
 * Telecharge une image depuis une URL (Supabase Storage), convertit en JPEG
 * si HEIC (iPhone), et upload vers Kaze direct_uploads → retourne signed_id.
 * Retourne null en cas d echec (le caller doit fallback sur PNG blanc).
 */
async function fetchConvertAndUpload(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.warn(`[kaze-close] fetch photo failed (${res.status}) : ${url.slice(0, 100)}`)
      return null
    }
    let buf: Buffer = Buffer.from(await res.arrayBuffer())
    let filename = 'photo.jpg'
    let mime     = 'image/jpeg'

    // Conversion HEIC → JPEG via Sharp (libheif inclus)
    if (isHeic(buf)) {
      try {
        const sharp = (await import('sharp')).default
        const converted = await sharp(buf).jpeg({ quality: 85 }).toBuffer()
        buf = Buffer.from(converted)
        console.log(`[kaze-close] HEIC converti en JPEG (${buf.length} bytes)`)
      } catch (e: any) {
        console.warn(`[kaze-close] HEIC conversion échouée : ${e.message}`)
        return null
      }
    } else {
      // Détecter PNG vs JPEG pour ajuster MIME
      if (buf[0] === 0x89 && buf[1] === 0x50) {
        mime = 'image/png'
        filename = 'photo.png'
      }
    }

    return await uploadFile(buf, filename, mime)
  } catch (e: any) {
    console.warn(`[kaze-close] fetchConvertAndUpload error : ${e.message}`)
    return null
  }
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
 * Options pour faire avancer un job Kaze. Les URLs photos/signature sont
 * optionnelles — si absentes, on fallback sur PNG blanc placeholder.
 */
export interface KazeAdvanceOptions {
  location?:     string
  driverPhotos?: string[]      // URLs Supabase Storage des photos chauffeur
  signatureUrl?: string | null // URL Supabase Storage de la signature client
}

/**
 * Fait avancer le workflow Kaze jusqu au step `targetStepIndex` inclus.
 * Si targetStepIndex >= 9, ferme completement la mission.
 * Best-effort : retourne ok=true meme si on n a pas tout fini, du moment qu on
 * a progresse.
 *
 * @param jobId UUID du job Kaze
 * @param targetStepIndex 0-9 (job_info à workshop_signature)
 * @param opts.driverPhotos URLs photos chauffeur (upload réel au lieu de PNG blanc)
 * @param opts.signatureUrl URL signature client (idem)
 */
export async function advanceKazeJob(
  jobId:            string,
  targetStepIndex:  number,
  opts:             KazeAdvanceOptions = {},
): Promise<CloseResult> {
  return runKazeWorkflow(jobId, targetStepIndex, opts)
}

/**
 * Wrapper compat : ferme completement un job Kaze (status=completed).
 * Equivalent a advanceKazeJob(jobId, 9).
 */
export async function closeKazeJob(
  jobId: string,
  opts:  KazeAdvanceOptions = {},
): Promise<CloseResult> {
  return runKazeWorkflow(jobId, 9, opts)
}

async function runKazeWorkflow(
  jobId:            string,
  targetStepIndex:  number,
  opts:             KazeAdvanceOptions = {},
): Promise<CloseResult> {
  const location = opts.location || '50.593186,5.873229'
  const stepsDone: string[] = []
  const maxIters = 12  // securite : pas plus que le nombre de steps + marge

  console.log(`[kaze-close] start jobId=${jobId} targetIdx=${targetStepIndex} photos=${opts.driverPhotos?.length ?? 0} sig=${opts.signatureUrl ? 'yes' : 'no'}`)

  // Reassigne la mission a notre user (VD Soft) AVANT d agir comme performer.
  // Kaze cree les missions assignees a un user IMA (Axel Higny par defaut)
  // et /performer/jobs/<id>/* ne fonctionne que pour le performer assigne.
  // Idempotent : si deja assigne, le PUT renvoie 204 sans effet.
  try {
    await assignPerformer(jobId)
    console.log(`[kaze-close] performer reassigned to VD Soft`)
  } catch (e: any) {
    console.error(`[kaze-close] reassign failed:`, e.message)
    return { ok: false, status: null, steps_done: [], error: `Reassign échoué : ${e.message}` }
  }

  // Upload PNG blanc (fallback unique pour tous les widgets sans vraie photo/sig).
  let blankSignedId: string
  try {
    blankSignedId = await uploadFile(blankPngBuffer(), 'placeholder.png', 'image/png')
    console.log(`[kaze-close] PNG blanc uploadé (fallback)`)
  } catch (e: any) {
    console.error(`[kaze-close] upload PNG failed:`, e.message)
    return { ok: false, status: null, steps_done: [], error: `Upload blank PNG échoué : ${e.message}` }
  }

  // Upload des VRAIES photos chauffeur en parallèle (1 seul appel HTTP par photo).
  // Si une photo fail (HEIC moisi, URL morte, etc), on garde just les autres.
  const realPhotoSignedIds: string[] = []
  if (opts.driverPhotos?.length) {
    const results = await Promise.allSettled(
      opts.driverPhotos.map(url => fetchConvertAndUpload(url)),
    )
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) realPhotoSignedIds.push(r.value)
    }
    console.log(`[kaze-close] ${realPhotoSignedIds.length}/${opts.driverPhotos.length} photos chauffeur uploadées sur Kaze`)
  }

  // Upload signature client si disponible (Kaze accepte PNG/JPEG dans signature)
  let realSignatureSignedId: string | null = null
  if (opts.signatureUrl) {
    realSignatureSignedId = await fetchConvertAndUpload(opts.signatureUrl)
    if (realSignatureSignedId) console.log(`[kaze-close] signature client uploadée sur Kaze`)
    else                       console.warn(`[kaze-close] signature upload échouée, fallback PNG blanc`)
  }

  for (let iter = 0; iter < maxIters; iter++) {
    let job: any
    try {
      job = await getJobFull(jobId)
    } catch (e: any) {
      console.error(`[kaze-close] iter ${iter}: getJob failed:`, e.message)
      return { ok: false, status: null, steps_done: stepsDone, error: `getJob échoué : ${e.message}` }
    }

    // Liste des steps : prioriser job.steps (parfois absent dans ?with_versions=1),
    // sinon fallback sur workflow.children qui contient les memes IDs dans l ordre.
    let steps = job.steps as Array<{ id: string }> | undefined
    if (!steps || steps.length === 0) {
      steps = (job.workflow?.children || []).map((c: any) => ({ id: c.id }))
    }
    const curStep = job.current_step_id as string | null
    const curIdx  = steps && curStep ? steps.findIndex((s: { id: string }) => s.id === curStep) : -1

    console.log(`[kaze-close] iter ${iter}: status=${job.status} step=${curStep} (idx ${curIdx}/${targetStepIndex}) stepsDone=${stepsDone.length}`)

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

    // Protection supplementaire : si on a deja complete plus de steps que la cible,
    // on stop (au cas ou curIdx aurait un comportement etrange genre -1)
    if (stepsDone.length > targetStepIndex) {
      console.log(`[kaze-close] stepsDone.length ${stepsDone.length} > target ${targetStepIndex}, stop`)
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
      await fillAndCompleteStep(jobId, stepNode, {
        blankSignedId,
        realPhotoSignedIds,
        realSignatureSignedId,
      }, location)
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

interface StepSignedIds {
  blankSignedId:           string                      // fallback PNG blanc
  realPhotoSignedIds:      string[]                    // photos chauffeur (peut etre vide)
  realSignatureSignedId:   string | null               // signature client (peut etre null)
}

/** Remplit les widgets requis d un step + le marque comme completed. */
async function fillAndCompleteStep(
  jobId:    string,
  stepNode: any,
  ids:      StepSignedIds,
  location: string,
): Promise<void> {
  const stepId   = stepNode.id
  const stepType = stepNode.type

  // Helper : prend la prochaine vraie photo dispo, sinon fallback PNG blanc.
  // On rotate sur l array pour avoir des photos variees sur les differents
  // widgets (au lieu de mettre la meme partout).
  let photoIdx = 0
  const nextPhotoSignedId = (): string => {
    if (ids.realPhotoSignedIds.length > 0) {
      const sig = ids.realPhotoSignedIds[photoIdx % ids.realPhotoSignedIds.length]
      photoIdx++
      return sig
    }
    return ids.blankSignedId
  }

  // 1) Remplir les widgets selon le type de template
  let widgetsData: Record<string, any> = {}

  if (stepType === 'template_photo') {
    // Tous les widget_photo de ce step doivent avoir un signed_id.
    // On utilise les vraies photos chauffeur en rotation, fallback PNG blanc.
    for (const w of stepNode.photos || []) {
      if (w.type === 'widget_photo') {
        widgetsData[w.id] = { data: [{ signed_id: nextPhotoSignedId() }] }
      }
    }
  } else if (stepType === 'template_signature') {
    // Signature : utilise la vraie signature client si dispo, sinon PNG blanc.
    const sigId = ids.realSignatureSignedId || ids.blankSignedId
    widgetsData[stepId] = { signature: [{ signed_id: sigId }] }
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
