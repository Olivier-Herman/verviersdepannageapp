// src/app/api/missions/[id]/vr-contrat/route.ts — contrat VR VAB côté chauffeur et bureau (Olivier 23/10/2026).
//
// GET   → { contrat, avancement, lignes, photos{clé:url}, signature_url } — dernier contrat de la mission
// POST  → crée (ou reprend s'il est encore ouvert) le lien client : { id, url, expires_at }
// PATCH { vehicule: { proprete_int, proprete_ext, km, carburant } } → état du véhicule prêté, éditable
//        pendant que le client remplit sa partie.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { VR_BUCKET, VR_TTL_MIN, VR_PHOTOS, PROPRETES, CARBURANTS, avancement, lignesComet, finaliserSiComplet } from '@/lib/vab/vr-contrat'

export const dynamic = 'force-dynamic'
const json = (b: any, status = 200) => NextResponse.json(b, { status })

async function acces(missionId: string) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.email) return { err: json({ error: 'Non autorisé' }, 401) }
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, name, role, roles').eq('email', u.email).maybeSingle()
  const { data: m } = await sb.from('incoming_missions').select('id, mission_number, assigned_to, vab_vr, vehicle_plate').eq('id', missionId).maybeSingle()
  if (!me || !m) return { err: json({ error: 'Mission introuvable' }, 404) }
  const bureau = [me.role, ...(me.roles || [])].some((r: string) => ['dispatcher', 'admin', 'superadmin'].includes(r))
  if (m.assigned_to !== me.id && !bureau) return { err: json({ error: 'Mission non attribuée' }, 403) }
  return { sb, me, m }
}

const dernier = (sb: any, missionId: string) => sb.from('vr_contrats').select('*').eq('mission_id', missionId)
  .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle()

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const a = await acces(params.id); if ('err' in a) return a.err
  const { data: c } = await dernier(a.sb, params.id)
  if (!c) return json({ contrat: null })
  const signe = async (p?: string | null) => p ? (await a.sb.storage.from(VR_BUCKET).createSignedUrl(p, 3600)).data?.signedUrl || null : null
  const photos: Record<string, string | null> = {}
  for (const k of VR_PHOTOS) photos[k] = await signe(c.photos?.[k])
  const expire = c.status === 'ouvert' && new Date(c.expires_at).getTime() < Date.now()
  return json({
    contrat: { ...c, expire, url: `${process.env.NEXT_PUBLIC_APP_URL || ''}/vr/${c.id}` },
    avancement: avancement(c), lignes: lignesComet(c.client), photos, signature_url: await signe(c.signature_path),
  })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await acces(params.id); if ('err' in a) return a.err
  if (!a.m.vab_vr) return json({ error: 'Pas de véhicule de remplacement sur cette mission' }, 409)
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const expires = new Date(Date.now() + VR_TTL_MIN * 60_000).toISOString()
  const { data: c } = await dernier(a.sb, params.id)
  // Un contrat déjà entamé est repris (le chauffeur rouvre le QR) ; son lien est prolongé s'il n'est pas signé.
  if (c?.status === 'complet') return json({ id: c.id, url: `${origin}/vr/${c.id}`, expires_at: c.expires_at, complet: true })
  if (c) {
    if (!c.signed_at) await a.sb.from('vr_contrats').update({ expires_at: expires, updated_at: new Date().toISOString() }).eq('id', c.id)
    return json({ id: c.id, url: `${origin}/vr/${c.id}`, expires_at: c.signed_at ? c.expires_at : expires })
  }
  const { data: row, error } = await a.sb.from('vr_contrats').insert({ mission_id: params.id, created_by: a.me.id, expires_at: expires }).select('id').single()
  if (error || !row) return json({ error: error?.message || 'Création impossible' }, 500)
  await a.sb.from('mission_logs').insert({ mission_id: params.id, actor_id: a.me.id, action: 'vab_vr_contrat_ouvert',
    notes: `Contrat du véhicule de remplacement ouvert par ${a.me.name || 'le chauffeur'} (QR montré au client).` }).then(() => {}, () => {})
  return json({ id: row.id, url: `${origin}/vr/${row.id}`, expires_at: expires })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const a = await acces(params.id); if ('err' in a) return a.err
  const b = await req.json().catch(() => ({})) as any
  const { data: c } = await dernier(a.sb, params.id)
  if (!c) return json({ error: 'Aucun contrat ouvert' }, 404)
  const bureau = [a.me.role, ...(a.me.roles || [])].some((r: string) => ['dispatcher', 'admin', 'superadmin'].includes(r))
  // Le bureau a recopié le contrat dans Comet (en attendant l'encodage automatique).
  if (b?.comet === 'encode' || b?.comet === 'a_encoder') {
    if (!bureau) return json({ error: 'Réservé au bureau' }, 403)
    await a.sb.from('vr_contrats').update({ comet_status: b.comet, updated_at: new Date().toISOString() }).eq('id', c.id)
    if (b.comet === 'encode') await a.sb.from('mission_logs').insert({ mission_id: params.id, actor_id: a.me.id, action: 'vab_vr_contrat_comet',
      notes: `Contrat du véhicule de remplacement encodé dans Comet par ${a.me.name || 'le bureau'}.` }).then(() => {}, () => {})
    return json({ ok: true })
  }
  if (c.status === 'complet' && !bureau) return json({ error: 'Contrat déjà complet : une correction se fait au bureau' }, 409)
  const v = b?.vehicule || {}
  const vehicule = { ...(c.vehicule || {}) }
  if ('proprete_int' in v) vehicule.proprete_int = (PROPRETES as readonly string[]).includes(v.proprete_int) ? v.proprete_int : null
  if ('proprete_ext' in v) vehicule.proprete_ext = (PROPRETES as readonly string[]).includes(v.proprete_ext) ? v.proprete_ext : null
  if ('km' in v) { const n = Math.round(Number(String(v.km ?? '').replace(/[^\d]/g, ''))); vehicule.km = n > 0 && n < 2_000_000 ? n : null }
  if ('carburant' in v) vehicule.carburant = (CARBURANTS as readonly number[]).includes(Number(v.carburant)) && v.carburant !== null ? Number(v.carburant) : null
  await a.sb.from('vr_contrats').update({ vehicule, updated_at: new Date().toISOString() }).eq('id', c.id)
  await finaliserSiComplet(a.sb, c.id)
  return json({ ok: true, vehicule })
}
