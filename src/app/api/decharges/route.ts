// src/app/api/decharges/route.ts
//
// GET : liste des types de decharges actifs, ordonnes pour l UI chauffeur.
// Fallback fige (DISCHARGE_TYPES de lib/decharges.ts) si la DB est vide ou
// en erreur — garantit que le chauffeur a toujours quelque chose a saisir.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { DISCHARGE_TYPES, type DischargeType } from '@/lib/decharges'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ types: [] }, { status: 401 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('discharge_types')
    .select('key, label, title, body, footnote, name_field_label, color, needs_comment, comment_label, needs_photos, photos_hint, needs_schema')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  if (error || !data || data.length === 0) {
    // Fallback fige : DB vide / non migree / erreur → garde l app fonctionnelle
    return NextResponse.json({ types: DISCHARGE_TYPES, source: 'fallback' })
  }

  const types: DischargeType[] = data.map((d: any) => ({
    key:            d.key,
    label:          d.label,
    title:          d.title,
    body:           d.body,
    footnote:       d.footnote ?? undefined,
    nameFieldLabel: d.name_field_label ?? undefined,
    color:          d.color,
    needsComment:   d.needs_comment,
    commentLabel:   d.comment_label ?? undefined,
    needsPhotos:    d.needs_photos,
    photosHint:     d.photos_hint ?? undefined,
    needsSchema:    d.needs_schema ?? false,
  }))

  return NextResponse.json({ types, source: 'db' })
}
