// Module Relance — Helper Storage Supabase.
// Upload PDF/XLSX dans le bucket prive 'reminders' + retourne signed URL.
// TTL configurable : 1 an par defaut (relances reelles, pour traçabilité
// long terme), 24h pour les previews mock CHECKPOINT 2.

import { createAdminClient } from '@/lib/supabase'

const BUCKET = 'reminders'
const TTL_1Y = 365 * 24 * 60 * 60
const TTL_24H = 24 * 60 * 60

interface UploadResult {
  path:      string  // chemin dans le bucket (pour ré-générer une signedUrl plus tard)
  signedUrl: string  // URL valide TTL secondes
}

export async function uploadReminderFile(opts: {
  partnerId: number
  level:     1 | 2 | 3
  ext:       'pdf' | 'xlsx'
  buffer:    Buffer
  prefix?:   string         // 'mock' pour les previews CHECKPOINT 2 (pas de tracking)
  fileName?: string         // override du nom de fichier final (sinon genere)
  ttlSec?:   number         // override du TTL signed URL (default 1 an)
}): Promise<UploadResult> {
  const supabase = createAdminClient()
  const ttl    = opts.ttlSec || TTL_1Y
  const prefix = opts.prefix ? `${opts.prefix}/` : ''

  let path: string
  if (opts.fileName) {
    // Override explicite : path = "<prefix><fileName>" (path direct, partnerId ignore)
    path = `${prefix}${opts.fileName}`
  } else {
    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')
    path = `${prefix}${opts.partnerId}/L${opts.level}-${dateStr}.${opts.ext}`
  }

  const contentType = opts.ext === 'pdf'
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, opts.buffer, { contentType, upsert: true })
  if (upErr) throw new Error(`Upload reminders/${path} : ${upErr.message}`)

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, ttl)
  if (signErr || !signed) throw new Error(`Signed URL ${path} : ${signErr?.message || 'unknown'}`)

  return { path, signedUrl: signed.signedUrl }
}

export const SIGNED_URL_TTL_24H = TTL_24H
export const SIGNED_URL_TTL_1Y  = TTL_1Y
