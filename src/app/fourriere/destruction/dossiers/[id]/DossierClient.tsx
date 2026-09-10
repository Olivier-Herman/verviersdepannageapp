'use client'
// Dossier de destruction — consultation, le jour où quelqu'un se présente :
// photos horodatées, état constaté, frais À LA DATE choisie (défaut : aujourd'hui,
// le compteur ne s'arrête pas à la destruction), trace de la présentation, et un
// document imprimable à remettre. Aucune facture Odoo.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import PhotoLightbox from '@/components/ui/PhotoLightbox'

type Cost = { days: number; forfaitHtva: number; gardienHtva: number; totalHtva: number; totalTvac: number; at: string; grid: { forfaitHtva: number; parcDayHtva: number; label: string } }
type Data = { dossier: any; cost: Cost; claims: any[]; mission: any }
const fmtD = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const fmtDT = (iso?: string | null) => iso ? new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const today = () => new Date().toISOString().slice(0, 10)

export default function DossierClient({ id }: { id: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [at, setAt] = useState(today())
  const [err, setErr] = useState('')
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [person, setPerson] = useState(''); const [note, setNote] = useState(''); const [saving, setSaving] = useState(false)
  const load = async (date = at) => {
    setErr('')
    try { const r = await fetch(`/api/fourriere/destruction-dossiers/${id}?at=${date}`, { cache: 'no-store' }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erreur'); setData(j) }
    catch (e: any) { setErr(e.message) }
  }
  useEffect(() => { load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [id])
  const claim = async () => {
    setSaving(true); setErr('')
    try {
      const r = await fetch(`/api/fourriere/destruction-dossiers/${id}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presented_at: at, person: person || null, note: note || null }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erreur'); setPerson(''); setNote(''); await load()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }
  if (!data && !err) return <main className="p-6 text-ink-muted">Chargement…</main>
  if (!data) return <main className="p-6 text-critical">⚠ {err}</main>
  const d = data.dossier; const c = data.cost; const cond = d.condition || {}
  return (
    <main className="p-4 lg:p-8 max-w-4xl mx-auto print:p-0">
      <style>{`@media print { .no-print { display: none !important } body { background: #fff } .print-block { break-inside: avoid } }`}</style>
      <div className="no-print flex items-center justify-between gap-3 mb-4 flex-wrap">
        <Link href="/fourriere/destruction/dossiers" className="text-ink-muted text-sm hover:text-ink">← Dossiers de destruction</Link>
        <div className="flex gap-2">
          {data.mission && <Link href={`/dispatch/${data.mission.id}`} className="px-3 py-2 bg-surface-2 border rounded-xl text-sm">Fiche #{data.mission.mission_number}</Link>}
          <button type="button" onClick={() => window.print()} className="px-3 py-2 bg-brand text-white rounded-xl text-sm font-semibold">🖨️ Imprimer le document</button>
        </div>
      </div>
      {err && <p className="text-critical text-sm mb-3 no-print">⚠ {err}</p>}

      {/* ── Document ─────────────────────────────────────────────────────── */}
      <section className="bg-surface border rounded-2xl p-5 print:border-0 print-block">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-ink-muted text-[11px] uppercase tracking-widest">Verviers Dépannage · Fourrière · Dossier de destruction</p>
            <h1 className="text-ink text-2xl font-bold mt-1">{[d.brand, d.model].filter(Boolean).join(' ') || 'Véhicule non identifié'}{d.color ? <span className="text-ink-secondary font-normal"> · {d.color}</span> : null}</h1>
            <p className="font-mono text-ink-secondary mt-1">{d.vin ? `VIN ${d.vin}` : 'VIN non lu'}{d.plate ? ` · plaque ${d.plate}` : ''}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-mono font-bold text-ink">{d.dossier_number}</p>
            {d.forced && <p className="text-amber-600 text-xs font-semibold">Sortie forcée — {d.forced_reason}</p>}
          </div>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
          <div><dt className="text-ink-muted text-[11px] uppercase tracking-wide">Entré au parc</dt><dd className="text-ink font-semibold">{fmtD(d.entered_at)}</dd></div>
          <div><dt className="text-ink-muted text-[11px] uppercase tracking-wide">Parti à la casse</dt><dd className="text-ink font-semibold">{fmtD(d.exited_at)}</dd></div>
          <div><dt className="text-ink-muted text-[11px] uppercase tracking-wide">Zone</dt><dd className="text-ink font-semibold">{d.parc_zone_key || '—'}</dd></div>
          <div><dt className="text-ink-muted text-[11px] uppercase tracking-wide">Épaviste</dt><dd className="text-ink font-semibold">{d.epaviste || '—'}</dd></div>
        </dl>

        <h2 className="text-ink-muted text-[11px] uppercase tracking-widest mt-6 mb-2">État constaté le {fmtD(d.exited_at)}</h2>
        <dl className="text-sm space-y-1">
          {[['Carrosserie', cond.carrosserie], ['Vitres', cond.vitres], ['Roues', cond.roues], ['Intérieur', cond.interieur], ['Remarques', cond.remarques]].filter(([, v]) => v).map(([k, v]) => (
            <div key={k as string} className="grid grid-cols-[110px_1fr] gap-2"><dt className="text-ink-muted">{k}</dt><dd className="text-ink">{v as string}</dd></div>
          ))}
          {!Object.values(cond).some(Boolean) && <p className="text-ink-faint">Aucun constat écrit — voir les photos.</p>}
        </dl>

        <h2 className="text-ink-muted text-[11px] uppercase tracking-widest mt-6 mb-2">Photos ({d.photos?.length || 0})</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {(d.photos || []).map((u: string, i: number) => <button key={u} type="button" onClick={() => setLightbox(i)} className="print:pointer-events-none"><img src={u} alt="" className="w-full h-28 object-cover rounded-lg bg-surface-2" /></button>)}
        </div>

        <h2 className="text-ink-muted text-[11px] uppercase tracking-widest mt-6 mb-2">Frais dus au {fmtD(c.at)}</h2>
        <div className="no-print flex items-center gap-2 mb-2 text-sm">
          <label className="text-ink-muted">Calculer à la date du</label>
          <input type="date" value={at} onChange={e => { setAt(e.target.value); load(e.target.value) }} className="bg-surface-hover border rounded-xl px-3 py-1.5 text-ink" />
          <button type="button" onClick={() => { setAt(today()); load(today()) }} className="text-brand text-xs hover:underline">aujourd'hui</button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-t"><td className="py-1.5 text-ink-secondary">Forfait enlèvement ({c.grid.label})</td><td className="py-1.5 text-right font-mono text-ink">{eur(c.forfaitHtva)}</td></tr>
            <tr className="border-t"><td className="py-1.5 text-ink-secondary">Gardiennage : {c.days} jour{c.days > 1 ? 's' : ''} × {eur(c.grid.parcDayHtva)}</td><td className="py-1.5 text-right font-mono text-ink">{eur(c.gardienHtva)}</td></tr>
            <tr className="border-t"><td className="py-1.5 text-ink">Total HTVA</td><td className="py-1.5 text-right font-mono text-ink">{eur(c.totalHtva)}</td></tr>
            <tr className="border-t border-b"><td className="py-2 text-ink font-bold">Total TVAC</td><td className="py-2 text-right font-mono text-ink font-bold text-lg">{eur(c.totalTvac)}</td></tr>
          </tbody>
        </table>
        <p className="text-ink-faint text-xs mt-2">Le gardiennage court jusqu'à la date indiquée, comme si le véhicule était encore au parc. Document informatif remis à la personne qui se présente ; aucune facture n'est établie.</p>
      </section>

      {/* ── Présentations ────────────────────────────────────────────────── */}
      <section className="no-print bg-surface border rounded-2xl p-5 mt-4">
        <h2 className="text-ink font-semibold mb-1">Quelqu'un se présente</h2>
        <p className="text-ink-muted text-xs mb-3">Enregistre la présentation : les frais à cette date sont figés dans le dossier, et la fiche d'origine en garde la trace.</p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
          <input value={person} onChange={e => setPerson(e.target.value)} placeholder="Nom de la personne (facultatif)" className="bg-surface-hover border rounded-xl px-3 py-2 text-ink text-sm" />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (ce qu'elle voulait, ce qu'on lui a dit)" className="bg-surface-hover border rounded-xl px-3 py-2 text-ink text-sm" />
          <button type="button" onClick={claim} disabled={saving} className="px-4 py-2 bg-brand text-white rounded-xl text-sm font-semibold disabled:opacity-50">{saving ? '…' : `Enregistrer au ${fmtD(at)}`}</button>
        </div>
        {data.claims.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {data.claims.map((k: any) => <li key={k.id} className="text-ink-secondary">• {fmtDT(k.presented_at)} — {k.person || 'sans nom'}{k.note ? ` · ${k.note}` : ''} · <span className="font-mono">{eur(Number(k.computed?.totalTvac || 0))} TVAC</span> <span className="text-ink-faint">({k.created_by_name})</span></li>)}
          </ul>
        )}
      </section>
      <p className="no-print text-ink-faint text-xs mt-3">Dossier créé le {fmtDT(d.created_at)} par {d.created_by_name || '—'}{d.qr_scanned ? ' · QR scanné' : ''}.</p>
      {lightbox != null && <PhotoLightbox photos={d.photos || []} startIndex={lightbox} onClose={() => setLightbox(null)} />}
    </main>
  )
}
