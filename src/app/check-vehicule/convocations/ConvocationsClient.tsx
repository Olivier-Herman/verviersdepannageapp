'use client'
// src/app/check-vehicule/convocations/ConvocationsClient.tsx
// Convocations contrôle technique : scan (OCR) → agenda VD Soft + Outlook info@.

import { useEffect, useRef, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { CalendarClock, Upload, Trash2, Check, Loader2, Pencil, X } from 'lucide-react'

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const fmtDay = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
const daysTo = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)

export default function ConvocationsClient({ userRole, userName, userModules }: { userRole: string; userName: string; userModules: string[] }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [edit, setEdit] = useState<any | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => { setLoading(true); fetch('/api/check-vehicule/convocations', { cache: 'no-store' }).then(r => r.json()).then(j => setRows(j.convocations || [])).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  const b64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f) })

  const upload = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.includes('pdf') || f.type.startsWith('image/') || /\.(pdf|jpe?g|png|heic|webp)$/i.test(f.name))
    if (!arr.length) { setMsg('⚠ Dépose un PDF ou une image de convocation.'); return }
    setBusy(true); let ok = 0, cal = 0, err = 0
    for (let i = 0; i < arr.length; i++) {
      setMsg(`Lecture ${i + 1}/${arr.length}…`)
      try {
        const data = await b64(arr[i])
        const r = await fetch('/api/check-vehicule/convocations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: data, mime: arr[i].type, filename: arr[i].name }) })
        const j = await r.json()
        if (r.ok) { ok++; if (j.calendar) cal++ } else err++
      } catch { err++ }
    }
    setMsg(`✅ ${ok} convocation(s) ajoutée(s)${cal ? ` · ${cal} dans le calendrier Outlook` : ''}${err ? ` · ${err} échec(s)` : ''}`)
    setBusy(false); load()
  }

  const del = async (id: string) => { if (!confirm('Supprimer cette convocation ?')) return; await fetch(`/api/check-vehicule/convocations?id=${id}`, { method: 'DELETE' }); load() }
  const saveEdit = async () => {
    const rdv_at = edit.rdv_date ? new Date(`${edit.rdv_date}T${edit.rdv_time || '09:00'}:00`).toISOString() : undefined
    await fetch('/api/check-vehicule/convocations', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: edit.id, plate: edit.plate, brand: edit.brand, model: edit.model, center_name: edit.center_name, rdv_at }) })
    setEdit(null); load()
  }

  const upcoming = rows.filter(r => r.rdv_at && new Date(r.rdv_at).getTime() >= Date.now() - 86400000)
  const undated  = rows.filter(r => !r.rdv_at)

  return (
    <AppShell title="Convocations CT" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-brand/10 text-brand flex items-center justify-center"><CalendarClock size={22} /></div>
          <div>
            <h1 className="text-xl font-bold text-ink leading-tight">Convocations contrôle technique</h1>
            <p className="text-ink-muted text-xs">Scanne la convocation → RDV + véhicule extraits, ajoutés à l'agenda et à Outlook (rappel 1 mois avant).</p>
          </div>
        </div>

        {/* Zone scan */}
        <div onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files) }}
          onClick={() => fileRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition ${drag ? 'border-brand bg-brand/5' : 'border-default hover:border-brand/40'}`}>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={e => { if (e.target.files) upload(e.target.files); e.target.value = '' }} />
          <div className="w-12 h-12 mx-auto rounded-xl bg-surface-2 flex items-center justify-center text-brand mb-2">
            {busy ? <Loader2 className="animate-spin" size={22} /> : <Upload size={22} />}
          </div>
          <p className="text-ink font-semibold text-sm">📎 Glisse ta convocation ici (PDF ou photo)</p>
          <p className="text-ink-muted text-xs mt-1">Plusieurs à la fois · lecture auto de la date, du véhicule et du centre</p>
          {msg && <p className="text-ink-secondary text-xs mt-2">{msg}</p>}
        </div>

        {/* Agenda */}
        {loading ? <p className="text-ink-muted text-sm text-center">Chargement…</p>
          : rows.length === 0 ? <div className="bg-surface border rounded-2xl p-8 text-center text-ink-muted text-sm">Aucune convocation. Scanne la première ci-dessus.</div>
          : (
          <div className="space-y-2.5">
            {upcoming.map(r => {
              const d = daysTo(r.rdv_at)
              const soon = d <= 30
              return (
                <div key={r.id} className={`bg-surface border rounded-2xl p-4 flex items-center gap-3 ${soon ? 'border-amber-500/40' : ''}`}>
                  <div className="flex flex-col items-center justify-center w-14 flex-shrink-0">
                    <span className="text-brand text-xl font-black leading-none">{new Date(r.rdv_at).getDate()}</span>
                    <span className="text-ink-muted text-[11px] uppercase">{MONTHS[new Date(r.rdv_at).getMonth()].slice(0, 3)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-ink text-sm">{[r.plate, r.brand, r.model].filter(Boolean).join(' ') || 'Véhicule ?'}</span>
                      {soon && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">dans {d} j</span>}
                    </div>
                    <p className="text-ink-secondary text-xs mt-0.5">🕒 {fmtTime(r.rdv_at)} · {r.center_name || 'Centre ?'}{r.center_address ? ` — ${r.center_address}` : ''}</p>
                    <p className="text-ink-muted text-[11px] mt-0.5">{r.graph_event_id ? '📅 Dans Outlook (rappel 1 mois avant)' : '⚠ Pas ajouté à Outlook'}</p>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <button onClick={() => setEdit({ ...r, rdv_date: r.rdv_at ? new Date(r.rdv_at).toISOString().slice(0, 10) : '', rdv_time: r.rdv_at ? fmtTime(r.rdv_at) : '' })} className="p-1.5 rounded-lg text-ink-muted hover:text-brand"><Pencil size={15} /></button>
                    <button onClick={() => del(r.id)} className="p-1.5 rounded-lg text-ink-muted hover:text-red-500"><Trash2 size={15} /></button>
                  </div>
                </div>
              )
            })}
            {undated.length > 0 && (
              <div className="pt-2">
                <p className="text-ink-muted text-xs font-semibold mb-1.5">📌 Date non lue (à compléter)</p>
                {undated.map(r => (
                  <div key={r.id} className="bg-amber-50 dark:bg-amber-500/10 border border-amber-400/40 rounded-xl p-3 flex items-center gap-2 mb-2">
                    <span className="text-ink text-sm flex-1">{[r.plate, r.brand, r.model].filter(Boolean).join(' ') || 'Véhicule ?'} — date à saisir</span>
                    <button onClick={() => setEdit({ ...r, rdv_date: '', rdv_time: '' })} className="text-xs px-2.5 py-1.5 rounded-lg bg-brand text-white">Compléter</button>
                    <button onClick={() => del(r.id)} className="p-1.5 text-ink-muted hover:text-red-500"><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Édition */}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface border rounded-2xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-ink">Corriger la convocation</h3>
              <button onClick={() => setEdit(null)} className="p-1 text-ink-muted"><X size={18} /></button>
            </div>
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-ink-muted">Date<input type="date" value={edit.rdv_date} onChange={e => setEdit({ ...edit, rdv_date: e.target.value })} className="w-full mt-1 bg-surface-2 border rounded-lg px-2 py-2 text-sm text-ink" /></label>
                <label className="text-xs text-ink-muted">Heure<input type="time" value={edit.rdv_time} onChange={e => setEdit({ ...edit, rdv_time: e.target.value })} className="w-full mt-1 bg-surface-2 border rounded-lg px-2 py-2 text-sm text-ink" /></label>
              </div>
              <input value={edit.plate || ''} onChange={e => setEdit({ ...edit, plate: e.target.value.toUpperCase() })} placeholder="Plaque" className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" />
              <div className="grid grid-cols-2 gap-2">
                <input value={edit.brand || ''} onChange={e => setEdit({ ...edit, brand: e.target.value })} placeholder="Marque" className="bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" />
                <input value={edit.model || ''} onChange={e => setEdit({ ...edit, model: e.target.value })} placeholder="Modèle" className="bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" />
              </div>
              <input value={edit.center_name || ''} onChange={e => setEdit({ ...edit, center_name: e.target.value })} placeholder="Centre de contrôle" className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" />
            </div>
            <button onClick={saveEdit} className="w-full mt-4 py-2.5 bg-brand text-white rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-1.5"><Check size={16} /> Enregistrer</button>
            <p className="text-ink-muted text-[11px] text-center mt-2">Modifier la date recrée le rappel.</p>
          </div>
        </div>
      )}
    </AppShell>
  )
}
