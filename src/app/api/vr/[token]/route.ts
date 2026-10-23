// src/app/api/vr/[token]/route.ts — PUBLIC : page du client pour le contrat VR VAB (Olivier 23/10/2026).
// Le jeton (uuid, 2 h, réservé à une mission) vaut autorisation ; il se ferme à la signature.
//
// GET  → { status, lang, plaque, client, photos{clé:bool}, ocr_ok }
// POST multipart { photo: <clé>, file }        → stocke la photo ; au verso, lit le document et pré-remplit
// POST JSON { step: 'infos', lang, client }    → enregistre les informations vérifiées
// POST JSON { step: 'signature', data: <png> } → signe et ferme le lien
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase'
import { extractJsonFromImages, ID_DOCUMENT_PROMPT } from '@/lib/ocr/vision-json'
import { VR_BUCKET, VR_PHOTOS, PERMIS_PROMPT, preRemplir, clientRempli, finaliserSiComplet, ADRESSE_VIDE, type VrPhoto } from '@/lib/vab/vr-contrat'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const json = (b: any, status = 200) => NextResponse.json(b, { status })

async function charger(sb: any, token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const { data } = await sb.from('vr_contrats').select('*').eq('id', token).maybeSingle()
  return data || null
}
const ouvert = (c: any) => !c.signed_at && new Date(c.expires_at).getTime() >= Date.now()

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  const c = await charger(sb, params.token)
  if (!c) return json({ error: 'Lien invalide' }, 404)
  const { data: m } = await sb.from('incoming_missions').select('vab_vr').eq('id', c.mission_id).maybeSingle()
  const photos: Record<string, boolean> = {}
  for (const k of VR_PHOTOS) photos[k] = !!c.photos?.[k]
  return json({
    status: c.signed_at ? 'signe' : ouvert(c) ? 'ouvert' : 'expire',
    lang: c.lang, plaque: m?.vab_vr?.plate || null,
    client: preRemplir(c.client || {}, c.ocr), photos,
    lu: { id: !!c.ocr?.id, permis: !!c.ocr?.permis },
  })
}

async function petit(buf: Buffer) {
  try { return (await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()).toString('base64') }
  catch { return buf.toString('base64') }
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  const c = await charger(sb, params.token)
  if (!c) return json({ error: 'Lien invalide' }, 404)
  if (!ouvert(c)) return json({ error: 'expire' }, 410)
  const now = new Date().toISOString()

  if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    const cle = String(form?.get('photo') || '') as VrPhoto
    const f = form?.get('file') as File | null
    if (!VR_PHOTOS.includes(cle) || !f || typeof f !== 'object' || !f.size) return json({ error: 'Photo manquante' }, 400)
    if (f.size > 15 * 1024 * 1024) return json({ error: 'Photo trop lourde' }, 413)
    const buf = Buffer.from(await f.arrayBuffer())
    const path = `${c.mission_id}/vr/${c.id}_${cle}_${Date.now()}.jpg`
    const jpg = await sharp(buf).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer().catch(() => buf)
    const { error: upErr } = await sb.storage.from(VR_BUCKET).upload(path, jpg, { contentType: 'image/jpeg', upsert: false })
    if (upErr) return json({ error: 'Envoi de la photo impossible, réessayez' }, 500)
    const photos = { ...(c.photos || {}), [cle]: path }
    await sb.from('mission_documents').insert({
      mission_id: c.mission_id, kind: cle.startsWith('id_') ? 'id_card' : 'driving_licence', file_path: path,
      file_name: `vr_${cle}.jpg`, mime_type: 'image/jpeg', file_size: jpg.length, uploaded_by: c.created_by || null,
    }).then(() => {}, () => {})
    await sb.from('vr_contrats').update({ photos, updated_at: now }).eq('id', c.id)

    // Les deux faces d'un document sont là → lecture (sinon le client remplit lui-même, rien ne bloque).
    const doc = cle.startsWith('id_') ? 'id' : 'permis'
    const faces = doc === 'id' ? ['id_recto', 'id_verso'] : ['permis_recto', 'permis_verso']
    let lu = false
    if (faces.every(k => photos[k])) {
      try {
        const images: { base64: string; mimeType: string }[] = []
        for (const k of faces) {
          const { data: blob } = await sb.storage.from(VR_BUCKET).download(photos[k])
          if (blob) images.push({ base64: await petit(Buffer.from(await blob.arrayBuffer())), mimeType: 'image/jpeg' })
        }
        const r = doc === 'id'
          ? await extractJsonFromImages(images, ID_DOCUMENT_PROMPT, 'Recto puis verso de la même carte d’identité. Retourne uniquement le JSON.')
          : await extractJsonFromImages(images, PERMIS_PROMPT, 'Recto puis verso du même permis de conduire. Retourne uniquement le JSON.')
        if (r.ok && r.data?.confidence !== 'low') {
          const { data: fresh } = await sb.from('vr_contrats').select('ocr').eq('id', c.id).single()
          await sb.from('vr_contrats').update({ ocr: { ...(fresh?.ocr || {}), [doc]: r.data }, updated_at: new Date().toISOString() }).eq('id', c.id)
          lu = true
        }
      } catch { /* lecture impossible : le client complète à la main */ }
    }
    return json({ ok: true, lu })
  }

  const b = await req.json().catch(() => ({})) as any
  if (b.step === 'infos') {
    const s = (v: any, max = 120) => String(v ?? '').trim().slice(0, max)
    const x = b.client || {}, ad = x.adresse || {}
    const client = {
      nom: s(x.nom), prenom: s(x.prenom), naissance: s(x.naissance, 10), carte_id: s(x.carte_id, 40), permis: s(x.permis, 40),
      email: s(x.email).toLowerCase(), tel: s(x.tel, 30), langue: ['fr', 'nl', 'en', 'de'].includes(b.lang) ? b.lang : 'fr',
      adresse: { ...ADRESSE_VIDE, pays: s(ad.pays, 2).toUpperCase() || 'BE', cp: s(ad.cp, 10), ville: s(ad.ville, 80), rue: s(ad.rue, 120), numero: s(ad.numero, 10), boite: s(ad.boite, 10) },
    }
    if (!clientRempli(client)) return json({ error: 'incomplet' }, 400)
    if (client.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email)) return json({ error: 'email' }, 400)
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(client.naissance)) return json({ error: 'naissance' }, 400)
    await sb.from('vr_contrats').update({ client, lang: client.langue, status: 'client_ok', updated_at: now }).eq('id', c.id)
    return json({ ok: true })
  }
  if (b.step === 'signature') {
    if (!clientRempli(c.client)) return json({ error: 'incomplet' }, 400)
    const m = String(b.data || '').match(/^data:image\/png;base64,(.+)$/)
    if (!m) return json({ error: 'Signature manquante' }, 400)
    const buf = Buffer.from(m[1], 'base64')
    const path = `${c.mission_id}/vr/${c.id}_signature.png`
    const { error: upErr } = await sb.storage.from(VR_BUCKET).upload(path, buf, { contentType: 'image/png', upsert: true })
    if (upErr) return json({ error: 'Envoi de la signature impossible, réessayez' }, 500)
    await sb.from('mission_documents').insert({ mission_id: c.mission_id, kind: 'signature', file_path: path, file_name: 'vr_signature.png',
      mime_type: 'image/png', file_size: buf.length, uploaded_by: c.created_by || null }).then(() => {}, () => {})
    await sb.from('vr_contrats').update({ signature_path: path, signed_at: now, status: 'signe', updated_at: now }).eq('id', c.id)
    await sb.from('mission_logs').insert({ mission_id: c.mission_id, action: 'vab_vr_contrat_signe',
      notes: `Contrat du véhicule de remplacement signé par ${c.client.prenom} ${c.client.nom} sur son téléphone.`, metadata: { contrat: c.id } }).then(() => {}, () => {})
    await finaliserSiComplet(sb, c.id)
    return json({ ok: true })
  }
  return json({ error: 'Étape inconnue' }, 400)
}
