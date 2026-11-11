'use client'

// « Ma journée » — voir page.tsx. Les lectures (qui a la main, prochaine action)
// sont celles des écrans d'origine, importées telles quelles : rien n'est
// recalculé ici. Chaque bouton fait le geste de l'écran d'origine ou l'ouvre au
// bon endroit (?q= préremplit la recherche de Parc et d'À facturer).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Search, Undo2, Truck, PenLine, Unlock, Plus, Check, X, Minus, RefreshCw, ArrowRight } from 'lucide-react'
import type { Dossier } from '@/lib/dossier/build'
import BillingModal from '@/components/dossier/BillingModal'
import { readDossier, type AutoInfo, type ComexInfo } from '@/app/facturation/dossiers/AFacturerClient'
import { readVehicle, type V } from '@/app/fourriere/ParcClient'

interface ComexRow {
  id: string; dossier: string; commande: string; prestation: string; plaque: string; brand: string; model: string
  montant: number; vd_montant: number | null; verdict: string; mission_id: string | null; km: number
}
interface Req { id: string; subject: string | null; received_at: string | null; status: string; confidence: string | null; matched_mission_id: string | null; pv: string | null; plaque: string | null; vehicule: string | null; candidates: number }
interface Acc { id: string; plate: string | null; model: string; zone: string | null; parked_at: string | null; police: string; started: boolean; next_label: string | null; done: number; total: number }
interface Mail { id: string; handler: string; subject: string | null; from_email: string | null; received_at: string | null; status: string; blocked_reason: string | null }

const eur = (n: number | null | undefined) => n == null ? '—' : Number(n).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const norm = (s: string) => s.toLowerCase().replace(/[\s.\-_/]/g, '')
const SHOW = 6

type Gesture = 'restituer' | 'transporteur' | 'abandon' | 'levee'
const GESTURES: { key: Gesture; label: string; Icon: any; hint: string }[] = [
  { key: 'restituer',    label: 'Restituer',          Icon: Undo2,   hint: 'Parcours de restitution : qui reprend le véhicule, contrôles, facture.' },
  { key: 'transporteur', label: 'Sortie transporteur', Icon: Truck,   hint: 'Parcours de restitution, réponse « un transporteur ».' },
  { key: 'abandon',      label: 'Abandon',            Icon: PenLine, hint: 'Parcours de restitution, réponse « abandon du véhicule ».' },
  { key: 'levee',        label: 'Levée de saisie',    Icon: Unlock,  hint: 'Fiche du véhicule, bloc saisie : date, qui paie, document.' },
]
const gestureHref = (g: Gesture, id: string) => g === 'levee' ? `/dispatch/${id}` : `/restitution/${id}`

function Card({ tone, n, title, sub, action, children }: { tone: string; n: number | string; title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-surface border rounded-2xl overflow-hidden shadow-sm break-inside-avoid mb-4">
      <header className={`flex items-center gap-3 px-4 py-3 text-white ${tone}`}>
        <span className="text-4xl font-extrabold tabular-nums leading-none min-w-[1.3em]">{n}</span>
        <div className="min-w-0"><h2 className="font-bold text-base leading-tight">{title}</h2>{sub && <p className="text-[12.5px] text-white/90">{sub}</p>}</div>
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  )
}
function Row({ children, done }: { children: React.ReactNode; done?: boolean }) {
  return <div className={`flex items-center gap-3 px-4 py-2.5 border-b last:border-0 flex-wrap ${done ? 'opacity-40' : ''}`}>{children}</div>
}
const Plate = ({ p }: { p: string | null | undefined }) => p ? <span className="font-mono font-bold text-[12.5px] border rounded-md px-1.5 bg-surface-2 whitespace-nowrap">{p}</span> : null
const btnMain = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-bold bg-brand text-white hover:opacity-90 disabled:opacity-40'
const btnGhost = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-semibold border bg-surface text-ink hover:bg-surface-hover disabled:opacity-40'
const More = ({ href, n }: { href: string; n: number }) => n > SHOW ? <Link href={href} className="flex items-center justify-center gap-1 px-4 py-3 text-sm font-semibold text-ink-secondary hover:text-ink">Voir les {n} <ArrowRight size={15} /></Link> : null
const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-4 py-4 text-sm text-ink-muted">{children}</p>

export default function MaJourneeClient({ firstName, dossiers: initial, autoById, comexById, canFacturation, canFourriere, canMails }: {
  firstName: string; dossiers: Dossier[]; autoById: Record<string, boolean>; comexById: Record<string, ComexInfo>
  canFacturation: boolean; canFourriere: boolean; canMails: boolean
}) {
  const [dossiers, setDossiers] = useState<Dossier[]>(initial)
  const [auto, setAuto] = useState<Record<string, AutoInfo> | undefined>()
  const [vehicles, setVehicles] = useState<V[]>([])
  const [comex, setComex] = useState<ComexRow[]>([])
  const [coupure, setCoupure] = useState<{ depuis: string | null } | null>(null)
  const [reqs, setReqs] = useState<Req[]>([]); const [reqRobot, setReqRobot] = useState(0)
  const [mails, setMails] = useState<Mail[]>([])
  const [acc, setAcc] = useState<{ todo: Acc[]; stock: Acc[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [billing, setBilling] = useState<Dossier | null>(null)
  const [doneCount, setDoneCount] = useState(0)
  const [menuOff, setMenuOff] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { try { setMenuOff(localStorage.getItem('vd_ma_journee_off') === '1') } catch {} }, [])
  const toggleMenu = () => { const v = !menuOff; setMenuOff(v); try { v ? localStorage.setItem('vd_ma_journee_off', '1') : localStorage.removeItem('vd_ma_journee_off') } catch {}; window.location.reload() }

  const load = useCallback(async () => {
    const j = (u: string) => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
    const [a, p, c, m, t] = await Promise.all([
      canFacturation ? j('/api/facturation/auto-eligible') : null,
      canFourriere ? j('/api/fourriere/parc') : null,
      canFacturation ? j('/api/touring/comex-bko/list') : null,
      j('/api/ma-journee'),
      canFourriere ? j('/api/taches/vehicules') : null,
    ])
    if (t?.todo) setAcc({ todo: t.todo || [], stock: t.stock || [] })
    if (a?.byMission) setAuto(a.byMission)
    if (p?.vehicles) setVehicles(p.vehicles)
    if (c?.rows) setComex(c.rows)
    setCoupure(c?.coupure || null)
    if (m) { setReqs(m.requisitoires || []); setReqRobot(m.requisitoiresRobot24h || 0); setMails(m.mails || []) }
    setLoading(false)
  }, [canFacturation, canFourriere])
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 6000); return () => clearTimeout(t) }, [msg])

  // ── Lectures des écrans d'origine ──
  const now = Date.now()
  const dRead = useMemo(() => dossiers.map(d => ({ d, r: readDossier(d, auto?.[d.root_id], comexById[d.root_id], !!autoById[d.root_id], now) })), [dossiers, auto, comexById, autoById, now])
  // Touring est traité dans sa propre carte : on ne le compte pas deux fois.
  const dNous = dRead.filter(x => x.r.who === 'nous' && x.r.primary?.kind !== 'comex')
  const dRobot = dRead.filter(x => x.r.who === 'robot').length
  const dEux = dRead.filter(x => x.r.who === 'eux').length
  const vRead = useMemo(() => vehicles.map(v => ({ v, r: readVehicle(v, { zonesSeules: true }) })), [vehicles])
  const vNous = vRead.filter(x => x.r.who === 'nous').sort((a, b) => b.v.nights - a.v.nights)
  const vRobot = vRead.filter(x => x.r.who === 'robot').length
  const vEux = vRead.filter(x => x.r.who === 'eux').length
  const tOk = comex.filter(r => r.verdict === 'ok'), tVerify = comex.filter(r => r.verdict === 'verify'), tNone = comex.filter(r => r.verdict !== 'ok' && r.verdict !== 'verify')
  const tOkTotal = tOk.reduce((s, r) => s + Number(r.montant || 0), 0)

  const accList = acc ? [...acc.todo, ...acc.stock].sort((x, y) => String(x.parked_at || '').localeCompare(String(y.parked_at || ''))) : []
  const aToi = dNous.length + vNous.length + tOk.length + tVerify.length + reqs.length + mails.length + accList.length
  const totalDay = aToi + doneCount

  // ── Recherche (parc + dossiers à facturer chargés, sinon recherche générale) ──
  const nq = norm(q)
  const hitsV = nq.length >= 3 ? vehicles.filter(v => norm([v.plate, v.vin, v.pv, v.dossier_number, String(v.mission_number ?? ''), v.client_name].filter(Boolean).join(' ')).includes(nq)).slice(0, 6) : []
  const hitsD = nq.length >= 3 ? dossiers.filter(d => norm([d.ref, String(d.number ?? ''), d.vehicle.plate, d.vehicle.vin, d.dossier_number, d.client?.name, d.billed_to.name].filter(Boolean).join(' ')).includes(nq)).slice(0, 4) : []

  async function openBilling(id: string) {
    setBusy(id)
    try { const j = await fetch(`/api/dossier/${id}?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()); if (j?.dossier) setBilling(j.dossier); else setMsg('⚠ Dossier introuvable') }
    catch { setMsg('⚠ Erreur réseau') } finally { setBusy(null) }
  }
  async function refreshDossier(id: string) {
    try { const j = await fetch(`/api/dossier/${id}?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()); if (j?.dossier) setDossiers(p => p.map(d => d.root_id === id ? j.dossier : d)) } catch {}
  }
  async function acceptGreens() {
    if (!armed) { setArmed(true); return }
    setArmed(false); setBusy('comex')
    try {
      const j = await fetch('/api/touring/comex-bko/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: tOk.map(r => r.id) }) }).then(r => r.json())
      if (j.ok) { const fails = (j.results || []).filter((r: any) => !r.ok).length; setMsg(`✓ ${j.accepted}/${j.total} dossier(s) Touring validé(s)${fails ? ` · ${fails} échec(s), à revoir dans Touring à valider` : ''}`); setDoneCount(c => c + (j.accepted || 0)) }
      else setMsg(`⚠ ${j.error || 'Échec'}`)
    } catch { setMsg('⚠ Erreur réseau') } finally { setBusy(null); load() }
  }

  const dossierAction = (d: Dossier, p: NonNullable<ReturnType<typeof readDossier>['primary']>) => {
    if (p.kind === 'bill' || p.kind === 'bill_ready') return <button className={btnMain} disabled={busy === d.root_id} onClick={() => openBilling(d.root_id)}>{busy === d.root_id ? '…' : p.label}</button>
    const href = p.href || (p.kind === 'allianz' ? '/facturation/allianz' : p.kind === 'dossier' ? `/dispatch/dossier/${d.root_id}` : `/facturation/dossiers?q=${encodeURIComponent(d.vehicle.plate || d.ref)}`)
    return <Link href={href} target={p.kind === 'odoo' ? '_blank' : undefined} className={btnGhost}>{p.label}</Link>
  }
  const vehicleAction = (v: V, p: NonNullable<ReturnType<typeof readVehicle>['primary']>) => {
    const href = p.kind === 'zone' ? `/fourriere?q=${encodeURIComponent(v.plate || v.vin || String(v.mission_number ?? ''))}` : p.href || (p.kind === 'restitute' ? `/qr/mission/${v.id}` : `/fourriere?q=${encodeURIComponent(v.plate || v.vin || String(v.mission_number ?? ''))}`)
    return <Link href={href} className={p.tone === 'brand' ? btnMain : btnGhost}>{p.label}</Link>
  }

  const pct = totalDay ? Math.round(doneCount / totalDay * 100) : 0
  const today = new Date().toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' })

  return (
    <main className="p-4 lg:p-6 max-w-[1800px] mx-auto space-y-4">
      {msg && <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] bg-surface border shadow-lg rounded-xl px-4 py-2 text-sm font-medium text-ink">{msg}</div>}

      {/* Bandeau : le comptoir à gauche, où en est la journée à droite */}
      <div className="rounded-3xl text-white shadow-md p-5 lg:p-7 grid gap-6 lg:grid-cols-[1.5fr_1fr] items-end bg-[radial-gradient(120%_160%_at_100%_0%,#6d111c_0%,#17110f_62%)]">
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight">Ma journée{firstName ? `, ${firstName}` : ''}</h1>
          <p className="text-white/75 text-sm mt-0.5 mb-4 first-letter:uppercase">{today} · ce qui t’attend, dans l’ordre où tu travailles</p>
          <label className="flex items-center gap-2.5 bg-white/10 border border-white/25 rounded-2xl px-4 min-h-[52px] focus-within:border-white">
            <Search size={18} className="shrink-0" />
            <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Plaque, châssis, n° de dossier, n° de PV…" aria-label="Rechercher un véhicule"
              className="flex-1 min-w-0 bg-transparent outline-none text-base placeholder:text-white/60" />
            {q && <button onClick={() => { setQ(''); setGesture(null) }} aria-label="Effacer" className="p-2 -mr-2"><X size={16} /></button>}
          </label>
          <div className="flex flex-wrap gap-2 mt-3">
            {canFourriere && GESTURES.map(g => (
              <button key={g.key} onClick={() => { setGesture(gesture === g.key ? null : g.key); searchRef.current?.focus() }}
                className={`inline-flex items-center gap-2 min-h-[44px] px-3.5 rounded-xl border text-[13.5px] font-semibold ${gesture === g.key ? 'bg-white text-stone-900 border-white' : 'bg-white/10 border-white/25 hover:bg-white/20'}`}>
                <g.Icon size={17} />{g.label}
              </button>
            ))}
            {canFourriere && <Link href="/fourriere/gardiennage/nouveau" className="inline-flex items-center gap-2 min-h-[44px] px-3.5 rounded-xl border border-white/25 bg-white/10 hover:bg-white/20 text-[13.5px] font-semibold"><Plus size={17} />Véhicule apporté</Link>}
          </div>
          {gesture && <p className="text-white/80 text-[13px] mt-2">{GESTURES.find(g => g.key === gesture)!.hint} {nq.length < 3 ? 'Tape la plaque du véhicule.' : ''}</p>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[[aToi, 'à toi'], [dRobot + vRobot, 'chez le robot'], [dEux + vEux, 'chez eux']].map(([n, l]) => (
            <div key={l as string} className="bg-white/10 border border-white/20 rounded-2xl px-3 py-2.5">
              <b className="block text-3xl lg:text-4xl font-extrabold leading-none tabular-nums">{loading ? '…' : n}</b><span className="text-xs text-white/75">{l}</span>
            </div>
          ))}
          <div className="col-span-3">
            <div className="h-2.5 rounded-full bg-white/10 overflow-hidden"><i className="block h-full rounded-full bg-gradient-to-r from-emerald-300 to-emerald-100 transition-all" style={{ width: `${pct}%` }} /></div>
            <small className="block mt-1 text-xs text-white/75">{doneCount} fait{doneCount > 1 ? 's' : ''} depuis l’ouverture de la page</small>
          </div>
        </div>
      </div>

      {/* Résultats de recherche */}
      {nq.length >= 3 && (
        <section className="bg-surface border rounded-2xl shadow-sm">
          {hitsV.map(v => (
            <Row key={v.id}>
              <div className="flex-1 min-w-[200px]"><Plate p={v.plate} /> <span className="font-semibold">{[v.brand, v.model].filter(Boolean).join(' ')}</span><small className="block text-ink-faint">Au parc · {v.zone_label || v.zone || 'sans zone'} · {v.nights} nuit(s){v.pv ? ` · PV ${v.pv}` : ''}</small></div>
              {gesture
                ? <Link href={gestureHref(gesture, v.id)} className={btnMain}>{GESTURES.find(g => g.key === gesture)!.label}</Link>
                : <><Link href={`/restitution/${v.id}`} className={btnMain}>Restituer</Link><Link href={`/qr/mission/${v.id}`} className={btnGhost}>Fiche de l’étiquette</Link></>}
              <Link href={`/dispatch/${v.id}`} className={btnGhost}>Fiche</Link>
            </Row>
          ))}
          {hitsD.map(d => (
            <Row key={d.root_id}>
              <div className="flex-1 min-w-[200px]"><Plate p={d.vehicle.plate} /> <span className="font-semibold">{d.ref} · {d.source_label}</span><small className="block text-ink-faint">À facturer · {d.billed_to.name || 'client à définir'}</small></div>
              <button className={btnMain} disabled={busy === d.root_id} onClick={() => openBilling(d.root_id)}>Facturer</button>
              <Link href={`/dispatch/dossier/${d.root_id}`} className={btnGhost}>Vue dossier</Link>
            </Row>
          ))}
          <Row><span className="flex-1 text-sm text-ink-muted">{hitsV.length + hitsD.length ? 'Pas le bon véhicule ?' : 'Rien au parc ni à facturer pour cette recherche.'}</span><Link href={`/recherche?q=${encodeURIComponent(q)}`} className={btnGhost}>Chercher partout</Link></Row>
        </section>
      )}

      {/* Cartes : 1 colonne sur téléphone, jusqu'à 4 sur grand écran */}
      <div className="columns-1 md:columns-2 2xl:columns-3 min-[1900px]:columns-4 gap-4">
        {canFacturation && (
          <Card tone="bg-indigo-700" n={loading ? '…' : comex.length} title="Touring à valider" sub="Leur montant face au nôtre" action={<Link href="/touring-comex" className="inline-flex items-center min-h-[40px] px-3 rounded-xl border border-white/70 text-[13px] font-bold">Ouvrir la liste</Link>}>
            {coupure && <div role="alert" className="mx-4 mt-3 rounded-xl border border-red-300 bg-red-50 text-red-800 px-3 py-2 text-sm font-semibold">Connexion à Touring coupée{coupure.depuis ? ` depuis le ${new Date(coupure.depuis).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''} : la liste n'est pas à jour.</div>}
            {comex.length > 0 && (
              <div className="flex h-9 rounded-xl overflow-hidden mx-4 mt-3 text-[12.5px] font-extrabold">
                {tOk.length > 0 && <div style={{ flexGrow: tOk.length }} className="flex items-center justify-center gap-1 px-2.5 whitespace-nowrap bg-emerald-600 text-white"><Check size={14} />{tOk.length} d’accord</div>}
                {tVerify.length > 0 && <div style={{ flexGrow: tVerify.length }} className="flex items-center justify-center gap-1 px-2.5 whitespace-nowrap bg-red-600 text-white"><X size={14} />{tVerify.length} écart{tVerify.length > 1 ? 's' : ''}</div>}
                {tNone.length > 0 && <div style={{ flexGrow: tNone.length }} className="flex items-center justify-center gap-1 px-2.5 whitespace-nowrap bg-stone-200 text-stone-700">{tNone.length} autre{tNone.length > 1 ? 's' : ''}</div>}
              </div>
            )}
            {tOk.length > 0 && (
              <div className="flex items-center gap-3 flex-wrap px-4 py-3">
                <button onClick={acceptGreens} disabled={busy === 'comex'} className={`inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-bold text-white ${armed ? 'bg-emerald-800 ring-2 ring-emerald-300' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                  <Check size={16} />{busy === 'comex' ? 'Validation…' : armed ? `Confirmer : valider ${tOk.length} chez Touring` : `Valider les ${tOk.length} verts · ${eur(tOkTotal)}`}
                </button>
                {armed && <button onClick={() => setArmed(false)} className={btnGhost}>Annuler</button>}
                <small className="text-ink-muted text-[12.5px]">Valide chez Touring et lance la facture, comme « Accepter ».</small>
              </div>
            )}
            {tVerify.slice(0, SHOW).map(r => { const d = r.vd_montant == null ? null : Number(r.montant) - Number(r.vd_montant); return (
              <Row key={r.id}>
                <div className="flex-1 min-w-[180px]"><Plate p={r.plaque} /> {r.prestation} · {[r.brand, r.model].filter(Boolean).join(' ')}<small className="block text-ink-faint">Touring {eur(r.montant)} · VD Soft {eur(r.vd_montant)}</small></div>
                {d != null && <span className={`text-[13px] font-extrabold tabular-nums rounded-lg px-2 py-0.5 text-white ${d < 0 ? 'bg-red-600' : 'bg-emerald-600'}`}>{d < 0 ? '−' : '+'}{eur(Math.abs(d))}</span>}
                <Link href="/touring-comex?f=verify" className={btnGhost}>Regarder</Link>
              </Row>) })}
            <More href="/touring-comex?f=verify" n={tVerify.length} />
            {!loading && comex.length === 0 && !coupure && <Empty>Rien en attente chez Touring.</Empty>}
          </Card>
        )}

        {canFacturation && (
          <Card tone="bg-red-700" n={loading ? '…' : dNous.length} title="À facturer" sub={`à toi · ${dRobot} chez le robot · ${dEux} chez eux`} action={<Link href="/facturation/dossiers" className="inline-flex items-center min-h-[40px] px-3 rounded-xl border border-white/70 text-[13px] font-bold">Tout voir</Link>}>
            {dNous.slice(0, SHOW).map(({ d, r }) => (
              <Row key={d.root_id}>
                <div className="flex-1 min-w-[180px]"><Plate p={d.vehicle.plate} /> {d.ref} · {d.source_label}<small className="block text-ink-faint">{r.headline}</small></div>
                {r.primary && dossierAction(d, r.primary)}
              </Row>
            ))}
            <More href="/facturation/dossiers" n={dNous.length} />
            {!loading && dNous.length === 0 && <Empty>Rien à facturer de ton côté.</Empty>}
          </Card>
        )}

        {canFourriere && (
          <Card tone="bg-violet-700" n={loading ? '…' : reqs.length} title="Réquisitoires reçus" sub={reqRobot ? `Le robot en a rattaché ${reqRobot} depuis hier` : 'À rattacher à leur fiche'} action={<Link href="/fourriere/requisitoires" className="inline-flex items-center min-h-[40px] px-3 rounded-xl border border-white/70 text-[13px] font-bold">Ouvrir</Link>}>
            {reqs.slice(0, SHOW).map(r => (
              <Row key={r.id}>
                <div className="flex-1 min-w-[180px]">{r.pv ? `PV ${r.pv}` : (r.subject || 'Document reçu')}<small className="block text-ink-faint">{[r.vehicule, r.plaque].filter(Boolean).join(' · ') || 'Lecture incomplète'} · {r.matched_mission_id ? 'fiche trouvée' : r.candidates ? `${r.candidates} fiche(s) possible(s)` : 'aucune fiche trouvée'}</small></div>
                <Link href="/fourriere/requisitoires" className={r.matched_mission_id && r.confidence === 'high' ? btnMain : btnGhost}>{r.matched_mission_id ? 'Rattacher' : 'Choisir la fiche'}</Link>
              </Row>
            ))}
            <More href="/fourriere/requisitoires" n={reqs.length} />
            {!loading && reqs.length === 0 && <Empty>Aucun document en attente.</Empty>}
          </Card>
        )}

        {canFourriere && acc && (
          <Card tone="bg-orange-700" n={loading ? '…' : accList.length} title="Accidentés à prendre en charge" sub="Les plus anciens en premier · une question à la fois" action={<Link href="/taches" className="inline-flex items-center min-h-[40px] px-3 rounded-xl border border-white/70 text-[13px] font-bold">Ouvrir</Link>}>
            {accList.slice(0, SHOW).map(v => {
              const jours = v.parked_at ? Math.floor((Date.now() - new Date(v.parked_at).getTime()) / 86400000) : null
              return (
                <Row key={v.id}>
                  <div className="flex-1 min-w-[180px]"><Plate p={v.plate} /> {v.model}<small className="block text-ink-faint">{jours != null ? `au parc depuis ${jours} j` : ''}{v.zone ? ` · zone ${v.zone}` : ''}{v.started ? ` · ${v.done}/${v.total} · ${v.next_label || ''}` : ' · pas commencée'}</small></div>
                  <Link href={`/taches?m=${v.id}`} className={v.started ? btnGhost : btnMain}>{v.started ? 'Continuer' : 'Prendre en charge'}</Link>
                </Row>
              )
            })}
            <More href="/taches" n={accList.length} />
            {!loading && accList.length === 0 && <Empty>Tous les accidentés sont pris en charge.</Empty>}
          </Card>
        )}

        {canFourriere && (
          <Card tone="bg-teal-700" n={loading ? '…' : vNous.length} title="Au parc" sub={`à toi · ${vRobot} chez le robot · ${vEux} chez eux`} action={<Link href="/fourriere" className="inline-flex items-center min-h-[40px] px-3 rounded-xl border border-white/70 text-[13px] font-bold">Parc</Link>}>
            {vNous.slice(0, SHOW).map(({ v, r }) => (
              <Row key={v.id}>
                <div className="flex-1 min-w-[180px]"><Plate p={v.plate} /> {[v.brand, v.model].filter(Boolean).join(' ')}<small className="block text-ink-faint">{r.headline}</small></div>
                {r.primary && vehicleAction(v, r.primary)}
              </Row>
            ))}
            <More href="/fourriere" n={vNous.length} />
            {!loading && vNous.length === 0 && <Empty>Rien à faire au parc.</Empty>}
          </Card>
        )}

        {canMails && (
          <Card tone="bg-amber-700" n={loading ? '…' : mails.length} title="Mails et rejets" sub="Préparés par l’agent mail, à décider" action={<Link href="/mail-agent" className="inline-flex items-center min-h-[40px] px-3 rounded-xl border border-white/70 text-[13px] font-bold">Ouvrir</Link>}>
            {mails.slice(0, SHOW).map(m => (
              <Row key={m.id}>
                <div className="flex-1 min-w-[180px]">{/rejet/.test(m.handler) ? 'Facture refusée' : 'Mail à classer'} · {m.subject || '—'}<small className="block text-ink-faint">{m.from_email || ''}{m.blocked_reason ? ` · ${m.blocked_reason}` : ''}</small></div>
                <Link href="/mail-agent" className={m.status === 'ready' ? btnMain : btnGhost}>{m.status === 'ready' ? 'Appliquer' : 'Décider'}</Link>
              </Row>
            ))}
            <More href="/mail-agent" n={mails.length} />
            {!loading && mails.length === 0 && <Empty>Aucun mail en attente.</Empty>}
          </Card>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
        <span>Pas dans cette page, toujours dans leurs espaces :</span>
        {canFourriere && <Link href="/fourriere/saisies" className="border rounded-full px-3 py-1.5 bg-surface hover:text-ink">États de frais</Link>}
        {canFourriere && <Link href="/fourriere/sorties" className="border rounded-full px-3 py-1.5 bg-surface hover:text-ink">Sorties</Link>}
        {canFourriere && <Link href="/fourriere/controle" className="border rounded-full px-3 py-1.5 bg-surface hover:text-ink">Contrôle du parc</Link>}
        <Link href="/finance" className="border rounded-full px-3 py-1.5 bg-surface hover:text-ink">Relances clients</Link>
        <button onClick={load} className="inline-flex items-center gap-1 border rounded-full px-3 py-1.5 bg-surface hover:text-ink"><RefreshCw size={13} />Actualiser</button>
        <button onClick={toggleMenu} className="ml-auto inline-flex items-center gap-1 border rounded-full px-3 py-1.5 bg-surface hover:text-ink"><Minus size={13} />{menuOff ? 'Remettre le nouveau menu' : 'Revenir à l’ancien menu'}</button>
      </div>

      {billing && <BillingModal valider d={billing} onClose={() => setBilling(null)} onDone={async (res: any) => { const id = billing.root_id; if (res?.invoices?.length) { setBilling(null); setDoneCount(c => c + 1); setMsg(`✓ ${res.invoices.length} facture(s) brouillon créée(s)`) } await refreshDossier(id) }} />}
    </main>
  )
}
