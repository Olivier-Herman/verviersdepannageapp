'use client'

// Page Réglages (option C, Olivier 11/11/2026). Maquette :
// https://claude.ai/artifact/GV8tdegb5gGZ5H1yE539wo
// Recherche (pages + chaque réglage métier) · Au quotidien · 8 rubriques · Rangé.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, X, ChevronDown, AlertTriangle, Archive } from 'lucide-react'
import {
  QUOTIDIEN, QUOTIDIEN_AUSSI, RUBRIQUES, RANGE,
  lienVisible, ecranVisible, normaliser, GROUPE_AFFICHE,
  type ReglageEcran, type ReglageLien, type Visibilite,
} from '@/lib/admin/reglages'
import { BUSINESS_SETTINGS } from '@/lib/settings/business-registry'

/** Réglages de la page Paramètres qui ne sont pas dans le registre métier. */
const AUTRES_PARAMETRES: { label: string; mots: string; lien: string }[] = [
  { label: 'Boîte achat des avances de fonds', mots: 'avance fonds achat email', lien: '/admin/settings?r=odoo_purchase_email' },
  { label: 'Accueil visiteurs — zone GPS du QR', mots: 'qr accueil gps rayon visiteur', lien: '/admin/settings?r=reception_geofence' },
  { label: 'TGR — adresse d’information', mots: 'tgr mail adresse', lien: '/admin/settings?r=tgr_info_email' },
  { label: 'Achats — boîte des demandes de prix', mots: 'achats offre prix boite', lien: '/admin/settings?r=achats_rfq_mailbox' },
  { label: 'Motifs d’intervention', mots: 'motif intervention liste', lien: '/admin/settings?onglet=motif' },
  { label: 'Modes de paiement', mots: 'paiement mode liste', lien: '/admin/settings?onglet=payment_mode' },
  { label: 'Raccourcis d’appel', mots: 'appel telephone raccourci', lien: '/admin/settings?onglet=calls' },
  { label: 'Vider le cache de session', mots: 'cache session reconnecter role', lien: '/admin/settings?r=cache-session' },
]

const MAX_REGLAGES = 25
const CLE_OUVERT = 'reglages_rubrique_ouverte'

interface Resultat { href: string; titre: string; chemin: string }

export default function ReglagesClient({ superadmin, obd, alertes }: {
  superadmin: boolean
  obd:        boolean
  alertes:    Record<string, string>
}) {
  const vis: Visibilite = { superadmin, obd }
  const [q, setQ] = useState('')
  const [ouvert, setOuvert] = useState<string | null>(null)

  useEffect(() => { try { setOuvert(localStorage.getItem(CLE_OUVERT)) } catch {} }, [])
  const basculer = (key: string) => {
    const n = ouvert === key ? null : key
    setOuvert(n)
    try { n ? localStorage.setItem(CLE_OUVERT, n) : localStorage.removeItem(CLE_OUVERT) } catch {}
  }

  const quotidien = QUOTIDIEN.filter(l => lienVisible(l, vis))
  const aussi     = QUOTIDIEN_AUSSI.filter(l => lienVisible(l, vis))
  const range     = RANGE.filter(l => lienVisible(l, vis))
  const rubriques = RUBRIQUES
    .map(r => ({ ...r, ecrans: r.ecrans.map(e => ecranVisible(e, vis)).filter((e): e is ReglageEcran => !!e) }))
    .filter(r => r.ecrans.length)
  const alerteEcran = (e: ReglageEcran) => e.onglets.map(o => alertes[o.href]).find(Boolean)
  const listeAlertes = Object.entries(alertes)

  // ── Recherche : tous les mots tapés doivent se trouver (sans accents ni majuscules).
  const resultats = useMemo(() => {
    const mots = normaliser(q).split(/\s+/).filter(Boolean)
    if (!mots.length) return null
    const ok = (texte: string) => { const t = normaliser(texte); return mots.every(m => t.includes(m)) }

    const pages: Resultat[] = []
    const ajouterPage = (l: ReglageLien, titre: string, chemin: string, extra: string) => {
      if (ok(`${titre} ${chemin} ${l.desc || ''} ${l.mots || ''} ${extra}`)) pages.push({ href: l.href, titre, chemin })
    }
    for (const r of rubriques) for (const e of r.ecrans) for (const o of e.onglets) {
      // La description d'un écran à plusieurs onglets parle de tous ses onglets : on ne la
      // compte que pour un écran d'un seul onglet (sinon « garde » remonterait « Adoption »).
      const titre = e.onglets.length > 1 ? `${e.label} › ${o.label}` : o.label
      ajouterPage(o, titre, r.label, e.onglets.length > 1 ? '' : e.desc)
    }
    for (const l of quotidien) ajouterPage(l, l.label, 'Au quotidien', '')
    for (const l of aussi)     ajouterPage(l, l.label, 'Au quotidien', '')
    for (const l of range)     ajouterPage(l, l.label, 'Rangé', '')

    const reglages: Resultat[] = []
    for (const d of BUSINESS_SETTINGS) {
      const groupe = GROUPE_AFFICHE[d.group] || d.group
      if (ok(`${d.label} ${d.help || ''} ${groupe}`)) reglages.push({ href: `/admin/settings?r=${d.key}`, titre: d.label, chemin: `Paramètres › ${groupe}` })
    }
    for (const p of AUTRES_PARAMETRES) if (ok(`${p.label} ${p.mots}`)) reglages.push({ href: p.lien, titre: p.label, chemin: 'Paramètres' })
    return { pages, reglages }
  }, [q, superadmin, obd]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="px-4 py-5 lg:px-0 lg:py-0 max-w-4xl space-y-6">
      <header>
        <h1 className="text-ink font-bold text-2xl">Réglages</h1>
        <p className="text-ink-muted text-sm mt-1">Tout ce qui se règle dans VD Soft, et le travail de tous les jours en tête.</p>
      </header>

      {listeAlertes.length > 0 && !resultats && (
        <section aria-label="À regarder" className="space-y-2">
          {listeAlertes.map(([href, texte]) => (
            <Link key={href} href={href}
              className="flex items-center gap-3 min-h-[44px] px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium hover:border-amber-400">
              <AlertTriangle size={18} className="flex-shrink-0" />
              <span className="flex-1">{texte}</span>
              <span className="text-amber-700 font-semibold">Ouvrir</span>
            </Link>
          ))}
        </section>
      )}

      <div className="relative">
        <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
        <input type="text" inputMode="search" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" enterKeyHint="search"
          placeholder="Page ou réglage…" aria-label="Chercher une page ou un réglage"
          className="w-full min-h-[52px] pl-12 pr-12 rounded-xl bg-surface border border-strong text-ink text-base outline-none focus:border-brand" />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label="Effacer la recherche"
            className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-ink-muted hover:text-ink">
            <X size={20} />
          </button>
        )}
      </div>

      {resultats ? (
        <div className="space-y-6">
          {resultats.pages.length + resultats.reglages.length === 0 && (
            <p className="text-ink-muted text-sm py-6 text-center">Rien ne correspond à « {q.trim()} ». Essayez un autre mot, par exemple « tarif », « garde » ou « Siabis ».</p>
          )}
          {resultats.pages.length > 0 && (
            <ListeResultats titre={`Pages · ${resultats.pages.length}`} items={resultats.pages} />
          )}
          {resultats.reglages.length > 0 && (
            <ListeResultats titre={`Réglages · ${resultats.reglages.length}`} items={resultats.reglages.slice(0, MAX_REGLAGES)}
              suite={resultats.reglages.length > MAX_REGLAGES ? `Et ${resultats.reglages.length - MAX_REGLAGES} autres : ajoutez un mot pour affiner.` : undefined} />
          )}
        </div>
      ) : (
        <>
          {quotidien.length > 0 && (
            <section>
              <h2 className="text-ink-muted text-xs uppercase tracking-wider font-semibold mb-3 px-1">Au quotidien</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {quotidien.map(l => (
                  <Link key={l.href} href={l.href} title={l.desc}
                    className="flex items-center justify-center text-center min-h-[64px] px-3 rounded-xl bg-brand/5 border border-brand/40 text-ink font-semibold text-base hover:bg-brand/10 hover:border-brand">
                    {l.label}
                  </Link>
                ))}
              </div>
              {aussi.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <span className="text-ink-muted text-sm mr-1">Aussi :</span>
                  {aussi.map(l => (
                    <Link key={l.href} href={l.href} title={l.desc}
                      className="inline-flex items-center min-h-[44px] px-4 rounded-xl bg-surface border border-strong text-ink-secondary text-sm font-medium hover:text-ink hover:border-brand/40">
                      {l.label}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          <section>
            <h2 className="text-ink-muted text-xs uppercase tracking-wider font-semibold mb-3 px-1">Réglages</h2>
            <div className="space-y-3">
              {rubriques.map(r => {
                const estOuvert = ouvert === r.key
                const nbAlertes = r.ecrans.filter(alerteEcran).length
                return (
                  <div key={r.key} className={`rounded-xl border bg-surface ${estOuvert ? 'border-brand border-2' : 'border-strong'}`}>
                    <button type="button" onClick={() => basculer(r.key)} aria-expanded={estOuvert}
                      className="w-full flex items-center gap-3 min-h-[60px] px-4 text-left">
                      <span className="flex-1 text-ink font-semibold text-base">{r.label}</span>
                      {nbAlertes > 0 && <AlertTriangle size={16} className="text-amber-600" aria-label="À regarder" />}
                      <span className="text-ink-muted text-sm">{r.ecrans.length} écran{r.ecrans.length > 1 ? 's' : ''}</span>
                      <ChevronDown size={18} className={`text-ink-muted transition-transform ${estOuvert ? 'rotate-180' : ''}`} />
                    </button>
                    {estOuvert && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-3 pb-3">
                        {r.ecrans.map(e => {
                          const alerte = alerteEcran(e)
                          return (
                            <Link key={e.key} href={e.onglets[0].href}
                              className="block min-h-[44px] px-4 py-3 rounded-xl bg-surface-2 border border-strong hover:border-brand/50">
                              <span className="flex items-baseline justify-between gap-2">
                                <span className="text-ink font-semibold text-sm">{e.label}</span>
                                {e.onglets.length > 1 && <span className="text-ink-muted text-xs whitespace-nowrap">{e.onglets.length} onglets</span>}
                              </span>
                              <span className="block text-ink-muted text-xs mt-0.5">{e.desc}</span>
                              {alerte && (
                                <span className="flex items-center gap-1 text-amber-700 text-xs font-medium mt-1.5">
                                  <AlertTriangle size={12} /> {alerte}
                                </span>
                              )}
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {range.length > 0 && (
            <details className="rounded-xl border border-dashed border-strong bg-surface-2">
              <summary className="flex items-center gap-2 min-h-[56px] px-4 cursor-pointer text-ink-secondary font-semibold text-sm">
                <Archive size={16} /> Rangé · {range.length} page{range.length > 1 ? 's' : ''} à l’arrêt
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-3 pb-3">
                {range.map(l => (
                  <Link key={l.href} href={l.href}
                    className="block min-h-[44px] px-4 py-3 rounded-xl bg-surface border border-strong hover:border-brand/50">
                    <span className="block text-ink font-semibold text-sm">{l.label}</span>
                    {l.desc && <span className="block text-ink-muted text-xs mt-0.5">{l.desc}</span>}
                  </Link>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}

function ListeResultats({ titre, items, suite }: { titre: string; items: Resultat[]; suite?: string }) {
  return (
    <section>
      <h2 className="text-ink-muted text-xs uppercase tracking-wider font-semibold mb-3 px-1">{titre}</h2>
      <div className="space-y-2">
        {items.map(it => (
          <Link key={it.href + it.titre} href={it.href}
            className="block min-h-[44px] px-4 py-3 rounded-xl bg-surface border border-strong hover:border-brand/50">
            <span className="block text-ink font-semibold text-sm">{it.titre}</span>
            <span className="block text-ink-muted text-xs mt-0.5">{it.chemin}</span>
          </Link>
        ))}
      </div>
      {suite && <p className="text-ink-muted text-xs mt-2 px-1">{suite}</p>}
    </section>
  )
}
