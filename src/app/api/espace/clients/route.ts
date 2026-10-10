// /api/espace/clients — « Mes clients » du garage (Olivier 10/10/2026).
//   GET   → par société : option, lien, clients inscrits, commission du mois.
//   PATCH { societeId, actif }        → activer / couper l'option (gestionnaire seulement)
//   PATCH { vehiculeId, assistance }  → classer un véhicule (gestionnaire ou compte de la société)
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
    // Véhicules inscrits chez ce garage, avec leur propriétaire (Olivier 10/10/2026 : un client peut avoir plusieurs
    // véhicules, chacun relié à un garage ; la prise en charge se coche par véhicule).
    const { data: vehs } = await sb.from('espace_vehicules')
      .select('id, client_id, garage_id, plaque, marque, modele, assistance, assistance_le, created_at')
      .eq('societe_id', so.id).eq('active', true).order('created_at', { ascending: false })
    const cids = Array.from(new Set((vehs || []).map(x => x.client_id)))
    const { data: clients } = cids.length
      ? await sb.from('espace_clients').select('id, prenom, nom, tel, email, adresse, verifie_le').in('id', cids).eq('active', true)
      : { data: [] as any[] }
    const vids = (vehs || []).map(x => x.id)
    const { data: cmds } = vids.length
      ? await sb.from('incoming_missions').select('espace_vehicule_id').in('espace_vehicule_id', vids).neq('status', 'cancelled')
      : { data: [] as any[] }
    const nbCmd = new Map<string, number>()
    for (const m of cmds || []) nbCmd.set(m.espace_vehicule_id, (nbCmd.get(m.espace_vehicule_id) || 0) + 1)
    const { data: garages } = await sb.from('espace_garages').select('id, nom').eq('societe_id', so.id).order('ordre')
    out.push({
      id: so.id, nom: so.nom, couleur: so.couleur, actif: so.clients_actif,
      lien: `${base.replace(/\/$/, '')}/d/${so.clients_slug}`,
      vehicules: (vehs || []).flatMap(x => {
        const c = (clients || []).find(y => y.id === x.client_id)
        if (!c?.verifie_le) return []
        return [{ ...x, garage: (garages || []).find(g => g.id === x.garage_id)?.nom || '', client: { prenom: c.prenom, nom: c.nom, tel: c.tel, email: c.email, adresse: c.adresse }, commandes: nbCmd.get(x.id) || 0 }]
      }),
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
  if (b?.vehiculeId) {
    // Le garage classe le véhicule (assistance ou pas). Il ne change pas son garage : seul notre dispatch le fait.
    const { data: v } = await sb.from('espace_vehicules').select('id, societe_id').eq('id', b.vehiculeId).maybeSingle()
    if (!v || !mesSocietes.some(x => x.id === v.societe_id)) return NextResponse.json({ error: 'Véhicule inconnu' }, { status: 404 })
    await sb.from('espace_vehicules').update({ assistance: !!b.assistance, assistance_par: s.compte.nom, assistance_le: now, updated_at: now }).eq('id', v.id)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Demande inconnue' }, { status: 400 })
}
