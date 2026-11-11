'use client'

// Page Réglages (ex-Administration). Structure : option C validée par Olivier le 11/11/2026
// (catalogue src/lib/admin/reglages.ts). Habillage validé le même jour sur maquette
// (https://claude.ai/artifact/691RdVeV3wwexScKXUZaSo) après « c'est plat, juste des écritures » :
// en-tête sombre avec la recherche et quatre repères, « Au quotidien » en cartes de couleur avec
// le nombre qui attend, une carte par rubrique (chiffres réels, écrans en un appui), 1 à 4 colonnes.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Search, X, Archive, ChevronRight, AlertTriangle,
  Bot, Banknote, Wallet, PhoneCall, Car, Shield, FileText,
  Radio, Receipt, Map as MapIcon, ConciergeBell, Users, Bell, SlidersHorizontal, Activity,
  type LucideIcon,
} from 'lucide-react'
import {
  QUOTIDIEN, QUOTIDIEN_AUSSI, RUBRIQUES, RANGE,
  lienVisible, ecranVisible, normaliser, GROUPE_AFFICHE,
  type ReglageEcran, type ReglageLien, type Visibilite,
} from '@/lib/admin/reglages'
import { BUSINESS_SETTINGS } from '@/lib/settings/business-registry'

type Couleur = 'brand' | 'success' | 'info' | 'warning' | 'purple' | 'alert'
/** Dégradés francs (11/11/2026 : « pas un écran vert ») : cartes du quotidien et icônes des rubriques. */
const DEGRADE: Record<Couleur, string> = {
  brand:   'from-rose-500 to-red-600 shadow-red-500/30',
  success: 'from-emerald-500 to-teal-600 shadow-emerald-500/30',
  info:    'from-sky-500 to-blue-600 shadow-blue-500/30',
  warning: 'from-amber-400 to-orange-500 shadow-orange-500/30',
  purple:  'from-violet-500 to-purple-600 shadow-purple-500/30',
  alert:   'from-orange-500 to-rose-500 shadow-rose-500/30',
}
const VOILE: Record<Couleur, string> = {
  brand: 'from-rose-500/10', success: 'from-emerald-500/10', info: 'from-sky-500/10', warning: 'from-amber-400/15', purple: 'from-violet-500/10', alert: 'from-orange-500/10',
}

const VISUEL: Record<string, { icon: LucideIcon; couleur: Couleur }> = {
  '/admin/agents':        { icon: Bot,       couleur: 'purple' },
  '/paiements':           { icon: Banknote,  couleur: 'success' },
  '/admin/cash':          { icon: Wallet,    couleur: 'warning' },
  '/admin/demandes-site': { icon: PhoneCall, couleur: 'info' },
  '/admin/amendes':       { icon: AlertTriangle, couleur: 'alert' },
  '/admin/ventes':        { icon: Car,       couleur: 'info' },
  '/admin/tgr':           { icon: Shield,    couleur: 'purple' },
  '/admin/documents':     { icon: FileText,  couleur: 'success' },
  missions:      { icon: Radio,             couleur: 'info' },
  prix:          { icon: Receipt,           couleur: 'success' },
  parc:          { icon: MapIcon,           couleur: 'warning' },
  accueil:       { icon: ConciergeBell,     couleur: 'purple' },
  personnes:     { icon: Users,             couleur: 'brand' },
  notifications: { icon: Bell,              couleur: 'alert' },
  general:       { icon: SlidersHorizontal, couleur: 'info' },
  surveillance:  { icon: Activity,          couleur: 'success' },
}

/** Chiffres du jour calculés par la page (voir page.tsx). */
export interface ChiffresReglages {
  /** Par bouton « Au quotidien » : le nombre mis en avant et sa légende. */
  quotidien: Record<string, { n?: number; legende: string }>
  /** Par rubrique : une ligne de faits (« 37 sources · 5 dépôts »). */
  rubriques: Record<string, string>
  /** Vue d'ensemble affichée dans l'en-tête : quelques repères, `ok` false = à regarder. */
  etat: { label: string; valeur: string; ok?: boolean; href?: string }[]
}

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
interface Resultat { href: string; titre: string; chemin: string }

export default function ReglagesClient({ superadmin, obd, alertes, chiffres, prenom }: {
  superadmin: boolean
  obd:        boolean
  alertes:    Record<string, string>
  chiffres:   ChiffresReglages
  prenom:     string
}) {
  const vis: Visibilite = { superadmin, obd }
  const [q, setQ] = useState('')

  const quotidien = QUOTIDIEN.filter(l => lienVisible(l, vis))
  const aussi     = QUOTIDIEN_AUSSI.filter(l => lienVisible(l, vis))
  const range     = RANGE.filter(l => lienVisible(l, vis))
  const rubriques = RUBRIQUES
    .map(r => ({ ...r, ecrans: r.ecrans.map(e => ecranVisible(e, vis)).filter((e): e is ReglageEcran => !!e) }))
    .filter(r => r.ecrans.length)
  const alerteEcran = (e: ReglageEcran) => e.onglets.map(o => alertes[o.href]).find(Boolean)
  const listeAlertes = Object.entries(alertes)
  const aFaire = quotidien.reduce((n, l) => n + (chiffres.quotidien[l.href]?.n || 0), 0)

  const resultats = useMemo(() => {
    const mots = normaliser(q).split(/\s+/).filter(Boolean)
    if (!mots.length) return null
    const ok = (texte: string) => { const t = normaliser(texte); return mots.every(m => t.includes(m)) }
    const pages: Resultat[] = []
    const ajouterPage = (l: ReglageLien, titre: string, chemin: string, extra: string) => {
      if (ok(`${titre} ${chemin} ${l.desc || ''} ${l.mots || ''} ${extra}`)) pages.push({ href: l.href, titre, chemin })
    }
    for (const r of rubriques) for (const e of r.ecrans) for (const o of e.onglets) {
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
    <div className="px-4 py-5 lg:px-0 lg:py-0 w-full max-w-[1800px] mx-auto space-y-7 lg:space-y-9">
      {/* ── En-tête : l'état du jour + la recherche ── */}
      <header className="relative overflow-hidden rounded-3xl shadow-xl shadow-red-900/20 bg-gradient-to-br from-[#1b1220] via-[#4a1230] to-[#E11D2E] p-5 lg:p-8 text-white">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 w-56 h-56 rounded-full bg-orange-400/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -left-10 -bottom-20 w-56 h-56 rounded-full bg-violet-500/40 blur-3xl" />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div>
          <h1 className="font-display font-bold text-3xl lg:text-4xl tracking-tight">Réglages</h1>
          <p className="text-white/85 text-base mt-1">
            {prenom ? `Bonjour ${prenom}. ` : ''}
            {aFaire > 0 ? `${aFaire} chose${aFaire > 1 ? 's' : ''} vous attend${aFaire > 1 ? 'ent' : ''} aujourd’hui.` : 'Rien ne vous attend pour le moment.'}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {listeAlertes.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 min-h-[32px] px-3 rounded-full bg-white/15 backdrop-blur text-white text-xs font-semibold ring-1 ring-white/25">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.8)]" /> Tout est branché
              </span>
            ) : listeAlertes.map(([href, texte]) => (
              <Link key={href} href={href}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-full bg-amber-300 text-amber-950 text-xs font-bold hover:bg-amber-200">
                <AlertTriangle size={14} className="flex-shrink-0" /> {texte}
              </Link>
            ))}
          </div>
          <div className="relative mt-4 lg:max-w-2xl">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            <input type="text" inputMode="search" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" enterKeyHint="search"
              placeholder="Page ou réglage…" aria-label="Chercher une page ou un réglage"
              className="w-full min-h-[56px] pl-12 pr-12 rounded-2xl bg-white text-zinc-900 placeholder:text-zinc-400 shadow-lg text-base outline-none ring-2 ring-transparent focus:ring-white/70" />
            {q && (
              <button type="button" onClick={() => setQ('')} aria-label="Effacer la recherche"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-zinc-500 hover:text-zinc-900">
                <X size={20} />
              </button>
            )}
          </div>
        </div>
          {chiffres.etat.length > 0 && (
            <div className="grid grid-cols-2 gap-2 lg:gap-3 lg:w-[420px]">
              {chiffres.etat.map(e => {
                const corps = (
                  <>
                    <span className="flex items-center gap-1.5 text-white/75 text-xs">
                      {e.ok != null && <span className={`w-2 h-2 rounded-full ${e.ok ? 'bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.7)]' : 'bg-amber-300 shadow-[0_0_8px_2px_rgba(252,211,77,0.8)]'}`} />}
                      {e.label}
                    </span>
                    <span className="block font-display font-bold text-xl lg:text-2xl leading-tight mt-0.5 tabular-nums">{e.valeur}</span>
                  </>
                )
                const cls = 'block rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur px-3 py-2.5 lg:px-4 lg:py-3 min-h-[60px]'
                return e.href
                  ? <Link key={e.label} href={e.href} className={`${cls} hover:bg-white/20 transition-colors`}>{corps}</Link>
                  : <div key={e.label} className={cls}>{corps}</div>
              })}
            </div>
          )}
        </div>
      </header>

      {resultats ? (
        <div className="space-y-6">
          {resultats.pages.length + resultats.reglages.length === 0 && (
            <p className="text-ink-muted text-sm py-6 text-center">Rien ne correspond à « {q.trim()} ». Essayez un autre mot, par exemple « tarif », « garde » ou « Siabis ».</p>
          )}
          {resultats.pages.length > 0 && <ListeResultats titre={`Pages · ${resultats.pages.length}`} items={resultats.pages} />}
          {resultats.reglages.length > 0 && (
            <ListeResultats titre={`Réglages · ${resultats.reglages.length}`} items={resultats.reglages.slice(0, MAX_REGLAGES)}
              suite={resultats.reglages.length > MAX_REGLAGES ? `Et ${resultats.reglages.length - MAX_REGLAGES} autres : ajoutez un mot pour affiner.` : undefined} />
          )}
        </div>
      ) : (
        <>
          {/* ── Au quotidien : ce qui attend, en chiffres ── */}
          {quotidien.length > 0 && (
            <section>
              <Titre>Au quotidien</Titre>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-5">
                {quotidien.map(l => {
                  const v = VISUEL[l.href] || { icon: FileText, couleur: 'info' as Couleur }
                  const c = chiffres.quotidien[l.href]
                  const Icon = v.icon
                  return (
                    <Link key={l.href} href={l.href}
                      className={`group relative overflow-hidden rounded-3xl p-4 min-h-[148px] flex flex-col text-white bg-gradient-to-br shadow-lg transition-all duration-200 hover:-translate-y-1 hover:shadow-xl active:scale-[0.98] ${DEGRADE[v.couleur]}`}>
                      <Icon aria-hidden size={110} strokeWidth={1.25} className="pointer-events-none absolute -right-5 -bottom-6 text-white/15 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6" />
                      <span className="relative flex items-start justify-between">
                        <span className="w-11 h-11 rounded-2xl flex items-center justify-center bg-white/20 ring-1 ring-white/30 backdrop-blur"><Icon size={22} /></span>
                        {c?.n != null && c.n > 0 && (
                          <span className="font-display text-4xl font-bold leading-none tabular-nums drop-shadow-sm">{c.n}</span>
                        )}
                      </span>
                      <span className="relative block font-semibold text-lg leading-tight mt-auto pt-3">{l.label}</span>
                      <span className="relative block text-white/85 text-xs mt-0.5">{c?.legende || l.desc}</span>
                    </Link>
                  )
                })}
              </div>
              {aussi.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {aussi.map(l => {
                    const v = VISUEL[l.href] || { icon: FileText, couleur: 'info' as Couleur }
                    const Icon = v.icon
                    return (
                      <Link key={l.href} href={l.href} title={l.desc}
                        className="inline-flex items-center gap-2 min-h-[44px] pl-2 pr-4 rounded-full bg-surface border shadow-card text-ink-secondary text-sm font-medium hover:text-ink hover:border-strong">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-white bg-gradient-to-br shadow ${DEGRADE[v.couleur]}`}><Icon size={16} /></span>
                        {l.label}
                      </Link>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* ── Réglages : une carte par rubrique, ses écrans en un appui ── */}
          <section>
            <Titre>Réglages</Titre>
            <div className="columns-1 md:columns-2 xl:columns-3 min-[1700px]:columns-4 gap-4 lg:gap-5 [&>*]:mb-4 lg:[&>*]:mb-5 [&>*]:break-inside-avoid">
              {rubriques.map(r => {
                const v = VISUEL[r.key] || { icon: SlidersHorizontal, couleur: 'info' as Couleur }
                const Icon = v.icon
                return (
                  <div key={r.key} className={`relative overflow-hidden bg-surface border rounded-3xl shadow-card p-4 bg-gradient-to-b ${VOILE[v.couleur]} to-transparent to-40% transition-shadow hover:shadow-lg`}>
                    <div className="flex items-center gap-3">
                      <span className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 text-white bg-gradient-to-br shadow-lg ${DEGRADE[v.couleur]}`}><Icon size={24} /></span>
                      <div className="min-w-0">
                        <h3 className="font-display text-ink font-bold text-lg leading-tight">{r.label}</h3>
                        {chiffres.rubriques[r.key] && <p className="text-ink-muted text-xs mt-0.5 truncate">{chiffres.rubriques[r.key]}</p>}
                      </div>
                    </div>
                    <div className="mt-3 divide-y divide-[var(--border-default,rgba(0,0,0,0.08))]">
                      {r.ecrans.map(e => {
                        const alerte = alerteEcran(e)
                        return (
                          <Link key={e.key} href={e.onglets[0].href}
                            className="group flex items-center gap-3 min-h-[52px] py-2 -mx-2 px-2 rounded-lg hover:bg-surface-hover">
                            <span className="flex-1 min-w-0">
                              <span className="block text-ink text-sm font-medium">{e.label}</span>
                              <span className="block text-ink-muted text-xs truncate">
                                {alerte ? <span className="text-warning font-medium">{alerte}</span>
                                  : e.onglets.length > 1 ? e.onglets.map(o => o.label).join(' · ') : e.desc}
                              </span>
                            </span>
                            {alerte && <AlertTriangle size={16} className="text-warning flex-shrink-0" />}
                            <ChevronRight size={18} className="text-ink-faint flex-shrink-0 transition-transform group-hover:translate-x-0.5" />
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {range.length > 0 && (
            <details className="rounded-card border border-dashed border-strong bg-surface-2">
              <summary className="flex items-center gap-2 min-h-[52px] px-4 cursor-pointer text-ink-muted font-medium text-sm">
                <Archive size={16} /> Rangé · {range.length} page{range.length > 1 ? 's' : ''} à l’arrêt
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-3 pb-3">
                {range.map(l => (
                  <Link key={l.href} href={l.href} className="block min-h-[44px] px-4 py-3 rounded-xl bg-surface border hover:border-strong">
                    <span className="block text-ink font-medium text-sm">{l.label}</span>
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

function Titre({ children }: { children: React.ReactNode }) {
  return <h2 className="text-ink-muted text-xs uppercase tracking-wider font-semibold mb-3 px-1">{children}</h2>
}

function ListeResultats({ titre, items, suite }: { titre: string; items: Resultat[]; suite?: string }) {
  return (
    <section>
      <Titre>{titre}</Titre>
      <div className="space-y-2">
        {items.map(it => (
          <Link key={it.href + it.titre} href={it.href}
            className="group flex items-center gap-3 min-h-[52px] px-4 py-3 rounded-card bg-surface border shadow-card hover:border-strong">
            <span className="flex-1 min-w-0">
              <span className="block text-ink font-semibold text-sm">{it.titre}</span>
              <span className="block text-ink-muted text-xs mt-0.5">{it.chemin}</span>
            </span>
            <ChevronRight size={18} className="text-ink-faint flex-shrink-0" />
          </Link>
        ))}
      </div>
      {suite && <p className="text-ink-muted text-xs mt-2 px-1">{suite}</p>}
    </section>
  )
}
