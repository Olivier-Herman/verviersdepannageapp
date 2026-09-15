// src/app/api/site/contact/route.ts
//
// Formulaire de contact du site public. Trois motifs, une seule boîte :
//   · depannage  → une demande non urgente (un rendez-vous, un devis, une question) ;
//   · pro        → garage, assureur, loueur : transport, dépôt-reprise, série ;
//   · evenement  → organisateur : couverture d'un événement, du circuit, d'un chantier.
// Le motif fait le sujet du mail, pour que le bureau trie sans ouvrir.
//
// Deux garde-fous, parce que c'est public : un champ piège que seul un robot
// remplit, et la même limitation par IP que l'assistant. Une demande urgente
// n'a rien à faire ici — le formulaire le dit, et l'accusé de réception aussi.
// Olivier 2026-09-15.

import { NextResponse } from 'next/server'
import { sendEmail, emailLayout, infoRow } from '@/lib/emails'
import { TEL } from '@/app/site/_data'

export const dynamic = 'force-dynamic'

const TO = 'info@verviersdepannage.be'
const MOTIFS: Record<string, string> = {
  depannage: 'Demande de dépannage (non urgent)',
  pro:       'Demande professionnelle',
  evenement: 'Couverture d’événement',
}

const WINDOW_MS = 10 * 60 * 1000
const MAX_HITS  = 5
const hits = new Map<string, number[]>()
function rateLimited(ip: string) {
  const now = Date.now()
  const seen = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS)
  seen.push(now); hits.set(ip, seen)
  if (hits.size > 5000) hits.clear()
  return seen.length > MAX_HITS
}

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
  if (rateLimited(ip)) {
    return NextResponse.json({ error: `Trop de messages d’un coup. Appelez le ${TEL}, quelqu’un décroche 24h/24.` }, { status: 429 })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }

  // Champ piège : invisible pour un humain, rempli par les robots. On répond
  // « ok » sans rien envoyer, pour ne pas leur apprendre qu'ils sont vus.
  if (str(body.website, 10)) return NextResponse.json({ ok: true })

  const motif   = MOTIFS[body.motif] ? String(body.motif) : 'depannage'
  const name    = str(body.name, 120)
  const email   = str(body.email, 160).toLowerCase()
  const phone   = str(body.phone, 40)
  const company = str(body.company, 120)
  const message = str(body.message, 3000)

  if (!name)    return NextResponse.json({ error: 'Votre nom est requis.' }, { status: 400 })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'Adresse e-mail invalide.' }, { status: 400 })
  if (message.length < 10) return NextResponse.json({ error: 'Dites-nous en un peu plus — dix caractères au moins.' }, { status: 400 })

  const subject = `[Site] ${MOTIFS[motif]} — ${name}${company ? ` (${company})` : ''}`
  const inner = `
    <p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#111;">${esc(MOTIFS[motif])}</p>
    <p style="margin:0 0 20px;font-size:13px;color:#888;">Reçu depuis le formulaire du site</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${infoRow('Nom', esc(name))}
      ${company ? infoRow('Société', esc(company)) : ''}
      ${infoRow('E-mail', `<a href="mailto:${esc(email)}">${esc(email)}</a>`)}
      ${phone ? infoRow('Téléphone', `<a href="tel:${esc(phone)}">${esc(phone)}</a>`) : ''}
    </table>
    <div style="margin-top:18px;padding:16px 18px;background:#f8f8f8;border-radius:8px;font-size:14px;line-height:1.6;color:#222;">${esc(message)}</div>
    <p style="margin:18px 0 0;font-size:12px;color:#999;">Répondre à ce mail répond directement à la personne.</p>
  `

  try {
    // Vers le bureau, avec l'expéditeur en réponse : un clic sur « Répondre » suffit.
    await sendEmail(TO, subject, emailLayout(inner, subject), 'Verviers Dépannage', undefined, undefined, undefined, undefined)
  } catch (e: any) {
    console.error('[site/contact] envoi bureau KO:', e?.message)
    return NextResponse.json({ error: `L’envoi a échoué. Appelez le ${TEL} ou écrivez à ${TO}.` }, { status: 502 })
  }

  // Accusé de réception, best effort : s'il ne part pas, la demande est
  // quand même arrivée au bureau.
  const ack = `
    <p style="margin:0 0 12px;font-size:20px;font-weight:700;color:#111;">Bien reçu, ${esc(name)}.</p>
    <p style="margin:0 0 12px;font-size:14px;color:#444;line-height:1.6;">
      Votre message est arrivé chez nous. Nous vous répondons pendant les heures de bureau,
      en général le jour même.
    </p>
    <p style="margin:0 0 16px;font-size:14px;color:#444;line-height:1.6;">
      <strong>Si vous êtes en panne ou accidenté maintenant, n’attendez pas ce mail :</strong>
      appelez le <a href="tel:+3287351820" style="color:#CC2222;font-weight:700;">${TEL}</a>, quelqu’un décroche 24h/24.
    </p>
    <div style="padding:14px 18px;background:#f8f8f8;border-radius:8px;font-size:13px;line-height:1.6;color:#555;">
      <strong style="color:#222;">Votre message</strong><br>${esc(message)}
    </div>
  `
  await sendEmail(email, `Bien reçu — ${MOTIFS[motif]}`, emailLayout(ack, 'Bien reçu'), name).catch(() => {})

  return NextResponse.json({ ok: true })
}
