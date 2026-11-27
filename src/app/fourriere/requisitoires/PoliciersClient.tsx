'use client'
// src/app/fourriere/requisitoires/PoliciersClient.tsx
//
// Onglet « Policiers à encoder » de l'écran Réquisitoires (Olivier 27/11/2026) :
// pour chaque véhicule au parc sans réquisitoire, le nom du policier (écrit sur la fiche)
// et une remarque libre. Relances du réquisitoire : décochées par défaut, le nom est
// enregistré sans que le robot relance le policier.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import OfficerAutocomplete from '@/components/missions/OfficerAutocomplete'

interface Item {
  id: string; fiche: number | null; plaque: string | null; vehicule: string | null
  ancienne: boolean; zone: string | null; societe_zone: number | null; zone_deduite: boolean; adresse: string | null
  entree: string | null; zone_parc: string | null; requerant: string | null
  policier: string; policier_id: number | null; policier_relie: boolean; relances: boolean; relances_coupees: boolean; nb_relances: number
  remarque: string; vu: { at: string; releve: boolean } | null
}
interface Brouillon { policier: string; policier_id: number | null; remarque: string; relancer: boolean }

const jour = (s: string | null) => s ? new Date(s).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const mois = (s: string | null) => s ? Math.floor((Date.now() - Date.parse(s)) / (30.44 * 86_400_000)) : null
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const VESDRE = 'Police Zone Vesdre'

export default function PoliciersClient() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [zone, setZone] = useState<string>(VESDRE)
  const [vue, setVue] = useState<'sans' | 'avec' | 'tous'>('sans')
  const [q, setQ] = useState('')
  const [brouillons, setBrouillons] = useState<Record<string, Brouillon>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ id: string; ok: boolean; msg: string } | null>(null)
  // Fiches enregistrées pendant la séance : restent affichées même si elles sortent du filtre.
  const [faites, setFaites] = useState<Set<string>>(new Set())

  const charger = async () => {
    setErreur(null)
    try {
      const r = await fetch('/api/fourriere/policiers-a-encoder', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Chargement impossible')
      setItems(j.items)
    } catch (e: any) { setErreur(e?.message || 'Chargement impossible') }
  }
  useEffect(() => { charger() }, [])

  const zones = useMemo(() => {
    const c: Record<string, number> = {}
    for (const i of items || []) { const z = i.zone || 'Zone inconnue'; c[z] = (c[z] || 0) + 1 }
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [items])

  const dansZone = (items || []).filter(i => zone === 'toutes' || (i.zone || 'Zone inconnue') === zone)
  const sansNom = dansZone.filter(i => !i.policier.trim())
  const visibles = dansZone
    .filter(i => vue === 'tous' || faites.has(i.id) || (vue === 'sans' ? !i.policier.trim() : !!i.policier.trim()))
    .filter(i => !q.trim() || norm([i.plaque, i.fiche, i.vehicule, i.adresse, i.policier, i.requerant, i.remarque].filter(Boolean).join(' ')).includes(norm(q.trim())))

  const brouillon = (i: Item): Brouillon => brouillons[i.id] || { policier: i.policier, policier_id: i.policier_id, remarque: i.remarque, relancer: i.relances }
  const modifie = (i: Item) => { const b = brouillons[i.id]; return !!b && (b.policier.trim() !== i.policier.trim() || (b.policier_id ?? null) !== (i.policier_id ?? null) || b.remarque.trim() !== i.remarque.trim() || b.relancer !== i.relances) }
  // Mise à jour fonctionnelle : le champ policier envoie le nom puis le contact dans le même clic.
  const changer = (i: Item, p: Partial<Brouillon>) => setBrouillons(s => ({ ...s, [i.id]: { ...(s[i.id] || { policier: i.policier, policier_id: i.policier_id, remarque: i.remarque, relancer: i.relances }), ...p } }))

  const enregistrer = async (i: Item) => {
    const b = brouillon(i)
    setBusy(i.id)
    try {
      const r = await fetch('/api/fourriere/policiers-a-encoder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: i.id, officer_name: b.policier, officer_partner_id: b.policier_id, remarque: b.remarque, relancer: b.relancer }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Enregistrement impossible')
      setItems(list => (list || []).map(x => x.id === i.id ? { ...x, policier: j.policier, policier_id: j.policier_id, policier_relie: j.policier_relie, remarque: j.remarque, relances: b.relancer, relances_coupees: j.relances_coupees } : x))
      setBrouillons(s => { const n = { ...s }; delete n[i.id]; return n })
      setFaites(s => new Set(s).add(i.id))
      const rel = j.relance as { ok: boolean; email?: string; error?: string } | null
      if (rel?.ok) setItems(list => (list || []).map(x => x.id === i.id ? { ...x, nb_relances: x.nb_relances + 1 } : x))
      setFlash({ id: i.id, ok: !rel || rel.ok, msg: !rel ? 'Enregistré' : rel.ok ? `Relance envoyée à ${rel.email} · la fiche quitte cette liste et se suit dans « Manquants »` : `Enregistré, mais la relance n’est pas partie : ${rel.error}` })
    } catch (e: any) { setFlash({ id: i.id, ok: false, msg: e?.message || 'Enregistrement impossible' }) }
    finally { setBusy(null); setTimeout(() => setFlash(f => f?.id === i.id ? null : f), 10000) }
  }

  if (erreur) return (
    <div className="px-3 lg:px-6 py-6 max-w-[1800px] mx-auto">
      <div className="rounded-2xl border border-red-300 bg-red-50 text-red-800 p-4 flex items-center gap-3 flex-wrap">
        <span className="font-semibold">La liste n’a pas pu se charger : {erreur}</span>
        <button onClick={charger} className="min-h-[44px] px-4 rounded-xl bg-red-700 text-white font-bold">Réessayer</button>
      </div>
    </div>
  )
  if (!items) return <p className="px-3 lg:px-6 py-10 text-center text-ink-muted">Chargement des véhicules au parc…</p>

  const chip = (actif: boolean) => `min-h-[44px] px-3.5 rounded-xl text-sm font-semibold border transition ${actif ? 'bg-ink text-surface border-ink' : 'bg-surface-2 text-ink-secondary border-app hover:bg-surface-hover'}`

  return (
    <div className="px-3 lg:px-6 pt-3 pb-10 max-w-[1800px] min-w-0 [contain:inline-size] mx-auto space-y-3">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 text-amber-900 p-3.5 text-sm leading-relaxed">
        Véhicules au parc <b>sans réquisitoire</b>. Le nom du policier s’écrit sur la fiche. Tant que <b>« Relancer ce policier »</b> n’est pas cochée,
        aucune relance ne part : le nom est seulement enregistré. Cochée, la demande de réquisitoire part au policier dès que tu cliques « Enregistrer », puis une relance par semaine ; la fiche quitte alors cette liste et se suit dans « Manquants ».
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <select value={zone} onChange={e => setZone(e.target.value)} aria-label="Zone de police" className="min-h-[44px] px-3 rounded-xl border border-app bg-surface-2 text-sm font-semibold text-ink">
          {zones.map(([z, n]) => <option key={z} value={z}>{z} · {n}</option>)}
          <option value="toutes">Toutes les zones · {items.length}</option>
        </select>
        <button onClick={() => setVue('sans')} className={chip(vue === 'sans')}>Sans policier · {sansNom.length}</button>
        <button onClick={() => setVue('avec')} className={chip(vue === 'avec')}>Avec policier · {dansZone.length - sansNom.length}</button>
        <button onClick={() => setVue('tous')} className={chip(vue === 'tous')}>Tous · {dansZone.length}</button>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Plaque, fiche, rue, nom…" aria-label="Rechercher"
          className="min-h-[44px] px-3 rounded-xl border border-app bg-surface-2 text-sm text-ink flex-1 min-w-[180px]" />
      </div>

      {visibles.length === 0 ? (
        <p className="text-sm text-ink-muted italic py-10 text-center">
          {vue === 'sans' && dansZone.length > 0 ? 'Tous les véhicules de cette zone ont un policier. 🎉' : 'Aucun véhicule pour ce filtre.'}
        </p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] xl:grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
          {visibles.map(i => {
            const b = brouillon(i); const m = mois(i.entree); const dirty = modifie(i)
            return (
              <div key={i.id} className={`rounded-2xl border bg-surface-2 p-3.5 space-y-2.5 ${dirty ? 'border-sky-400 ring-1 ring-sky-300' : 'border-app'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-[13px] px-2 py-0.5 rounded-md border border-app bg-surface">{i.plaque || 'sans plaque'}</span>
                      <Link href={`/dispatch/${i.id}`} className="font-semibold text-ink hover:underline">#{i.fiche ?? '—'}</Link>
                      <span className="text-ink-secondary">{i.vehicule || '—'}</span>
                      {i.ancienne && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">ancien logiciel</span>}
                    </div>
                    <div className="text-xs text-ink-muted mt-1">
                      Au parc depuis le {jour(i.entree)}{m != null ? ` (${m} mois)` : ''} · zone {i.zone_parc || '—'}
                      {' · '}{i.vu ? `vu au contrôle le ${jour(i.vu.at)}${i.vu.releve ? ' (relevé de Verviers)' : ''}` : 'pas vu au contrôle'}
                    </div>
                    <div className="text-xs text-ink-muted">Enlevé : {i.adresse || '—'}{i.zone_deduite ? ' · zone déduite du lieu' : ''}</div>
                  </div>
                  {i.relances_coupees && !dirty && <span className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-amber-100 text-amber-800">relances coupées</span>}
                  {i.relances && !dirty && <span className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-emerald-100 text-emerald-800">relancé{i.nb_relances ? ` ${i.nb_relances}×` : ''}</span>}
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2.5">
                  <div className="block min-w-0">
                    <OfficerAutocomplete label="Policier" value={b.policier}
                      onChange={v => changer(i, { policier: v })}
                      onPickPartner={id => changer(i, { policier_id: id })}
                      companyId={i.societe_zone} allZones={!i.societe_zone} />
                    {i.requerant && !b.policier.trim() && (
                      <button onClick={() => changer(i, { policier: i.requerant!.split(/\s+/)[0], policier_id: null })} className="mt-1.5 min-h-[36px] px-2.5 rounded-lg text-xs font-semibold border border-sky-300 bg-sky-50 text-sky-800">
                        Chercher « {i.requerant} » (requérant de l’ancien logiciel)
                      </button>
                    )}
                    {b.policier.trim() && (b.policier_id
                      ? <span className="block mt-1 text-[11px] font-semibold text-emerald-700">✓ relié à son contact police</span>
                      : <span className="block mt-1 text-[11px] font-semibold text-amber-700">pas relié : choisis le policier dans la liste des contacts</span>)}
                  </div>
                  <label className="block">
                    <span className="text-xs font-semibold text-ink-secondary">Remarque</span>
                    <textarea value={b.remarque} onChange={e => changer(i, { remarque: e.target.value })} rows={2} placeholder="Remarque libre"
                      className="mt-1 w-full min-h-[44px] px-3 py-2 rounded-xl border border-app bg-surface text-sm text-ink resize-y" />
                  </label>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 min-h-[44px] cursor-pointer text-sm text-ink">
                    <input type="checkbox" checked={b.relancer} onChange={e => changer(i, { relancer: e.target.checked })} className="w-5 h-5" />
                    Relancer ce policier pour le réquisitoire
                  </label>
                  <div className="ml-auto flex items-center gap-2">
                    {flash?.id === i.id && <span className={`text-xs font-semibold ${flash.ok ? 'text-emerald-700' : 'text-red-700'}`}>{flash.ok ? '✓' : '⚠'} {flash.msg}</span>}
                    {dirty && <button onClick={() => setBrouillons(s => { const n = { ...s }; delete n[i.id]; return n })} className="min-h-[44px] px-3 rounded-xl text-sm font-semibold text-ink-secondary border border-app">Annuler</button>}
                    <button onClick={() => enregistrer(i)} disabled={!dirty || busy === i.id}
                      className="min-h-[44px] px-4 rounded-xl text-sm font-bold bg-sky-700 text-white disabled:opacity-40">
                      {busy === i.id ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
