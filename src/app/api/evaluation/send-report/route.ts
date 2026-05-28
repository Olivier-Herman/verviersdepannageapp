// POST /api/evaluation/send-report
// Envoie un email recap a mobi@verviersdepannage.be avec le rapport complet
// des evaluations de l user connecte. Inclut un lien vers la page rapport
// HTML imprimable (Cmd+P -> PDF cote Olivier).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendEmail }         from '@/lib/emails'

// Rapport final envoye a Olivier (perso) ET a l adresse interne (mobi).
const RECIPIENTS = ['info@olivierherman.be', 'mobi@verviersdepannage.be']

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  success: { label: '✅ Réussi',     color: '#10b981' },
  partial: { label: '⚠️ Partiel',    color: '#f59e0b' },
  failed:  { label: '❌ Échoué',     color: '#ef4444' },
  skipped: { label: '⏭️ Passé',      color: '#9ca3af' },
}

function ratingStars(n: number | null): string {
  if (n == null) return '<span style="color:#d1d5db">non noté</span>'
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n))
}

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const sb = createAdminClient()

  // Charge les evaluations de l user
  const { data: evaluations, error } = await sb
    .from('evaluations')
    .select('*')
    .eq('user_id', user.id)
    .order('function_id', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!evaluations || evaluations.length === 0) {
    return NextResponse.json({ error: 'Aucune evaluation a envoyer' }, { status: 400 })
  }

  // Stats globales
  const stats = {
    total:   evaluations.length,
    success: evaluations.filter(e => e.status === 'success').length,
    partial: evaluations.filter(e => e.status === 'partial').length,
    failed:  evaluations.filter(e => e.status === 'failed').length,
    skipped: evaluations.filter(e => e.status === 'skipped').length,
  }
  const uxRatings = evaluations.filter(e => e.ux_rating != null).map(e => e.ux_rating as number)
  const uiRatings = evaluations.filter(e => e.ui_rating != null).map(e => e.ui_rating as number)
  const avgUx = uxRatings.length ? (uxRatings.reduce((s, n) => s + n, 0) / uxRatings.length).toFixed(2) : '—'
  const avgUi = uiRatings.length ? (uiRatings.reduce((s, n) => s + n, 0) / uiRatings.length).toFixed(2) : '—'

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
  const reportUrl = `${baseUrl}/evaluation/report/${user.id}`

  // Construit l email HTML
  const subject = `Rapport d'évaluation VD Soft — ${user.name || user.email} (${stats.total} fonctions testées)`

  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
      <div style="background: linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 24px;">
        <h1 style="margin: 0 0 8px 0; font-size: 24px;">📋 Rapport d'évaluation VD Soft</h1>
        <p style="margin: 0; opacity: 0.9; font-size: 14px;">
          Testeur : <strong>${user.name || user.email}</strong><br>
          Date : ${new Date().toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      <h2 style="font-size: 18px; color: #b91c1c; border-bottom: 2px solid #fee2e2; padding-bottom: 6px;">📊 Statistiques globales</h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 8px 12px; background: #f3f4f6; border-radius: 6px; width: 33%;">
            <strong style="font-size: 22px; color: #1a1a1a;">${stats.total}</strong><br>
            <span style="font-size: 12px; color: #6b7280;">Fonctions testées</span>
          </td>
          <td style="padding: 8px 12px; background: #ecfdf5; border-radius: 6px; width: 33%;">
            <strong style="font-size: 22px; color: #065f46;">${avgUx} / 5</strong><br>
            <span style="font-size: 12px; color: #6b7280;">Note UX moyenne</span>
          </td>
          <td style="padding: 8px 12px; background: #eff6ff; border-radius: 6px; width: 33%;">
            <strong style="font-size: 22px; color: #1e40af;">${avgUi} / 5</strong><br>
            <span style="font-size: 12px; color: #6b7280;">Note UI moyenne</span>
          </td>
        </tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 6px 10px; background: #ecfdf5; border-radius: 6px; text-align: center; width: 25%;">
            <strong style="color: #10b981;">${stats.success}</strong>
            <span style="font-size: 11px; color: #6b7280; display: block;">Réussis</span>
          </td>
          <td style="padding: 6px 10px; background: #fef3c7; border-radius: 6px; text-align: center; width: 25%;">
            <strong style="color: #f59e0b;">${stats.partial}</strong>
            <span style="font-size: 11px; color: #6b7280; display: block;">Partiels</span>
          </td>
          <td style="padding: 6px 10px; background: #fee2e2; border-radius: 6px; text-align: center; width: 25%;">
            <strong style="color: #ef4444;">${stats.failed}</strong>
            <span style="font-size: 11px; color: #6b7280; display: block;">Échoués</span>
          </td>
          <td style="padding: 6px 10px; background: #f3f4f6; border-radius: 6px; text-align: center; width: 25%;">
            <strong style="color: #9ca3af;">${stats.skipped}</strong>
            <span style="font-size: 11px; color: #6b7280; display: block;">Passés</span>
          </td>
        </tr>
      </table>

      <h2 style="font-size: 18px; color: #b91c1c; border-bottom: 2px solid #fee2e2; padding-bottom: 6px;">📝 Détail des évaluations</h2>
      ${evaluations.map(e => {
        const s = STATUS_LABELS[e.status] || { label: e.status, color: '#9ca3af' }
        return `
          <div style="border-left: 4px solid ${s.color}; padding: 10px 14px; background: #fafafa; border-radius: 6px; margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
              <strong style="font-size: 14px; color: #1a1a1a;">#${e.function_id} — ${e.function_label}</strong>
              <span style="color: ${s.color}; font-weight: bold; font-size: 12px;">${s.label}</span>
            </div>
            <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">
              UX : ${ratingStars(e.ux_rating)} &nbsp;·&nbsp;
              UI : ${ratingStars(e.ui_rating)}
            </div>
            ${e.comment ? `<div style="font-size: 12px; color: #374151; margin-top: 6px;"><strong>Commentaire :</strong> ${e.comment}</div>` : ''}
            ${e.suggestion ? `<div style="font-size: 12px; color: #065f46; margin-top: 4px; background: #ecfdf5; padding: 4px 8px; border-radius: 4px;"><strong>💡 Suggestion :</strong> ${e.suggestion}</div>` : ''}
          </div>
        `
      }).join('')}

      <div style="margin-top: 30px; padding: 16px; background: #eff6ff; border-radius: 8px; text-align: center;">
        <p style="margin: 0 0 10px 0; font-size: 13px; color: #1e40af;">
          📄 <strong>Voir le rapport complet en ligne</strong> (imprimable PDF via Cmd+P) :
        </p>
        <a href="${reportUrl}" style="display: inline-block; padding: 10px 20px; background: #1e40af; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Ouvrir le rapport →
        </a>
        <p style="margin: 12px 0 0 0; font-size: 11px; color: #6b7280;">${reportUrl}</p>
      </div>

      <div style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center;">
        Email auto-généré par VD Soft — module évaluation app · ${new Date().toLocaleDateString('fr-BE')}
      </div>
    </div>
  `

  try {
    // Premier destinataire = to, autres = cc
    const [toAddr, ...ccAddrs] = RECIPIENTS
    await sendEmail(toAddr, subject, html, 'VD Soft Évaluation', ccAddrs)
    console.log(`[evaluation/send-report] Email envoye a ${RECIPIENTS.join(', ')} pour user ${user.id}`)

    // Marque la session : declenche la purge auto 6h plus tard via cron
    // /api/cron/cleanup-test-data. Si l user renvoie son rapport apres une
    // purge precedente, on remet purged_at a NULL pour qu une nouvelle purge
    // ait lieu.
    const now = new Date().toISOString()
    const { error: sessionErr } = await sb
      .from('evaluation_sessions')
      .upsert({
        user_id:        user.id,
        report_sent_at: now,
        purged_at:      null,
        updated_at:     now,
      }, { onConflict: 'user_id' })
    if (sessionErr) {
      console.error('[evaluation/send-report] Erreur upsert evaluation_sessions:', sessionErr.message)
    }

    return NextResponse.json({ ok: true, recipients: RECIPIENTS, count: stats.total })
  } catch (e: any) {
    console.error('[evaluation/send-report] Erreur email:', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
