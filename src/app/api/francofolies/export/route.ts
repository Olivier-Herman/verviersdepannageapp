// src/app/api/francofolies/export/route.ts
//
// GET /api/francofolies/export?from=YYYY-MM-DD&to=YYYY-MM-DD
// Registre Excel (.xlsx) des véhicules enlevés sur la période : Date, Heure,
// Marque, Modèle, Immatriculation, coordonnées propriétaire, payé / pas payé.
// Réservé au superadmin. Olivier 2026-06-29.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import * as XLSX             from 'xlsx'

export const dynamic = 'force-dynamic'

const PICKED = ['to_invoice', 'completed', 'invoiced']

/** JJ/MM/AAAA + HH:MM en heure locale Belgique. */
function fmtLocal(ts: string | null): { date: string; time: string } {
  if (!ts) return { date: '', time: '' }
  const d = new Date(ts)
  if (isNaN(d.getTime())) return { date: '', time: '' }
  const date = d.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })
  return { date, time }
}
/** Date locale Belgique au format AAAA-MM-JJ (pour comparer à from/to). */
function localYmd(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  return p   // en-CA → AAAA-MM-JJ
}
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'superadmin') {
    return NextResponse.json({ error: 'Réservé au superadmin' }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)
  const from = (searchParams.get('from') || '').slice(0, 10)   // AAAA-MM-JJ
  const to   = (searchParams.get('to')   || '').slice(0, 10)

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('incoming_missions')
    .select(`mission_number, status, vehicle_plate, vehicle_brand, vehicle_model,
             client_name, client_address, client_city, client_phone, client_email,
             payment_method, no_charge_at, amount_to_collect, completed_at, parked_at`)
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
    .sort((a: any, b: any) => String(a._ref).localeCompare(String(b._ref)))

  const header = ['Date', 'Heure', 'Marque', 'Modèle', 'Immatriculation', 'Nom', 'Adresse', 'Ville', 'Téléphone', 'Email', 'Montant (€)', 'Paiement']
  const aoa: any[][] = [header]
  for (const m of rows) {
    const { date, time } = fmtLocal(m._ref)
    const paiement = m.no_charge_at ? 'Sans frais'
      : m.payment_method === 'unpaid' ? 'PAS PAYÉ'
      : 'Payé'
    aoa.push([
      date, time, m.vehicle_brand || '', m.vehicle_model || '', m.vehicle_plate || '',
      m.client_name || '', m.client_address || '', m.client_city || '',
      m.client_phone || '', m.client_email || '',
      m.amount_to_collect != null ? Number(m.amount_to_collect) : '',
      paiement,
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 11 }, { wch: 7 }, { wch: 14 }, { wch: 14 }, { wch: 13 },
    { wch: 22 }, { wch: 28 }, { wch: 16 }, { wch: 15 }, { wch: 26 }, { wch: 11 }, { wch: 11 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Enlèvements')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const fname = `francofolies_enlevements_${from || 'debut'}_${to || 'fin'}.xlsx`
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fname}"`,
    },
  })
}
