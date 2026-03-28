// src/app/api/documents/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase  = createAdminClient()
  const isAdmin   = ['admin', 'superadmin', 'dispatcher'].includes((session.user as any).role)
  const userId    = req.nextUrl.searchParams.get('userId')

  const { data: me } = await supabase
    .from('users').select('id').eq('email', session.user.email!).single()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  // Admin peut voir les docs d'un autre utilisateur
  const targetId = (isAdmin && userId) ? userId : me.id

  const { data, error } = await supabase
    .from('driver_documents')
    .select('*')
    .eq('user_id', targetId)
    .order('doc_type')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const body     = await req.json()
  const { docType, expiresAt, fileUrl, fileUrlVerso, notes } = body

  if (!docType || !expiresAt || !fileUrl) {
    return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 })
  }

  const { data: me } = await supabase
    .from('users').select('id').eq('email', session.user.email!).single()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  // Upsert — un seul document actif par type
  const { data, error } = await supabase
    .from('driver_documents')
    .upsert({
      user_id:        me.id,
      doc_type:       docType,
      expires_at:     expiresAt,
      file_url:       fileUrl,
      file_url_verso: fileUrlVerso ?? null,
      notes:          notes ?? null,
      updated_at:     new Date().toISOString(),
      // Réinitialiser les alertes si le document est renouvelé
      alert_6m_sent: false,
      alert_3m_sent: false,
      alert_1m_sent: false,
    }, { onConflict: 'user_id,doc_type' })
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, document: data })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const { id }   = await req.json()

  const { data: me } = await supabase
    .from('users').select('id').eq('email', session.user.email!).single()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  const { error } = await supabase
    .from('driver_documents')
    .delete()
    .eq('id', id)
    .eq('user_id', me.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
