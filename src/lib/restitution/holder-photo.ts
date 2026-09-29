// src/lib/restitution/holder-photo.ts — photo du titulaire de la pièce d'identité,
// rangée dans la fiche (Olivier 29/09/2026 : « ajouter la photo de la personne et
// qu'elle s'ajoute dans notre fiche »).
//   - carte eID lue au comptoir : la photo vient de la puce (fichier JPEG) ;
//   - pièce photographiée : Claude repère le portrait sur le recto, on le découpe.
import sharp from 'sharp'
import { extractJsonFromImages } from '@/lib/ocr/vision-json'

const PORTRAIT_PROMPT = `Tu reçois la photo d'une pièce d'identité (carte ou passeport). Repère la PHOTO DU TITULAIRE (le portrait imprimé), pas l'hologramme ni la petite photo fantôme.
Retourne UNIQUEMENT un JSON strict : { "found": <boolean>, "x": <0-1>, "y": <0-1>, "w": <0-1>, "h": <0-1> }
x, y = coin supérieur gauche du portrait, w, h = largeur et hauteur, en fraction de la largeur et de la hauteur de l'image.`

/** Découpe le portrait sur le recto ; null si introuvable. */
export async function cropPortrait(buf: Buffer, mime: string): Promise<Buffer | null> {
  const img = sharp(buf).rotate()
  const oriented = await img.toBuffer()
  const meta = await sharp(oriented).metadata()
  if (!meta.width || !meta.height) return null
  const r = await extractJsonFromImages([{ base64: oriented.toString('base64'), mimeType: mime }], PORTRAIT_PROMPT, 'Où est le portrait du titulaire ? JSON uniquement.', 200)
  if (!r.ok || !r.data?.found) return null
  const { x, y, w, h } = r.data
  if (![x, y, w, h].every((n: any) => typeof n === 'number' && n >= 0 && n <= 1) || w < 0.05 || h < 0.05) return null
  // Marge de 8 % autour du cadre donné (les cadres sont approximatifs).
  const pad = 0.08
  const left = Math.max(0, Math.floor((x - w * pad) * meta.width))
  const top = Math.max(0, Math.floor((y - h * pad) * meta.height))
  const width = Math.min(meta.width - left, Math.ceil(w * (1 + 2 * pad) * meta.width))
  const height = Math.min(meta.height - top, Math.ceil(h * (1 + 2 * pad) * meta.height))
  if (width < 40 || height < 40) return null
  return sharp(oriented).extract({ left, top, width, height }).resize({ width: 400, height: 520, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()
}

/** Range la photo du titulaire dans la fiche (documents « Photo du titulaire »). */
export async function saveHolderPhoto(sb: any, missionId: string, buf: Buffer, actorId: string | null, origin: 'eid' | 'photo'): Promise<string | null> {
  const path = `${missionId}/id_photo/${Date.now()}_${origin}.jpg`
  const up = await sb.storage.from('mission-documents').upload(path, buf, { contentType: 'image/jpeg', upsert: false })
  if (up.error) return null
  const { data } = await sb.from('mission_documents').insert({ mission_id: missionId, kind: 'id_photo', file_path: path, file_name: origin === 'eid' ? 'photo-titulaire-eid.jpg' : 'photo-titulaire.jpg', mime_type: 'image/jpeg', file_size: buf.length, uploaded_by: actorId }).select('id').single()
  return data?.id || null
}
