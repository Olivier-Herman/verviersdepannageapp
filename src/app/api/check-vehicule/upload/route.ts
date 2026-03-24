import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase  = createAdminClient()
  const formData  = await req.formData()
  const file      = formData.get('file') as File | null
  const checkId   = formData.get('checkId') as string

  if (!file || !checkId) return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })

  const ext      = file.name.split('.').pop() || 'jpg'
  const filename = `${checkId}/${Date.now()}.${ext}`
  const buffer   = Buffer.from(await file.arrayBuffer())

  const { error } = await supabase.storage
    .from('check-photos')
    .upload(filename, buffer, { contentType: file.type, upsert: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = supabase.storage.from('check-photos').getPublicUrl(filename)

  return NextResponse.json({ url: publicUrl })
}
