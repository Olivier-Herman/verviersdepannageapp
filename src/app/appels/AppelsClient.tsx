'use client'
// « Appels à rattacher » — voir page.tsx. Maquette validée le 24/11/2026 (claude.ai/artifact/BhdJ61GbeiXDT2e86YvVdk).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Info, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import ChoisirFiche, { type FicheChoix } from '@/components/appels/ChoisirFiche'
import { dureeTxt, quandTxt, pastilleSens } from '@/components/appels/format'

interface AppelVue {
  id: string; debut: string; sens: 'entrant' | 'sortant'; perdu: boolean; service: string | null; numero_lisible: string
  duree_s: number; resume: string; suggestions: FicheChoix[]; fiche: (FicheChoix) | null; lien: string | null
  motif: string | null; ignore: boolean
}
type Onglet = 'a' | 'auto' | 'non'

function CarteAppel({ a, onFait }: { a: AppelVue; onFait: (msg: string) => void }) {
  const [choix, setChoix] = useState<FicheChoix | null>(null)
  const [retenir, setRetenir] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const p = pastilleSens(a.sens, a.perdu)
  const masque = a.numero_lisible.includes('*')
  const envoyer = async (corps: any, msg: string) => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/appels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Enregistrement impossible')
      onFait(msg)
    } catch (e: any) { setErr(e.message); setBusy(false) }
  }
  return (
    <div className="bg-surface border rounded-xl p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${p.cls}`}>{p.txt}</span>
        <span className="text-lg font-semibold text-ink">{a.numero_lisible}</span>
        <span className="text-sm text-ink-secondary">{quandTxt(a.debut)}{a.duree_s ? ` · ${dureeTxt(a.duree_s)}` : ''}{a.service ? ` · ${a.service}` : ''}</span>
        <span className="text-sm text-ink-secondary">· {a.resume}</span>
      </div>
      <ChoisirFiche proposees={a.suggestions} choisie={choix?.id || null} onChoisir={setChoix} />
      {err && <p className="text-sm text-red-800 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
      <div className="flex flex-wrap items-center gap-2 justify-end">
        {!masque && (
          <label className="flex items-center gap-2 min-h-[44px] mr-auto text-sm text-ink-secondary">
            <input type="checkbox" checked={retenir} onChange={e => setRetenir(e.target.checked)} className="w-[18px] h-[18px]" />
            Retenir ce numéro pour cette fiche
          </label>
        )}
        {!masque && (
          <button type="button" disabled={busy} onClick={() => envoyer({ action: 'pas_lie', appel_id: a.id, jamais: true }, `${a.numero_lisible} ne sera plus proposé.`)}
            title="Pour un numéro qui n’appelle jamais pour un dossier précis (fournisseur, assisteur, police…)"
            className="min-h-[44px] px-4 rounded-lg border bg-surface text-sm font-medium text-ink hover:bg-surface-hover disabled:opacity-40">Ne plus proposer ce numéro</button>
        )}
        <button type="button" disabled={busy} onClick={() => envoyer({ action: 'pas_lie', appel_id: a.id }, 'Appel classé « pas lié à une fiche ».')}
          className="min-h-[44px] px-4 rounded-lg border bg-surface text-sm font-medium text-ink hover:bg-surface-hover disabled:opacity-40">Pas lié à une fiche</button>
        <button type="button" disabled={busy || !choix} onClick={() => choix && envoyer({ action: 'rattacher', appel_id: a.id, mission_id: choix.id, retenir: retenir && !masque }, `Appel rattaché à ${choix.titre}.`)}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg text-sm font-semibold bg-blue-700 text-white hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-700">
          {busy && <Loader2 size={15} className="animate-spin" />}{choix ? `Rattacher à ${choix.titre}` : 'Choisissez une fiche'}
        </button>
      </div>
    </div>
  )
}

function ReProposer({ motif, onFait }: { motif: string; onFait: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <>
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true); setErr(null)
        try { const r = await fetch('/api/appels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reproposer', numero8: motif }) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Action impossible'); onFait() }
        catch (e: any) { setErr(e.message); setBusy(false) }
      }} className="ml-2 min-h-[44px] px-3 rounded-lg border text-xs font-semibold text-ink hover:bg-surface-hover disabled:opacity-40">Proposer de nouveau</button>
      {err && <span className="ml-2 text-xs text-red-800">{err}</span>}
    </>
  )
}

export default function AppelsClient() {
  const [onglet, setOnglet] = useState<Onglet>('a')
  const [data, setData] = useState<{ comptes: Record<Onglet, number>; appels: AppelVue[]; releve: any } | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const charger = useCallback(async (o: Onglet) => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch(`/api/appels?onglet=${o}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Chargement impossible')
      setData(j)
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { charger(onglet) }, [onglet, charger])

  const rel = data?.releve
  const releveEnRetard = rel && (Date.now() - +new Date(rel.at) > 60 * 60e3)
  const ongs: [Onglet, string][] = [['a', 'À rattacher'], ['auto', 'Rattachés'], ['non', 'Pas liés']]

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Appels à rattacher</h1>
          <p className="text-sm text-ink-secondary">Les appels des dernières 48 heures dont le numéro ne désigne pas une seule fiche.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ongs.map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setMsg(null); setOnglet(k) }}
              className={`min-h-[44px] px-4 rounded-full text-sm font-semibold ${onglet === k ? 'bg-blue-700 text-white border border-blue-700' : 'bg-surface text-ink border hover:bg-surface-hover'}`}>
              {l}{data ? ` (${data.comptes[k]})` : ''}
            </button>
          ))}
          <button type="button" onClick={() => charger(onglet)} aria-label="Actualiser" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full border bg-surface text-ink hover:bg-surface-hover"><RefreshCw size={16} /></button>
        </div>
      </div>

      <div className="flex gap-2.5 items-start rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-3 text-sm text-blue-900">
        <Info size={18} className="shrink-0 mt-0.5" />
        <span>Un appel arrive ici environ 30 minutes après avoir raccroché (délai de Microsoft). Si son numéro est sur une seule fiche en cours, ou s’il a été retenu pour une fiche, il s’y rattache tout seul et n’apparaît pas ici. Les appels perdus et ceux du personnel n’y figurent pas.</span>
      </div>
      {rel && (rel.erreurs?.length > 0 || releveEnRetard) && (
        <div className="flex gap-2.5 items-start rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span>{releveEnRetard ? `Les appels n’ont plus été relevés depuis ${quandTxt(rel.at)} : la liste n’est pas à jour.` : `Le dernier relevé des appels a rencontré un problème (${rel.erreurs[0]}).`} Prévenez Mobi s’il persiste.</span>
        </div>
      )}
      {msg && <p className="text-sm text-green-800 bg-green-50 rounded-lg px-3 py-2">{msg}</p>}
      {err && <p className="text-sm text-red-800 bg-red-50 rounded-lg px-3 py-2">{err} <button type="button" onClick={() => charger(onglet)} className="underline font-semibold">Réessayer</button></p>}
      {loading && !data && <p className="flex items-center gap-2 text-sm text-ink-secondary"><Loader2 size={16} className="animate-spin" /> Chargement des appels…</p>}

      {data && !data.appels.length && !loading && (
        <p className="text-sm text-ink-muted bg-surface border rounded-xl px-4 py-6 text-center">
          {onglet === 'a' ? 'Rien à rattacher : tous les appels ont trouvé leur fiche.' : onglet === 'auto' ? 'Aucun appel rattaché ces dernières 48 heures.' : 'Aucun appel classé « pas lié ».'}
        </p>
      )}

      {data && onglet === 'a' && data.appels.map(a => (
        <CarteAppel key={a.id} a={a} onFait={m => { setMsg(m); charger('a') }} />
      ))}

      {data && onglet !== 'a' && data.appels.length > 0 && (
        <div className="bg-surface border rounded-xl divide-y">
          {data.appels.map(a => { const p = pastilleSens(a.sens, a.perdu); return (
            <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${p.cls}`}>{p.txt}</span>
              <span className="font-semibold text-ink">{a.numero_lisible}</span>
              <span className="text-ink-secondary">{quandTxt(a.debut)} · {a.resume}</span>
              <span className="ml-auto text-ink-secondary">
                {a.fiche ? <Link href={`/dispatch/${a.fiche.id}`} className="font-semibold text-blue-700 hover:text-blue-900">{a.fiche.titre}</Link> : null}
                {a.lien ? <span className="text-xs"> · {a.lien}</span> : null}
                {a.ignore && a.motif && <ReProposer motif={a.motif} onFait={() => { setMsg(`${a.numero_lisible} sera de nouveau proposé.`); charger(onglet) }} />}
              </span>
            </div>
          ) })}
        </div>
      )}
    </div>
  )
}
