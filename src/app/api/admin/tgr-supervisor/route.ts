// src/app/api/admin/tgr-supervisor/route.ts
//
// Gestion de l'accès supervision TGR (admin/superadmin) :
//   GET  → { token, link, email }
//   POST { action: 'set_email', email }  → règle l'email du bilan mensuel
//        { action: 'regenerate' }        → révoque l'ancien + nouveau jeton
//        { action: 'revoke' }            → révoque tous les jetons
// Olivier 2026-07-11.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { getTgrSupervisionData } from '@/lib/tgr/supervision'
import { buildTgrReportEmail, buildTgrWelcomeEmail } from '@/lib/tgr/report-email'
import { sendEmail } from '@/lib/emails'

export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const sb = createAdminClient()
  const { data } = await sb.from('users').select('id, role, roles').eq('email', session.user.email).maybeSingle()
  const roles: string[] = [data?.role, ...(Array.isArray(data?.roles) ? data!.roles : [])].filter(Boolean)
  if (!roles.some(r => ['admin', 'superadmin'].includes(r))) return null
  return { sb, actor: data }
}

async function activeToken(sb: any): Promise<string | null> {
  const { data } = await sb.from('tgr_supervisor_tokens')
    .select('token').eq('revoked', false).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data?.token || null
}
async function getEmail(sb: any): Promise<string> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'tgr_supervisor_email').maybeSingle()
  return data?.value || ''
}
const linkFor = (token: string | null) => token ? `${APP_URL}/superv/tgr?token=${token}` : null

export async function GET() {
  const auth = await requireAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const token = await activeToken(auth.sb)
  return NextResponse.json({ ok: true, token, link: linkFor(token), email: await getEmail(auth.sb) })
}

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = auth.sb
  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || '')

  if (action === 'set_email') {
    const email = String(body?.email || '').trim()
    await sb.from('app_settings').upsert({ key: 'tgr_supervisor_email', value: email }, { onConflict: 'key' })
    return NextResponse.json({ ok: true, email })
  }
  if (action === 'revoke') {
    await sb.from('tgr_supervisor_tokens').update({ revoked: true }).eq('revoked', false)
    return NextResponse.json({ ok: true, token: null, link: null })
  }
  if (action === 'regenerate') {
    await sb.from('tgr_supervisor_tokens').update({ revoked: true }).eq('revoked', false)
    const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
    await sb.from('tgr_supervisor_tokens').insert({ token, label: 'Responsable Touring' })
    return NextResponse.json({ ok: true, token, link: linkFor(token) })
  }

  // Envoi manuel : test (bilan du mois en cours) ou mail de bienvenue.
  if (action === 'send_test' || action === 'send_welcome') {
    const email = await getEmail(sb)
    if (!email) return NextResponse.json({ error: "Renseigne d'abord l'email du responsable." }, { status: 400 })
    const link = linkFor(await activeToken(sb))
    if (!link) return NextResponse.json({ error: "Aucun lien actif — régénère le lien d'abord." }, { status: 400 })
    try {
      if (action === 'send_welcome') {
        const { subject, html } = buildTgrWelcomeEmail(link)
        await sendEmail(email, subject, html)
      } else {
        const now = new Date()
        const from = new Date(now.getFullYear(), now.getMonth(), 1)  // mois en cours
        const data = await getTgrSupervisionData(sb, { from: from.toISOString() })
        const monthLabel = from.toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' }) + ' (test)'
        const { subject, html } = buildTgrReportEmail(data.stats, monthLabel, link)
        await sendEmail(email, subject, html)
      }
      return NextResponse.json({ ok: true, sent_to: email })
    } catch (e: any) {
      return NextResponse.json({ error: `Envoi KO : ${e?.message || e}` }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
