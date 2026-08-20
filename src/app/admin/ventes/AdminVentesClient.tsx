'use client'

// Module « Ventes de véhicules » — l'écran qui alimente le site public.
//
// Deux entrées de stock :
//   · « Depuis un abandon » → une fiche mission portant un abandon ; marque,
//     modèle, VIN, plaque et photos du chauffeur sont repris tels quels ;
//   · « Ajout manuel »      → lot vierge, pour n'importe quel véhicule qu'on
//     veut vendre sans qu'il vienne d'une intervention (rachat d'occasion,
//     reprise, véhicule de la flotte…). Tout se saisit à la main, photos
//     comprises, et les trois modes de vente restent disponibles.
// L'origine reste INTERNE : le site n'en dit jamais rien.
//
// Le mode de vente se choisit lot par lot (prix fixe / enveloppe fermée /
// enchère montante) — voir lib/ventes/types pour ce que chacun implique.
// Olivier 2026-08-20.

import { useState }  from 'react'
import { useRouter } from 'next/navigation'
import Link          from 'next/link'
import {
  SALE_MODES, SALE_CONDITIONS, SALE_DESTINATIONS, SALE_STATUSES,
  type SaleMode, type SaleStatus,
} from '@/lib/ventes/types'

interface Bids { total: number; confirmed: number; best: number | null }
interface Sale {
  id: string; reference: string; origin: string; mission_id: string | null
  title: string; brand: string | null; model: string | null; version: string | null
  first_registration: string | null; mileage: number | null; mileage_source: string | null
  fuel: string | null; gearbox: string | null; power_kw: number | null; doors: number | null
  color: string | null; plate: string | null; vin: string | null
  condition: string; destination: string; damage: string | null
  ct_status: string | null; carpass: boolean | null; keys_count: number | null
  description: string | null; photos: string[]
  sale_mode: SaleMode; price: number | null; reserve_price: number | null
  start_price: number | null; bid_step: number | null
  status: SaleStatus; opens_at: string | null; closes_at: string | null
  visit_info: string | null; purchase_price: number | null; purchase_notes: string | null
  sold_price: number | null; awarded_bid_id: string | null
  bids: Bids
}
interface Bid {
  id: string; amount: number; bidder_name: string; bidder_email: string
  bidder_phone: string | null; bidder_is_pro: boolean; bidder_vat: string | null
  intent: string | null; message: string | null; confirmed_at: string | null
  status: string; created_at: string
}
interface Abandon {
  id: string; mission_number: number | null; vehicle_brand: string | null
  vehicle_model: string | null; vehicle_plate: string | null; abandon_at: string
}

const eur = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

const STATUS_CLS: Record<string, string> = {
  draft:     'bg-surface-2 text-ink-muted',
  published: 'bg-emerald-500/15 text-emerald-600',
  closed:    'bg-amber-500/15 text-amber-600',
  awarded:   'bg-blue-500/15 text-blue-600',
  sold:      'bg-blue-500/15 text-blue-600',
  withdrawn: 'bg-surface-2 text-ink-muted line-through',
}

const inputCls = 'w-full bg-surface border border-app rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand'
const labelCls = 'block text-xs text-ink-muted mb-1'

export default function AdminVentesClient({
  initialSales, abandons,
}: { initialSales: Sale[]; abandons: Abandon[] }) {
  const router = useRouter()
  const [sales, setSales]     = useState<Sale[]>(initialSales)
  const [open, setOpen]       = useState<Sale | null>(null)
  const [bids, setBids]       = useState<Bid[]>([])
  const [pickAbandon, setPickAbandon] = useState(false)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [filter, setFilter]   = useState<'all' | SaleStatus>('all')
  const [uploading, setUploading] = useState(false)

  const shown = filter === 'all' ? sales : sales.filter(s => s.status === filter)

  async function call(url: string, init: RequestInit) {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j?.error || 'Erreur')
    return j
  }

  async function create(missionId?: string) {
    setBusy(true); setError(null)
    try {
      const { sale } = await call('/api/admin/ventes', {
        method: 'POST', body: JSON.stringify(missionId ? { mission_id: missionId } : {}),
      })
      setSales([{ ...sale, bids: { total: 0, confirmed: 0, best: null } }, ...sales])
      setPickAbandon(false)
      await openLot({ ...sale, bids: { total: 0, confirmed: 0, best: null } })
      router.refresh()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  async function openLot(s: Sale) {
    setOpen(s); setBids([]); setError(null)
    try {
      const j = await call(`/api/admin/ventes/${s.id}`, { method: 'GET' })
      setOpen({ ...j.sale, bids: s.bids }); setBids(j.bids)
    } catch (e: any) { setError(e.message) }
  }

  async function patch(body: any) {
    if (!open) return
    setBusy(true); setError(null)
    try {
      const { sale } = await call(`/api/admin/ventes/${open.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      const merged = { ...sale, bids: open.bids }
      setOpen(merged)
      setSales(sales.map(s => s.id === sale.id ? merged : s))
      if (body.award_bid_id) {
        const j = await call(`/api/admin/ventes/${open.id}`, { method: 'GET' })
        setBids(j.bids)
      }
      router.refresh()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  async function removeLot(s: Sale) {
    if (!confirm(`Supprimer le brouillon ${s.reference} ?`)) return
    setBusy(true); setError(null)
    try {
      await call(`/api/admin/ventes/${s.id}`, { method: 'DELETE' })
      setSales(sales.filter(x => x.id !== s.id)); setOpen(null); router.refresh()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  const set = (k: keyof Sale, v: any) => open && setOpen({ ...open, [k]: v } as Sale)

  async function uploadPhotos(files: FileList | null) {
    if (!open || !files?.length) return
    setUploading(true); setError(null)
    try {
      const fd = new FormData()
      Array.from(files).forEach(f => fd.append('files', f))
      const r = await fetch(`/api/admin/ventes/${open.id}/photos`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Envoi impossible.')
      setOpen({ ...open, photos: j.photos })
    } catch (e: any) { setError(e.message) } finally { setUploading(false) }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin" className="text-sm text-ink-muted hover:text-ink">← Admin</Link>
        <h1 className="text-xl font-bold text-ink">🚗 Ventes de véhicules</h1>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setPickAbandon(true)} disabled={busy}
            className="px-3 py-2 bg-surface-2 hover:bg-surface border border-app rounded-xl text-sm font-medium text-ink disabled:opacity-50">
            + Depuis un abandon
          </button>
          <button onClick={() => create()} disabled={busy}
            className="px-3 py-2 bg-brand hover:opacity-90 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
            + Ajout manuel
          </button>
        </div>
      </div>

      <p className="text-sm text-ink-muted">
        Les lots « En ligne » sont publiés sur le site via <code className="text-xs">/api/ventes</code>.
        L&apos;origine du véhicule, la plaque, le VIN, le prix d&apos;achat et le prix de réserve ne sortent jamais.
      </p>

      {error && <div className="bg-critical/10 border border-critical/30 text-critical rounded-xl px-4 py-2 text-sm">⚠ {error}</div>}

      <div className="flex flex-wrap gap-1.5">
        {(['all', 'draft', 'published', 'closed', 'awarded', 'sold', 'withdrawn'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              filter === f ? 'bg-brand text-white border-brand' : 'bg-surface border-app text-ink-muted hover:text-ink'}`}>
            {f === 'all' ? `Tous (${sales.length})` : `${SALE_STATUSES[f].label} (${sales.filter(s => s.status === f).length})`}
          </button>
        ))}
      </div>

      <div className="bg-surface border border-app rounded-2xl overflow-hidden">
        {shown.length === 0 && <p className="p-6 text-sm text-ink-muted text-center">Aucun lot ici.</p>}
        {shown.map(s => (
          <button key={s.id} onClick={() => openLot(s)}
            className="w-full text-left px-4 py-3 border-b border-app last:border-b-0 hover:bg-surface-2 transition flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-xs text-ink-muted w-24 shrink-0">{s.reference}</span>
            <span className="font-medium text-ink flex-1 min-w-[180px]">{s.title}</span>
            <span className="text-xs text-ink-muted w-28">{SALE_MODES[s.sale_mode].short}</span>
            <span className="text-xs text-ink-muted w-24">
              {s.sale_mode === 'fixed' ? eur(s.price) : `${s.bids.confirmed} offre${s.bids.confirmed > 1 ? 's' : ''}`}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_CLS[s.status]}`}>
              {SALE_STATUSES[s.status].label}
            </span>
          </button>
        ))}
      </div>

      {/* ── Choisir la fiche d'abandon ── */}
      {pickAbandon && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-surface w-full max-w-lg rounded-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-3 border-b border-app sticky top-0 bg-surface">
              <h3 className="font-bold text-ink">Fiches avec abandon enregistré</h3>
              <button onClick={() => setPickAbandon(false)} className="text-ink-muted hover:text-ink text-xl leading-none px-1">✕</button>
            </div>
            <div className="p-4 space-y-2">
              {abandons.length === 0 && (
                <p className="text-sm text-ink-muted">
                  Aucune fiche disponible. Un véhicule saisi par la police n&apos;apparaît jamais ici :
                  il ne nous appartient pas et passe par le SPF Domaine.
                </p>
              )}
              {abandons.map(a => (
                <button key={a.id} onClick={() => create(a.id)} disabled={busy}
                  className="w-full text-left px-3 py-2 bg-surface-2 hover:bg-surface border border-app rounded-xl disabled:opacity-50">
                  <span className="text-sm font-medium text-ink">
                    {[a.vehicle_brand, a.vehicle_model].filter(Boolean).join(' ') || 'Véhicule'}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    n° {a.mission_number ?? '—'} · {a.vehicle_plate || 'sans plaque'} ·
                    abandon du {new Date(a.abandon_at).toLocaleDateString('fr-BE')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Édition d'un lot ── */}
      {open && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-surface w-full max-w-3xl rounded-2xl my-6">
            <div className="flex items-center justify-between px-5 py-3 border-b border-app sticky top-0 bg-surface z-10 rounded-t-2xl">
              <div>
                <h3 className="font-bold text-ink">{open.reference}</h3>
                <p className="text-xs text-ink-muted">
                  {open.origin === 'abandon' ? 'Depuis une fiche' : 'Ajouté à la main'}
                  {open.mission_id && <> · <Link href={`/dispatch/${open.mission_id}`} className="text-brand hover:underline">voir la fiche</Link></>}
                </p>
              </div>
              <button onClick={() => setOpen(null)} className="text-ink-muted hover:text-ink text-xl leading-none px-1">✕</button>
            </div>

            <div className="p-5 space-y-5">
              {error && <div className="bg-critical/10 border border-critical/30 text-critical rounded-xl px-3 py-2 text-sm">⚠ {error}</div>}

              {/* Annonce */}
              <section className="space-y-3">
                <h4 className="text-sm font-semibold text-ink">Annonce</h4>
                <div><label className={labelCls}>Titre affiché</label>
                  <input className={inputCls} value={open.title || ''} onChange={e => set('title', e.target.value)} /></div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div><label className={labelCls}>Marque</label><input className={inputCls} value={open.brand || ''} onChange={e => set('brand', e.target.value)} /></div>
                  <div><label className={labelCls}>Modèle</label><input className={inputCls} value={open.model || ''} onChange={e => set('model', e.target.value)} /></div>
                  <div><label className={labelCls}>1re immat.</label><input type="date" className={inputCls} value={open.first_registration || ''} onChange={e => set('first_registration', e.target.value)} /></div>
                  <div><label className={labelCls}>Kilométrage</label><input type="number" className={inputCls} value={open.mileage ?? ''} onChange={e => set('mileage', e.target.value === '' ? null : +e.target.value)} /></div>
                  <div><label className={labelCls}>Carburant</label><input className={inputCls} value={open.fuel || ''} onChange={e => set('fuel', e.target.value)} /></div>
                  <div><label className={labelCls}>Boîte</label><input className={inputCls} value={open.gearbox || ''} onChange={e => set('gearbox', e.target.value)} /></div>
                  <div><label className={labelCls}>Couleur</label><input className={inputCls} value={open.color || ''} onChange={e => set('color', e.target.value)} /></div>
                  <div><label className={labelCls}>Clés</label><input type="number" className={inputCls} value={open.keys_count ?? ''} onChange={e => set('keys_count', e.target.value === '' ? null : +e.target.value)} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelCls}>État</label>
                    <select className={inputCls} value={open.condition} onChange={e => set('condition', e.target.value)}>
                      {Object.entries(SALE_CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></div>
                  <div><label className={labelCls}>Destination</label>
                    <select className={inputCls} value={open.destination} onChange={e => set('destination', e.target.value)}>
                      {Object.entries(SALE_DESTINATIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></div>
                </div>
                {open.destination === 'pieces' && (
                  <p className="text-xs text-amber-700">
                    ⚠ Vendu pour pièces : le véhicule ne peut pas être réimmatriculé et doit suivre la filière
                    des véhicules hors d&apos;usage. À vérifier avant publication.
                  </p>
                )}
                <div><label className={labelCls}>Dégâts constatés</label>
                  <textarea className={inputCls} rows={2} value={open.damage || ''} onChange={e => set('damage', e.target.value)} /></div>
                <div><label className={labelCls}>Description</label>
                  <textarea className={inputCls} rows={3} value={open.description || ''} onChange={e => set('description', e.target.value)} /></div>
              </section>

              {/* Photos */}
              <section className="space-y-2">
                <h4 className="text-sm font-semibold text-ink">Photos publiées ({open.photos?.length || 0})</h4>
                <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
                  {(open.photos || []).map((url, i) => (
                    <div key={url + i} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="w-full aspect-square object-cover rounded-lg border border-app" />
                      <button onClick={() => set('photos', open.photos.filter((_, j) => j !== i))}
                        className="absolute top-1 right-1 bg-black/70 text-white rounded-full w-5 h-5 text-xs leading-none">×</button>
                    </div>
                  ))}
                </div>
                <label className="inline-flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface border border-app rounded-xl text-sm font-medium text-ink cursor-pointer w-fit">
                  {uploading ? 'Envoi…' : '📷 Ajouter des photos'}
                  <input type="file" accept="image/*" multiple hidden disabled={uploading}
                    onChange={e => { uploadPhotos(e.target.files); e.currentTarget.value = '' }} />
                </label>
                <p className="text-xs text-ink-muted">
                  Floutez les plaques avant publication : elles identifient l&apos;ancien propriétaire.
                </p>
              </section>

              {/* Vente */}
              <section className="space-y-3">
                <h4 className="text-sm font-semibold text-ink">Mode de vente</h4>
                <div className="grid md:grid-cols-3 gap-2">
                  {(Object.keys(SALE_MODES) as SaleMode[]).map(m => (
                    <button key={m} onClick={() => set('sale_mode', m)}
                      className={`text-left p-3 rounded-xl border transition ${
                        open.sale_mode === m ? 'border-brand bg-brand/5' : 'border-app bg-surface-2 hover:bg-surface'}`}>
                      <span className="block text-sm font-semibold text-ink">{SALE_MODES[m].label}</span>
                      <span className="block text-xs text-ink-muted mt-1">{SALE_MODES[m].help}</span>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {open.sale_mode === 'fixed' && (
                    <div><label className={labelCls}>Prix affiché (TVAC)</label>
                      <input type="number" className={inputCls} value={open.price ?? ''} onChange={e => set('price', e.target.value === '' ? null : +e.target.value)} /></div>
                  )}
                  {open.sale_mode === 'auction' && (<>
                    <div><label className={labelCls}>Mise à prix</label>
                      <input type="number" className={inputCls} value={open.start_price ?? ''} onChange={e => set('start_price', e.target.value === '' ? null : +e.target.value)} /></div>
                    <div><label className={labelCls}>Pas minimum</label>
                      <input type="number" className={inputCls} value={open.bid_step ?? ''} onChange={e => set('bid_step', e.target.value === '' ? null : +e.target.value)} /></div>
                  </>)}
                  {open.sale_mode !== 'fixed' && (
                    <div><label className={labelCls}>Prix de réserve <span className="text-ink-muted">(interne)</span></label>
                      <input type="number" className={inputCls} value={open.reserve_price ?? ''} onChange={e => set('reserve_price', e.target.value === '' ? null : +e.target.value)} /></div>
                  )}
                  {open.sale_mode !== 'fixed' && (
                    <div><label className={labelCls}>Clôture</label>
                      <input type="datetime-local" className={inputCls}
                        value={open.closes_at ? open.closes_at.slice(0, 16) : ''}
                        onChange={e => set('closes_at', e.target.value ? new Date(e.target.value).toISOString() : null)} /></div>
                  )}
                </div>
                <div><label className={labelCls}>Visite / enlèvement</label>
                  <input className={inputCls} placeholder="Pepinster, sur rendez-vous" value={open.visit_info || ''} onChange={e => set('visit_info', e.target.value)} /></div>
              </section>

              {/* Interne */}
              <section className="space-y-3">
                <h4 className="text-sm font-semibold text-ink">Interne <span className="text-xs font-normal text-ink-muted">— jamais publié</span></h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div><label className={labelCls}>Plaque</label><input className={inputCls} value={open.plate || ''} onChange={e => set('plate', e.target.value)} /></div>
                  <div><label className={labelCls}>VIN</label><input className={inputCls} value={open.vin || ''} onChange={e => set('vin', e.target.value)} /></div>
                  {open.origin === 'achat' && (
                    <div><label className={labelCls}>Prix d&apos;achat</label>
                      <input type="number" className={inputCls} value={open.purchase_price ?? ''} onChange={e => set('purchase_price', e.target.value === '' ? null : +e.target.value)} /></div>
                  )}
                </div>
              </section>

              {/* Offres */}
              {open.sale_mode !== 'fixed' && (
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold text-ink">Offres reçues ({bids.length})</h4>
                  {bids.length === 0 && <p className="text-sm text-ink-muted">Aucune offre pour l&apos;instant.</p>}
                  {bids.map(b => (
                    <div key={b.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-xl border ${
                      b.status === 'awarded' ? 'border-emerald-500 bg-emerald-500/5' : 'border-app bg-surface-2'}`}>
                      <span className="font-semibold text-ink w-24">{eur(b.amount)}</span>
                      <span className="text-sm text-ink flex-1 min-w-[140px]">
                        {b.bidder_name}{b.bidder_is_pro ? ' · pro' : ''}
                        <span className="block text-xs text-ink-muted">{b.bidder_email}{b.bidder_phone ? ` · ${b.bidder_phone}` : ''}</span>
                      </span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                        b.confirmed_at ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600'}`}>
                        {b.confirmed_at ? 'confirmée' : 'non confirmée'}
                      </span>
                      {open.status !== 'awarded' && open.status !== 'sold' && b.confirmed_at && (
                        <button onClick={() => confirm(`Attribuer le véhicule à ${b.bidder_name} pour ${eur(b.amount)} ?`) && patch({ award_bid_id: b.id })}
                          disabled={busy}
                          className="text-xs px-2.5 py-1 bg-brand text-white rounded-lg font-medium disabled:opacity-50">
                          Attribuer
                        </button>
                      )}
                    </div>
                  ))}
                  {open.reserve_price != null && open.bids.best != null && open.bids.best < open.reserve_price && (
                    <p className="text-xs text-amber-700">
                      ⚠ La meilleure offre ({eur(open.bids.best)}) est sous votre prix de réserve ({eur(open.reserve_price)}).
                    </p>
                  )}
                </section>
              )}
            </div>

            <div className="flex flex-wrap gap-2 px-5 py-4 border-t border-app sticky bottom-0 bg-surface rounded-b-2xl">
              <button onClick={() => patch({ ...open, id: undefined, status: undefined })} disabled={busy}
                className="px-4 py-2 bg-surface-2 hover:bg-surface border border-app rounded-xl text-sm font-medium text-ink disabled:opacity-50">
                Enregistrer
              </button>
              {open.status === 'draft' && (
                <button onClick={() => patch({ ...open, id: undefined, status: 'published' })} disabled={busy}
                  className="px-4 py-2 bg-brand text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                  Publier sur le site
                </button>
              )}
              {open.status === 'published' && (
                <button onClick={() => patch({ status: 'closed' })} disabled={busy}
                  className="px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                  Clôturer
                </button>
              )}
              {open.status === 'awarded' && (
                <button onClick={() => patch({ status: 'sold' })} disabled={busy}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                  Marquer vendu
                </button>
              )}
              <div className="ml-auto flex gap-2">
                {open.status !== 'draft' && open.status !== 'withdrawn' && (
                  <button onClick={() => patch({ status: 'withdrawn' })} disabled={busy}
                    className="px-3 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50">Retirer</button>
                )}
                {open.status === 'draft' && (
                  <button onClick={() => removeLot(open)} disabled={busy}
                    className="px-3 py-2 text-sm text-critical hover:underline disabled:opacity-50">Supprimer</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
