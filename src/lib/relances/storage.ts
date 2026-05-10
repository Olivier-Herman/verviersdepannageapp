// Module Relance — Helper Storage Supabase.
// Upload PDF/XLSX dans le bucket prive 'reminders' + retourne signed URL
// (TTL 1 an, cohérent avec les autres modules privé : advances, documents).

import { createAdminClient } from '@/lib/supabase'

const BUCKET = 'reminders'
const SIGNED_URL_TTL_S = 365 * 24 * 60 * 60   // 1 an

interface UploadResult {
  path:      string  // chemin dans le bucket (pour ré-générer une signedUrl plus tard)
  signedUrl: string  // URL valide TTL_S secondes
}

export async function uploadReminderFile(opts: {
  partnerId: number
  level:     1 | 2 | 3
  ext:       'pdf' | 'xlsx'
  buffer:    Buffer
  prefix?:   string   // 'mock' pour les previews CHECKPOINT 2 (pas de tracking)
}): Promise<UploadResult> {
  const supabase = createAdminClient()
  const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')
  const prefix  = opts.prefix ? `${opts.prefix}/` : ''
  const path    = `${prefix}${opts.partnerId}/L${opts.level}-${dateStr}.${opts.ext}`

  const contentType = opts.ext === 'pdf'
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, opts.buffer, { contentType, upsert: true })
  if (upErr) throw new Error(`Upload reminders/${path} : ${upErr.message}`)

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_S)
  if (signErr || !signed) throw new Error(`Signed URL ${path} : ${signErr?.message || 'unknown'}`)

  return { path, signedUrl: signed.signedUrl }
}
