// src/app/api/check-vehicule/convocations/route.ts
//
// Convocations au contrôle technique :
//   POST { image, mime, filename? } → OCR (Claude) + stockage + insert +
//        évènement Outlook (Graph) avec rappel 1 mois avant.
//   GET  → liste (rdv à venir + passés).
//   PATCH { id, ...champs } → correction manuelle.  DELETE ?id=
// Accès : admin / superadmin / dispatcher.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { extractConvocation } from '@/lib/ct/extract-convocation'
import { createCtCalendarEvent } from '@/lib/ct/calendar'

export const dynamic     = 'force-dynamic'
export const maxDuration  = 60

const ALLOWED = ['admin', 'superadmin', 'dispatcher']
const ok = (u: any) => ALLOWED.includes(u?.role) || (Array.isArray(u?.roles) && u.roles.some((r: string) => ALLOWED.includes(r)))

/** Offset Bruxelles ('+01:00' ou '+02:00') pour une date donnée. */
function brusselsOffset(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00Z')
    const s = d.toLocaleString('en-US', { timeZone: 'Europe/Brussels', timeZoneName: 'shortOffset' })
    const m = s.match(/GMT([+-]\d{1,2})/)
    const h = m ? parseInt(m[1], 10) : 2
    return (h >= 0 ? '+' : '-') + String(Math.abs(h)).padStart(2, '0') + ':00'
  } catch { return '+01:00' }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!ok(session?.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const { data } = await sb.from('ct_convocations').select('*').order('rdv_at', { ascending: true, nullsFirst: false })
  return NextResponse.json({ convocations: data || [] })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!ok(u)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id').eq('email', u.email).maybeSingle()

  const body = await req.json().catch(() => ({}))
  const image = String(body.image || '')
  const mime  = String(body.mime || 'image/jpeg')
  if (!image) return NextResponse.json({ error: 'Aucun fichier' }, { status: 400 })

  // 1) OCR
  let ex
  try { ex = await extractConvocation(image, mime) }
  catch (e: any) { return NextResponse.json({ error: `Lecture impossible : ${e?.message}` }, { status: 422 }) }

  // 2) rdv_at + reminder_at
  let rdvAt: string | null = null, reminderAt: string | null = null
  if (ex.rdv_date && /^\d{4}-\d{2}-\d{2}$/.test(ex.rdv_date)) {
    const time = ex.rdv_time && /^\d{1,2}:\d{2}$/.test(ex.rdv_time) ? ex.rdv_time.padStart(5, '0') : '09:00'
    rdvAt = new Date(`${ex.rdv_date}T${time}:00${brusselsOffset(ex.rdv_date)}`).toISOString()
    reminderAt = new Date(new Date(rdvAt).getTime() - 30 * 24 * 3600 * 1000).toISOString()
  }

  // 3) Upload du scan
  let storagePath: string | null = null
  try {
    const buf = Buffer.from(image.replace(/^data:.*;base64,/, ''), 'base64')
    const ext = mime.includes('pdf') ? 'pdf' : 'jpg'
    storagePath = `${me?.id || 'x'}/${Date.now()}_${Math.round(Math.random() * 1e6)}.${ext}`
    await sb.storage.from('convocations').upload(storagePath, buf, { contentType: mime, upsert: false })
  } catch { storagePath = null }

  // 4) Évènement Outlook (Graph) + rappel 1 mois
  let graphEventId: string | null = null
  if (rdvAt) graphEventId = await createCtCalendarEvent({ rdv_at: rdvAt, plate: ex.plate, brand: ex.brand, model: ex.model, center_name: ex.center_name, center_address: ex.center_address })

  // 5) Insert
  const { data: row, error } = await sb.from('ct_convocations').insert({
    plate: ex.plate, brand: ex.brand, model: ex.model, vin: ex.vin,
    rdv_at: rdvAt, reminder_at: reminderAt,
    center_name: ex.center_name, center_address: ex.center_address,
    storage_path: storagePath, graph_event_id: graphEventId,
    ocr: ex as any, status: 'a_venir', created_by: me?.id || null,
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, convocation: row, calendar: !!graphEventId })
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!ok(session?.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const b = await req.json().catch(() => ({}))
  const id = String(b.id || '')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const upd: any = { updated_at: new Date().toISOString() }
  for (const k of ['plate', 'brand', 'model', 'vin', 'center_name', 'center_address', 'status', 'notes']) if (b[k] !== undefined) upd[k] = b[k]
  if (b.rdv_at) { upd.rdv_at = b.rdv_at; upd.reminder_at = new Date(new Date(b.rdv_at).getTime() - 30 * 24 * 3600 * 1000).toISOString() }
  const { error } = await sb.from('ct_convocations').update(upd).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!ok(session?.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  await sb.from('ct_convocations').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
