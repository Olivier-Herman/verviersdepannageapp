// Page rapport consultable : /evaluation/report/[userId]
// Affiche les evaluations d un user au format imprimable (Cmd+P -> PDF).
// Lien envoye dans l email recap a mobi@verviersdepannage.be.

import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  success: { label: 'Réussi',     color: '#10b981' },
  partial: { label: 'Partiel',    color: '#f59e0b' },
  failed:  { label: 'Échoué',     color: '#ef4444' },
  skipped: { label: 'Passé',      color: '#9ca3af' },
}

function stars(n: number | null): string {
  if (n == null) return 'non noté'
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n))
}

export default async function ReportPage({ params }: { params: { userId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect(`/login?callbackUrl=/evaluation/report/${params.userId}`)

  const sb = createAdminClient()

  // Charge l user
  const { data: user } = await sb.from('users').select('id, name, email').eq('id', params.userId).maybeSingle()
  if (!user) notFound()

  // Charge les evaluations
  const { data: evaluations } = await sb
    .from('evaluations')
    .select('*')
    .eq('user_id', params.userId)
    .order('function_id', { ascending: true })

  const list = evaluations || []
  const stats = {
    total:   list.length,
    success: list.filter((e: any) => e.status === 'success').length,
    partial: list.filter((e: any) => e.status === 'partial').length,
    failed:  list.filter((e: any) => e.status === 'failed').length,
    skipped: list.filter((e: any) => e.status === 'skipped').length,
  }
  const uxRatings = list.filter((e: any) => e.ux_rating != null).map((e: any) => e.ux_rating)
  const uiRatings = list.filter((e: any) => e.ui_rating != null).map((e: any) => e.ui_rating)
  const avgUx = uxRatings.length ? (uxRatings.reduce((s: number, n: number) => s + n, 0) / uxRatings.length).toFixed(2) : '—'
  const avgUi = uiRatings.length ? (uiRatings.reduce((s: number, n: number) => s + n, 0) / uiRatings.length).toFixed(2) : '—'

  return (
    <div style={{
      fontFamily: '-apple-system, "Helvetica Neue", Arial, sans-serif',
      maxWidth: '210mm',
      margin: '0 auto',
      padding: '15mm',
      color: '#1a1a1a',
      lineHeight: 1.5,
      fontSize: '11pt',
    }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @page { size: A4; margin: 15mm; }
        @media print {
          .no-print { display: none !important; }
        }
        .eval-card { page-break-inside: avoid; }
      ` }} />

      {/* Header */}
      <header style={{
        background: 'linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)',
        color: 'white',
        padding: '24pt',
        borderRadius: '12pt',
        marginBottom: '20pt',
      }}>
        <h1 style={{ margin: '0 0 6pt 0', fontSize: '24pt' }}>📋 Rapport d'évaluation VD Soft</h1>
        <p style={{ margin: 0, opacity: 0.9, fontSize: '12pt' }}>
          Testeur : <strong>{user.name || user.email}</strong><br />
          Email : {user.email}<br />
          Date : {new Date().toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      </header>

      {/* Bouton imprimer (caché à l'impression) */}
      <div className="no-print" style={{ textAlign: 'center', marginBottom: '20pt' }}>
        <button
          onClick={() => window.print()}
          style={{
            padding: '10pt 24pt',
            background: '#1e40af',
            color: 'white',
            border: 'none',
            borderRadius: '6pt',
            fontSize: '13pt',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          🖨️ Imprimer / Enregistrer en PDF (Cmd+P)
        </button>
        <p style={{ fontSize: '10pt', color: '#6b7280', marginTop: '6pt' }}>
          Tu peux aussi utiliser le raccourci clavier <strong>Cmd+P</strong> (Mac) ou <strong>Ctrl+P</strong> (Windows)
        </p>
      </div>

      {/* Stats */}
      <section style={{ marginBottom: '24pt' }}>
        <h2 style={{ fontSize: '16pt', color: '#b91c1c', borderBottom: '2pt solid #fee2e2', paddingBottom: '4pt' }}>
          📊 Statistiques globales
        </h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10pt' }}>
          <tbody>
            <tr>
              <td style={{ padding: '8pt', background: '#f3f4f6', borderRadius: '6pt', width: '33%', textAlign: 'center' }}>
                <strong style={{ fontSize: '22pt' }}>{stats.total}</strong>
                <div style={{ fontSize: '10pt', color: '#6b7280' }}>Fonctions testées</div>
              </td>
              <td style={{ padding: '8pt' }}></td>
              <td style={{ padding: '8pt', background: '#ecfdf5', borderRadius: '6pt', width: '33%', textAlign: 'center' }}>
                <strong style={{ fontSize: '22pt', color: '#065f46' }}>{avgUx} / 5</strong>
                <div style={{ fontSize: '10pt', color: '#6b7280' }}>Note UX moyenne</div>
              </td>
              <td style={{ padding: '8pt' }}></td>
              <td style={{ padding: '8pt', background: '#eff6ff', borderRadius: '6pt', width: '33%', textAlign: 'center' }}>
                <strong style={{ fontSize: '22pt', color: '#1e40af' }}>{avgUi} / 5</strong>
                <div style={{ fontSize: '10pt', color: '#6b7280' }}>Note UI moyenne</div>
              </td>
            </tr>
          </tbody>
        </table>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8pt' }}>
          <tbody>
            <tr>
              <td style={{ padding: '6pt', background: '#ecfdf5', borderRadius: '4pt', textAlign: 'center', width: '25%' }}>
                <strong style={{ color: '#10b981', fontSize: '14pt' }}>{stats.success}</strong>
                <div style={{ fontSize: '9pt', color: '#6b7280' }}>Réussis</div>
              </td>
              <td style={{ padding: '6pt' }}></td>
              <td style={{ padding: '6pt', background: '#fef3c7', borderRadius: '4pt', textAlign: 'center', width: '25%' }}>
                <strong style={{ color: '#f59e0b', fontSize: '14pt' }}>{stats.partial}</strong>
                <div style={{ fontSize: '9pt', color: '#6b7280' }}>Partiels</div>
              </td>
              <td style={{ padding: '6pt' }}></td>
              <td style={{ padding: '6pt', background: '#fee2e2', borderRadius: '4pt', textAlign: 'center', width: '25%' }}>
                <strong style={{ color: '#ef4444', fontSize: '14pt' }}>{stats.failed}</strong>
                <div style={{ fontSize: '9pt', color: '#6b7280' }}>Échoués</div>
              </td>
              <td style={{ padding: '6pt' }}></td>
              <td style={{ padding: '6pt', background: '#f3f4f6', borderRadius: '4pt', textAlign: 'center', width: '25%' }}>
                <strong style={{ color: '#9ca3af', fontSize: '14pt' }}>{stats.skipped}</strong>
                <div style={{ fontSize: '9pt', color: '#6b7280' }}>Passés</div>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Détail */}
      <section>
        <h2 style={{ fontSize: '16pt', color: '#b91c1c', borderBottom: '2pt solid #fee2e2', paddingBottom: '4pt' }}>
          📝 Détail des évaluations ({list.length})
        </h2>

        {list.length === 0 && (
          <p style={{ color: '#6b7280', fontStyle: 'italic', marginTop: '20pt', textAlign: 'center' }}>
            Aucune évaluation enregistrée pour ce testeur.
          </p>
        )}

        {list.map((e: any) => {
          const s = STATUS_LABELS[e.status] || { label: e.status, color: '#9ca3af' }
          return (
            <div
              key={e.id}
              className="eval-card"
              style={{
                borderLeft: `4pt solid ${s.color}`,
                padding: '10pt 14pt',
                background: '#fafafa',
                borderRadius: '4pt',
                margin: '10pt 0',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4pt' }}>
                <strong style={{ fontSize: '13pt', color: '#1a1a1a' }}>
                  #{e.function_id} — {e.function_label}
                </strong>
                <span style={{ color: s.color, fontWeight: 'bold', fontSize: '11pt' }}>{s.label}</span>
              </div>
              <div style={{ fontSize: '10pt', color: '#6b7280', marginBottom: '4pt' }}>
                <strong>UX :</strong> <span style={{ color: '#f59e0b' }}>{stars(e.ux_rating)}</span>
                &nbsp;&nbsp;·&nbsp;&nbsp;
                <strong>UI :</strong> <span style={{ color: '#f59e0b' }}>{stars(e.ui_rating)}</span>
              </div>
              {e.comment && (
                <div style={{ fontSize: '10pt', color: '#374151', marginTop: '6pt' }}>
                  <strong>Commentaire :</strong> {e.comment}
                </div>
              )}
              {e.suggestion && (
                <div style={{ fontSize: '10pt', color: '#065f46', marginTop: '4pt', background: '#ecfdf5', padding: '4pt 8pt', borderRadius: '3pt' }}>
                  <strong>💡 Suggestion :</strong> {e.suggestion}
                </div>
              )}
            </div>
          )
        })}
      </section>

      {/* Footer */}
      <footer style={{ marginTop: '30pt', paddingTop: '10pt', borderTop: '1pt solid #e5e7eb', textAlign: 'center', fontSize: '9pt', color: '#9ca3af' }}>
        Rapport généré le {new Date().toLocaleString('fr-BE')} · VD Soft module évaluation
      </footer>
    </div>
  )
}
