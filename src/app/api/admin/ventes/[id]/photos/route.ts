// src/app/api/admin/ventes/[id]/photos/route.ts
//
// POST /api/admin/ventes/[id]/photos  → ajoute des photos à un lot (multipart)
//
// Un lot créé depuis une fiche hérite des photos du chauffeur ; un lot ajouté à
// la main n'en a aucune, et sans photo on ne publie pas. Même bucket que les
// missions (`mission-photos`, public), rangé sous `ventes/<lot>/` pour ne pas
// mélanger avec les photos d'intervention. Olivier 2026-08-20.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { sessionAccess }             from '@/lib/access'
import { createAdminClient }         from '@/lib/supabase'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const MAX_PHOTOS = 20

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const acc = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['ventes', 'facturation'] })
  if (!acc.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const sb = createAdminClient()
  const { data: sale } = await sb.from('vehicle_sales').select('id, photos').eq('id', params.id).maybeSingle()
  if (!sale) return NextResponse.json({ error: 'Lot introuvable' }, { status: 404 })

  const form  = await req.formData()
  const files = form.getAll('files') as File[]
  if (!files.length) return NextResponse.json({ error: 'Aucun fichier' }, { status: 400 })

  const current: string[] = Array.isArray(sale.photos) ? sale.photos : []
  if (current.length + files.length > MAX_PHOTOS) {
    return NextResponse.json({ error: `Maximum ${MAX_PHOTOS} photos par véhicule.` }, { status: 400 })
  }

  const urls: string[] = []
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: `« ${file.name} » n'est pas une image.` }, { status: 400 })
    }
    const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase().slice(0, 5)
    const path = `ventes/${params.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const { error } = await sb.storage.from('mission-photos')
      .upload(path, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type || 'image/jpeg', upsert: true,
      })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    urls.push(sb.storage.from('mission-photos').getPublicUrl(path).data.publicUrl)
  }

  const photos = [...current, ...urls]
  const { error } = await sb.from('vehicle_sales')
    .update({ photos, updated_at: new Date().toISOString() }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ photos })
}
