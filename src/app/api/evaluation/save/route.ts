// POST /api/evaluation/save
// Sauvegarde l evaluation d une fonction par un utilisateur (upsert).
// Olivier 2026-05-28 : a chaque sauvegarde, envoi mail a info@olivierherman.be
// pour qu Olivier suive l avancement du testeur en live.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendEmail }         from '@/lib/emails'

const NOTIFY_RECIPIENT = 'info@olivierherman.be'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  success: { label: '✅ Réussi',  color: '#10b981' },
  partial: { label: '⚠️ Partiel', color: '#f59e0b' },
  failed:  { label: '❌ Échoué',  color: '#ef4444' },
  skipped: { label: '⏭️ Passé',   color: '#9ca3af' },
}

function stars(n: number | null): string {
  if (n == null) return '<span style="color:#d1d5db">non noté</span>'
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n))
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const body = await req.json()
  const {
    function_id,
    function_label,
    status,
    ux_rating,
    ui_rating,
    comment,
    suggestion,
  } = body

  if (!function_id || !function_label || !status) {
    return NextResponse.json({ error: 'function_id, function_label, status requis' }, { status: 400 })
  }
  if (!['success', 'partial', 'failed', 'skipped'].includes(status)) {
    return NextResponse.json({ error: 'status invalide' }, { status: 400 })
  }

  const sb = createAdminClient()

  const { data, error } = await sb
    .from('evaluations')
    .upsert({
      user_id:        user.id,
      function_id:    String(function_id),
      function_label: String(function_label),
      status,
      ux_rating:      ux_rating != null ? Number(ux_rating) : null,
      ui_rating:      ui_rating != null ? Number(ui_rating) : null,
      comment:        comment?.trim() || null,
      suggestion:     suggestion?.trim() || null,
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'user_id,function_id' })
    .select()
    .single()

  if (error) {
    console.error('[evaluation/save]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Envoi mail live a Olivier (notifyRecipient) — non bloquant.
  sendQuestionEmail({
    user,
    function_id: String(function_id),
    function_label: String(function_label),
    status,
    ux_rating: ux_rating != null ? Number(ux_rating) : null,
    ui_rating: ui_rating != null ? Number(ui_rating) : null,
    comment: comment?.trim() || null,
    suggestion: suggestion?.trim() || null,
  }).catch(e => {
    console.error('[evaluation/save] Erreur envoi mail live:', e.message)
  })

  return NextResponse.json({ ok: true, evaluation: data })
}

interface QuestionEmailPayload {
  user:            { id: string; name?: string; email?: string }
  function_id:     string
  function_label:  string
  status:          string
  ux_rating:       number | null
  ui_rating:       number | null
  comment:         string | null
  suggestion:      string | null
}

async function sendQuestionEmail(p: QuestionEmailPayload) {
  const s = STATUS_LABELS[p.status] || { label: p.status, color: '#9ca3af' }
  const testerName = p.user.name || p.user.email || 'Testeur'
  const subject = `[Éval] ${testerName} — #${p.function_id} ${p.function_label} ${s.label}`

  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 16px; color: #1a1a1a;">
      <div style="background: #f3f4f6; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px;">
        <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Testeur · ${new Date().toLocaleString('fr-BE')}</div>
        <div style="font-size: 14px; font-weight: bold;">${testerName} (${p.user.email || ''})</div>
      </div>

      <div style="border-left: 4px solid ${s.color}; padding: 12px 16px; background: #fafafa; border-radius: 4px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
          <strong style="font-size: 15px;">#${p.function_id} — ${p.function_label}</strong>
          <span style="color: ${s.color}; font-weight: bold; font-size: 13px;">${s.label}</span>
        </div>
        <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">
          UX : <span style="color: #f59e0b">${stars(p.ux_rating)}</span> &nbsp;·&nbsp;
          UI : <span style="color: #f59e0b">${stars(p.ui_rating)}</span>
        </div>
        ${p.comment ? `<div style="font-size: 12px; color: #374151; margin-top: 8px;"><strong>Commentaire :</strong> ${escapeHtml(p.comment)}</div>` : ''}
        ${p.suggestion ? `<div style="font-size: 12px; color: #065f46; margin-top: 6px; background: #ecfdf5; padding: 6px 10px; border-radius: 4px;"><strong>💡 Suggestion :</strong> ${escapeHtml(p.suggestion)}</div>` : ''}
      </div>

      <div style="font-size: 10px; color: #9ca3af; text-align: center; margin-top: 12px;">
        Notification live envoyée à chaque sauvegarde — VD Soft module évaluation
      </div>
    </div>
  `

  await sendEmail(NOTIFY_RECIPIENT, subject, html, 'VD Soft Évaluation')
  console.log(`[evaluation/save] Mail live envoyé a ${NOTIFY_RECIPIENT} pour #${p.function_id}`)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
