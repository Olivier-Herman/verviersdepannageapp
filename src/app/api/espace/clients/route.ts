// /api/espace/clients — « Mes clients » du garage (Olivier 10/10/2026).
//   GET   → par société : option, lien, clients inscrits, commission du mois.
//   PATCH { societeId, actif }        → activer / couper l'option (gestionnaire seulement)
//   PATCH { clientId, assistance }    → classer un client (gestionnaire ou compte de la société)
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getEspaceSession } from '@/lib/espace/session'
import { commissionDuMois, type SocieteClients } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

const moisCourant = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }).slice(0, 7)

async function societesClients(ids: string[]): Promise<SocieteClients[]> {
  const { data } = await createAdminClient().from('espace_societes')
    .select('id, nom, odoo_partner_id, source_key, appel_audio, couleur, clients_actif, clients_slug, clients_source_key')
    .in('id', ids).eq('active', true).not('clients_source_key', 'is', null).order('nom')
  return (data || []) as SocieteClients[]
}

export async function GET(req: Request) {
  const s = await getEspaceSession()
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  if (s.compte.role === 'collaborateur') return NextResponse.json({ error: 'Accès réservé au garage' }, { status: 403 })
  const base = process.env.NEXTAUTH_URL || new URL(req.url).origin
  const sb = createAdminClient()
  const societes = await societesClients(s.societes.map(x => x.id))
  const mois = moisCourant()
  const out = []
  for (const so of societes) {
    const { data: clients } = await sb.from('espace_clients')
      .select('id, prenom, nom, tel, email, adresse, plaque, marque, modele, assistance, assistance_par, assistance_le, verifie_le, created_at, garage_id')
      .eq('societe_id', so.id).eq('active', true).not('verifie_le', 'is', null).order('created_at', { ascending: false })
    const ids = (clients || []).map(c => c.id)
    const { data: cmds } = ids.length
      ? await sb.from('incoming_missions').select('espace_client_id').in('espace_client_id', ids).neq('status', 'cancelled')
      : { data: [] as any[] }
    const nbCmd = new Map<string, number>()
    for (const m of cmds || []) nbCmd.set(m.espace_client_id, (nbCmd.get(m.espace_client_id) || 0) + 1)
    const { data: garages } = await sb.from('espace_garages').select('id, nom').eq('societe_id', so.id).order('ordre')
    out.push({
      garages: garages || [],
      id: so.id, nom: so.nom, couleur: so.couleur, actif: so.clients_actif,
      lien: `${base.replace(/\/$/, '')}/d/${so.clients_slug}`,
      clients: (clients || []).map(c => ({ ...c, commandes: nbCmd.get(c.id) || 0 })),
      commission: await commissionDuMois(so, mois),
    })
  }
  return NextResponse.json({ gestionnaire: s.compte.role === 'gestionnaire', mois, societes: out })
}

export async function PATCH(req: Request) {
  const s = await getEspaceSession()
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  if (s.compte.role === 'collaborateur') return NextResponse.json({ error: 'Accès réservé au garage' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const sb = createAdminClient()
  const now = new Date().toISOString()
  const mesSocietes = await societesClients(s.societes.map(x => x.id))

  if (b?.societeId) {
    if (s.compte.role !== 'gestionnaire') return NextResponse.json({ error: 'Seul le gestionnaire active ou coupe ce service.' }, { status: 403 })
    if (!mesSocietes.some(x => x.id === b.societeId)) return NextResponse.json({ error: 'Société inconnue' }, { status: 404 })
    await sb.from('espace_societes').update({ clients_actif: !!b.actif, clients_actif_par: s.compte.nom, clients_actif_le: now }).eq('id', b.societeId)
    return NextResponse.json({ ok: true })
  }
  if (b?.clientId) {
    const { data: c } = await sb.from('espace_clients').select('id, societe_id').eq('id', b.clientId).maybeSingle()
    if (!c || !mesSocietes.some(x => x.id === c.societe_id)) return NextResponse.json({ error: 'Client inconnu' }, { status: 404 })
    if ('garageId' in b) {
      const { data: g } = await sb.from('espace_garages').select('id').eq('id', b.garageId).eq('societe_id', c.societe_id).maybeSingle()
      if (!g) return NextResponse.json({ error: 'Garage inconnu' }, { status: 400 })
      await sb.from('espace_clients').update({ garage_id: g.id, updated_at: now }).eq('id', c.id)
      return NextResponse.json({ ok: true })
    }
    await sb.from('espace_clients').update({ assistance: !!b.assistance, assistance_par: s.compte.nom, assistance_le: now, updated_at: now }).eq('id', c.id)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Demande inconnue' }, { status: 400 })
}
