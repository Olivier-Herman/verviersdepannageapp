// /admin/diagnostics-obd — journal du bureau des diagnostics OBD (Olivier 05/11/2026, maquette validée).
// Chaque lecture du boîtier : avec ou sans intervention, VIN, codes, avis de Sam, effacement signé par PIN.
// Préversion : drapeau obd_diagnostic.
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isPreviewOn } from '@/lib/feature-flags'

export const dynamic = 'force-dynamic'

const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
const VERDICT: Record<string, string> = { dsp: 'Dépannage sur place', rem: 'Remorquage', controle: 'Rien d’anormal' }

export default async function DiagnosticsObdPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  if (!(await isPreviewOn('obd_diagnostic', u.role, u.id))) redirect('/admin')
  const sb = createAdminClient()
  const { data } = await sb.from('obd_diagnostics').select('*').order('created_at', { ascending: false }).limit(200)
  const rows = data || []
  const { data: prises } = await sb.from('obd_port_locations').select('id, label, fr, status, source_url, confirmed_by, updated_at').order('updated_at', { ascending: false }).limit(200)
  const uids = [...new Set(rows.flatMap((d: any) => [d.created_by, d.cleared_by]).filter(Boolean))]
  const mids = [...new Set(rows.map((d: any) => d.mission_id).filter(Boolean))]
  const [{ data: us }, { data: ms }] = await Promise.all([
    uids.length ? sb.from('users').select('id, name').in('id', uids) : Promise.resolve({ data: [] as any[] }),
    mids.length ? sb.from('incoming_missions').select('id, mission_number').in('id', mids) : Promise.resolve({ data: [] as any[] }),
  ])
  const name: Record<string, string> = {}; for (const x of us || []) name[x.id] = x.name
  const num: Record<string, number> = {}; for (const x of ms || []) num[x.id] = x.mission_number

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl">
      <header>
        <h1 className="text-ink font-bold text-xl">Diagnostics OBD</h1>
        <p className="text-ink-muted text-sm mt-1">Préversion. Chaque lecture du boîtier par un chauffeur : avec ou sans intervention, numéro de châssis, codes de panne, avis de Sam et effacements signés par le code du chauffeur.</p>
      </header>
      {rows.length === 0 ? (
        <p className="rounded-xl border bg-surface p-6 text-center text-ink-secondary text-sm">Aucun diagnostic pour l’instant. Les lectures apparaîtront ici dès le premier essai avec le boîtier.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-ink-muted text-xs uppercase tracking-wide">
              {['Quand', 'Fiche', 'Véhicule', 'Chauffeur', 'Codes', 'Avis de Sam', 'Effacement', 'Intervention'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((d: any) => {
                const v = d.vehicle || {}
                return (
                  <tr key={d.id} className="border-t align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-ink-secondary">{fmt(d.created_at)}</td>
                    <td className="px-3 py-2 font-semibold text-ink">{d.numero}</td>
                    <td className="px-3 py-2 text-ink">{[v.marque, v.modele, v.annee].filter(Boolean).join(' · ') || '—'}<div className="font-mono text-xs text-ink-muted">{d.vin || 'VIN non lu'}{d.plate ? ` · ${d.plate}` : ''}</div></td>
                    <td className="px-3 py-2 text-ink-secondary">{name[d.created_by] || '—'}</td>
                    <td className="px-3 py-2 font-mono text-ink">{(d.codes || []).length ? (d.codes || []).map((c: any) => c.code + (c.type === 'en_attente' ? '*' : '')).join(', ') : <span className="font-sans text-ink-muted">aucun</span>}</td>
                    <td className="px-3 py-2 text-ink-secondary">{d.analysis ? VERDICT[d.analysis.verdict] || '—' : '—'}{d.decision ? <div className="text-xs">Chauffeur : {d.decision === 'dsp' ? 'dépannage sur place' : 'remorquage'}</div> : null}</td>
                    <td className="px-3 py-2 text-ink-secondary">{d.cleared_by ? <>{d.clear_result === 'ok' ? 'Effacés' : d.clear_result === 'refuse' ? 'Refusé par la voiture' : 'Signé'}<div className="text-xs">{name[d.cleared_by] || ''} · {fmt(d.cleared_at)}</div></> : '—'}</td>
                    <td className="px-3 py-2">{d.mission_id ? <Link className="text-brand underline" href={`/dispatch/${d.mission_id}`}>#{num[d.mission_id] || '…'}</Link> : <span className="text-ink-muted">seul</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-ink-muted border-t">* code en attente (pas encore confirmé par la voiture).</p>
        </div>
      )}
      <section className="space-y-2">
        <h2 className="text-ink font-semibold text-base">Emplacements de la prise par modèle</h2>
        <p className="text-ink-muted text-sm">« À confirmer » vient de la documentation en ligne et peut être faux. « Vérifié » a été confirmé par un chauffeur.</p>
        {(prises || []).length === 0 ? <p className="rounded-xl border bg-surface p-4 text-center text-ink-secondary text-sm">Aucun emplacement pour l’instant.</p> : (
          <div className="overflow-x-auto rounded-xl border bg-surface"><table className="w-full text-sm">
            <thead><tr className="text-left text-ink-muted text-xs uppercase tracking-wide">{['Modèle', 'Emplacement', 'État', 'Source'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{(prises || []).map((p: any) => <tr key={p.id} className="border-t align-top">
              <td className="px-3 py-2 text-ink">{p.label}</td><td className="px-3 py-2 text-ink-secondary">{p.fr}</td>
              <td className="px-3 py-2 whitespace-nowrap">{p.status === 'verifie' ? `Vérifié (${(p.confirmed_by || []).length})` : 'À confirmer'}</td>
              <td className="px-3 py-2">{p.source_url ? <a className="text-brand underline" href={p.source_url} target="_blank" rel="noreferrer">voir la page</a> : p.status === 'verifie' ? 'Chauffeur' : '—'}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>
    </div>
  )
}
