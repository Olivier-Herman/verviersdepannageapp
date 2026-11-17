'use client'
// Contrôle aléatoire du parc (Olivier 17/11/2026) : sur le téléphone, un véhicule à la fois (scanner son étiquette,
// « Pas trouvé », « Dans une autre zone ») puis « Merci » ; au bureau, la recherche des véhicules pas trouvés avec les
// pistes préparées par VD Soft. Maquette https://claude.ai/artifact/1DStEWrJtFLfHRLRe3E2Dv validée.
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
const QRScanner = dynamic(() => import('@/components/fourriere/QRScanner'), { ssr: false })

const fr = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' }) : '—'

export default function ControleAleatoireClient({ id, zones }: { id: string; zones: string[] }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [autreZone, setAutreZone] = useState(false)
  const charger = async (pistes = false) => {
    try { const r = await fetch(`/api/parc/controle-aleatoire/${id}${pistes ? '?pistes=1' : ''}`, { cache: 'no-store' }); const j = await r.json(); if (r.ok) setD(j); else setErr(j.error || 'Contrôle illisible') } catch { setErr('Erreur réseau') }
  }
  useEffect(() => { charger(true) }, [id])   // eslint-disable-line react-hooks/exhaustive-deps
  const post = async (body: any) => {
    setBusy(true); setErr(null); setInfo(null)
    try {
      const r = await fetch(`/api/parc/controle-aleatoire/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok || j.ok === false) { setErr(j.error || 'Action refusée'); return false }
      await charger(true); return true
    } catch { setErr('Erreur réseau'); return false } finally { setBusy(false) }
  }
  if (!d) return <div className="p-4 text-ink-secondary">{err || 'Chargement…'}</div>
  const c = d.controle, items: any[] = d.items || []
  const restant = items.filter(i => !i.resultat)
  const courant = restant[0]
  const faits = items.length - restant.length
  const absents = items.filter(i => i.resultat === 'absent')

  // Pas encore lancé : le lancer d'ici (le téléphone peut aussi démarrer).
  if (c.status === 'demande') return (
    <div className="p-4 max-w-md mx-auto space-y-3">
      <h1 className="text-xl font-bold text-ink">Contrôle du parc : {items.length} véhicules</h1>
      <p className="text-ink-secondary text-sm">Un véhicule à la fois : scanner son étiquette, ou « Pas trouvé ».</p>
      {err && <p className="text-sm font-semibold text-red-700">{err}</p>}
      <button type="button" disabled={busy} onClick={() => post({ action: 'start' })} className="w-full min-h-[52px] rounded-xl bg-sky-700 text-white font-bold">Commencer</button>
    </div>
  )

  // Scans un par un.
  if (courant && c.status === 'en_cours') {
    const f = courant.fiche || {}
    return (
      <div className="p-4 max-w-md mx-auto space-y-3">
        <div>
          <p className="font-bold text-ink">Contrôle du parc · {faits + 1} / {items.length}</p>
          <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden mt-2"><div className="h-full bg-sky-600" style={{ width: `${(faits / items.length) * 100}%` }} /></div>
        </div>
        <div className="rounded-2xl border p-4 space-y-1 bg-surface">
          <p className="text-xs uppercase tracking-widest text-ink-muted">À trouver</p>
          <p className="text-3xl font-bold text-ink">{f.vehicle_plate || 'sans plaque'}</p>
          <p className="text-ink-secondary">{[f.vehicle_brand, f.vehicle_model].filter(Boolean).join(' ') || '—'}</p>
          <p><span className="inline-block rounded-lg bg-sky-50 text-sky-800 font-bold text-lg px-3 py-1">Zone {courant.zone_attendue || '?'}</span></p>
          <p className="text-sm text-ink-muted">Fiche #{f.mission_number} · entré le {fr(f.parked_at || f.created_at)}{f.levee_saisie_at ? ` · levée le ${fr(f.levee_saisie_at)}` : ''}</p>
        </div>
        {err && <p className="text-sm font-semibold text-red-700">{err}</p>}
        {info && <p className="text-sm font-semibold text-emerald-700">{info}</p>}
        <button type="button" disabled={busy} onClick={() => setCamera(true)} className="w-full min-h-[56px] rounded-xl bg-sky-700 text-white font-bold text-lg">📷 Scanner l’étiquette</button>
        <button type="button" disabled={busy} onClick={() => post({ action: 'absent', item_id: courant.id })} className="w-full min-h-[52px] rounded-xl border-2 border-red-600 bg-red-50 text-red-800 font-bold">Pas trouvé</button>
        {!autreZone
          ? <button type="button" disabled={busy} onClick={() => setAutreZone(true)} className="w-full min-h-[48px] rounded-xl border border-slate-300 text-ink font-semibold">Le véhicule est dans une autre zone…</button>
          : <div className="rounded-xl border p-3 space-y-2"><p className="text-sm font-semibold text-ink">Dans quelle zone est-il ?</p>
              <div className="flex flex-wrap gap-2">{zones.map(z => <button key={z} type="button" disabled={busy} onClick={async () => { if (await post({ action: 'autre_zone', item_id: courant.id, zone: z })) setAutreZone(false) }} className="min-h-[44px] min-w-[52px] rounded-lg border border-slate-300 font-bold text-ink px-2">{z}</button>)}</div>
              <button type="button" onClick={() => setAutreZone(false)} className="min-h-[44px] text-sm text-ink-secondary underline">Annuler</button></div>}
        {camera && (
          <QRScanner title={`Scanner ${f.vehicle_plate || 'le véhicule'}`} paused={busy} onClose={() => setCamera(false)}
            onScan={async (qr: string) => { setCamera(false); if (await post({ action: 'scan', item_id: courant.id, qr })) setInfo(`✅ ${f.vehicle_plate || 'Véhicule'} présent`) }} />
        )}
      </div>
    )
  }

  // Terminé : merci, puis la recherche des pas trouvés.
  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <div className="rounded-2xl border p-4 bg-surface text-center space-y-2">
        <p className="text-2xl font-bold text-ink">✅ Merci !</p>
        <p className="text-ink-secondary">Contrôle du {fr(c.prevu_at)}{c.started_by_name ? ` par ${c.started_by_name}` : ''} : <b>{items.length - absents.length}</b> présent(s), <b className="text-red-700">{absents.length}</b> pas trouvé(s).</p>
        {absents.length > 0 && <p className="text-sm text-ink-muted">Les véhicules pas trouvés sont à rechercher au bureau : les pistes sont ci-dessous.</p>}
      </div>
      {err && <p className="text-sm font-semibold text-red-700">{err}</p>}
      {absents.map(i => <Recherche key={i.id} it={i} zones={zones} busy={busy} onPost={post} />)}
      <a href="/fourriere/controle-aleatoire" className="block text-center min-h-[44px] text-sm text-ink-secondary underline">Tous les contrôles</a>
    </div>
  )
}

function Recherche({ it, zones, busy, onPost }: { it: any; zones: string[]; busy: boolean; onPost: (b: any) => Promise<boolean> }) {
  const f = it.fiche || {}
  const [choix, setChoix] = useState<string | null>(null)
  const [zone, setZone] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const lib: Record<string, string> = { retrouve: 'retrouvé au parc', restitue: 'restitué au propriétaire', epave: 'parti chez un épaviste (Scratch)', domaine: 'vendu ou remis au Domaine', recherche: 'on cherche encore (non localisé)' }
  if (it.resolu_at) return <div className="rounded-2xl border p-4 bg-surface"><p className="font-bold text-ink">{f.vehicle_plate} · {lib[it.resolution] || it.resolution}</p>{it.resolution_note && <p className="text-sm text-ink-secondary">{it.resolution_note}</p>}</div>
  return (
    <div className="rounded-2xl border-2 border-red-300 p-4 bg-surface space-y-3">
      <div>
        <p className="text-xs uppercase tracking-widest text-red-700 font-semibold">Pas trouvé</p>
        <p className="text-xl font-bold text-ink">{f.vehicle_plate || 'sans plaque'} · {[f.vehicle_brand, f.vehicle_model].filter(Boolean).join(' ')}</p>
        <p className="text-sm text-ink-muted">Devait être en zone {it.zone_attendue || '?'} · fiche <a className="underline" href={`/dispatch/${it.mission_id}?fiche=1`}>#{f.mission_number}</a></p>
      </div>
      <div className="space-y-1">{(it.pistes || []).map((p: any, k: number) => <p key={k} className="text-sm text-ink-secondary"><span className="mr-2">{p.icone}</span>{p.texte}</p>)}{!(it.pistes || []).length && <p className="text-sm text-ink-muted">Pistes en cours de lecture…</p>}</div>
      <div className="grid gap-2 sm:grid-cols-2">{Object.entries(lib).map(([k, v]) => <button key={k} type="button" onClick={() => setChoix(k)} className={`min-h-[44px] rounded-xl border px-3 text-left font-semibold ${choix === k ? 'border-sky-600 bg-sky-50 text-sky-900' : 'border-slate-300 text-ink'}`}>{v}</button>)}</div>
      {choix && (
        <div className="space-y-2">
          {choix === 'retrouve' && <div className="flex flex-wrap gap-2">{zones.map(z => <button key={z} type="button" onClick={() => setZone(z)} className={`min-h-[44px] min-w-[52px] rounded-lg border font-bold px-2 ${zone === z ? 'border-sky-600 bg-sky-50 text-sky-900' : 'border-slate-300 text-ink'}`}>{z}</button>)}</div>}
          {(choix === 'restitue' || choix === 'domaine') && <label className="block text-sm text-ink">Date de sortie <input type="date" value={date} onChange={e => setDate(e.target.value)} className="ml-2 rounded-lg border border-slate-300 px-2 min-h-[44px]" /></label>}
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Ce qui s’est passé (optionnel)" className="w-full rounded-lg border border-slate-300 p-2 text-sm" rows={2} />
          <button type="button" disabled={busy || (choix === 'retrouve' && !zone)} onClick={() => onPost({ action: 'resoudre', item_id: it.id, choix, zone, date, note })} className="w-full min-h-[48px] rounded-xl bg-sky-700 text-white font-bold disabled:opacity-50">Enregistrer</button>
        </div>
      )}
    </div>
  )
}
