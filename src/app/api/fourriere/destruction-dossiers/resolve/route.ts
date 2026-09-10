// GET ?qr=<contenu du QR>  ou  ?q=<plaque / VIN / marque>  → fiches EN PARC candidates + état du verrou de sortie
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { fourriereUser }     from '@/lib/fourriere/destruction-access'
import { getExitControlState } from '@/lib/missions/exit-control'

export const dynamic = 'force-dynamic'
const SELECT = 'id, mission_number, source, status, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, parc_zone_key, parked_at, intervention_date, received_at, client_name'

export async function GET(req: Request) {
  const u = await fourriereUser(); if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const sp = new URL(req.url).searchParams
  const qr = (sp.get('qr') || '').trim(); const q = (sp.get('q') || '').trim()
  let rows: any[] = []
  if (qr) {
    // QR de l'étiquette = URL /qr/mission/<n° ou uuid> (ou ancien /v/<ticket Odoo>)
    const m = qr.match(/\/qr\/mission\/([A-Za-z0-9-]+)/) || qr.match(/^([0-9]{6,})$/)
    const v = qr.match(/\/v\/([0-9]+)/)
    if (m) {
      const key = m[1]
      const r = /^\d+$/.test(key)
        ? await sb.from('incoming_missions').select(SELECT).eq('mission_number', Number(key)).eq('dossier_leg', false).maybeSingle()
        : await sb.from('incoming_missions').select(SELECT).eq('id', key).eq('dossier_leg', false).maybeSingle()
      if (r.data) rows = [r.data]
    } else if (v) {
      const r = await sb.from('incoming_missions').select(SELECT).eq('odoo_helpdesk_id', Number(v[1])).eq('dossier_leg', false).limit(1)
      rows = r.data || []
    }
    if (!rows.length) return NextResponse.json({ error: 'QR non reconnu : ce n’est pas une étiquette VD Soft.', missions: [] }, { status: 404 })
  } else if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`
    const { data } = await sb.from('incoming_missions').select(SELECT).eq('status', 'parked').eq('dossier_leg', false)
      .or(`vehicle_plate.ilike.${like},vehicle_vin.ilike.${like},vehicle_brand.ilike.${like},vehicle_model.ilike.${like}`)
      .order('parked_at', { ascending: true }).limit(20)
    rows = data || []
  } else {
    const { data } = await sb.from('incoming_missions').select(SELECT).eq('status', 'parked').eq('dossier_leg', false)
      .order('parked_at', { ascending: true, nullsFirst: true }).limit(60)
    rows = data || []
  }
  const missions = await Promise.all(rows.map(async (m: any) => {
    let lock: { blocked: boolean; reason: string | null } = { blocked: false, reason: null }
    try { const st = await getExitControlState(sb, m.id); lock = { blocked: st.armed && !st.allowed, reason: st.reason } } catch { /* pas de contrôle → libre */ }
    const entered = m.parked_at || m.intervention_date || m.received_at
    const days = entered ? Math.floor((Date.now() - new Date(entered).getTime()) / 86_400_000) : null
    return { ...m, entered_at: entered, days, lock, in_parc: m.status === 'parked' }
  }))
  return NextResponse.json({ missions })
}
