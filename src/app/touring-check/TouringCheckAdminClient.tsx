'use client'
// src/app/touring-check/TouringCheckAdminClient.tsx

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import AppShell from '@/components/layout/AppShell'

const RESP: Record<string, { label: string; cls: string; willDo: (item: any) => string }> = {
  already_invoiced: {
    label: 'Déjà facturé', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    willDo: (it) => `Passe ${nFiches(it)} en Facturation OK, n° « Déjà facturé avec numéro d'accord ${it.response_note || '…'} ».`,
  },
  not_covered: {
    label: 'Contrat 105 non couvert', cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    willDo: (it) => `Annule ${nFiches(it)}, motif « Non couvert ».`,
  },
  invoice_hors_comex: {
    label: 'À facturer hors comex', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    willDo: (it) => it.is_combined || nb(it) > 1
      ? 'Dossier combiné → tampon « À facturer hors comex » (traitement manuel).'
      : 'Dossier simple → lance l\'auto-facturation.',
  },
  deplacement_hors_comex: {
    label: 'Déplacement à facturer hors comex', cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    willDo: () => 'Vérifie le type « trajet à vide » → auto-facturation (sinon tampon à vérifier).',
  },
  other: {
    label: 'Autre → à vérifier', cls: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
    willDo: () => 'Tampon « À vérifier » + remarque Touring en facturation (traitement manuel).',
  },
}
const nb = (it: any) => (Array.isArray(it.fiches) ? it.fiches.length : 0)
const nFiches = (it: any) => `${nb(it)} fiche${nb(it) > 1 ? 's' : ''}`

const KIND_CLS: Record<string, string> = {
  REM: 'bg-amber-500/15 text-amber-700', DSP: 'bg-sky-500/15 text-sky-700',
  REL: 'bg-purple-500/15 text-purple-700', DPR: 'bg-rose-500/15 text-rose-700', AUTRE: 'bg-gray-500/15 text-gray-600',
}
const CHAIN = ['bg-amber-500/5 border-amber-500/40', 'bg-sky-500/5 border-sky-500/40', 'bg-emerald-500/5 border-emerald-500/40', 'bg-purple-500/5 border-purple-500/40']

function fmtDate(s: string | null) {
  if (!s) return ''
  return new Date(s).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TouringCheckAdminClient(props: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [data, setData] = useState<any>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const loadRef = useRef<() => void>(() => {})
  async function load() {
    const r = await fetch('/api/touring/check', { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    setData(j)
  }
  loadRef.current = load
  useEffect(() => { load() }, [])

  // Temps réel : on écoute le signal (mini-table sans donnée sensible) et on
  // recharge dès que Touring répond ou qu'un dossier entre/sort. + filet polling.
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    let ch: any
    if (url && key) {
      const sb = createClient(url, key)
      ch = sb.channel('touring-check-signal')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'touring_check_signal' }, () => loadRef.current())
        .subscribe()
    }
    const onVis = () => { if (document.visibilityState === 'visible') loadRef.current() }
    document.addEventListener('visibilitychange', onVis)
    const iv = setInterval(() => loadRef.current(), 20000)
    return () => { try { ch?.unsubscribe() } catch {} ; document.removeEventListener('visibilitychange', onVis); clearInterval(iv) }
  }, [])

  async function post(body: any, label: string) {
    setBusy(label); setMsg('')
    const r = await fetch('/api/touring/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    setBusy(null)
    if (!r.ok) { setMsg(j.error || 'Erreur'); return j }
    return j
  }

  async function refresh() {
    const j = await post({ action: 'refresh' }, 'refresh')
    if (j?.ok) setMsg(`Rafraîchi · 🤖 ${j.reconcile?.reconciled || 0} rapproché(s) via accord · ${j.count} dossier(s) restant(s)`)
    load()
  }
  async function apply(id: string) { const j = await post({ action: 'apply', id }, id); if (j?.result) setMsg(j.result); load() }
  async function dismiss(id: string) { if (!confirm('Retirer ce dossier de la liste ?')) return; await post({ action: 'dismiss', id }, id); load() }
  async function rotate() { if (!confirm('Régénérer le lien invalidera l\'ancien. Continuer ?')) return; await post({ action: 'rotate' }, 'rotate'); load() }
  function copy() { if (data?.link) { navigator.clipboard?.writeText(data.link); setMsg('Lien copié'); } }

  const items: any[] = data?.items || []
  const counts = data?.counts || {}
  const c = data?.counts || {}

  return (
    <AppShell title="Check Touring" userRole={props.userRole} userName={props.userName} userEmail={props.userEmail} userModules={props.userModules}>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-[#d6002a] text-white flex items-center justify-center text-lg font-bold">🅣</div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-ink flex items-center gap-2">Check Touring
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#d6002a] text-white">{counts.total || 0} dossier{(counts.total || 0) > 1 ? 's' : ''}</span>
            </h1>
            <p className="text-ink-muted text-sm">
              Dossiers Touring hors COMEX à faire trancher
              {c.answered ? <> · <b className="text-emerald-600">{c.answered} réponse{c.answered > 1 ? 's' : ''} à appliquer</b></> : null}
            </p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 my-4">
          <button onClick={refresh} disabled={busy === 'refresh'}
            className="bg-[#d6002a] text-white font-semibold text-sm px-4 py-2 rounded-lg disabled:opacity-50">
            {busy === 'refresh' ? '⏳ Rapprochement…' : '🔄 Rafraîchir la liste'}
          </button>
          <div className="flex-1 min-w-[220px] flex items-center gap-2 bg-surface-2 border border-dashed rounded-lg px-3 py-1.5">
            <span className="font-mono text-xs text-ink-secondary truncate flex-1">{data?.link || '…'}</span>
            <button onClick={copy} className="text-xs font-semibold text-brand hover:underline whitespace-nowrap">📋 Copier</button>
          </div>
          <button onClick={rotate} className="text-xs font-medium text-ink-muted hover:text-ink border rounded-lg px-3 py-2">♻︎ Régénérer le lien</button>
        </div>
        {data?.email && <p className="text-xs text-ink-faint -mt-2 mb-3">Rappel mensuel envoyé à <b>{data.email}</b> le 5 à 13h · rapprochement auto le mercredi 8h.</p>}
        {msg && <div className="mb-3 text-sm bg-surface-2 border rounded-lg px-3 py-2 text-ink-secondary">{msg}</div>}

        {/* Liste */}
        {items.length === 0 && <div className="bg-surface border rounded-2xl p-8 text-center text-ink-muted">Aucun dossier. Clique sur « Rafraîchir la liste ».</div>}

        <div className="space-y-3">
          {items.map((it, idx) => {
            const tint = it.is_combined ? CHAIN[idx % CHAIN.length] : 'bg-surface border-default'
            const fiches: any[] = Array.isArray(it.fiches) ? it.fiches : []
            const resp = it.response_code ? RESP[it.response_code] : null
            return (
              <div key={it.id} className={`border rounded-2xl overflow-hidden ${tint}`}>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-black/5 dark:border-white/5 flex-wrap">
                  <span className="font-mono font-bold text-sm text-ink">{it.dossier_number || '—'}</span>
                  <span className="text-xs text-ink-muted tabular-nums">{fmtDate(it.intervention_date)}</span>
                  {it.is_combined && <span className="text-[11px] font-bold text-amber-700 bg-amber-500/15 px-2 py-0.5 rounded-full">🔗 Combiné · {fiches.length} fiches</span>}
                  {fiches.slice(0, it.is_combined ? 0 : 1).map((f, i) => <span key={i} className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${KIND_CLS[f.kind] || KIND_CLS.AUTRE}`}>{f.kind}</span>)}
                  <span className="ml-auto text-[11px] text-ink-faint">{fiches.map(f => f.plate).filter(Boolean).join(' · ')}</span>
                </div>

                {fiches.some(f => f.is_police) && (
                  <div className="px-4 py-1.5 text-xs font-semibold text-ink border-b border-black/5 dark:border-white/5">
                    {fiches.filter(f => f.is_police).map((f, i) => (
                      <span key={i} className="mr-3">🚓 Appel police{f.plate ? ` (${f.plate})` : ''} : {f.police_depannage_htva != null ? `${f.police_depannage_htva.toFixed(2)} € HT` : '—'}</span>
                    ))}
                  </div>
                )}

                {it.status === 'applied' ? (
                  <div className="px-4 py-3 text-sm text-ink-muted flex items-center gap-2">
                    <span className="text-emerald-600">✅ Appliqué</span> — {it.applied_result}
                  </div>
                ) : resp ? (
                  <div className="px-4 py-3 flex flex-wrap items-center gap-3">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${resp.cls}`}>{resp.label}{it.response_note ? ` · ${it.response_note}` : ''}</span>
                    <span className="text-xs text-ink-muted flex-1 min-w-[160px]">{resp.willDo(it)}</span>
                    <button onClick={() => apply(it.id)} disabled={busy === it.id}
                      className="bg-[#d6002a] text-white text-sm font-semibold px-4 py-1.5 rounded-lg disabled:opacity-50">
                      {busy === it.id ? '…' : '✅ Appliquer'}
                    </button>
                    <button onClick={() => dismiss(it.id)} className="text-xs text-ink-faint hover:text-ink">retirer</button>
                  </div>
                ) : (
                  <div className="px-4 py-3 text-sm text-ink-faint italic flex items-center justify-between">
                    <span>⏳ En attente de la réponse de Touring…</span>
                    <button onClick={() => dismiss(it.id)} className="text-xs text-ink-faint hover:text-ink not-italic">retirer</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </AppShell>
  )
}
