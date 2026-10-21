'use client'

// Écran de contrôle du parc (Olivier 21/10/2026) : une colonne par zone, une carte par
// voiture, grise tant qu'elle n'est pas scannée, verte quand elle l'est (orange si elle a
// changé de zone, violet = Domaine). Se met à jour en direct pendant que Jona et Mobi
// scannent. « Tout est scanné » clôt le contrôle et ouvre l'analyse de fin.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { orderZones, zoneLabel, TAMPON, TAMPON_KEY, LAST, type Zone } from './zones'

interface Item {
  id: string; mission_id: string | null; expected: boolean; expected_zone: string | null; plate: string | null; vehicle: string | null
  mission_number: number | null; source: string | null; is_domaine: boolean; scanned_at: string | null; scanned_by_name: string | null
  scanned_zone: string | null; result: string | null; moved_from: string | null; moved_to: string | null; via: string | null
  analysis: any; decision: string | null; applied_at: string | null; applied_result: string | null
}
interface Ctrl { id: string; status: string; started_at: string; closed_at: string | null; applied_at: string | null; zones_done: Record<string, { at: string; by: string }>; scanners: Record<string, { name: string; zone: string; at: string }> }

const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
const DEC_LABEL: Record<string, string> = { sortir: 'Sortir du parc', rechercher: 'Garder et rechercher', laisser: 'Laisser tel quel', remettre: 'Remettre au parc', enquete: 'Signaler sur la fiche' }
const CAT_ORDER = ['paye', 'domaine', 'paye_sans_levee', 'levee', 'aucune', 'sortie_pendant']
const CAT_HELP: Record<string, string> = {
  paye: 'Facture payée (et levée reçue pour une saisie) : la voiture est très probablement partie sans être sortie de VD Soft. La sortie prend la date du paiement ou de la levée.',
  domaine: 'Vente ou enlèvement Domaine connu : la sortie n’a pas été encodée.',
  paye_sans_levee: 'Payée, mais aucune levée de saisie : un paiement ne vaut pas sortie. À rechercher ou à éclaircir.',
  levee: 'Levée reçue mais aucun paiement : à rechercher.',
  aucune: 'Ni paiement, ni levée, ni vente Domaine. À rechercher (deuxième passage) avant toute décision. « Garder et rechercher » la met dans les non-localisés.',
  sortie_pendant: 'La fiche est sortie du parc pendant le contrôle : rien à faire.',
}

function itemZone(it: Item): string | null {
  return it.moved_to || it.expected_zone
}

export default function ControleClient({ initialId }: { initialId: string | null }) {
  const [list, setList] = useState<{ id: string; status: string; started_at: string; closed_at: string | null; applied_at: string | null }[] | null>(null)
  const [id, setId] = useState<string | null>(initialId)
  const [ctrl, setCtrl] = useState<Ctrl | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmApply, setConfirmApply] = useState(false)
  const [results, setResults] = useState<{ plate: string | null; result: string }[] | null>(null)
  const [q, setQ] = useState('')

  const loadList = useCallback(async () => {
    const r = await fetch('/api/fourriere/controle', { cache: 'no-store' }).then(r => r.json()).catch(() => null)
    if (!r) return
    setList(r.controles || [])
    if (!initialId && r.current) setId(r.current.id)
  }, [initialId])

  const load = useCallback(async () => {
    if (!id) return
    const r = await fetch(`/api/fourriere/controle/${id}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null)
    if (!r || r.error) { setErr(r?.error || 'Chargement impossible'); return }
    setCtrl(r.controle); setItems(r.items || []); setZones(orderZones(r.zones || [])); setErr(null)
  }, [id])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!id || ctrl?.status !== 'en_cours') return
    const t = setInterval(load, 2500)
    return () => clearInterval(t)
  }, [id, ctrl?.status, load])

  async function post(action: string, extra: any = {}) {
    setBusy(action); setErr(null)
    try {
      const r = await fetch(`/api/fourriere/controle/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) }).then(r => r.json())
      if (r.error) setErr(r.error)
      await load()
      return r
    } finally { setBusy(null) }
  }

  async function start() {
    setBusy('start'); setErr(null)
    const r = await fetch('/api/fourriere/controle', { method: 'POST' }).then(r => r.json()).catch(() => ({ error: 'Lancement impossible' }))
    setBusy(null)
    if (r.error) { setErr(r.error); return }
    setId(r.id); loadList()
  }

  const expected = items.filter(i => i.expected)
  const scannedN = expected.filter(i => i.scanned_at).length
  const kOk = items.filter(i => i.result === 'ok').length
  const kTr = items.filter(i => i.result === 'transfere').length
  const kDom = items.filter(i => i.result === 'domaine').length
  const extras = items.filter(i => i.result === 'en_trop')
  const activeScanners = Object.values(ctrl?.scanners || {}).filter(s => Date.now() - new Date(s.at).getTime() < 5 * 60_000)

  const qn = q.trim().toUpperCase().replace(/[\s.-]/g, '')
  const match = (i: Item) => !qn || (i.plate || '').toUpperCase().replace(/[\s.-]/g, '').includes(qn) || String(i.mission_number || '').includes(qn)

  const columns = useMemo(() => {
    const keys = zones.map(z => z.key)
    const cols = zones.map(z => ({ zone: z, items: items.filter(i => i.result !== 'en_trop' && itemZone(i) === z.key) }))
    const none = items.filter(i => i.result !== 'en_trop' && (!itemZone(i) || !keys.includes(itemZone(i) as string)))
    if (none.length) cols.push({ zone: { key: '_none', label: 'Sans zone', sort_order: 9999 }, items: none })
    return cols
  }, [zones, items])

  // ── Sans contrôle sélectionné : lancer / historique ──
  if (!id) {
    return (
      <div className="p-4 max-w-3xl mx-auto space-y-4">
        <div className="rounded-2xl border border-zinc-300 dark:border-zinc-700 p-5 space-y-3 bg-white/60 dark:bg-zinc-900/60">
          <h1 className="text-xl font-bold text-ink">Contrôle du parc</h1>
          <p className="text-sm text-ink-secondary">On scanne toutes les voitures du parc, zone par zone, avec les téléphones (à plusieurs si besoin). Cet écran montre en direct les voitures retrouvées. À la fin, VD Soft analyse les voitures non retrouvées et propose une décision pour chacune.</p>
          <p className="text-sm text-ink-secondary">Ordre : zones de stockage, puis la zone tampon (J, relivraison, Transit) et LABO en dernier.</p>
          {err && <div className="text-red-700 bg-red-50 rounded-xl p-3 text-sm">{err}</div>}
          <button onClick={start} disabled={busy === 'start'} className="min-h-[44px] px-5 rounded-xl bg-red-700 text-white font-bold disabled:opacity-50">{busy === 'start' ? 'Préparation de la liste…' : 'Lancer un contrôle'}</button>
        </div>
        <div className="space-y-2">
          <h2 className="font-semibold text-ink">Contrôles précédents</h2>
          {list === null && <div className="text-sm text-ink-muted">Chargement…</div>}
          {list?.length === 0 && <div className="text-sm text-ink-muted">Aucun contrôle pour l’instant.</div>}
          {list?.map(c => (
            <button key={c.id} onClick={() => setId(c.id)} className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 text-left text-ink flex justify-between items-center">
              <span>Contrôle du {fmtDate(c.started_at)}</span>
              <span className="text-xs text-ink-muted">{c.status === 'en_cours' ? 'en cours' : c.status === 'cloture' ? 'à décider' : 'terminé'}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (!ctrl) return <div className="p-6 text-ink-muted">{err || 'Chargement du contrôle…'}</div>

  const header = (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <h1 className="text-xl font-bold text-ink">Contrôle du parc du {fmtDate(ctrl.started_at)}</h1>
        <div className="text-sm text-ink-muted">{ctrl.status === 'en_cours' ? 'En cours — mise à jour en direct' : ctrl.status === 'cloture' ? `Clôturé le ${fmtDate(ctrl.closed_at)} — décisions à prendre` : `Terminé le ${fmtDate(ctrl.applied_at)}`}</div>
      </div>
      <button onClick={() => { setId(null); setCtrl(null); setItems([]); loadList() }} className="text-sm underline text-ink-secondary min-h-[44px]">Tous les contrôles</button>
    </div>
  )

  // ── Contrôle en cours : écran en direct ──
  if (ctrl.status === 'en_cours') {
    return (
      <div className="p-4 space-y-3">
        {header}
        {err && <div className="text-red-700 bg-red-50 rounded-xl p-3 text-sm">{err}</div>}
        <div className="rounded-2xl border border-zinc-300 dark:border-zinc-700 p-4 bg-white/60 dark:bg-zinc-900/60 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex-1 min-w-[240px]">
            <div className="flex justify-between text-sm"><b className="text-ink">{scannedN} / {expected.length} voitures retrouvées</b><span className="text-ink-muted">{expected.length ? Math.round(scannedN / expected.length * 100) : 0} %</span></div>
            <div className="h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-800 mt-1 overflow-hidden"><div className="h-full bg-green-600 transition-all" style={{ width: `${expected.length ? scannedN / expected.length * 100 : 0}%` }} /></div>
          </div>
          <div className="flex gap-4 text-sm tabular-nums">
            <div><b className="block text-lg text-ink">{kOk}</b><span className="text-ink-muted text-xs">à leur place</span></div>
            <div><b className="block text-lg text-ink">{kTr}</b><span className="text-ink-muted text-xs">changées de zone</span></div>
            <div><b className="block text-lg text-ink">{kDom}</b><span className="text-ink-muted text-xs">Domaine à déplacer</span></div>
            <div><b className="block text-lg text-ink">{extras.length}</b><span className="text-ink-muted text-xs">trouvées en trop</span></div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {activeScanners.length === 0 && <span className="text-xs text-ink-muted">Aucun téléphone connecté</span>}
            {activeScanners.map((s, i) => <span key={i} className="text-xs font-semibold rounded-full border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-ink">📱 {s.name} · {s.zone === TAMPON_KEY ? 'zone tampon' : `zone ${s.zone}`}</span>)}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link href="/fourriere/controle/scanner" className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-ink font-semibold inline-flex items-center">📱 Scanner</Link>
            {!confirmClose
              ? <button onClick={() => setConfirmClose(true)} className="min-h-[44px] px-4 rounded-xl bg-red-700 text-white font-bold">Tout est scanné</button>
              : <span className="flex gap-2 items-center flex-wrap">
                  <span className="text-sm text-ink">{expected.length - scannedN} voiture(s) non retrouvée(s) iront dans l’analyse. Clôturer ?</span>
                  <button onClick={async () => { await post('close'); setConfirmClose(false) }} disabled={!!busy} className="min-h-[44px] px-4 rounded-xl bg-red-700 text-white font-bold disabled:opacity-50">{busy === 'close' ? 'Analyse en cours…' : 'Oui, clôturer'}</button>
                  <button onClick={() => setConfirmClose(false)} className="min-h-[44px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 text-ink">Annuler</button>
                </span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-ink-secondary items-center">
          <span className="inline-flex gap-1.5 items-center"><i className="w-3.5 h-3.5 rounded bg-zinc-100 border border-zinc-300 dark:bg-zinc-800 dark:border-zinc-600" />pas encore scannée</span>
          <span className="inline-flex gap-1.5 items-center"><i className="w-3.5 h-3.5 rounded bg-green-100 border border-green-400" />à sa place</span>
          <span className="inline-flex gap-1.5 items-center"><i className="w-3.5 h-3.5 rounded bg-amber-100 border border-amber-400" />venait d’une autre zone (déplacée)</span>
          <span className="inline-flex gap-1.5 items-center"><i className="w-3.5 h-3.5 rounded bg-violet-600" />Domaine : à mettre en zone I</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher une plaque…" className="ml-auto min-h-[40px] rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 bg-transparent text-ink text-sm" />
        </div>
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-2.5 min-w-min">
            {columns.map(({ zone, items: its }) => {
              const shown = its.filter(match).sort((a, b) => Number(!!a.scanned_at) - Number(!!b.scanned_at) || (a.plate || '').localeCompare(b.plate || ''))
              const done = ctrl.zones_done?.[zone.key]
              const here = activeScanners.filter(s => s.zone === zone.key || (s.zone === TAMPON_KEY && TAMPON.includes(zone.key))).map(s => s.name)
              return (
                <div key={zone.key} className={`w-[190px] shrink-0 rounded-xl border ${LAST.includes(zone.key) ? 'border-dashed' : ''} border-zinc-300 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/70 flex flex-col max-h-[70vh]`}>
                  <div className="px-2.5 pt-2.5 pb-1 flex justify-between items-baseline gap-1">
                    <b className="text-ink">{zone.key === '_none' ? 'Sans zone' : zoneLabel(zone)}</b>
                    <span className="text-xs font-semibold text-ink-muted tabular-nums">{its.filter(i => i.scanned_at).length} / {its.length}</span>
                  </div>
                  <div className="px-2.5 pb-2 text-[11px] text-ink-muted flex gap-1.5 flex-wrap min-h-[18px]">
                    {TAMPON.includes(zone.key) && <span>zone tampon</span>}
                    {zone.key === 'Verviers' && <span>relevé sans étiquette repris, pas de scan</span>}
                    {here.length > 0 && <span>📱 {here.join(', ')}</span>}
                    {done && <span className="text-green-700 font-bold">✓ terminée ({done.by})</span>}
                  </div>
                  <div className="overflow-y-auto px-2 pb-2 flex flex-col gap-1.5">
                    {shown.length === 0 && <div className="text-xs text-ink-muted italic px-1">{its.length ? 'Aucun résultat' : 'Aucune voiture attendue'}</div>}
                    {shown.map(i => {
                      const tone = !i.scanned_at ? 'bg-zinc-50 border-zinc-300 dark:bg-zinc-800 dark:border-zinc-600' : i.result === 'transfere' ? 'bg-amber-50 border-amber-400 dark:bg-amber-950 dark:border-amber-700' : 'bg-green-50 border-green-400 dark:bg-green-950 dark:border-green-700'
                      return (
                        <div key={i.id} className={`rounded-lg border px-2 py-1.5 text-xs ${tone}`}>
                          <b className="font-mono text-[12.5px] text-ink">{i.plate || 'sans plaque'}</b>
                          <div className="text-ink-muted truncate">{i.vehicle || '—'}{i.mission_number ? ` · #${i.mission_number}` : ''}</div>
                          <div className="flex gap-1 flex-wrap">
                            {i.moved_to && <span className="mt-0.5 rounded bg-amber-600 text-white px-1 font-bold text-[10px]">venait de {i.moved_from || 'aucune'}</span>}
                            {i.is_domaine && <span className="mt-0.5 rounded bg-violet-600 text-white px-1 font-bold text-[10px]">Domaine</span>}
                            {i.via === 'releve' && <span className="mt-0.5 rounded bg-sky-700 text-white px-1 font-bold text-[10px]">{i.scanned_by_name}</span>}
                            {!i.expected && i.scanned_at && <span className="mt-0.5 rounded bg-zinc-600 text-white px-1 font-bold text-[10px]">entrée pendant le contrôle</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            <div className="w-[190px] shrink-0 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/70 flex flex-col max-h-[70vh]">
              <div className="px-2.5 pt-2.5 pb-2 flex justify-between"><b className="text-ink">Trouvées en trop</b><span className="text-xs text-ink-muted">{extras.length}</span></div>
              <div className="overflow-y-auto px-2 pb-2 flex flex-col gap-1.5">
                {extras.length === 0 && <div className="text-xs text-ink-muted italic px-1">Aucune</div>}
                {extras.map(i => <div key={i.id} className="rounded-lg border border-fuchsia-400 bg-fuchsia-50 dark:bg-fuchsia-950 px-2 py-1.5 text-xs"><b className="font-mono text-ink">{i.plate || 'sans plaque'}</b><div className="text-ink-muted truncate">{i.vehicle || '—'} · trouvée en {i.scanned_zone === TAMPON_KEY ? 'zone tampon' : i.scanned_zone}</div></div>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Contrôle clôturé : analyse et décisions ──
  const missing = expected.filter(i => !i.scanned_at)
  const groups = CAT_ORDER.map(cat => ({ cat, items: missing.filter(i => (i.analysis?.category || 'aucune') === cat) })).filter(g => g.items.length)
  const domaine = items.filter(i => i.result === 'domaine')
  const domaineTodo = domaine.filter(i => !i.applied_at)
  const moved = items.filter(i => i.result === 'transfere')
  const toDecide = [...missing, ...extras].filter(i => !i.applied_at)
  const decided = toDecide.filter(i => i.decision).length

  const decisionRow = (i: Item, opts: string[], prop?: string) => i.applied_at
    ? <span className="text-xs text-green-800 dark:text-green-300 font-semibold">✓ {i.applied_result}</span>
    : <div className="flex gap-1.5 flex-wrap">{opts.map(o => (
        <button key={o} onClick={() => post('decide', { item_id: i.id, decision: i.decision === o ? null : o })} disabled={!!busy}
          className={`min-h-[36px] px-2.5 rounded-lg border text-xs font-semibold whitespace-nowrap ${i.decision === o ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 dark:border-zinc-700 text-ink'}`}>
          {DEC_LABEL[o]}{o === prop ? ' ★' : ''}
        </button>))}</div>

  return (
    <div className="p-4 space-y-4 max-w-6xl">
      {header}
      {err && <div className="text-red-700 bg-red-50 rounded-xl p-3 text-sm">{err}</div>}
      <div className="rounded-xl bg-red-50 dark:bg-red-950 p-3 text-sm text-ink">{expected.length - missing.length} voitures retrouvées sur {expected.length}. Rien ne sort du parc avant « Appliquer les décisions ». La proposition de VD Soft est marquée ★.</div>

      <section className="rounded-2xl border border-zinc-300 dark:border-zinc-700 p-4 space-y-3 bg-white/60 dark:bg-zinc-900/60">
        <h2 className="font-bold text-ink text-lg">Voitures attendues mais pas retrouvées · {missing.length}</h2>
        {missing.length === 0 && <div className="text-sm text-ink-muted">Toutes les voitures attendues ont été retrouvées.</div>}
        {groups.map(g => {
          const prop = g.items[0]?.analysis?.proposal
          const open = g.items.filter(i => !i.applied_at)
          return (
            <div key={g.cat} className="space-y-2">
              <div className="border-l-4 border-zinc-300 dark:border-zinc-600 pl-3">
                <h3 className="font-semibold text-ink">{g.items[0]?.analysis?.label || g.cat} · {g.items.length}</h3>
                <p className="text-xs text-ink-muted max-w-3xl">{CAT_HELP[g.cat]}</p>
                {open.length > 1 && prop && <button onClick={() => post('decide', { item_ids: open.map(i => i.id), decision: prop })} disabled={!!busy} className="text-sm font-bold text-red-700 min-h-[36px]">Appliquer ★ « {DEC_LABEL[prop]} » à tout le groupe</button>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-zinc-200 dark:border-zinc-700"><th className="py-1.5 pr-3">Voiture</th><th className="pr-3">Zone</th><th className="pr-3">Ce que VD Soft sait</th><th>Décision</th></tr></thead>
                  <tbody>
                    {g.items.map(i => (
                      <tr key={i.id} className="border-b border-zinc-100 dark:border-zinc-800 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap"><a href={`/dispatch/${i.mission_id}`} target="_blank" className="font-mono font-semibold text-ink underline">{i.plate || 'sans plaque'}</a><div className="text-xs text-ink-muted">{i.vehicle || '—'}{i.mission_number ? ` · #${i.mission_number}` : ''}</div></td>
                        <td className="pr-3 text-ink">{i.expected_zone || '—'}</td>
                        <td className="pr-3 text-xs text-ink-secondary">{(i.analysis?.facts || []).join(' · ') || '—'}</td>
                        <td className="py-2">{decisionRow(i, ['sortir', 'rechercher', 'laisser'], i.analysis?.proposal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <section className="rounded-2xl border border-zinc-300 dark:border-zinc-700 p-4 space-y-2 bg-white/60 dark:bg-zinc-900/60">
          <h2 className="font-bold text-ink">À transférer en zone I (Domaine) · {domaine.length}</h2>
          <p className="text-xs text-ink-muted">Véhicules remis au Domaine et scannés pendant ce contrôle : leur présence chez nous est certaine.</p>
          {domaine.length === 0 && <div className="text-sm text-ink-muted">Aucun.</div>}
          {domaine.map(i => <div key={i.id} className="text-sm text-ink flex justify-between gap-2"><span className="font-mono">{i.plate || 'sans plaque'}</span><span className="text-xs text-ink-muted">{i.applied_at ? '✓ en zone I' : `trouvée en ${i.moved_to || i.expected_zone || '?'}`}</span></div>)}
          {domaineTodo.length > 0 && <button onClick={() => post('domaine')} disabled={!!busy} className="min-h-[44px] px-4 rounded-xl border border-violet-500 text-violet-800 dark:text-violet-300 font-semibold disabled:opacity-50">{busy === 'domaine' ? 'Transfert…' : `Transférer ces ${domaineTodo.length} véhicules en zone I (Domaine)`}</button>}
        </section>
        <section className="rounded-2xl border border-zinc-300 dark:border-zinc-700 p-4 space-y-2 bg-white/60 dark:bg-zinc-900/60">
          <h2 className="font-bold text-ink">Trouvées en trop · {extras.length}</h2>
          <p className="text-xs text-ink-muted">Scannées au parc alors que leur fiche dit qu’elles sont sorties, annulées ou terminées.</p>
          {extras.length === 0 && <div className="text-sm text-ink-muted">Aucune.</div>}
          {extras.map(i => (
            <div key={i.id} className="space-y-1 border-b border-zinc-100 dark:border-zinc-800 pb-2">
              <div className="text-sm text-ink"><a href={`/dispatch/${i.mission_id}`} target="_blank" className="font-mono underline">{i.plate || 'sans plaque'}</a> <span className="text-xs text-ink-muted">{i.vehicle} · trouvée en {i.scanned_zone === TAMPON_KEY ? 'zone tampon' : i.scanned_zone}</span></div>
              {decisionRow(i, ['remettre', 'enquete'])}
            </div>
          ))}
        </section>
        <section className="rounded-2xl border border-zinc-300 dark:border-zinc-700 p-4 space-y-2 bg-white/60 dark:bg-zinc-900/60">
          <h2 className="font-bold text-ink">Déplacées pendant le scan · {moved.length}</h2>
          <p className="text-xs text-ink-muted">Changées de zone automatiquement (position réelle). Pour information.</p>
          <div className="text-xs text-ink-secondary">{moved.map(i => `${i.plate || '?'} : ${i.moved_from || 'aucune'} → ${i.moved_to}`).join(' · ') || 'Aucune.'}</div>
        </section>
      </div>

      {(toDecide.length > 0 || results) && (
        <div className="rounded-2xl border border-zinc-300 dark:border-zinc-700 p-4 flex flex-wrap gap-3 items-center justify-between bg-white/60 dark:bg-zinc-900/60 sticky bottom-2">
          <span className="text-sm text-ink-muted">{decided} décision{decided > 1 ? 's' : ''} prise{decided > 1 ? 's' : ''} sur {toDecide.length}</span>
          {!confirmApply
            ? <button onClick={() => setConfirmApply(true)} disabled={!decided || !!busy} className="min-h-[44px] px-5 rounded-xl bg-red-700 text-white font-bold disabled:opacity-40">Appliquer les décisions</button>
            : <span className="flex gap-2 items-center flex-wrap">
                <span className="text-sm text-ink">{toDecide.filter(i => i.decision === 'sortir').length} sortie(s) du parc, {toDecide.filter(i => i.decision === 'rechercher').length} à rechercher. Confirmer ?</span>
                <button onClick={async () => { const r = await post('apply'); setConfirmApply(false); if (r?.results) setResults(r.results) }} disabled={!!busy} className="min-h-[44px] px-4 rounded-xl bg-red-700 text-white font-bold disabled:opacity-50">{busy === 'apply' ? 'Application…' : 'Oui, appliquer'}</button>
                <button onClick={() => setConfirmApply(false)} className="min-h-[44px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 text-ink">Annuler</button>
              </span>}
          {results && <div className="w-full text-xs text-ink-secondary">{results.length} décision(s) appliquée(s) : {results.map(r => `${r.plate || '?'} — ${r.result}`).join(' · ')}</div>}
        </div>
      )}
    </div>
  )
}
