// GET /api/appels-police/chauffeurs?lat=&lng= — chauffeurs classés pour un appel police (même calcul que le « chauffeur
// proposé » : temps de route réels, jamais à vol d'oiseau ; sans itinéraire, pas d'estimation).
import { NextResponse } from 'next/server'
import { moi } from '@/lib/appels-police/server'
import { classerChauffeurs } from '@/lib/dispatch/proposition'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const u = await moi()
  if (!u?.dispatch) return NextResponse.json({ error: 'Réservé au dispatch' }, { status: 403 })
  const url = new URL(req.url), lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'))
  // « Voir tous les chauffeurs » : tous les comptes chauffeurs actifs, sans estimation.
  if (url.searchParams.get('tous') === '1') {
    const { createAdminClient } = await import('@/lib/supabase')
    const { data } = await createAdminClient().from('users').select('id, name').eq('active', true).or('role.eq.driver,roles.ov.{driver}').order('name')
    return NextResponse.json({ chauffeurs: (data || []).map((d: any) => ({ id: d.id, nom: d.name, eta_min: null, occupe: false, raison: '' })) })
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ chauffeurs: [] })
  const c = await classerChauffeurs(null, { retourDepot: true, but: { lat, lng } })
  if ('erreur' in c) return NextResponse.json({ error: c.erreur }, { status: 400 })
  const prio = (x: any) => x.priorite ?? Number.MAX_SAFE_INTEGER
  const liste = [...c.liste].sort((a, b) => (a.eta_min ?? 1e9) - (b.eta_min ?? 1e9) || prio(a) - prio(b))
  return NextResponse.json({ chauffeurs: liste.map(x => ({ id: x.id, nom: x.nom, eta_min: x.eta_min, occupe: x.occupe, raison: x.raison })) })
}
