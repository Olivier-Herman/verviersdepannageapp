// src/app/api/towsoft/error-notify/route.ts
// Alerte email + push à l'admin quand une mission TowSoft passe en error.
// Appelée depuis scripts/towsoft-create.js juste après updateQueue('error', ...).

export const dynamic = 'force-dynamic'

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendEmail }         from '@/lib/emails'
import { sendPushToUser }    from '@/lib/push'

// .trim() pour absorber les espaces/tabs collés en trop dans la valeur Vercel
const NOTIFY_EMAIL    = (process.env.TOWSOFT_ERROR_NOTIFY_EMAIL || 'info@olivierherman.be').trim()
// Email du compte Supabase qui doit recevoir le push (peut différer du destinataire mail).
// Si non défini, on retombe sur NOTIFY_EMAIL.
const PUSH_USER_EMAIL = (process.env.TOWSOFT_ERROR_PUSH_USER_EMAIL || NOTIFY_EMAIL).trim()

const HTML_ESCAPES: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;' }
function escapeHtml(s: string): string {
  return s.replace(/[<>&]/g, c => HTML_ESCAPES[c] || c)
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { queue_id, error_message, run_id, secret } = body

  if (secret !== process.env.TOWSOFT_CALLBACK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!queue_id) {
    return NextResponse.json({ error: 'queue_id requis' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: queue } = await supabase
    .from('towsoft_queue')
    .select('id, mission_type, plate, brand, model, driver_name, odoo_ticket_id, location, created_at')
    .eq('id', queue_id)
    .maybeSingle()

  if (!queue) {
    return NextResponse.json({ error: 'Queue introuvable' }, { status: 404 })
  }

  const repo        = 'Olivier-Herman/verviersdepannageapp'
  const runUrl      = run_id ? `https://github.com/${repo}/actions/runs/${run_id}` : null
  const artifactUrl = run_id ? `https://github.com/${repo}/actions/runs/${run_id}#artifacts` : null

  const subject = `❌ Création TowSoft échouée — ${queue.plate || 'plaque inconnue'}`

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fff;color:#222">
      <h2 style="color:#cc2222;margin:0 0 16px">❌ Mission TowSoft en erreur</h2>

      <p style="margin:0 0 12px"><b>Chauffeur :</b> ${queue.driver_name || 'inconnu'}</p>
      <p style="margin:0 0 12px"><b>Type :</b> ${queue.mission_type}</p>
      <p style="margin:0 0 12px"><b>Plaque :</b> ${queue.plate || '-'}</p>
      <p style="margin:0 0 12px"><b>Véhicule :</b> ${[queue.brand, queue.model].filter(Boolean).join(' ') || '-'}</p>
      <p style="margin:0 0 12px"><b>Lieu :</b> ${queue.location || '-'}</p>
      <p style="margin:0 0 12px"><b>Ticket Odoo :</b> ${queue.odoo_ticket_id ? `#${queue.odoo_ticket_id}` : '-'}</p>
      <p style="margin:0 0 12px"><b>Queue ID :</b> <code>${queue.id}</code></p>

      <hr style="border:none;border-top:1px solid #ddd;margin:20px 0"/>

      <p style="margin:0 0 8px"><b>Message d'erreur :</b></p>
      <pre style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:13px;white-space:pre-wrap;word-break:break-word">${escapeHtml(error_message || 'Inconnu')}</pre>

      ${runUrl ? `
      <hr style="border:none;border-top:1px solid #ddd;margin:20px 0"/>
      <p style="margin:0 0 8px">
        <a href="${runUrl}" style="color:#cc2222;font-weight:600;text-decoration:none">→ Voir le run GitHub Actions</a>
      </p>
      <p style="margin:0">
        <a href="${artifactUrl}" style="color:#cc2222;font-weight:600;text-decoration:none">→ Télécharger les screenshots (debug-before-submit.png &amp; debug-after-submit.png)</a>
      </p>
      ` : ''}

      <hr style="border:none;border-top:1px solid #ddd;margin:20px 0"/>
      <p style="font-size:12px;color:#888;margin:0">
        Le chauffeur doit recréer la mission manuellement dans TowSoft (ou retenter depuis l'app si le bug est passager).
        Aucun doublon ni fausse association côté Odoo : la queue est en <code>error</code>, pas <code>done</code>.
      </p>
    </div>
  `

  // Email
  try {
    await sendEmail(NOTIFY_EMAIL, subject, html)
    console.log('[ErrorNotify] Email envoyé à', NOTIFY_EMAIL)
  } catch (e: any) {
    console.error('[ErrorNotify] Email échec:', e.message)
  }

  // Push (si l'admin est inscrit dans la base + a une subscription active)
  try {
    const { data: adminUser } = await supabase
      .from('users')
      .select('id')
      .ilike('email', PUSH_USER_EMAIL)
      .maybeSingle()

    if (adminUser?.id) {
      // URL et tag courts — iOS PWA n'ouvre que des URLs du même origin via clients.openWindow,
      // les URLs externes (github.com pour les artifacts) sont à ouvrir depuis le mail uniquement.
      const result = await sendPushToUser(adminUser.id, {
        title: '❌ TowSoft échec',
        body:  `${queue.mission_type} — ${queue.plate || 'sans plaque'} — ${queue.driver_name || ''}`,
        url:   '/admin/missions',
        tag:   'towsoft-error',
      })
      console.log(`[ErrorNotify] Push: ${result.sent} envoyé(s), ${result.failed} échec(s)`)
    } else {
      console.warn('[ErrorNotify] Aucun user trouvé pour', PUSH_USER_EMAIL, '— pas de push')
    }
  } catch (e: any) {
    console.error('[ErrorNotify] Push échec:', e.message)
  }

  return NextResponse.json({ ok: true })
}
