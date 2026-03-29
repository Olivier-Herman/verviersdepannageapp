// src/app/api/missions/photos-upload/route.ts
import { NextRequest, NextResponse } from 'next/server'

export const config = {
  api: { bodyParser: false },
}

// Augmenter la limite pour les photos
export const maxDuration = 60
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()

  const formData = await req.formData()
  const missionId = formData.get('mission_id') as string
  if (!missionId) return NextResponse.json({ error: 'mission_id manquant' }, { status: 400 })

  const files = formData.getAll('files') as File[]
  if (!files.length) return NextResponse.json({ error: 'Aucun fichier' }, { status: 400 })

  const urls: string[] = []
  for (const file of files) {
    const ext  = file.name.split('.').pop() || 'jpg'
    const path = `${missionId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error } = await supabase.storage
      .from('mission-photos')
      .upload(path, buffer, { contentType: file.type || 'image/jpeg', upsert: true })

    if (error) {
      console.error('[photos-upload]', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data } = supabase.storage.from('mission-photos').getPublicUrl(path)
    urls.push(data.publicUrl)
  }

  return NextResponse.json({ urls })
}
