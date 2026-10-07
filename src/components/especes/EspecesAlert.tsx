'use client'
// Remise des espèces à Momo (Olivier 06/10/2026). Monté dans l'AppShell :
//   - Olivier : la liste des espèces à remettre, « Transférer à Momo » (son alerte de 13 h) ou
//     « Demander à Momo s'il a reçu » (affiché chez lui tout de suite) ; une fois par jour, ou via le menu ;
//   - Momo (ses deux comptes) : les paiements à confirmer ; cases à cocher, « J'ai bien reçu
//     l'argent » + code PIN, « Pas reçu », « Me le rappeler dans 15 min ». Fermeture par les boutons seulement.
import { useCallback, useEffect, useState } from 'react'
import { pollWhenVisible } from '@/lib/client/poll'
import PinInput from '@/components/ui/PinInput'

type Item = {
  odoo_payment_id: number; journal: string; payment_name: string; payment_date: string; amount: number
  invoice: string | null; client: string | null; holder_label: string | null; vehicle: string | null
  place: string | null; intervention_date: string | null; place_guessed: boolean; status: string; alerte?: boolean; last_error?: string | null
}
const eur = (n: number) => Number(n).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' })
const d = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '')
const short = (n: string) => n.split('/').pop()

function Details({ it }: { it: Item }) {
  return (
    <div className="text-xs text-slate-700 mt-0.5 leading-snug">
      <div>🚗 {it.vehicle || <i>véhicule non renseigné</i>}</div>
      <div>📍 {it.intervention_date || it.place
        ? <>{d(it.intervention_date) || 'date ?'} · {it.place || 'lieu ?'}{it.place_guessed && <i> (déduit de la plaque, à vérifier)</i>}</>
        : <i>date non renseignée · lieu non renseigné</i>}</div>
    </div>
  )
}

export default function EspecesAlert() {
  const [role, setRole] = useState<'admin' | 'momo' | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [pinOpen, setPinOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/especes', { cache: 'no-store' }).then(x => x.json()).catch(() => null)
    if (!r) return
    setRole(r.role); setItems(r.items || [])
    if (r.role === 'momo' && (r.items || []).length) { setOpen(true); setChecked(new Set((r.items || []).map((x: Item) => x.odoo_payment_id))) }
    if (r.role === 'momo' && !(r.items || []).length) setOpen(false)
    if (r.role === 'admin' && (r.items || []).some((x: Item) => x.status === 'pending')) {
      // Une fois par jour ouvrable (et à la demande via « Espèces » en bas d'écran).
      let seen = ''; try { seen = window.localStorage.getItem('vd_especes_vu') || '' } catch {}
      const today = new Date().toISOString().slice(0, 10)
      const wd = new Date().getDay()
      if (seen !== today && wd !== 0 && wd !== 6) { setOpen(true); try { window.localStorage.setItem('vd_especes_vu', today) } catch {} }
    }
  }, [])
  // Toutes les 30 s tant que l'écran est visible, et tout de suite au retour sur l'app,
  // au retour du focus (PC) et au retour du réseau : Momo ne recharge jamais (06/10/2026).
  useEffect(() => {
    const stop = pollWhenVisible(load, 30_000)
    const now = () => { if (document.visibilityState !== 'hidden') load() }
    window.addEventListener('focus', now); window.addEventListener('online', now)
    return () => { stop(); window.removeEventListener('focus', now); window.removeEventListener('online', now) }
  }, [load])

  const post = async (body: any) => {
    setBusy(true); setMsg(null)
    const r = await fetch('/api/especes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(x => x.json()).catch(() => ({ error: 'Réseau indisponible' }))
    setBusy(false)
    return r
  }

  if (!role || !items.length) return null

  // ── Olivier ────────────────────────────────────────────────────────────
  if (role === 'admin') {
    const todo = items.filter(x => x.status === 'pending')
    const waiting = items.filter(x => x.status === 'transferred' || x.status === 'requested')
    const late = items.filter(x => x.alerte)
    const total = todo.reduce((s, x) => s + Number(x.amount), 0)
    if (!open) return (
      // Au-dessus du bouton du talkie (même coin, bas à droite) — 06/10/2026 : il le cachait à moitié.
      <button type="button" onClick={() => setOpen(true)} style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 160px)' }} className="fixed right-3 z-40 min-h-[44px] px-4 rounded-full bg-orange-600 text-white text-sm font-semibold shadow-lg">
        Espèces · {todo.length}
      </button>
    )
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3">
        <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl">
          <div className="flex items-start justify-between gap-3 p-4 border-b">
            <div><p className="font-bold text-slate-900">Espèces à remettre à Momo</p><p className="text-sm text-slate-700">{todo.length} paiement{todo.length > 1 ? 's' : ''} · {eur(total)}</p></div>
            <button type="button" aria-label="Fermer" onClick={() => setOpen(false)} className="w-11 h-11 rounded-xl border text-slate-700">✕</button>
          </div>
          <div className="divide-y">
            {todo.map(it => (
              <div key={it.odoo_payment_id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-900"><b>{short(it.payment_name)}</b> · facture {it.invoice || '?'} · {d(it.payment_date)} · {it.client}</p>
                  <p className="text-xs text-slate-700">{it.journal === 'CHAU1' ? 'Encaissement chauffeur' : 'Dépannage caisse'} · encaissé par <b>{it.holder_label}</b></p>
                  <Details it={it} />
                </div>
                <p className="font-bold text-slate-900 tabular-nums">{eur(it.amount)}</p>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={async () => { await post({ action: 'transfer', ids: [it.odoo_payment_id] }); load() }} className="min-h-[44px] px-3 rounded-xl bg-orange-600 text-white text-sm font-semibold">Transférer à Momo</button>
                  <button type="button" disabled={busy} onClick={async () => { await post({ action: 'request', ids: [it.odoo_payment_id] }); load() }} className="min-h-[44px] px-3 rounded-xl border border-orange-600 text-orange-700 text-sm font-semibold">Demander à Momo s’il a reçu</button>
                </div>
              </div>
            ))}
          </div>
          {waiting.length > 0 && <p className="px-4 py-2 text-xs text-slate-700 bg-slate-50 border-t">En attente chez Momo : {waiting.map(x => `${short(x.payment_name)} (${x.status === 'requested' ? 'demandé' : 'transféré'})`).join(', ')}</p>}
          {late.length > 0 && <p className="px-4 py-2 text-xs text-red-800 bg-red-50 border-t">Confirmés par Momo mais toujours pas rapprochés après 3 jours ouvrables : {late.map(x => short(x.payment_name)).join(', ')} — vérifier le relevé Scrada.</p>}
          <div className="p-4 flex flex-wrap gap-2 justify-end border-t">
            <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] px-4 rounded-xl border text-slate-800 font-semibold">Plus tard</button>
            {todo.length > 1 && <button type="button" disabled={busy} onClick={async () => { await post({ action: 'transfer', ids: todo.map(x => x.odoo_payment_id) }); load() }} className="min-h-[44px] px-4 rounded-xl bg-orange-600 text-white font-semibold">Tout transférer à Momo</button>}
          </div>
        </div>
      </div>
    )
  }

  // ── Momo ───────────────────────────────────────────────────────────────
  if (!open) return null
  const sel = items.filter(x => checked.has(x.odoo_payment_id))
  const selTotal = sel.reduce((s, x) => s + Number(x.amount), 0)
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-3">
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto bg-white rounded-2xl shadow-xl">
        <div className="p-4 border-b"><p className="font-bold text-slate-900">Espèces qu’Olivier t’a remises</p><p className="text-sm text-slate-700">Coche ce que tu as reçu.</p></div>
        <div className="divide-y">
          {items.map(it => (
            <div key={it.odoo_payment_id} className="p-3">
              <div className="flex items-start gap-3">
                <label className="flex items-center gap-2 min-h-[44px] font-semibold text-slate-900 shrink-0">
                  <input type="checkbox" className="w-6 h-6" checked={checked.has(it.odoo_payment_id)} onChange={e => { const s = new Set(checked); e.target.checked ? s.add(it.odoo_payment_id) : s.delete(it.odoo_payment_id); setChecked(s) }} /> Reçu
                </label>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-900"><b>{short(it.payment_name)}</b> · facture {it.invoice || '?'} · {d(it.payment_date)}</p>
                  <p className="text-sm text-slate-800">{it.client} · encaissé par <b>{it.holder_label}</b> · <b className="tabular-nums">{eur(it.amount)}</b></p>
                  <Details it={it} />
                </div>
              </div>
              <div className="mt-2"><button type="button" disabled={busy} onClick={async () => { await post({ action: 'not_received', ids: [it.odoo_payment_id] }); load() }} className="min-h-[44px] px-3 rounded-xl border border-red-600 text-red-700 text-sm font-semibold">Pas reçu</button></div>
            </div>
          ))}
        </div>
        {msg && <p className="px-4 py-2 text-sm font-semibold text-red-800 bg-red-50">{msg}</p>}
        <div className="p-4 border-t flex flex-col gap-2">
          <p className="text-sm font-bold text-slate-900">{sel.length} coché{sel.length > 1 ? 's' : ''} · {eur(selTotal)}</p>
          <button type="button" disabled={busy || !sel.length} onClick={() => { setPin(''); setMsg(null); setPinOpen(true) }} className="w-full min-h-[52px] rounded-xl bg-green-700 disabled:opacity-40 text-white font-bold">J’ai bien reçu l’argent ({sel.length})</button>
          <button type="button" disabled={busy} onClick={async () => { await post({ action: 'remind', ids: items.map(x => x.odoo_payment_id) }); setOpen(false); load() }} className="w-full min-h-[52px] rounded-xl border-2 border-slate-800 text-slate-900 font-bold">⏰ Me le rappeler dans 15 min</button>
        </div>
      </div>
      {pinOpen && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-xs bg-white rounded-2xl p-4 space-y-3 shadow-xl">
            <p className="font-bold text-slate-900">Code PIN VD Soft</p>
            <p className="text-sm text-slate-700">{sel.length} paiement{sel.length > 1 ? 's' : ''} · {eur(selTotal)}</p>
            <PinInput value={pin} onChange={setPin} autoFocus className="w-full min-h-[52px] text-2xl border rounded-xl text-slate-900" />
            {msg && <p className="text-sm font-semibold text-red-800">{msg}</p>}
            <div className="flex flex-col gap-2">
              <button type="button" disabled={busy || pin.length !== 4} onClick={async () => {
                const r = await post({ action: 'confirm', ids: sel.map(x => x.odoo_payment_id), pin })
                if (!r?.ok) { setMsg(r?.error || 'Refusé'); return }
                setPinOpen(false); setMsg(r.errors?.length ? `Confirmé, avec un souci : ${r.errors[0]}` : null); load()
              }} className="w-full min-h-[48px] rounded-xl bg-green-700 disabled:opacity-40 text-white font-bold">Valider</button>
              <button type="button" onClick={() => { setPinOpen(false); setMsg(null) }} className="w-full min-h-[48px] rounded-xl border text-slate-800 font-semibold">Annuler</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
