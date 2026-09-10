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
    // QR TowSoft (Olivier 10/09/2026 : « certains QR sur les véhicules sont liés à TowSoft ») :
    // URL appel.php?num=NNN, ou simple numéro. → fiche migrée « TS-NNN » si elle existe,
    // sinon l'archive TowSoft (marque, modèle, VIN, plaque, date d'appel) pour préremplir
    // un dossier « sans fiche ».
    let archive: any = null
    if (!rows.length) {
      const ts = qr.match(/towsoft[^0-9]*?num=([0-9]{3,8})/i) || qr.match(/^\s*(?:TS-?)?([0-9]{3,8})\s*$/i)
      if (ts) {
        const num = ts[1]
        const r = await sb.from('incoming_missions').select(SELECT).eq('external_id', `TS-${num}`).eq('dossier_leg', false).limit(1)
        rows = r.data || []
        if (!rows.length) {
          const { data: a } = await sb.from('towsoft_archive').select('towsoft_num, plate, vin, brand, model, motif, client_name, date_appel, appel_status, is_cancelled').eq('towsoft_num', num).maybeSingle()
          if (a) archive = a
        }
      }
    }
    if (!rows.length && archive) return NextResponse.json({ missions: [], archive })
    if (!rows.length) return NextResponse.json({ error: 'QR non reconnu : ni étiquette VD Soft, ni référence TowSoft connue.', missions: [] }, { status: 404 })
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
