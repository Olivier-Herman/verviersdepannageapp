// /api/obd/moteurs — liste des moteurs d'un modèle (Olivier 07/11/2026, maquette validée). Préversion : drapeau obd_diagnostic.
//   GET ?marque=Opel&modele=Combo&annee=2020&carburant=essence&source=voiture → liste gardée, sinon Sam cherche et l'enregistre « à confirmer ».
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { obdAccess } from '@/lib/obd/server'
import { modelKey } from '@/lib/obd/port'
import { familleDepuisLecture, filtrerMoteurs, samFindEngines } from '@/lib/obd/moteurs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!(await obdAccess(session?.user))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const u = new URL(req.url).searchParams
  const marque = String(u.get('marque') || '').trim().slice(0, 40)
  const modele = String(u.get('modele') || '').replace(/\s*\?\s*$/, '').trim().slice(0, 60)   // « Combo ? » = modèle estimé
  const annee = Number(u.get('annee')) || null
  if (!marque || !modele) return NextResponse.json({ ok: true, id: null, options: [] })
  const key = modelKey(`${marque} ${modele} ${annee || ''}`)
  const sb = createAdminClient()
  let { data: row } = await sb.from('obd_engine_options').select('*').eq('model_key', key).maybeSingle()
  if (!row) {
    const s = await samFindEngines(marque, modele, annee).catch(e => { console.warn('[obd/moteurs]', e?.message); return null })
    if (!s?.options.length) return NextResponse.json({ ok: true, id: null, options: [] })
    await sb.from('obd_engine_options').upsert({ model_key: key, label: `${marque} ${modele}${annee ? ` ${annee}` : ''}`, options: s.options, source_url: s.source_url }, { onConflict: 'model_key', ignoreDuplicates: true })
    row = (await sb.from('obd_engine_options').select('*').eq('model_key', key).maybeSingle()).data
    if (!row) return NextResponse.json({ ok: true, id: null, options: [] })
  }
  const options = filtrerMoteurs(row.options || [], familleDepuisLecture(u.get('carburant')), u.get('source'))
  return NextResponse.json({ ok: true, id: row.id, status: row.status, options: options.map(o => ({ id: o.id, label: o.label })) })
}
