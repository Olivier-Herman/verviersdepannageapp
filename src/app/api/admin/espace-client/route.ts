// /api/admin/espace-client — gestion de l'espace client (Olivier 10/10/2026) : sociétés, comptes,
// invitations, test de l'appel au dépannage. Réservé admin / superadmin.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { normEmail } from '@/lib/espace/session'
import { envoyerInvitation } from '@/lib/espace/mails'
import { appelerDepannage } from '@/lib/espace/demande'

export const dynamic = 'force-dynamic'

async function admin() {
  const s = await getServerSession(authOptions)
  const u = s?.user as any
  const roles = [u?.role, ...(u?.roles || [])]
  return u && roles.some((r: string) => r === 'admin' || r === 'superadmin') ? u : null
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const [soc, comptes, appels, sources, garages] = await Promise.all([
    sb.from('espace_societes').select('*').order('nom'),
    sb.from('espace_comptes').select('id, nom, emails, role, societe_ids, peut_inviter, invite_par, active, derniere_connexion, created_at').order('created_at'),
    sb.from('espace_appels').select('id, mission_id, status, detail, created_at').order('created_at', { ascending: false }).limit(15),
    sb.from('mission_source_catalog').select('key, label, default_billed_to_id, default_billed_to_name').eq('active', true).order('label'),
    sb.from('espace_garages').select('id, societe_id, nom, adresse, ordre').order('ordre'),
  ])
  return NextResponse.json({ societes: soc.data || [], comptes: comptes.data || [], appels: appels.data || [], sources: sources.data || [], garages: garages.data || [] })
}

export async function POST(req: Request) {
  const u = await admin()
  if (!u) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const sb = createAdminClient()

  if (b.action === 'societe') {
    const row = { nom: String(b.nom || '').trim(), odoo_partner_id: Number(b.odoo_partner_id), source_key: String(b.source_key || '').trim(), couleur: b.couleur || null, appel_audio: b.appel_audio || null, active: b.active !== false }
    if (!row.nom || !row.odoo_partner_id || !row.source_key) return NextResponse.json({ error: 'Nom, client facturé et source obligatoires.' }, { status: 400 })
    const r = b.id ? await sb.from('espace_societes').update(row).eq('id', b.id) : await sb.from('espace_societes').insert(row)
    return r.error ? NextResponse.json({ error: r.error.message }, { status: 400 }) : NextResponse.json({ ok: true })
  }

  if (b.action === 'compte') {
    const emails = [...new Set((Array.isArray(b.emails) ? b.emails : String(b.emails || '').split(/[\s,;]+/)).map(normEmail).filter((e: string) => e.includes('@')))]
    const row = { nom: String(b.nom || '').trim(), emails, role: b.role, societe_ids: Array.isArray(b.societe_ids) ? b.societe_ids : [], peut_inviter: b.role === 'gestionnaire' || b.peut_inviter === true, updated_at: new Date().toISOString() }
    if (!row.nom || !emails.length || !['societe', 'gestionnaire', 'collaborateur'].includes(row.role) || !row.societe_ids.length) return NextResponse.json({ error: 'Nom, adresse(s), rôle et société(s) obligatoires.' }, { status: 400 })
    if (row.role === 'collaborateur' && row.societe_ids.length !== 1) return NextResponse.json({ error: 'Un collaborateur est rattaché à une seule société.' }, { status: 400 })
    const { data: deja } = await sb.from('espace_comptes').select('id').overlaps('emails', emails)
    if ((deja || []).some((d: any) => d.id !== b.id)) return NextResponse.json({ error: 'Une de ces adresses a déjà un accès.' }, { status: 409 })
    const r = b.id ? await sb.from('espace_comptes').update(row).eq('id', b.id) : await sb.from('espace_comptes').insert(row)
    return r.error ? NextResponse.json({ error: r.error.message }, { status: 400 }) : NextResponse.json({ ok: true })
  }

  if (b.action === 'garage') {
    const nom = String(b.nom || '').trim(), adresse = String(b.adresse || '').trim()
    if (!b.societe_id || !nom || !adresse) return NextResponse.json({ error: 'Nom et adresse du garage obligatoires.' }, { status: 400 })
    const { count } = await sb.from('espace_garages').select('id', { count: 'exact', head: true }).eq('societe_id', b.societe_id)
    const lat = Number(b.lat), lng = Number(b.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: 'Adresse non localisée : vérifiez-la.' }, { status: 400 })
    const r = await sb.from('espace_garages').insert({ societe_id: b.societe_id, nom, adresse, lat, lng, ordre: (count || 0) + 1 })
    return r.error ? NextResponse.json({ error: r.error.message }, { status: 400 }) : NextResponse.json({ ok: true })
  }
  if (b.action === 'garage-suppr') {
    const r = await sb.from('espace_garages').delete().eq('id', b.id)
    return r.error ? NextResponse.json({ error: r.error.message }, { status: 400 }) : NextResponse.json({ ok: true })
  }

  if (b.action === 'actif') {
    const { data: c } = await sb.from('espace_comptes').select('session_version').eq('id', b.id).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 })
    await sb.from('espace_comptes').update({ active: !!b.actif, ...(b.actif ? {} : { session_version: c.session_version + 1 }), updated_at: new Date().toISOString() }).eq('id', b.id)
    return NextResponse.json({ ok: true })
  }

  if (b.action === 'inviter') {
    const { data: c } = await sb.from('espace_comptes').select('nom, emails, societe_ids, active').eq('id', b.id).maybeSingle()
    if (!c?.active) return NextResponse.json({ error: 'Compte introuvable ou coupé' }, { status: 404 })
    const { data: s } = await sb.from('espace_societes').select('nom').in('id', c.societe_ids)
    const to = normEmail(b.email) && c.emails.includes(normEmail(b.email)) ? normEmail(b.email) : c.emails[0]
    try { await envoyerInvitation(to, c.nom, 'Verviers Dépannage', (s || []).map((x: any) => x.nom).join(' et ')) }
    catch (e: any) { return NextResponse.json({ error: `Mail non parti : ${e?.message || e}` }, { status: 502 }) }
    return NextResponse.json({ ok: true, to })
  }

  if (b.action === 'tester-appel') {
    const { data: s } = await sb.from('espace_societes').select('*').eq('id', b.id).maybeSingle()
    if (!s) return NextResponse.json({ error: 'Société introuvable' }, { status: 404 })
    await appelerDepannage('00000000-0000-0000-0000-000000000000', s as any)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
