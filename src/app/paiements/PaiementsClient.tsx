'use client'
// src/app/paiements/PaiementsClient.tsx — Paiements fournisseurs (Olivier 16/10/2026).
// 1. Tri d'Olivier : factures à payer → « Ajouter à la liste d'attente » ; en dessous, la liste
//    d'attente (ce que Momo n'a pas encore pris) avec « Retirer ».
// 2. Lot du jour (Momo, 14 h 30 les jours ouvrables) : coche ce qui part → « Créer le lot ».
//    Ce qui n'est pas pris reste en attente et revient seul la fois suivante.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'

type Facture = {
  id?: string; move_id: number; move_name: string; partner_name: string; ref: string | null
  invoice_date: string | null; due_date: string | null; amount: number; communication: string | null
  iban: string | null; ibanAConfirmer: { id: number; acc: string } | null; ajoute_le?: string
}

const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fd = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—')
const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
function joursAvant(due: string | null): number | null {
  if (!due) return null
  return Math.round((new Date(due + 'T12:00:00').getTime() - new Date(todayIso() + 'T12:00:00').getTime()) / 864e5)
}

function Echeance({ due }: { due: string | null }) {
  const d = joursAvant(due)
  if (d === null) return <span className="text-xs text-ink-muted">Sans échéance</span>
  if (d < 0) return <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">En retard de {-d} j</span>
  if (d === 0) return <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Échéance aujourd’hui</span>
  if (d <= 3) return <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Échéance dans {d} j</span>
  return <span className="rounded-md bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">Échéance {fd(due)}</span>
}

function Ligne({ f, coche, onCoche, enAttenteDepuis, action, onConfirmerCompte }: {
  f: Facture; coche?: boolean; onCoche?: (v: boolean) => void; enAttenteDepuis?: boolean; action?: React.ReactNode
  onConfirmerCompte?: (bankId: number) => void
}) {
  const bloquee = !f.iban
  return (
    <label className={`grid items-center gap-3 rounded-card border bg-surface p-3 ${onCoche ? 'cursor-pointer grid-cols-[28px_1fr_auto]' : 'grid-cols-[1fr_auto_auto]'} ${coche ? 'border-brand ring-1 ring-brand' : ''}`}>
      {onCoche && (
        <input type="checkbox" className="h-6 w-6 accent-[var(--brand,#0b5cad)]" checked={!!coche} disabled={bloquee}
          onChange={e => onCoche(e.target.checked)} />
      )}
      <div className="min-w-0">
        <div className="font-semibold text-ink">{f.partner_name}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-secondary">
          <span className="font-mono">{f.move_name}</span>
          {f.ref && <span>réf. {f.ref}</span>}
          <span>facture du {fd(f.invoice_date)}</span>
          <span>échéance <b className="text-ink">{fd(f.due_date)}</b></span>
          {f.communication && <span className="font-mono">{f.communication}</span>}
        </div>
        {enAttenteDepuis && f.ajoute_le && f.ajoute_le.slice(0, 10) < todayIso() && (
          <div className="mt-1 text-xs font-semibold text-amber-800">En attente depuis le {fd(f.ajoute_le)} : pas encore prise</div>
        )}
        {bloquee && f.ibanAConfirmer && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-amber-800">
            Compte {f.ibanAConfirmer.acc} pas encore confirmé pour les virements
            {onConfirmerCompte && <button onClick={e => { e.preventDefault(); onConfirmerCompte(f.ibanAConfirmer!.id) }} className="min-h-[36px] rounded-lg border border-amber-300 bg-amber-50 px-3 text-amber-900">Confirmer ce compte</button>}
          </div>
        )}
        {bloquee && !f.ibanAConfirmer && <div className="mt-1 text-xs font-semibold text-red-800">Aucun compte bancaire (ou plusieurs) sur la fiche du fournisseur : à compléter avant de pouvoir payer</div>}
      </div>
      <div className="grid justify-items-end gap-1 text-right">
        <span className="font-mono font-semibold tabular-nums text-ink">{eur(f.amount)}</span>
        <Echeance due={f.due_date} />
      </div>
      {action}
    </label>
  )
}

export default function PaiementsClient({ societes, peutTrier, userRole, userName, userEmail, userModules }: {
  societes: { id: number; label: string }[]; peutTrier: boolean
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [soc, setSoc] = useState(societes[0].id)
  const [etape, setEtape] = useState<'tri' | 'lot'>(peutTrier ? 'tri' : 'lot')
  const [data, setData] = useState<{ attente: Facture[]; aTrier: Facture[] | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [fait, setFait] = useState<string>('')
  const [q, setQ] = useState('')

  const charger = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/paiements?societe=${soc}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Chargement impossible')
      setData({ attente: j.attente || [], aTrier: j.aTrier })
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }, [soc])
  useEffect(() => { setSel({}); setFait(''); setConfirm(false); charger() }, [charger])

  const aTrier = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (data?.aTrier || []).filter(f => !t || `${f.partner_name} ${f.move_name} ${f.ref || ''}`.toLowerCase().includes(t))
  }, [data, q])
  const attente = data?.attente || []
  const pool = etape === 'tri' ? aTrier : attente
  const cle = (f: Facture) => (etape === 'tri' ? String(f.move_id) : String(f.id))
  const coches = pool.filter(f => sel[cle(f)])
  const total = coches.reduce((s, f) => s + f.amount, 0)
  const label = societes.find(s => s.id === soc)?.label || ''

  async function post(action: string, ids: (string | number)[]) {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/paiements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ societe: soc, action, ids }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Action impossible')
      return j
    } catch (e: any) { setErr(e.message); return null } finally { setBusy(false) }
  }

  async function confirmerCompte(bankId: number) {
    if (await post('confirmer_compte', [bankId])) { setFait('Compte bancaire confirmé pour les virements.'); charger() }
  }

  async function valider() {
    if (etape === 'tri') {
      const j = await post('ajouter', coches.map(f => f.move_id))
      if (j) { setSel({}); setFait(`${j.ajoutees} facture(s) ajoutée(s) à la liste d’attente.`); charger() }
      return
    }
    const j = await post('lot', coches.map(f => f.id!))
    setConfirm(false)
    if (j) {
      setSel({})
      setFait(`Lot ${j.lot} ${j.ajoute ? 'complété' : 'créé'} : ${j.factures} facture(s), ${eur(j.total)}${j.ajoute ? ` (total du lot ${eur(j.lotTotal)})` : ''}. Olivier est prévenu pour générer le fichier et l’encoder à la banque. Ce qui n’a pas été pris reste dans la liste d’attente.`)
      charger()
    }
  }

  return (
    <AppShell title="Paiements fournisseurs" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="mx-auto max-w-4xl px-4 py-6 pb-32">
        <h1 className="font-display text-2xl font-bold text-ink">Paiements fournisseurs</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-secondary">
          {peutTrier ? 'Tu tries les factures à payer et les ajoutes à la liste d’attente. ' : ''}
          Chaque jour ouvrable à 14 h 30, la liste d’attente est présentée pour choisir ce qui part dans le lot. Ce qui n’est pas pris reste en attente pour la fois suivante.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-xl bg-surface-hover p-1">
            {societes.map(s => (
              <button key={s.id} onClick={() => setSoc(s.id)}
                className={`min-h-[44px] rounded-lg px-4 text-sm font-semibold ${soc === s.id ? 'bg-surface text-ink shadow-card' : 'text-ink-secondary'}`}>{s.label}</button>
            ))}
          </div>
          <div className="flex gap-1 rounded-xl bg-surface-hover p-1">
            {peutTrier && (
              <button onClick={() => { setEtape('tri'); setSel({}); setFait('') }}
                className={`min-h-[44px] rounded-lg px-4 text-sm font-semibold ${etape === 'tri' ? 'bg-surface text-ink shadow-card' : 'text-ink-secondary'}`}>1. Tri</button>
            )}
            <button onClick={() => { setEtape('lot'); setSel({}); setFait('') }}
              className={`min-h-[44px] rounded-lg px-4 text-sm font-semibold ${etape === 'lot' ? 'bg-surface text-ink shadow-card' : 'text-ink-secondary'}`}>
              {peutTrier ? '2. ' : ''}Lot du jour {data ? `(${attente.length})` : ''}
            </button>
          </div>
        </div>

        {fait && <div className="mt-4 rounded-card bg-green-50 p-3 text-sm text-green-900">{fait}</div>}
        {err && <div className="mt-4 rounded-card bg-red-50 p-3 text-sm text-red-800">{err}</div>}

        {loading ? (
          <div className="mt-10 flex items-center justify-center gap-2 text-ink-muted"><Loader2 className="animate-spin" size={18} /> Lecture des factures de {label}…</div>
        ) : etape === 'tri' ? (
          <div className="mt-5 grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">À trier ({aTrier.length})</h2>
              <div className="flex items-center gap-2 rounded-lg border bg-surface px-2">
                <Search size={14} className="text-ink-muted" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Fournisseur, n° de facture…" className="min-h-[40px] bg-transparent text-sm text-ink outline-none" />
              </div>
            </div>
            {aTrier.length === 0 && <div className="rounded-card border border-dashed p-4 text-sm text-ink-muted">Aucune facture à trier.</div>}
            {aTrier.map(f => <Ligne key={f.move_id} f={f} coche={sel[String(f.move_id)]} onCoche={v => setSel(s => ({ ...s, [String(f.move_id)]: v }))} onConfirmerCompte={confirmerCompte} />)}

            <h2 className="mt-6 text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Dans la liste d’attente ({attente.length} · {eur(attente.reduce((s, f) => s + f.amount, 0))})
            </h2>
            {attente.length === 0 && <div className="rounded-card border border-dashed p-4 text-sm text-ink-muted">La liste d’attente est vide.</div>}
            {attente.map(f => (
              <Ligne key={f.id} f={f} enAttenteDepuis onConfirmerCompte={confirmerCompte} action={
                <button disabled={busy} onClick={async e => { e.preventDefault(); if (await post('retirer', [f.id!])) charger() }}
                  className="min-h-[44px] rounded-lg border px-3 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50">Retirer</button>
              } />
            ))}
          </div>
        ) : (
          <div className="mt-5 grid gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Liste d’attente ({attente.length})</h2>
              {attente.length > 0 && <button onClick={() => setSel(Object.fromEntries(attente.filter(f => f.iban).map(f => [String(f.id), true])))} className="min-h-[36px] text-sm font-semibold text-brand">Tout cocher</button>}
            </div>
            {attente.length === 0 && <div className="rounded-card border border-dashed p-4 text-sm text-ink-muted">La liste d’attente est vide : rien à payer aujourd’hui pour {label}.</div>}
            {attente.map(f => <Ligne key={f.id} f={f} enAttenteDepuis coche={sel[String(f.id)]} onCoche={v => setSel(s => ({ ...s, [String(f.id)]: v }))} />)}
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-ink-secondary">{coches.length} cochée(s) · <b className="font-mono text-lg text-ink">{eur(total)}</b></div>
          {confirm ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink">Créer le lot de {eur(total)} pour {label} ?</span>
              <button onClick={() => setConfirm(false)} disabled={busy} className="min-h-[44px] rounded-xl border px-4 text-sm font-semibold text-ink">Annuler</button>
              <button onClick={valider} disabled={busy} className="flex min-h-[48px] items-center gap-2 rounded-xl bg-brand px-5 font-bold text-white disabled:opacity-50">
                {busy && <Loader2 className="animate-spin" size={16} />} Oui, créer le lot
              </button>
            </div>
          ) : (
            <button disabled={busy || !coches.length} onClick={() => (etape === 'lot' ? setConfirm(true) : valider())}
              className="flex min-h-[48px] items-center gap-2 rounded-xl bg-brand px-5 font-bold text-white disabled:opacity-40">
              {busy && <Loader2 className="animate-spin" size={16} />}
              {etape === 'tri' ? `Ajouter à la liste d’attente${coches.length ? ` (${coches.length})` : ''}` : `Créer le lot${coches.length ? ` (${coches.length})` : ''}`}
            </button>
          )}
        </div>
      </div>
    </AppShell>
  )
}
