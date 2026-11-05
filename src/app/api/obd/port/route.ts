// /api/obd/port — emplacement de la prise OBD (Olivier 06/11/2026, maquette validée). Préversion : drapeau obd_diagnostic.
//   GET ?q=Volkswagen Golf 7 → l'emplacement connu, sinon Sam cherche et l'enregistre « à confirmer ».
//   POST { id, action: 'trouvee' }                         → le chauffeur confirme
//   POST { q, id?, action: 'ailleurs', zone (fr, sq), image?, mime? } → le chauffeur corrige (photo facultative)
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { obdAccess } from '@/lib/obd/server'
import { modelKey, samFindPort } from '@/lib/obd/port'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const BUCKET = 'mission-remarks'

async function publicRow(sb: any, r: any) {
  const photo = r.photo_path ? (await sb.storage.from(BUCKET).createSignedUrl(r.photo_path, 3600)).data?.signedUrl || null : null
  let source: string | null = null
  try { source = r.source_url ? new URL(r.source_url).hostname.replace(/^www\./, '') : null } catch {}
  return { id: r.id, label: r.label, fr: r.fr, sq: r.sq, status: r.status, confirmations: (r.confirmed_by || []).length, source, photo }
}

async function findKnown(sb: any, key: string) {
  const { data } = await sb.from('obd_port_locations').select('*').or(`model_key.eq."${key}",aliases.cs.{"${key}"}`).limit(1)
  return data?.[0] || null
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!(await obdAccess(session?.user))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const q = String(new URL(req.url).searchParams.get('q') || '').trim().slice(0, 80)
  const key = modelKey(q)
  if (key.length < 2) return NextResponse.json({ ok: true, location: null })
  const sb = createAdminClient()
  const known = await findKnown(sb, key)
  if (known) return NextResponse.json({ ok: true, location: await publicRow(sb, known) })
  const s = await samFindPort(q).catch(e => { console.warn('[obd/port]', e?.message); return null })
  if (!s) return NextResponse.json({ ok: true, location: null })
  // Même modèle déjà connu sous un autre nom (« Golf 7 » / « Volkswagen Golf 7 ») : on ajoute l'alias.
  const label = `${s.marque} ${s.modele}`.trim()
  const canon = modelKey(label)
  const twin = await findKnown(sb, canon)
  if (twin) {
    await sb.from('obd_port_locations').update({ aliases: [...new Set([...(twin.aliases || []), key])] }).eq('id', twin.id)
    return NextResponse.json({ ok: true, location: await publicRow(sb, twin) })
  }
  const { data: row, error } = await sb.from('obd_port_locations').insert({ model_key: canon, aliases: key === canon ? [] : [key], label, fr: s.fr, sq: s.sq, source_url: s.source_url }).select('*').single()
  if (error) return NextResponse.json({ ok: true, location: { id: null, label, fr: s.fr, sq: s.sq, status: 'a_confirmer', confirmations: 0, source: null, photo: null } })
  return NextResponse.json({ ok: true, location: await publicRow(sb, row) })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!(await obdAccess(user))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const sb = createAdminClient()
  const now = new Date().toISOString()

  if (b.action === 'trouvee') {
    const { data: r } = await sb.from('obd_port_locations').select('*').eq('id', String(b.id || '')).maybeSingle()
    if (!r) return NextResponse.json({ error: 'Emplacement introuvable' }, { status: 404 })
    await sb.from('obd_port_locations').update({ status: 'verifie', confirmed_by: [...new Set([...(r.confirmed_by || []), user.id])], updated_at: now }).eq('id', r.id)
    return NextResponse.json({ ok: true })
  }

  if (b.action === 'ailleurs') {
    const fr = String(b.fr || '').trim().slice(0, 200), sq = String(b.sq || '').trim().slice(0, 200)
    if (!fr || !sq) return NextResponse.json({ error: 'Emplacement requis' }, { status: 400 })
    let r: any = null
    if (b.id) r = (await sb.from('obd_port_locations').select('*').eq('id', String(b.id)).maybeSingle()).data
    const key = r?.model_key || modelKey(String(b.q || ''))
    if (key.length < 2) return NextResponse.json({ error: 'Modèle requis' }, { status: 400 })
    let photo_path: string | null = r?.photo_path || null
    const data = String(b.image || '').replace(/^data:[^,]+,/, '')
    if (data.length > 1000) {
      const p = `obd-prises/${key.replace(/\s+/g, '-')}-${Date.now()}.jpg`
      const up = await sb.storage.from(BUCKET).upload(p, Buffer.from(data, 'base64'), { contentType: 'image/jpeg' })
      if (!up.error) photo_path = p
    }
    // La correction d'un chauffeur remplace l'indication : les anciennes confirmations portaient sur l'autre endroit.
    const vals = { fr, sq, status: 'verifie', confirmed_by: [user.id], source_url: null, photo_path, updated_at: now }
    if (r) await sb.from('obd_port_locations').update(vals).eq('id', r.id)
    else await sb.from('obd_port_locations').upsert({ model_key: key, label: String(b.q).slice(0, 80), ...vals }, { onConflict: 'model_key' })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
