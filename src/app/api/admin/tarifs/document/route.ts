// src/app/api/admin/tarifs/document/route.ts
//
// GET /api/admin/tarifs/document?path=<storage_path>
// Sert le PDF source d un tarif (depuis bucket tariff-documents).
// Superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function requireSuperadmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const role  = (session.user as any).role  || ''
  const roles = (session.user as any).roles || [role]
  const allRoles: string[] = Array.isArray(roles) ? roles : [roles]
  if (!allRoles.includes('superadmin')) return null
  return session
}

export async function GET(req: Request) {
  const session = await requireSuperadmin()
  if (!session) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const path = searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path requis' }, { status: 400 })

  const sb = createAdminClient()

  // Genere une signed URL courte (5 min) et redirige
  const { data, error } = await sb.storage.from('tariff-documents').createSignedUrl(path, 300)
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message || 'PDF introuvable' }, { status: 404 })
  }

  return NextResponse.redirect(data.signedUrl)
}
