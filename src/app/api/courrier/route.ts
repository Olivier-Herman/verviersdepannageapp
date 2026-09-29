// src/app/api/courrier/route.ts — module Courrier (Olivier 29/09/2026).
// GET  : à valider, traités aujourd'hui, registre, tâches, procédures retenues.
// POST : { source, pages:[{mime}] } → crée le courrier et rend une adresse d'envoi
//        signée par page (envoi direct au stockage : pas de plafond de 4,5 Mo).
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { courrierAccess } from '@/lib/courrier/access'

export const dynamic = 'force-dynamic'

/** Minuit à Bruxelles, aujourd'hui. */
const startOfDay = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]))
  const secs = (Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)
  return new Date(Date.now() - secs * 1000).toISOString()
}
const COLS = 'id, created_at, source, pages, status, error, reading, proposal, decision, decided_at, mission_id, sender_key'

export async function GET() {
  const a = await courrierAccess(); if (!a.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const since = startOfDay()
  const [todo, today, reg, tasks, rules, users] = await Promise.all([
    sb.from('courriers').select(COLS).in('status', ['reading', 'to_validate', 'error']).order('created_at', { ascending: true }).limit(100),
    sb.from('courriers').select(COLS).in('status', ['done', 'ignored']).gte('decided_at', since).order('decided_at', { ascending: false }).limit(100),
    sb.from('courriers').select(COLS).in('status', ['done', 'ignored']).order('decided_at', { ascending: false }).limit(200),
    sb.from('courrier_tasks').select('id, courrier_id, assignee_id, title, due_at, done_at, done_by, created_at').or(`done_at.is.null,done_at.gte.${since}`).order('due_at', { ascending: true }).limit(200),
    sb.from('courrier_rules').select('*').order('updated_at', { ascending: false }),
    sb.from('users').select('id, name'),
  ])
  const names: Record<string, string> = Object.fromEntries((users.data || []).map((u: any) => [u.id, u.name]))
  // Vignette : première page de chaque courrier affiché en liste.
  const shown = [...(todo.data || []), ...(today.data || [])]
  const paths = shown.map((c: any) => c.pages?.[0]?.mime?.startsWith('image/') ? c.pages[0].path : null).filter(Boolean) as string[]
  const signed = paths.length ? (await sb.storage.from('courrier').createSignedUrls(paths, 3600)).data || [] : []
  const thumb: Record<string, string> = Object.fromEntries(signed.filter((s: any) => s.signedUrl).map((s: any) => [s.path, s.signedUrl]))
  const withThumb = (c: any) => ({ ...c, thumb: c.pages?.[0] ? thumb[c.pages[0].path] || null : null, decided_by_name: names[c.decision?.by] || c.decision?.by_name || null })
  return NextResponse.json({
    me: a.userId,
    todo: (todo.data || []).map(withThumb), today: (today.data || []).map(withThumb),
    registre: (reg.data || []).map((c: any) => ({ ...c, decided_by_name: names[c.decision?.by] || null })),
    tasks: (tasks.data || []).map((t: any) => ({ ...t, assignee_name: names[t.assignee_id] || null, done_by_name: names[t.done_by] || null })),
    rules: (rules.data || []).map((r: any) => ({ ...r, updated_by_name: names[r.updated_by] || null })),
  })
}

export async function POST(req: Request) {
  const a = await courrierAccess(); if (!a.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const source = ['scan', 'photo', 'fichier'].includes(body.source) ? body.source : 'scan'
  const mimes: string[] = (Array.isArray(body.pages) ? body.pages : []).map((p: any) => String(p?.mime || '')).filter((m: string) => /^image\/(jpeg|png|webp)$|^application\/pdf$/.test(m)).slice(0, 30)
  if (!mimes.length) return NextResponse.json({ error: 'Aucune page (images ou PDF).' }, { status: 400 })
  const sb = createAdminClient()
  const { data: c, error } = await sb.from('courriers').insert({ created_by: a.userId, source, status: 'reading' }).select('id').single()
  if (error || !c) return NextResponse.json({ error: error?.message || 'Création impossible' }, { status: 500 })
  const pages = mimes.map((m, i) => ({ path: `${c.id}/page-${i + 1}.${m === 'application/pdf' ? 'pdf' : m.includes('png') ? 'png' : m.includes('webp') ? 'webp' : 'jpg'}`, mime: m }))
  const uploads = []
  for (const p of pages) {
    const { data: u, error: e } = await sb.storage.from('courrier').createSignedUploadUrl(p.path)
    if (e || !u) return NextResponse.json({ error: `Envoi impossible : ${e?.message}` }, { status: 500 })
    uploads.push({ path: p.path, token: u.token, signedUrl: u.signedUrl, mime: p.mime })
  }
  await sb.from('courriers').update({ pages }).eq('id', c.id)
  return NextResponse.json({ id: c.id, uploads })
}
