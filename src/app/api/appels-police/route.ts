// /api/appels-police — liste des appels en cours (dispatch) ; POST = le dispatch envoie un chauffeur sur un appel police.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendNotification } from '@/lib/notifications/send'
import { moi, STATUTS_ACTIFS } from '@/lib/appels-police/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const u = await moi()
  if (!u?.dispatch) return NextResponse.json({ error: 'Réservé au dispatch' }, { status: 403 })
  const sb = createAdminClient()
  const { data } = await sb.from('appels_police').select('*').in('status', STATUTS_ACTIFS).order('created_at', { ascending: false }).limit(50)
  const ids = Array.from(new Set((data || []).map((a: any) => a.driver_id)))
  const { data: us } = ids.length ? await sb.from('users').select('id, name').in('id', ids) : { data: [] as any[] }
  return NextResponse.json({ appels: (data || []).map((a: any) => ({ ...a, driver_name: (us || []).find((x: any) => x.id === a.driver_id)?.name || null })) })
}

export async function POST(req: Request) {
  const u = await moi()
  if (!u?.dispatch) return NextResponse.json({ error: 'Réservé au dispatch' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const address = String(b?.address || '').trim(), driverId = String(b?.driver_id || '')
  const lat = Number(b?.lat), lng = Number(b?.lng)
  if (!address) return NextResponse.json({ error: 'Indiquez l’adresse de l’appel.' }, { status: 400 })
  if (!driverId) return NextResponse.json({ error: 'Choisissez le chauffeur.' }, { status: 400 })
  const sb = createAdminClient()
  const { data: drv } = await sb.from('users').select('id, name, active').eq('id', driverId).maybeSingle()
  if (!drv || !(drv as any).active) return NextResponse.json({ error: 'Chauffeur introuvable.' }, { status: 400 })
  const { data: a, error } = await sb.from('appels_police').insert({
    created_by: u.id, driver_id: driverId, address,
    lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null,
    note: String(b?.note || '').trim().slice(0, 500) || null,
  }).select('id').single()
  if (error || !a) return NextResponse.json({ error: error?.message || 'Enregistrement impossible' }, { status: 500 })
  await sendNotification(driverId, 'appel_police_dispatch', {
    title: '🚓 Appel police',
    body: address + (b?.note ? ` — ${String(b.note).trim().slice(0, 120)}` : ''),
    action_url: `/mission/police?appel=${a.id}`,
    data: { appel_id: a.id },
  }).catch(() => {})
  return NextResponse.json({ ok: true, id: a.id, driver_name: (drv as any).name })
}
