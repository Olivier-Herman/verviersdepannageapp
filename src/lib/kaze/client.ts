// src/lib/kaze/client.ts
//
// Client API Kaze (https://app.kaze.so/api) pour l integration avec
// IMA Benelux (Ethias, Vivium, P&V Assistance, etc.).
//
// Auth : header `Authorization: <api_token>` (clé statique generee dans
// l espace Kaze : Parametres > Paramétrage > Api Config).
//
// Doc : https://documenter.getpostman.com/view/15303175/U16nLQ7r
// Reflet en memoire : project_kaze_integration.md

const KAZE_BASE_URL = 'https://app.kaze.so/api'

function getApiKey(): string {
  const key = process.env.KAZE_API_KEY
  if (!key) throw new Error('KAZE_API_KEY not configured')
  return key
}

export class KazeApiError extends Error {
  status: number
  body: any
  constructor(status: number, body: any, msg: string) {
    super(msg)
    this.name = 'KazeApiError'
    this.status = status
    this.body  = body
  }
}

async function kazeFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${KAZE_BASE_URL}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      'Authorization':  getApiKey(),
      'X-Date-Format':  'iso',
      'Content-Type':   'application/json',
      'Accept':         'application/json',
      ...(init.headers || {}),
    },
    // Kaze peut etre lent ; on laisse le timeout par defaut de Node.
    cache: 'no-store',
  })

  const text = await res.text()
  let body: any = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = text }
  }

  if (!res.ok) {
    throw new KazeApiError(
      res.status,
      body,
      `Kaze API ${res.status} on ${init.method || 'GET'} ${path}: ${
        body?.message || body?.error || text || res.statusText
      }`,
    )
  }

  return body as T
}

// ── Types (partiels, completer au fil de la decouverte du schema IMA) ────────

export interface KazeListMeta {
  page:            number
  per_page:        number
  total_pages:     number
  total_count:     number
  filter?:         Record<string, any>
  order_field?:    string
  order_direction?:'asc' | 'desc'
}

export interface KazeListResponse<T> {
  meta: KazeListMeta
  data: T[]
}

export interface KazeJob {
  id:                  string
  title?:              string | null
  reference?:          string | null
  owner_id?:           string | null
  target_id?:          string | null
  performer_user_id?:  string | null
  status?:             string | null
  status_name?:        string | null
  current_step_id?:    string | null
  owner_name?:         string | null
  target_name?:        string | null
  performer_user?:     any
  due_date?:           string | number | null
  bwa_link?:           string | null
  created_at?:         string | number | null
  updated_at?:         string | number | null
  work_order_address?: { address?: string; location?: string } | null
  workflow?:           any   // arbre nesté de widgets — parser dans un mapper dedie
  [key: string]: any
}

export type KazeJobStatus =
  | 'initial'   | 'draft'    | 'request'  | 'waiting'   | 'proposed'
  | 'accepted'  | 'assigned' | 'started'  | 'in_progress'
  | 'completed' | 'rejected' | 'cancelled'

// ── Methodes principales ────────────────────────────────────────────────────

export function getJob(id: string): Promise<KazeJob> {
  const qs = new URLSearchParams({ with_versions: '1', access_next: '1' })
  return kazeFetch<KazeJob>(`/jobs/${id}.json?${qs}`)
}

export interface ListJobsOptions {
  updatedAfter?:   string         // ISO date
  statuses?:       KazeJobStatus[]
  ownerId?:        string
  page?:           number
  perPage?:        number
  orderField?:     'updated_at' | 'created_at' | 'due_date'
  orderDirection?: 'asc' | 'desc'
}

export function listJobs(opts: ListJobsOptions = {}): Promise<KazeListResponse<KazeJob>> {
  const qs = new URLSearchParams()
  if (opts.updatedAfter)   qs.set('filter[updated_after]', opts.updatedAfter)
  if (opts.ownerId)        qs.set('filter[owner_id]', opts.ownerId)
  if (opts.page)           qs.set('page', String(opts.page))
  if (opts.perPage)        qs.set('per_page', String(opts.perPage))
  if (opts.orderField)     qs.set('order_field', opts.orderField)
  if (opts.orderDirection) qs.set('order_direction', opts.orderDirection)
  if (opts.statuses?.length) {
    for (const s of opts.statuses) qs.append('filter[status][]', s)
  }
  return kazeFetch<KazeListResponse<KazeJob>>(`/jobs.json?${qs}`)
}

export function getProfile(): Promise<any> {
  return kazeFetch('/profile.json')
}

let _myUserIdCache: string | null = null

/** Renvoie l user_id de la clé API (cache process-level). */
export async function getMyKazeUserId(): Promise<string> {
  if (_myUserIdCache) return _myUserIdCache
  const p = await getProfile()
  const id = p?.user?.id
  if (!id) throw new Error('Impossible de récupérer mon user_id Kaze depuis /profile')
  _myUserIdCache = id
  return id
}

/**
 * Reassigne la mission Kaze a un performer (par defaut : moi-meme).
 * Necessaire avant les PUTs /performer/jobs/... car ces endpoints ne
 * fonctionnent que si le user de la cle API est le performer assigne.
 *
 * Idempotent : si deja assigne, retourne juste 204.
 */
export async function assignPerformer(jobId: string, userId?: string): Promise<void> {
  const uid = userId || await getMyKazeUserId()
  await kazeFetch(`/jobs/${jobId}/performers/${uid}.json`, { method: 'PUT' })
}

export function listStatuses(): Promise<KazeListResponse<{ status: string; name: string }>> {
  return kazeFetch('/jobs/statuses.json')
}

// ── Actions retour (us → Kaze) ──────────────────────────────────────────────
// Ces helpers seront utilises quand notre chauffeur fait avancer la mission
// cote VD Soft, pour repercuter le statut cote Kaze.

export function acceptProposal(jobId: string): Promise<any> {
  return kazeFetch(`/jobs/${jobId}/accept_proposals.json`, { method: 'PUT' })
}

export function rejectProposal(jobId: string): Promise<any> {
  return kazeFetch(`/jobs/${jobId}/accept_proposals.json`, { method: 'DELETE' })
}

export function updateCell(jobId: string, cellId: string, payload: any): Promise<any> {
  return kazeFetch(`/jobs/${jobId}/cells/${cellId}.json`, {
    method: 'PUT',
    body:   JSON.stringify(payload),
  })
}

export function addNote(jobId: string, text: string): Promise<any> {
  // Format Kaze : { "note": "texte" } - string direct, pas un objet imbrique
  return kazeFetch(`/jobs/${jobId}/notes.json`, {
    method: 'POST',
    body:   JSON.stringify({ note: text }),
  })
}

export function getCancelReasons(jobId: string): Promise<any> {
  return kazeFetch(`/jobs/${jobId}/cancel_reasons.json`)
}

export function cancelJob(jobId: string, reasonId?: string, comment?: string): Promise<any> {
  return kazeFetch(`/jobs/${jobId}/cancel.json`, {
    method: 'PUT',
    body:   JSON.stringify({ cancel_reason_id: reasonId, comment }),
  })
}

// ── Workflow performer (clôture mission) ────────────────────────────────────
// Pattern decouvert le 2026-05-20 : on complete les steps un par un en tant
// que "performer" via /api/performer/jobs/<id>/templates/<step>.json.
// Chaque step requis necessite ses widgets remplis (photos via signed_id,
// signatures, selects), puis un 2e PUT avec { completed: true }.

export interface BlobMeta {
  filename:     string
  byte_size:    number
  checksum:     string   // base64-encoded MD5
  content_type: string   // image/png, image/jpeg, etc.
}

export interface DirectUploadResponse {
  signed_id:     string
  direct_upload: {
    url:     string
    headers: Record<string, string>
  }
}

/** Etape 1 : reserve un blob cote Kaze, renvoie signed_id + URL d upload S3. */
export function createDirectUpload(blob: BlobMeta): Promise<DirectUploadResponse> {
  return kazeFetch<DirectUploadResponse>('/direct_uploads', {
    method: 'POST',
    body:   JSON.stringify({ blob }),
  })
}

/** Etape 2 : upload le binaire sur l URL signee S3 (pas via kazeFetch). */
export async function uploadBlobBinary(
  url:     string,
  headers: Record<string, string>,
  data:    Uint8Array | Buffer | ArrayBuffer,
): Promise<void> {
  const res = await fetch(url, { method: 'PUT', headers, body: data as any })
  if (!res.ok) {
    throw new Error(`S3 upload échoué : HTTP ${res.status} ${await res.text().catch(() => '')}`)
  }
}

/** Helper combine : upload complet d un fichier (blob + binaire) → signed_id. */
export async function uploadFile(
  data:        Uint8Array | Buffer,
  filename:    string,
  contentType: string,
): Promise<string> {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const checksum = require('crypto').createHash('md5').update(buf).digest('base64')
  const meta = {
    filename,
    byte_size:    buf.length,
    checksum,
    content_type: contentType,
  }
  const ur = await createDirectUpload(meta)
  await uploadBlobBinary(ur.direct_upload.url, ur.direct_upload.headers, buf)
  return ur.signed_id
}

/** PUT performer/jobs/<id>/templates/<step>.json (remplit widgets ou complete). */
export function performerUpdateTemplate(
  jobId:    string,
  stepId:   string,
  data:     Record<string, any>,
  location: string = '50.593186,5.873229',  // Verviers depot par defaut
): Promise<any> {
  return kazeFetch(`/performer/jobs/${jobId}/templates/${stepId}.json`, {
    method: 'PUT',
    body:   JSON.stringify({
      data,
      skip_version_check: true,
      location,
    }),
  })
}

/** Mark a step as completed (separate PUT after widgets are filled). */
export function performerCompleteStep(
  jobId:    string,
  stepId:   string,
  location: string = '50.593186,5.873229',
): Promise<any> {
  return performerUpdateTemplate(jobId, stepId, {
    [stepId]: { completed: true },
  }, location)
}

/** Recupere le job en vue performer + le workflow tree complet. */
export function getJobFull(jobId: string): Promise<any> {
  return kazeFetch(`/jobs/${jobId}.json?with_versions=1&access_next=1`)
}
