// /api/admin/assistance-vehicules — véhicules des clients VD Assistance (Olivier 10/10/2026). Le client ne change
// jamais le garage d'un véhicule ; c'est le dispatch qui le réaffecte ici.
//   GET ?q=          → derniers véhicules (filtre plaque, nom, mail)
//   POST { id, garageId } → réaffecte le véhicule à un autre garage partenaire
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { SOC_COLS, avertirGarage, type SocieteClients } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

async function autorise() {
  const s = await getServerSession(authOptions)
  const u = s?.user as any
  const roles = [u?.role, ...(u?.roles || [])]
  return u && roles.some((r: string) => ['admin', 'superadmin', 'dispatcher'].includes(r)) ? u : null
}

export async function GET(req: Request) {
  if (!(await autorise())) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const q = String(new URL(req.url).searchParams.get('q') || '').trim().toLowerCase()
  const sb = createAdminClient()
  const { data: vehs } = await sb.from('espace_vehicules').select('id, client_id, societe_id, garage_id, plaque, marque, modele, assistance, created_at, garage_change_par, garage_change_le')
    .eq('active', true).order('created_at', { ascending: false }).limit(300)
  const cids = Array.from(new Set((vehs || []).map(v => v.client_id)))
  const [{ data: clients }, { data: garages }, { data: socs }] = await Promise.all([
    cids.length ? sb.from('espace_clients').select('id, prenom, nom, email, tel').in('id', cids) : Promise.resolve({ data: [] as any[] }),
    sb.from('espace_garages').select('id, societe_id, nom').order('ordre'),
    sb.from('espace_societes').select('id, nom, demo').eq('active', true).order('nom'),
  ])
  const rows = (vehs || []).map(v => {
    const c = (clients || []).find(x => x.id === v.client_id)
    return { ...v, client: c ? `${c.prenom} ${c.nom}` : '', email: c?.email || '', tel: c?.tel || '', societe: (socs || []).find(s => s.id === v.societe_id)?.nom || '' }
  }).filter(v => !q || [v.plaque, v.client, v.email].some(x => String(x).toLowerCase().includes(q)))
  return NextResponse.json({
    vehicules: rows.slice(0, 100),
    garages: (garages || []).map(g => ({ id: g.id, nom: g.nom, societe: (socs || []).find(s => s.id === g.societe_id)?.nom || '' })).filter(g => g.societe),
  })
}

export async function POST(req: Request) {
  const u = await autorise()
  if (!u) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const sb = createAdminClient()
  const { data: v } = await sb.from('espace_vehicules').select('*').eq('id', String(b?.id || '')).eq('active', true).maybeSingle()
  const { data: g } = await sb.from('espace_garages').select('id, societe_id, nom').eq('id', String(b?.garageId || '')).maybeSingle()
  if (!v || !g) return NextResponse.json({ error: 'Véhicule ou garage inconnu' }, { status: 404 })
  if (g.id === v.garage_id) return NextResponse.json({ ok: true })
  const now = new Date().toISOString()
  const autreSociete = g.societe_id !== v.societe_id
  // Nouveau garage = nouvelle décision de prise en charge : c'est lui qui coche l'assistance.
  await sb.from('espace_vehicules').update({
    garage_id: g.id, societe_id: g.societe_id, garage_change_par: u.name || u.email || 'dispatch', garage_change_le: now, updated_at: now,
    ...(autreSociete ? { assistance: false, assistance_par: null, assistance_le: null } : {}),
  }).eq('id', v.id)
  if (autreSociete) {
    const [{ data: so }, { data: c }] = await Promise.all([
      sb.from('espace_societes').select(SOC_COLS).eq('id', g.societe_id).maybeSingle(),
      sb.from('espace_clients').select('*').eq('id', v.client_id).maybeSingle(),
    ])
    if (so && c) await avertirGarage(so as SocieteClients, c, v, g.nom).catch(() => {})
  }
  return NextResponse.json({ ok: true })
}
