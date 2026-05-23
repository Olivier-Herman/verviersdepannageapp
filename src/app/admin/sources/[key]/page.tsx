// src/app/admin/sources/[key]/page.tsx
//
// Fiche detaillee d une source de mission. Consolide en UNE PAGE :
//   - Identite (label, cle, ordre, notes, actif, client par defaut)
//   - Tarifs : liste des grilles source_tariffs pour cette source
//   - Surcharges : plages horaires applicables (via surcharge_clients/_schedules)
//   - Stats : nombre de missions historiques, autofac, etc.
//
// Permet de tout voir et de naviguer rapidement vers les editeurs specifiques
// sans devoir parcourir 3 pages admin differentes.
//
// Phase 2 du chantier [[admin-zero-hardcode]].

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import {
  ArrowLeft, Tag, Receipt, DollarSign, BarChart3, AlertTriangle, ExternalLink, Calendar,
} from 'lucide-react'

const WEEKDAY_LABELS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

export default async function SourceDetailPage({ params }: { params: { key: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const isAdmin = ['admin', 'superadmin'].some(r => (user.roles || [user.role]).includes(r))
  if (!isAdmin) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const key = decodeURIComponent(params.key)
  const today = new Date().toISOString().slice(0, 10)

  const [
    { data: source },
    { data: tariffs },
    { data: surchargeClient },
    { count: missionsCount },
    { count: missionsLast30d },
  ] = await Promise.all([
    sb.from('mission_source_catalog').select('*').eq('key', key).maybeSingle(),
    sb.from('source_tariffs').select('*').eq('source', key).order('mission_type').order('effective_from', { ascending: false }),
    sb.from('surcharge_clients').select('key, label, kind, active').eq('key', key).maybeSingle(),
    sb.from('incoming_missions').select('*', { count: 'exact', head: true }).eq('source', key),
    sb.from('incoming_missions').select('*', { count: 'exact', head: true }).eq('source', key)
      .gte('received_at', new Date(Date.now() - 30 * 86400000).toISOString()),
  ])

  if (!source) notFound()

  // Plages surcharges si un client correspondant existe
  let surchargeSchedules: any[] = []
  if (surchargeClient) {
    const { data } = await sb.from('surcharge_schedules').select('*').eq('client_key', key).order('weekday').order('hour_start')
    surchargeSchedules = data || []
  }

  // Verifications "trous" pour warnings
  const noDefault = !source.default_billed_to_id
  const noTariff  = !tariffs || tariffs.length === 0
  const noSurcharge = !surchargeClient || surchargeSchedules.length === 0
  const activeTariffs = (tariffs || []).filter(t =>
    t.effective_from <= today && (!t.effective_to || t.effective_to >= today)
  )

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header avec retour + actions */}
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Link href="/admin/sources" className="mt-1 text-ink-muted hover:text-ink transition" title="Retour à la liste">
            <ArrowLeft size={20} />
          </Link>
          <div className="min-w-0">
            <h1 className="text-ink font-bold text-2xl truncate">{source.label}</h1>
            <p className="text-ink-muted text-sm mt-1">
              Clé technique : <span className="font-mono">{source.key}</span>
              {source.active
                ? <span className="ml-3 text-xs px-2 py-0.5 bg-success-soft text-success rounded">actif</span>
                : <span className="ml-3 text-xs px-2 py-0.5 bg-ink-faint/15 text-ink-muted rounded">désactivé</span>}
            </p>
          </div>
        </div>
      </header>

      {/* Warnings actionnables */}
      {(noDefault || noTariff || noSurcharge) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 space-y-2">
          <h2 className="text-amber-600 font-semibold text-sm flex items-center gap-2">
            <AlertTriangle size={16} /> Configuration incomplète
          </h2>
          <ul className="space-y-1 text-sm text-ink">
            {noDefault   && <li>• Aucun <strong>client par défaut</strong> configuré — édite ci-dessous.</li>}
            {noTariff    && <li>• Aucun <strong>tarif</strong> en grille pour cette source.</li>}
            {noSurcharge && <li>• Aucune <strong>plage de surcharge horaire</strong> configurée.</li>}
          </ul>
        </div>
      )}

      {/* Identite & client par defaut */}
      <section className="bg-surface border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-ink font-semibold text-sm flex items-center gap-2">
            <Tag size={16} /> Identité et client par défaut
          </h2>
          <Link href={`/admin/sources?edit=${encodeURIComponent(source.key)}`}
            className="text-xs text-brand hover:underline">
            ✎ Éditer (modal)
          </Link>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <div>
            <dt className="text-ink-muted text-xs">Libellé affiché</dt>
            <dd className="text-ink">{source.label}</dd>
          </div>
          <div>
            <dt className="text-ink-muted text-xs">Ordre d'affichage</dt>
            <dd className="text-ink font-mono">{source.sort_order ?? 100}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-ink-muted text-xs">Client à facturer par défaut</dt>
            <dd className="text-ink">
              {source.default_billed_to_name
                ? <>
                    {source.default_billed_to_name}
                    {source.default_billed_to_id != null && (
                      <span className="text-ink-faint text-xs ml-2">(Odoo partner #{source.default_billed_to_id})</span>
                    )}
                  </>
                : <span className="text-ink-muted italic">— non configuré (les missions seront créées sans client par défaut)</span>}
            </dd>
          </div>
          {source.notes && (
            <div className="sm:col-span-2">
              <dt className="text-ink-muted text-xs">Notes</dt>
              <dd className="text-ink whitespace-pre-wrap">{source.notes}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Tarifs */}
      <section className="bg-surface border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-ink font-semibold text-sm flex items-center gap-2">
            <Receipt size={16} /> Tarifs ({tariffs?.length || 0})
          </h2>
          <Link href={`/admin/tarifs?source=${encodeURIComponent(source.key)}`}
            className="text-xs text-brand hover:underline flex items-center gap-1">
            <ExternalLink size={12} /> Voir/éditer tous les tarifs
          </Link>
        </div>
        {tariffs && tariffs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-ink-muted text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2">Type</th>
                  <th className="text-left py-2">Mode</th>
                  <th className="text-right py-2">Forfait</th>
                  <th className="text-right py-2">Km inclus</th>
                  <th className="text-right py-2">€ / km extra</th>
                  <th className="text-right py-2">€ / jour parc</th>
                  <th className="text-left py-2">En vigueur</th>
                  <th className="text-left py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tariffs.map((t: any) => {
                  const inForce = t.effective_from <= today && (!t.effective_to || t.effective_to >= today)
                  return (
                    <tr key={t.id} className={inForce ? '' : 'opacity-50'}>
                      <td className="py-2">{t.mission_type}</td>
                      <td className="py-2"><span className="text-xs px-2 py-0.5 bg-surface-2 rounded">{t.pricing_mode || 'forfait'}</span></td>
                      <td className="py-2 text-right tabular-nums">{t.unit_price != null ? `${Number(t.unit_price).toFixed(2)} €` : '—'}</td>
                      <td className="py-2 text-right tabular-nums">{t.km_inclus ?? 0}</td>
                      <td className="py-2 text-right tabular-nums">{t.km_price != null ? `${Number(t.km_price).toFixed(2)} €` : '—'}</td>
                      <td className="py-2 text-right tabular-nums">{t.parc_day_price != null ? `${Number(t.parc_day_price).toFixed(2)} €` : '—'}</td>
                      <td className="py-2 text-xs text-ink-muted">
                        {t.effective_from} {t.effective_to ? `→ ${t.effective_to}` : '→ ∞'}
                      </td>
                      <td className="py-2">
                        <Link href={`/admin/tarifs/${t.id}`} className="text-brand text-xs hover:underline">Éditer</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {activeTariffs.length === 0 && (
              <p className="text-amber-500 text-xs mt-3">⚠ Aucun tarif en vigueur aujourd'hui (tous expirés ou futurs).</p>
            )}
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-ink-muted text-sm">Aucun tarif configuré pour cette source.</p>
            <Link href={`/admin/tarifs?source=${encodeURIComponent(source.key)}&new=1`}
              className="inline-block mt-3 px-4 py-2 bg-brand text-white rounded-xl text-sm font-medium hover:opacity-90 transition">
              + Créer une grille tarifaire
            </Link>
          </div>
        )}
      </section>

      {/* Surcharges horaires */}
      <section className="bg-surface border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-ink font-semibold text-sm flex items-center gap-2">
            <DollarSign size={16} /> Surcharges horaires ({surchargeSchedules.length} plage{surchargeSchedules.length > 1 ? 's' : ''})
          </h2>
          <Link href={`/admin/surcharges?client=${encodeURIComponent(source.key)}`}
            className="text-xs text-brand hover:underline flex items-center gap-1">
            <ExternalLink size={12} /> Voir/éditer les surcharges
          </Link>
        </div>
        {surchargeSchedules.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-ink-muted text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2">Jour</th>
                  <th className="text-left py-2">Plage horaire</th>
                  <th className="text-right py-2">+ DSP</th>
                  <th className="text-right py-2">+ REM</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {surchargeSchedules.map((s: any) => (
                  <tr key={s.id}>
                    <td className="py-2">{WEEKDAY_LABELS[s.weekday]}</td>
                    <td className="py-2 font-mono text-xs">{String(s.hour_start).padStart(2, '0')}h → {String(s.hour_end).padStart(2, '0')}h</td>
                    <td className="py-2 text-right tabular-nums">{s.rate_dsp_pct != null ? `+${s.rate_dsp_pct}%` : '—'}</td>
                    <td className="py-2 text-right tabular-nums">{s.rate_rem_pct != null ? `+${s.rate_rem_pct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-ink-muted text-sm">
              {surchargeClient
                ? 'Client de surcharge créé mais aucune plage horaire définie.'
                : 'Aucune surcharge configurée pour cette source.'}
            </p>
            <Link href={`/admin/surcharges?client=${encodeURIComponent(source.key)}&new=1`}
              className="inline-block mt-3 px-4 py-2 bg-brand text-white rounded-xl text-sm font-medium hover:opacity-90 transition">
              + Configurer les surcharges
            </Link>
          </div>
        )}
      </section>

      {/* Stats utilisation */}
      <section className="bg-surface border rounded-2xl p-5">
        <h2 className="text-ink font-semibold text-sm flex items-center gap-2 mb-4">
          <BarChart3 size={16} /> Utilisation
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-ink-muted text-xs">Total missions historiques</p>
            <p className="text-ink font-bold text-2xl tabular-nums mt-1">{missionsCount ?? 0}</p>
          </div>
          <div>
            <p className="text-ink-muted text-xs flex items-center gap-1"><Calendar size={11} /> 30 derniers jours</p>
            <p className="text-ink font-bold text-2xl tabular-nums mt-1">{missionsLast30d ?? 0}</p>
          </div>
          <div>
            <p className="text-ink-muted text-xs">Surcharge auto (autofac)</p>
            <p className="text-ink text-sm mt-1">
              {(tariffs || []).some(t => t.is_autofac) ? '✓ Oui (au moins 1 tarif)' : '— Non'}
            </p>
          </div>
          <div>
            <p className="text-ink-muted text-xs">Lien rapide</p>
            <Link href={`/dispatch?source=${encodeURIComponent(source.key)}`} className="text-brand text-sm mt-1 inline-block hover:underline">
              Voir les missions →
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
