'use client'
// Panneau « Pourquoi ça bloque » en haut de Facturation › À facturer, pour Olivier SEUL (28/10/2026 : « mon écran à
// facturer différent des autres utilisateurs, avec beaucoup plus d'info ») — maquette 8JhA5Spa6fRXrTmDYasPCH. Un groupe
// par raison, ce qu'il faut faire, les fiches avec leurs jours d'attente (rouge > 21 j, orange > 7 j).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { GroupeAF } from '@/lib/facturation/a-facturer'

const TON = {
  rouge:  { pastille: 'bg-red-50 text-red-800',       texte: 'text-red-800' },
  orange: { pastille: 'bg-orange-50 text-orange-800', texte: 'text-orange-800' },
  bleu:   { pastille: 'bg-blue-50 text-blue-800',     texte: 'text-blue-800' },
  vert:   { pastille: 'bg-emerald-50 text-emerald-800', texte: 'text-emerald-800' },
} as const
const fr = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit' }) : '—'

export default function BlocagesAFacturer() {
  const [data, setData] = useState<{ groupes: GroupeAF[]; total: number; plus21: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({})
  const [replie, setReplie] = useState(false)
  useEffect(() => {
    fetch('/api/admin/a-facturer', { cache: 'no-store' }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erreur'); setData(j); if (j.groupes?.[0]) setOuverts({ [j.groupes[0].cle]: true }) })
      .catch(e => setErr(String(e?.message || e)))
    try { setReplie(localStorage.getItem('blocages_af_replie') === '1') } catch { /* sans stockage */ }
  }, [])

  if (err) return null   // pas Olivier (403) ou panne : la liste de l'équipe reste là
  if (!data) return <div className="max-w-5xl mx-auto px-4 pt-4 text-sm text-slate-700">Chargement des raisons de blocage…</div>
  const basculerPanneau = () => { const v = !replie; setReplie(v); try { localStorage.setItem('blocages_af_replie', v ? '1' : '0') } catch { /* sans stockage */ } }
  const action = data.groupes.filter(g => !['hexalite', 'combinee', 'normal', 'siabis'].includes(g.cle)).reduce((s, g) => s + g.lignes.length, 0)
  const rien = data.groupes.filter(g => ['hexalite', 'combinee', 'normal'].includes(g.cle)).reduce((s, g) => s + g.lignes.length, 0)

  return (
    <div className="max-w-5xl mx-auto px-4 pt-4 pb-2 space-y-3">
      <div className="flex flex-wrap gap-3 justify-between items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-700">Visible par toi seul</p>
          <h2 className="text-xl font-extrabold text-slate-900">Pourquoi ça bloque</h2>
          <p className="text-sm text-slate-800">{data.total} fiche{data.total > 1 ? 's' : ''} terminée{data.total > 1 ? 's' : ''} pas encore facturée{data.total > 1 ? 's' : ''}, regroupées par raison. <button type="button" onClick={basculerPanneau} className="underline font-semibold min-h-[32px]">{replie ? 'Afficher le détail' : 'Replier'}</button></p>
        </div>
        <div className="flex gap-2">
          {[[data.plus21, 'en attente > 21 j', 'text-red-800'], [action, 'action de notre part', 'text-orange-800'], [rien, 'rien à faire', 'text-emerald-800']].map(([n, l, c]) => (
            <div key={String(l)} className="bg-white border border-slate-200 rounded-xl px-3 py-2"><p className={`text-xl font-extrabold ${c}`}>{n}</p><p className="text-xs text-slate-700">{l}</p></div>
          ))}
        </div>
      </div>

      {!replie && data.groupes.length === 0 && <p className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-emerald-900">Aucune fiche en attente de facturation.</p>}

      {!replie && data.groupes.map(g => {
        const t = TON[g.ton], o = !!ouverts[g.cle]
        return (
          <section key={g.cle} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <button type="button" onClick={() => setOuverts(x => ({ ...x, [g.cle]: !o }))} aria-expanded={o} className="w-full text-left flex gap-3 items-start px-4 py-4 min-h-[44px]">
              <span className={`min-w-[44px] h-8 px-2 rounded-lg font-extrabold flex items-center justify-center ${t.pastille}`}>{g.lignes.length}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-extrabold text-slate-900">{g.titre}</span>
                <span className="block text-sm text-slate-700">{g.pourquoi}</span>
                <span className={`block text-sm font-bold ${t.texte}`}>À faire : {g.afaire}</span>
              </span>
              <span className="text-sm font-semibold text-slate-700 pt-1 whitespace-nowrap">{o ? 'Masquer' : 'Voir les fiches'}</span>
            </button>
            {o && (
              <div className="border-t border-slate-100 overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-700">
                    <tr><th className="text-left px-4 py-2">Fiche</th><th className="text-left px-4 py-2">Plaque</th><th className="text-left px-4 py-2">Client facturé</th><th className="text-left px-4 py-2">Terminée le</th><th className="text-left px-4 py-2">Attente</th><th className="text-left px-4 py-2">Détail</th></tr>
                  </thead>
                  <tbody>
                    {g.lignes.map(l => (
                      <tr key={l.id} className="border-t border-slate-100">
                        <td className="px-4 py-2"><Link href={`/dispatch/${l.id}`} className="font-semibold text-red-700 underline">{l.numero ?? '—'}</Link></td>
                        <td className="px-4 py-2 font-mono">{l.plaque || '—'}</td>
                        <td className="px-4 py-2 text-slate-800">{l.client || '—'}</td>
                        <td className="px-4 py-2 text-slate-800">{fr(l.terminee)}</td>
                        <td className={`px-4 py-2 font-bold ${l.jours > 21 ? 'text-red-800' : l.jours > 7 ? 'text-orange-800' : 'text-slate-700'}`}>{l.jours} j</td>
                        <td className="px-4 py-2 text-slate-700">{l.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}
      {!replie && <p className="text-xs text-slate-700">Recalculé à chaque ouverture. Une fiche disparaît d’elle-même dès qu’elle est facturée.</p>}
    </div>
  )
}
