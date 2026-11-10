// src/app/api/site/rappel/route.ts
//
// « Rappelez-moi » du site public (lot 1, Olivier 10/11/2026) : le visiteur
// laisse son GSM, le bureau promet de rappeler sous N heures ouvrables
// (réglage `site_delai_rappel_heures`). La demande arrive dans l'écran
// /admin/demandes-site avec son échéance, ET par mail aux destinataires du
// réglage `site_rappel_destinataires`. Une urgence n'a rien à faire ici : la
// réponse rappelle le numéro, jour et nuit.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendEmail, emailLayout, infoRow } from '@/lib/emails'
import { getBusinessList, getBusinessNumber } from '@/lib/settings/business'
import { echeanceOuvrable } from '@/lib/site/heures'
import { limite, ipDe, str, esc, gsmValide } from '@/lib/site/garde-fous'
import { TEL } from '@/app/site/_data'

export const dynamic = 'force-dynamic'

const LANGS = ['fr', 'nl', 'de', 'en']
const quand = (d: Date) => new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(d)

export async function POST(req: Request) {
  const ip = ipDe(req)
  if (limite('rappel:' + ip, 3)) {
    return NextResponse.json({ error: `Trop de demandes d’un coup. Appelez le ${TEL}, quelqu’un décroche 24h/24.` }, { status: 429 })
  }
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Demande illisible.' }, { status: 400 }) }
  if (str(body.website, 10)) return NextResponse.json({ ok: true })   // champ piège

  const phone = str(body.phone, 40)
  const name  = str(body.name, 120)
  const motif = str(body.motif, 500)
  const lang  = LANGS.includes(body.lang) ? body.lang : 'fr'
  if (!gsmValide(phone)) return NextResponse.json({ error: 'Indiquez un numéro de GSM complet.' }, { status: 400 })

  const heures = await getBusinessNumber('site_delai_rappel_heures')
  const due = echeanceOuvrable(new Date(), heures)

  const sb = createAdminClient()
  const { error } = await sb.from('site_requests').insert({
    kind: 'rappel', phone, name: name || null, lang, details: motif ? { motif } : {}, due_at: due.toISOString(), ip,
  })
  if (error) {
    console.error('[site/rappel] enregistrement KO:', error.message)
    return NextResponse.json({ error: `La demande n’est pas passée. Appelez le ${TEL}.` }, { status: 502 })
  }

  // Mail au bureau : best effort, la demande est déjà dans l'écran.
  try {
    const to = await getBusinessList('site_rappel_destinataires')
    const subject = `[Site] Rappelez-moi — ${name || phone}`
    const inner = `
      <p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#111;">Rappelez-moi</p>
      <p style="margin:0 0 20px;font-size:13px;color:#888;">Demande laissée sur le site. À rappeler avant le ${esc(quand(due))}.</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('GSM', `<a href="tel:${esc(phone)}">${esc(phone)}</a>`)}
        ${name ? infoRow('Nom', esc(name)) : ''}
        ${lang !== 'fr' ? infoRow('Langue', lang.toUpperCase()) : ''}
      </table>
      ${motif ? `<div style="margin-top:18px;padding:16px 18px;background:#f8f8f8;border-radius:8px;font-size:14px;line-height:1.6;color:#222;">${esc(motif)}</div>` : ''}
      <p style="margin:18px 0 0;font-size:12px;color:#999;">Une fois rappelé, cochez-le dans l’écran « Demandes du site ».</p>`
    if (to.length) await sendEmail(to[0], subject, emailLayout(inner, subject), 'Verviers Dépannage', to.slice(1))
  } catch (e: any) {
    console.error('[site/rappel] mail bureau KO:', e?.message)
  }

  return NextResponse.json({ ok: true, heures, echeance: due.toISOString() })
}
