'use client'
// Relevé de parc sans étiquette (Olivier 18/10/2026). Un véhicule à la fois : on tape ce qu'on voit, VD Soft cherche
// (fiches, Towsoft, mails, ERP), on décide (c'est cette fiche / garder au parc / scratch / noter). Listing en fin de relevé.
import { useEffect, useState } from 'react'

type Lieux = Record<string, { label: string; zone: string | null }>
const ZONES_PEPINSTER = ['A', 'B', 'B*', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'Box', 'Transit', 'SNC']
const SOURCES: [string, string][] = [['police_saisie', 'Saisie'], ['police_accident', 'Accident (police)'], ['police_mg', 'Mal garée'], ['police_avp', 'AVP / abandon'], ['police_rodeo', 'Rodéo'], ['prive', 'Privé'], ['legacy_towsoft_migration', 'Autre / inconnu']]
const DECISIONS: Record<string, string> = { present_ok: '✅ Fiche confirmée', garder: '🅿️ Gardé au parc', scratch: '🗑️ Scratch', note: '📝 Noté' }
const srcDepuisType = (t?: string) => { const m = String(t || '').toLowerCase(); return m.includes('mal') && m.includes('gar') ? 'police_mg' : m.includes('accident') ? 'police_accident' : m.includes('saisie') ? 'police_saisie' : m.includes('rodeo') || m.includes('rodéo') ? 'police_rodeo' : m.includes('avp') || m.includes('abandon') ? 'police_avp' : m.includes('priv') ? 'prive' : 'legacy_towsoft_migration' }

const vide = { plate: '', vin: '', brand: '', model: '', date: '' }

export default function ReleveClient() {
  const [lieux, setLieux] = useState<Lieux>({})
  const [releves, setReleves] = useState<any[]>([])
  const [rel, setRel] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [s, setS] = useState({ ...vide })
  const [res, setRes] = useState<any>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [choix, setChoix] = useState<string | null>(null)        // mission_id retenue
  const [source, setSource] = useState('legacy_towsoft_migration')
  const [zone, setZone] = useState('')
  const [remark, setRemark] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)

  const charger = () => fetch('/api/fourriere/releve', { cache: 'no-store' }).then(r => r.json()).then(j => { setLieux(j.lieux || {}); setReleves(j.releves || []) })
  const ouvrir = (id: string) => fetch(`/api/fourriere/releve?id=${id}`, { cache: 'no-store' }).then(r => r.json()).then(j => { setRel(j.releve); setItems(j.items || []) })
  useEffect(() => { charger() }, [])

  const post = async (body: any) => {
    const r = await fetch('/api/fourriere/releve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || 'Erreur')
    return j
  }
  const demarrer = async (lieu: string) => { setBusy('start'); setErr(null); try { const j = await post({ lieu }); setRel(j.releve); setItems([]) } catch (e: any) { setErr(e.message) } finally { setBusy(null) } }
  const rechercher = async () => {
    setBusy('search'); setErr(null); setRes(null); setChoix(null); setConfirm(null)
    try {
      const j = await post({ id: rel.id, action: 'rechercher', saisie: s })
      setRes(j)
      const ts = j.towsoft?.[0]; setSource(srcDepuisType(ts?.type))
      if (!s.date && ts?.date) setS(x => ({ ...x, date: ts.date }))
      if (j.vdsoft?.length === 1) setChoix(j.vdsoft[0].id)
    } catch (e: any) { setErr(e.message) } finally { setBusy(null) }
  }
  const decider = async (decision: string) => {
    setBusy(decision); setErr(null)
    try {
      const j = await post({ id: rel.id, action: 'decider', saisie: s, candidates: res, decision, mission_id: choix || undefined, source, zone: zone || undefined, remark: remark || undefined })
      setItems(x => [...x, j.item]); setS({ ...vide }); setRes(null); setChoix(null); setRemark(''); setConfirm(null)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e: any) { setErr(e.message) } finally { setBusy(null) }
  }
  const cloturer = async () => { setBusy('close'); try { await post({ id: rel.id, action: 'cloturer' }); await ouvrir(rel.id) } catch (e: any) { setErr(e.message) } finally { setBusy(null) } }
  const exporter = () => {
    const head = ['Plaque', 'Châssis', 'Marque', 'Modèle', 'Date intervention', 'Décision', 'Fiche VD Soft', 'Fiche créée', 'Étiquette', 'Résultat', 'Remarque']
    const rows = items.map(i => [i.plate, i.vin, i.brand, i.model, i.intervention_date, DECISIONS[i.decision] || i.decision, i.mission_number ? `#${i.mission_number}` : '', i.created_mission ? 'oui' : '', i.label_printed ? 'oui' : '', i.result, i.remark])
    const csv = [head, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `releve-${rel.lieu}-${String(rel.started_at).slice(0, 10)}.csv`; a.click()
  }

  const lieu = rel ? lieux[rel.lieu] : null
  const inp = 'w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-ink'
  const btn = 'min-h-[48px] rounded-xl px-4 font-semibold disabled:opacity-50'

  if (!rel) return (
    <div className="max-w-xl mx-auto p-4 space-y-5">
      <p className="text-ink-secondary text-sm">Pour les véhicules sans étiquette : tu tapes ce que tu vois, VD Soft cherche dans ses fiches, Towsoft, les mails et l’ERP, puis tu décides.</p>
      <div className="space-y-2">
        <p className="font-semibold text-ink">Nouveau relevé — où es-tu ?</p>
        {Object.entries(lieux).map(([k, l]) => (
          <button key={k} disabled={!!busy} onClick={() => demarrer(k)} className={`${btn} w-full bg-blue-600 text-white text-left`}>{l.label}</button>
        ))}
      </div>
      {releves.length > 0 && (
        <div className="space-y-2">
          <p className="font-semibold text-ink">Relevés récents</p>
          {releves.map(r => (
            <button key={r.id} onClick={() => ouvrir(r.id)} className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 text-left text-ink">
              {lieux[r.lieu]?.label || r.lieu} — {new Date(r.started_at).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })} {r.closed_at ? '· terminé' : '· en cours'}
            </button>
          ))}
        </div>
      )}
      {err && <p className="text-red-700 bg-red-50 rounded-xl p-3 text-sm">⚠ {err}</p>}
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="font-bold text-ink text-lg">{lieu?.label || rel.lieu}</p>
          <p className="text-ink-muted text-xs">Commencé le {new Date(rel.started_at).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })} · {items.length} véhicule(s) {rel.closed_at ? '· terminé' : ''}</p>
        </div>
        <button onClick={() => { setRel(null); charger() }} className="text-sm underline text-ink-secondary min-h-[44px]">Changer de relevé</button>
      </div>

      {!rel.closed_at && (
        <div className="rounded-2xl border border-zinc-300 dark:border-zinc-700 p-4 space-y-3 bg-white/60 dark:bg-zinc-900/60">
          <p className="font-semibold text-ink">Véhicule n° {items.length + 1}</p>
          <p className="text-xs text-ink-muted">Plaque ou châssis si visibles ; sinon marque et modèle (et la date si tu la connais) : la recherche montre alors les véhicules de ce modèle encore au parc et dans Towsoft.</p>
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Plaque" value={s.plate} onChange={e => setS({ ...s, plate: e.target.value.toUpperCase() })} autoCapitalize="characters" />
            <input className={inp} placeholder="Châssis (même partiel)" value={s.vin} onChange={e => setS({ ...s, vin: e.target.value.toUpperCase() })} autoCapitalize="characters" />
            <input className={inp} placeholder="Marque" value={s.brand} onChange={e => setS({ ...s, brand: e.target.value })} />
            <input className={inp} placeholder="Modèle" value={s.model} onChange={e => setS({ ...s, model: e.target.value })} />
            <label className="col-span-2 text-xs text-ink-muted">Date d’intervention (si connue)<input type="date" className={inp} value={s.date} onChange={e => setS({ ...s, date: e.target.value })} /></label>
          </div>
          <button disabled={!!busy || (!s.plate.trim() && !s.vin.trim() && s.brand.trim().length < 2 && s.model.trim().length < 2)} onClick={rechercher} className={`${btn} w-full bg-blue-600 text-white`}>{busy === 'search' ? 'Recherche… (VD Soft, Towsoft, mails, ERP)' : '🔎 Rechercher'}</button>
        </div>
      )}

      {err && <p className="text-red-700 bg-red-50 rounded-xl p-3 text-sm">⚠ {err}</p>}

      {res && (
        <div className="space-y-4">
          {res.erreurs?.length > 0 && <p className="text-amber-800 bg-amber-50 rounded-xl p-2 text-xs">Recherche incomplète : {res.erreurs.join(' · ')}</p>}

          <Bloc titre={`Fiches VD Soft (${res.vdsoft.length})`}>
            {res.vdsoft.length === 0 && <p className="text-sm text-ink-muted">Aucune fiche.</p>}
            {res.vdsoft.map((m: any) => (
              <label key={m.id} className={`flex gap-3 items-start rounded-xl border p-3 cursor-pointer ${choix === m.id ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30' : 'border-zinc-300 dark:border-zinc-700'}`}>
                <input type="radio" className="mt-1 w-5 h-5" checked={choix === m.id} onChange={() => setChoix(m.id)} />
                <div className="text-sm text-ink">
                  <b>#{m.mission_number}</b> · {m.vehicle_plate || '—'} · {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')}<br />
                  {m.source} · <b className={m.status === 'cancelled' ? 'text-red-700' : ''}>{m.status === 'cancelled' ? 'ANNULÉE' : m.status}</b>{m.parc_zone_key ? ` · zone ${m.parc_zone_key}` : ''} · {String(m.intervention_date || '').slice(0, 10)}
                  {m.vehicle_vin ? <><br /><span className="text-ink-muted">VIN {m.vehicle_vin}</span></> : null}
                  {m.officer_name || m.dossier_number ? <><br /><span className="text-ink-muted">{[m.officer_name, m.dossier_number].filter(Boolean).join(' · ')}</span></> : null}
                </div>
              </label>
            ))}
            {res.vdsoft.length > 0 && <button onClick={() => setChoix(null)} className="text-sm underline text-ink-secondary min-h-[44px]">Aucune de ces fiches</button>}
          </Bloc>

          <Bloc titre={`Towsoft (${res.towsoft.length})`}>
            {res.towsoft.length === 0 && <p className="text-sm text-ink-muted">Aucune fiche Towsoft.</p>}
            {res.towsoft.map((t: any) => (
              <div key={t.num} className="rounded-xl border border-zinc-300 dark:border-zinc-700 p-3 text-sm text-ink">
                <b>Towsoft {t.num}</b> · {t.date} · <b>{t.statut}</b> · {t.type}<br />
                {t.plate || '—'} · {t.marque} {t.vin ? `· VIN ${t.vin}` : ''}<br />
                <span className="text-ink-muted">{t.lieu}{t.destination ? ` → ${t.destination}` : ''}</span><br />
                <span className="text-ink-muted">{[t.client, t.dossier, t.remarques].filter(Boolean).join(' · ')}</span>
                {/facture\s*ok/i.test(`${t.dossier} ${t.remarques}`) && <p className="mt-1 text-amber-800 font-semibold">💶 « Facture ok » : le client a déjà payé — pas d’état de frais.</p>}
                {t.url && <><br /><a href={t.url} target="_blank" rel="noreferrer" className="underline text-blue-700">Ouvrir dans Towsoft</a></>}
              </div>
            ))}
          </Bloc>

          <Bloc titre={`Mails (${res.mails.length})`}>
            {res.mails.length === 0 && <p className="text-sm text-ink-muted">Aucun mail.</p>}
            {res.mails.map((m: any) => (
              <div key={m.id} className="rounded-xl border border-zinc-300 dark:border-zinc-700 p-3 text-sm text-ink">
                <b>{m.date}</b> · {m.boite} · {m.de}{m.pj ? ' · 📎' : ''}<br /><b>{m.objet}</b><br /><span className="text-ink-muted">{m.apercu}</span>
                {m.lien && <><br /><a href={m.lien} target="_blank" rel="noreferrer" className="underline text-blue-700">Ouvrir le mail</a></>}
              </div>
            ))}
          </Bloc>

          <Bloc titre={`ERP (${res.erp.length})`}>
            {res.erp.length === 0 && <p className="text-sm text-ink-muted">Rien dans l’ERP.</p>}
            {res.erp.map((v: any, i: number) => (
              <div key={i} className="rounded-xl border border-zinc-300 dark:border-zinc-700 p-3 text-sm text-ink">
                <b>{v.vehicule}</b>{v.chassis ? ` · VIN ${v.chassis}` : ''}{v.etat ? ` · ${v.etat}` : ''}
                {v.factures.map((f: any) => <div key={f.nom}>{f.nom} · {f.client} · {f.montant} € · {f.paye === 'paid' ? 'payée' : f.paye}</div>)}
              </div>
            ))}
          </Bloc>

          <div className="rounded-2xl border-2 border-blue-600 p-4 space-y-3">
            <p className="font-semibold text-ink">Décision</p>
            {!choix && (
              <div className="grid grid-cols-1 gap-2">
                <label className="text-xs text-ink-muted">Type de fiche à créer
                  <select className={inp} value={source} onChange={e => setSource(e.target.value)}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </label>
                {!lieu?.zone && (
                  <label className="text-xs text-ink-muted">Zone
                    <select className={inp} value={zone} onChange={e => setZone(e.target.value)}><option value="">— choisir —</option>{ZONES_PEPINSTER.map(z => <option key={z} value={z}>{z}</option>)}</select>
                  </label>
                )}
              </div>
            )}
            <textarea className={`${inp} min-h-[60px] py-2`} placeholder="Remarque (état, clés, emplacement…)" value={remark} onChange={e => setRemark(e.target.value)} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {choix && <button disabled={!!busy} onClick={() => decider('present_ok')} className={`${btn} bg-emerald-600 text-white`}>✅ C’est cette fiche, il est bien ici</button>}
              <button disabled={!!busy || (!choix && !lieu?.zone && !zone)} onClick={() => decider('garder')} className={`${btn} bg-blue-600 text-white`}>🅿️ {choix ? 'Garder + réimprimer l’étiquette' : 'Garder au parc (créer la fiche + étiquette)'}</button>
              {confirm === 'scratch'
                ? <button disabled={!!busy} onClick={() => decider('scratch')} className={`${btn} bg-red-700 text-white`}>Confirmer : scratch et sortie du parc</button>
                : <button disabled={!!busy} onClick={() => setConfirm('scratch')} className={`${btn} bg-red-100 text-red-800 border border-red-300`}>🗑️ Scratch (épave, sortie du parc)</button>}
              <button disabled={!!busy} onClick={() => decider('note')} className={`${btn} border border-zinc-300 dark:border-zinc-700 text-ink`}>📝 Juste noter</button>
            </div>
            {busy && busy !== 'search' && <p className="text-sm text-ink-muted">Enregistrement…</p>}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="font-semibold text-ink">Listing du relevé ({items.length})</p>
          <div className="flex gap-2">
            {items.length > 0 && <button onClick={exporter} className={`${btn} border border-zinc-300 dark:border-zinc-700 text-ink text-sm`}>⬇ Télécharger (Excel)</button>}
            {!rel.closed_at && items.length > 0 && <button disabled={!!busy} onClick={cloturer} className={`${btn} bg-zinc-800 text-white text-sm`}>Terminer le relevé</button>}
          </div>
        </div>
        {items.length === 0 && <p className="text-sm text-ink-muted">Aucun véhicule relevé pour l’instant.</p>}
        {[...items].reverse().map(i => (
          <div key={i.id} className="rounded-xl border border-zinc-300 dark:border-zinc-700 p-3 text-sm text-ink">
            <b>{i.plate || i.vin || '—'}</b> {[i.brand, i.model].filter(Boolean).join(' ')} · {DECISIONS[i.decision] || i.decision}{i.mission_number ? ` · fiche #${i.mission_number}` : ''}<br />
            <span className="text-ink-muted">{i.result}</span>{i.remark ? <><br /><span className="text-ink-muted">« {i.remark} »</span></> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  return <div className="space-y-2"><p className="font-semibold text-ink text-sm uppercase tracking-wide">{titre}</p>{children}</div>
}
