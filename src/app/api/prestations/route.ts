// src/app/api/prestations/route.ts
//
// Module Prestations (superadmin).
// GET  ?period=AAAA-MM → { periods, period, sheets }
// POST { action:'import', from? } | { action:'save', id, days } | { action:'validate'|'unvalidate', id }

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { importPrestations }         from '@/lib/prestations/import'
import { generatePrestationsPdf }    from '@/lib/prestations/generate-pdf'
import { sendEmail, emailLayout }    from '@/lib/emails'
import bcrypt                        from 'bcryptjs'

// Destinataire de la feuille de présence (gestionnaire EasyPay). Configurable plus tard.
const JONATHAN = 'jonathan.junius@easypay-group.com'

export const dynamic    = 'force-dynamic'
export const fetchCache  = 'force-no-store'
export const maxDuration = 300

import { isPersonnelStaff } from '@/lib/rh-access'
const isSuper = isPersonnelStaff

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()

  const { data: all } = await sb.from('prestation_sheets').select('period').order('period', { ascending: false })
  const periods = [...new Set((all || []).map((r: any) => r.period))]
  const period = req.nextUrl.searchParams.get('period') || periods[0] || null

  let sheets: any[] = []
  if (period) {
    const { data } = await sb.from('prestation_sheets').select('*').eq('period', period).order('worker_name')
    sheets = data || []
  }
  return NextResponse.json({ periods, period, sheets })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const sb = createAdminClient()

  if (action === 'import') {
    try {
      const results = await importPrestations(body.from || undefined)
      return NextResponse.json({ ok: true, results })
    } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
  }

  if (action === 'save') {
    const id = String(body.id || '')
    if (!id || typeof body.days !== 'object') return NextResponse.json({ error: 'id + days requis' }, { status: 400 })
    await sb.from('prestation_sheets').update({ days: body.days, updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'sign_send') {
    // Valide + signe (PIN du profil) + envoie la feuille à Jonathan (EasyPay).
    const period = String(body.period || ''), pin = String(body.pin || '')
    if (!period || !pin) return NextResponse.json({ error: 'period + pin requis' }, { status: 400 })

    const email = (session!.user as any).email
    const { data: me } = await sb.from('users').select('name, verify_pin_hash').eq('email', email).maybeSingle()
    if (!me?.verify_pin_hash) return NextResponse.json({ error: "Aucun PIN configuré sur ton profil (Administration → PIN)." }, { status: 400 })
    const ok = await bcrypt.compare(pin, me.verify_pin_hash)
    if (!ok) return NextResponse.json({ error: 'PIN incorrect' }, { status: 403 })

    const { data: sheets } = await sb.from('prestation_sheets').select('*').eq('period', period).order('worker_name')
    if (!sheets?.length) return NextResponse.json({ error: 'Aucune feuille pour cette période' }, { status: 404 })

    const signedBy = me.name || 'Responsable'
    const signedDate = new Date().toLocaleDateString('fr-BE')

    // Une feuille (PDF) par société présente dans la période.
    const byCo: Record<string, any[]> = {}
    for (const s of sheets) (byCo[s.company_code || '438'] ||= []).push(s)
    for (const [cc, rows] of Object.entries(byCo)) {
      const bytes = await generatePrestationsPdf(period, cc, rows as any, signedBy, signedDate)
      const b64 = Buffer.from(bytes).toString('base64')
      const html = emailLayout(
        `<p style="margin:0 0 12px">Bonjour,</p>
         <p style="margin:0 0 12px">Veuillez trouver ci-joint la <b>feuille de présence</b> validée pour la période <b>${period}</b> (${cc}).</p>
         <p style="margin:0;color:#666;font-size:13px">Validée électroniquement par ${signedBy}, le ${signedDate}.</p>`,
        'Feuille de présence')
      await sendEmail(JONATHAN, `Feuille de présence ${period} — ${cc}`, html, 'EasyPay', 'mobi@verviersdepannage.be',
        [{ name: `feuille-presence-${period}-${cc}.pdf`, contentType: 'application/pdf', contentBytes: b64 }])
    }

    await sb.from('prestation_sheets').update({ validated: true, validated_at: new Date().toISOString(), signed_by: signedBy }).eq('period', period)
    return NextResponse.json({ ok: true, signedBy, date: signedDate, to: JONATHAN })
  }

  if (action === 'validate' || action === 'unvalidate') {
    const v = action === 'validate'
    if (body.period) await sb.from('prestation_sheets').update({ validated: v, validated_at: v ? new Date().toISOString() : null }).eq('period', body.period)
    else if (body.id) await sb.from('prestation_sheets').update({ validated: v, validated_at: v ? new Date().toISOString() : null }).eq('id', body.id)
    else return NextResponse.json({ error: 'id ou period requis' }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
