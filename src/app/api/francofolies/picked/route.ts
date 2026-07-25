// src/app/api/francofolies/picked/route.ts
//
// GET /api/francofolies/picked?from=YYYY-MM-DD&to=YYYY-MM-DD
// Registre CONSULTABLE À L'ÉCRAN des véhicules enlevés (Francofolies) : mêmes
// données que l'export Excel mais en JSON, pour un tableau superadmin.
// Réservé au superadmin. Olivier 2026-07-17.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const PICKED = ['to_invoice', 'completed', 'invoiced']

/** Date locale Belgique au format AAAA-MM-JJ (pour comparer à from/to). */
function localYmd(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'superadmin') {
    return NextResponse.json({ error: 'Réservé au superadmin' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const from = (searchParams.get('from') || '').slice(0, 10)
  const to   = (searchParams.get('to')   || '').slice(0, 10)

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('incoming_missions')
    .select(`id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, status,
             client_name, client_address, client_city, client_phone, client_email, client_vat,
             payment_method, amount_to_collect, amount_collected,
             no_charge_at, no_charge_reason, ff_gardiennage_days,
             parked_at, completed_at`)
    .eq('source', 'francofolies')
    .in('status', PICKED)
    .limit(10000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data || [])
    .map((m: any) => ({ ...m, _ref: m.completed_at || m.parked_at }))
    .filter((m: any) => {
      const ymd = localYmd(m._ref)
      if (from && ymd < from) return false
      if (to && ymd > to) return false
      return true
    })
    .sort((a: any, b: any) => String(b._ref).localeCompare(String(a._ref)))   // plus récent en premier
    .map((m: any) => {
      const paymentLabel = m.no_charge_at ? 'Sans frais'
        : m.payment_method === 'a_verifier' ? 'À vérifier'
        : m.payment_method === 'unpaid' ? 'Pas payé'
        : 'Payé'
      return {
        id:            m.id,
        mission_number: m.mission_number,
        picked_at:     m._ref,
        plate:         m.vehicle_plate || '',
        brand:         m.vehicle_brand || '',
        model:         m.vehicle_model || '',
        client_name:   m.client_name || '',
        client_address: m.client_address || '',
        client_city:   m.client_city || '',
        client_phone:  m.client_phone || '',
        client_email:  m.client_email || '',
        client_vat:    m.client_vat || '',
        amount:        m.amount_to_collect != null ? Number(m.amount_to_collect) : null,
        payment_method: m.payment_method || null,
        payment_label: paymentLabel,
        gardiennage_days: m.ff_gardiennage_days ?? 0,
        no_charge_reason: m.no_charge_reason || null,
      }
    })

  const collected = rows.reduce((s, r) => s + (r.payment_label === 'Payé' && r.amount ? r.amount : 0), 0)
  return NextResponse.json({
    vehicles: rows,
    count:    rows.length,
    collected: Math.round(collected * 100) / 100,
  })
}
