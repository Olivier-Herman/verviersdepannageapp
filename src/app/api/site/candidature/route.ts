// src/app/api/site/candidature/route.ts
//
// Candidature chauffeur-dépanneur du site public (lot 1, Olivier 10/11/2026).
// Deux minutes depuis un téléphone : permis, expérience, nom, GSM ; le CV est
// facultatif. La candidature arrive dans l'écran /admin/demandes-site (CV
// consultable) ET par mail, CV joint, aux destinataires du réglage
// `site_candidature_destinataires` (Mobi et Momo).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendEmail, emailLayout, infoRow, type EmailAttachment } from '@/lib/emails'
import { getBusinessList } from '@/lib/settings/business'
import { limite, ipDe, str, esc, gsmValide } from '@/lib/site/garde-fous'
import { TEL } from '@/app/site/_data'

export const dynamic = 'force-dynamic'

const LANGS = ['fr', 'nl', 'de', 'en']
const PERMIS = ['B', 'BE', 'C', 'CE', 'ADR']
const CV_MAX = 8 * 1024 * 1024
const CV_TYPES: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

export async function POST(req: Request) {
  const ip = ipDe(req)
  if (limite('candidature:' + ip, 3)) {
    return NextResponse.json({ error: `Trop d’envois d’un coup. Réessayez dans quelques minutes ou appelez le ${TEL}.` }, { status: 429 })
  }
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Envoi illisible.' }, { status: 400 }) }
  if (str(form.get('website'), 10)) return NextResponse.json({ ok: true })   // champ piège

  const name   = str(form.get('name'), 120)
  const phone  = str(form.get('phone'), 40)
  const email  = str(form.get('email'), 160).toLowerCase()
  const exp    = str(form.get('experience'), 10) === 'oui' ? 'oui' : 'non'
  const note   = str(form.get('message'), 2000)
  const lang   = LANGS.includes(String(form.get('lang'))) ? String(form.get('lang')) : 'fr'
  const permis = String(form.get('permis') || '').split(',').map(s => s.trim().toUpperCase()).filter(p => PERMIS.includes(p))
  if (!name)              return NextResponse.json({ error: 'Votre nom est requis.' }, { status: 400 })
  if (!gsmValide(phone))  return NextResponse.json({ error: 'Indiquez un numéro de GSM complet.' }, { status: 400 })
  if (!permis.length)     return NextResponse.json({ error: 'Cochez au moins un permis.' }, { status: 400 })
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'Adresse e-mail invalide.' }, { status: 400 })

  const cv = form.get('cv')
  let file: File | null = cv instanceof File && cv.size > 0 ? cv : null
  if (file && file.size > CV_MAX) return NextResponse.json({ error: 'Le CV dépasse 8 Mo. Envoyez une photo ou un PDF plus léger.' }, { status: 400 })
  if (file && !CV_TYPES[file.type]) return NextResponse.json({ error: 'Le CV doit être un PDF, une photo ou un document Word.' }, { status: 400 })

  const sb = createAdminClient()
  const id = crypto.randomUUID()
  let bytes: Buffer | null = null, path: string | null = null
  if (file) {
    bytes = Buffer.from(await file.arrayBuffer())
    path = `candidatures/${id}/cv.${CV_TYPES[file.type]}`
    const up = await sb.storage.from('site-demandes').upload(path, bytes, { contentType: file.type, upsert: false })
    if (up.error) {
      console.error('[site/candidature] CV KO:', up.error.message)
      return NextResponse.json({ error: 'Le CV n’a pas pu être envoyé. Réessayez sans CV : nous vous le demanderons.' }, { status: 502 })
    }
  }

  const details = { permis, experience: exp, ...(note ? { message: note } : {}) }
  const { error } = await sb.from('site_requests').insert({
    id, kind: 'candidature', name, phone, email: email || null, lang, details,
    file_path: path, file_name: file ? file.name.slice(0, 160) : null, ip,
  })
  if (error) {
    console.error('[site/candidature] enregistrement KO:', error.message)
    return NextResponse.json({ error: `La candidature n’est pas passée. Appelez le ${TEL}.` }, { status: 502 })
  }

  try {
    const to = await getBusinessList('site_candidature_destinataires')
    const subject = `[Site] Candidature chauffeur — ${name} (${permis.join(', ')})`
    const inner = `
      <p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#111;">Candidature chauffeur-dépanneur</p>
      <p style="margin:0 0 20px;font-size:13px;color:#888;">Reçue depuis le site${file ? ', CV joint' : ', sans CV'}.</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Nom', esc(name))}
        ${infoRow('GSM', `<a href="tel:${esc(phone)}">${esc(phone)}</a>`)}
        ${email ? infoRow('E-mail', `<a href="mailto:${esc(email)}">${esc(email)}</a>`) : ''}
        ${infoRow('Permis', esc(permis.join(', ')))}
        ${infoRow('Déjà fait du dépannage', exp === 'oui' ? 'Oui' : 'Non, mais motivé')}
        ${lang !== 'fr' ? infoRow('Langue', lang.toUpperCase()) : ''}
      </table>
      ${note ? `<div style="margin-top:18px;padding:16px 18px;background:#f8f8f8;border-radius:8px;font-size:14px;line-height:1.6;color:#222;">${esc(note)}</div>` : ''}
      <p style="margin:18px 0 0;font-size:12px;color:#999;">Aussi dans l’écran « Demandes du site ».</p>`
    const att: EmailAttachment[] = file && bytes
      ? [{ name: file.name || `cv.${CV_TYPES[file.type]}`, contentType: file.type, contentBytes: bytes.toString('base64') }]
      : []
    if (to.length) await sendEmail(to[0], subject, emailLayout(inner, subject), 'Verviers Dépannage', to.slice(1), att)
  } catch (e: any) {
    console.error('[site/candidature] mail KO:', e?.message)
  }

  return NextResponse.json({ ok: true })
}
