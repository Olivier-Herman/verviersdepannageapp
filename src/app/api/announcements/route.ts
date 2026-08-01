// src/app/api/announcements/route.ts
//
// Module Annonces (nouveautés de l'app).
// GET                       → annonce active non lue par le user (pour le modal /ma-paie)
// GET ?stats=1              → (RH/superadmin) suivi de lecture de l'annonce active
// POST {action:'seen', id}  → marque l'annonce lue par le user courant
// POST {action:'save', ...} → (superadmin) crée/édite l'annonce (upsert par key)
// POST {action:'broadcast'|'test', key} → (superadmin) envoie in-app + push
//        broadcast = tous les travailleurs liés · test = à moi uniquement

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { isPersonnelStaff }          from '@/lib/rh-access'
import { sendNotification }          from '@/lib/notifications/send'

export const dynamic     = 'force-dynamic'
export const fetchCache  = 'force-no-store'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()

  // ── Suivi de lecture (RH/superadmin) ──────────────────────────────────
  if (req.nextUrl.searchParams.get('stats') === '1') {
    if (!isPersonnelStaff(u)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: ann } = await sb.from('announcements').select('*').eq('active', true).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (!ann) return NextResponse.json({ announcement: null, targets: [] })
    // Cible = travailleurs liés (personnel.user_id)
    const { data: pers } = await sb.from('personnel').select('id, name, user_id').not('user_id', 'is', null)
    const userIds = [...new Set((pers || []).map((p: any) => p.user_id))]
    const { data: reads } = await sb.from('announcement_reads').select('user_id, seen_at').eq('announcement_id', ann.id)
    const readMap = new Map((reads || []).map((r: any) => [r.user_id, r.seen_at]))
    const targets = (pers || []).map((p: any) => ({ name: p.name, seen_at: readMap.get(p.user_id) || null }))
      .sort((a, b) => (a.seen_at ? 0 : 1) - (b.seen_at ? 0 : 1) || a.name.localeCompare(b.name))
    return NextResponse.json({ announcement: ann, targets, total: userIds.length, read: targets.filter(t => t.seen_at).length })
  }

  // ── Annonce active non lue (pour le modal) ────────────────────────────
  const { data: ann } = await sb.from('announcements').select('*').eq('active', true).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (!ann) return NextResponse.json({ announcement: null })
  const { data: seen } = await sb.from('announcement_reads').select('announcement_id').eq('announcement_id', ann.id).eq('user_id', u.id).maybeSingle()
  if (seen) return NextResponse.json({ announcement: null })
  return NextResponse.json({ announcement: { id: ann.id, key: ann.key, emoji: ann.emoji, title: ann.title, body: ann.body, action_url: ann.action_url, cta_label: ann.cta_label } })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  // ── Marquer lu (tout user) ────────────────────────────────────────────
  if (action === 'seen') {
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id manquant' }, { status: 400 })
    await sb.from('announcement_reads').upsert({ announcement_id: id, user_id: u.id, seen_at: new Date().toISOString() }, { onConflict: 'announcement_id,user_id' })
    return NextResponse.json({ ok: true })
  }

  // ── Actions superadmin ────────────────────────────────────────────────
  if (u.role !== 'superadmin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (action === 'save') {
    const key = String(body.key || '').trim()
    if (!key) return NextResponse.json({ error: 'key manquante' }, { status: 400 })
    const row = {
      key,
      emoji:      String(body.emoji || '✨'),
      title:      String(body.title || '').trim(),
      body:       String(body.body || '').trim(),
      action_url: String(body.action_url || '/ma-paie'),
      cta_label:  String(body.cta_label || 'Découvrir'),
      active:     body.active !== false,
      updated_at: new Date().toISOString(),
    }
    const { error } = await sb.from('announcements').upsert(row, { onConflict: 'key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'broadcast' || action === 'test') {
    const key = String(body.key || 'mes_prestations')
    const { data: ann } = await sb.from('announcements').select('*').eq('key', key).maybeSingle()
    if (!ann) return NextResponse.json({ error: 'Annonce introuvable' }, { status: 404 })

    // Cible : moi seul (test) ou tous les travailleurs liés (broadcast)
    let userIds: string[]
    if (action === 'test') {
      userIds = [u.id]
    } else {
      const { data: pers } = await sb.from('personnel').select('user_id').not('user_id', 'is', null)
      userIds = [...new Set((pers || []).map((p: any) => p.user_id as string))]
    }

    const payload = {
      title:      `${ann.emoji} ${ann.title}`,
      body:       ann.body.length > 140 ? ann.body.slice(0, 137) + '…' : ann.body,
      action_url: ann.action_url,
    }
    let sent = 0, failed = 0
    await Promise.all(userIds.map(async (id) => {
      const r = await sendNotification(id, 'feature_announcement', payload).catch(() => ({ ok: false }))
      if ((r as any)?.ok) sent++; else failed++
    }))
    return NextResponse.json({ ok: true, mode: action, targeted: userIds.length, sent, failed })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
