'use client'
// src/app/matthieu/MatthieuClient.tsx
// « La tête à Matthieu » — accès bureau : on saisit marque + modèle et on discute.

import { useState, useRef } from 'react'
import AppShell from '@/components/layout/AppShell'

export default function MatthieuClient({ userRole, userName, userModules }: { userRole: string; userName: string; userModules: string[] }) {
  const [brand, setBrand]   = useState('')
  const [model, setModel]   = useState('')
  const [locked, setLocked] = useState(false)
  const [msgs, setMsgs]     = useState<{ role: 'user' | 'assistant'; content: string; attachments?: { title: string; url: string; section?: string }[] }[]>([])
  const [input, setInput]   = useState('')
  const [busy, setBusy]     = useState(false)
  const [img, setImg]       = useState<{ data: string; media_type: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const attach = (f: File) => { const r = new FileReader(); r.onload = () => { const c = String(r.result || '').split(',')[1]; if (c) setImg({ data: c, media_type: f.type || 'image/jpeg' }) }; r.readAsDataURL(f) }

  const ask = async (q: string) => {
    const question = q.trim()
    if ((!question && !img) || busy || !brand.trim()) return
    setLocked(true)
    const label = question + (img ? (question ? ' ' : '') + '📷 [photo]' : '')
    const next = [...msgs, { role: 'user' as const, content: label }]
    setMsgs(next); setInput('')
    const imgs = img ? [img] : []; setImg(null); setBusy(true)
    try {
      const r = await fetch('/api/mecano/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: brand.trim(), model: model.trim(), messages: next.map(m => ({ role: m.role, content: m.content })), images: imgs }),
      })
      const j = await r.json()
      setMsgs(m => [...m, { role: 'assistant', content: j.answer || j.error || 'Pas de réponse.', attachments: j.attachments }])
    } catch { setMsgs(m => [...m, { role: 'assistant', content: 'Réseau KO.' }]) }
    finally { setBusy(false) }
  }

  return (
    <AppShell title="La tête à Matthieu" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col" style={{ minHeight: 'calc(100vh - 120px)' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-2xl bg-indigo-500/15 text-indigo-500 flex items-center justify-center text-2xl">🔧</div>
          <div>
            <h1 className="text-xl font-bold text-ink leading-tight">La tête à Matthieu</h1>
            <p className="text-ink-muted text-xs">Le mécano de poche — base technique Touring (dépannage + remorquage)</p>
          </div>
        </div>

        {/* Véhicule */}
        <div className="bg-surface border rounded-2xl p-3 mb-3 grid grid-cols-2 gap-2">
          <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Marque (ex. Audi)"
            className="bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-brand" />
          <input value={model} onChange={e => setModel(e.target.value)} placeholder="Modèle (ex. A3 2020)"
            className="bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-brand" />
        </div>

        {/* Chat */}
        <div className="flex-1 bg-surface-2 border rounded-2xl p-3 overflow-y-auto space-y-3 min-h-[240px]">
          {msgs.length === 0 && (
            <div className="space-y-2">
              <p className="text-ink-muted text-sm text-center">Renseigne le véhicule, puis pose ta question.</p>
              {['Comment ouvrir ce véhicule verrouillé ?', 'Pannes fréquentes ?', 'Points d\'ancrage / mode remorquage ?', 'Coupure haute tension (électrique/hybride) ?'].map(q => (
                <button key={q} onClick={() => ask(q)} disabled={busy || !brand.trim()}
                  className="block w-full text-left text-sm px-3.5 py-2.5 rounded-xl bg-surface border border-indigo-500/30 text-ink hover:border-indigo-500/60 disabled:opacity-40">💬 {q}</button>
              ))}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-brand text-white' : 'bg-surface border text-ink'}`}>{m.content}</div>
              {m.attachments?.map((a, j) => (
                <a key={j} href={a.url} target="_blank" rel="noreferrer" className="mt-1.5 max-w-[85%] flex items-center gap-2 bg-surface border border-indigo-500/40 rounded-xl px-3 py-2 hover:border-indigo-500">
                  <span className="text-xl">📄</span>
                  <span className="text-ink text-xs font-medium flex-1 leading-tight">{a.title}</span>
                  <span className="text-indigo-600 dark:text-indigo-300 text-sm">ouvrir</span>
                </a>
              ))}
            </div>
          ))}
          {busy && <div className="flex justify-start"><div className="bg-surface border rounded-2xl px-3.5 py-2.5 text-sm text-ink-muted">Matthieu réfléchit…</div></div>}
        </div>

        {img && (
          <div className="flex items-center gap-2 mt-2">
            <img src={`data:${img.media_type};base64,${img.data}`} className="w-12 h-12 object-cover rounded-lg border" />
            <span className="text-ink-muted text-xs flex-1">Photo prête.</span>
            <button onClick={() => setImg(null)} className="text-ink-muted text-lg px-1">✕</button>
          </div>
        )}
        <div className="flex items-center gap-2 mt-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="w-10 h-10 rounded-full bg-surface border flex items-center justify-center flex-shrink-0 disabled:opacity-40" title="Photo">📷</button>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask(input) }}
            placeholder={brand.trim() ? 'Ta question…' : 'Renseigne d\'abord la marque'} disabled={busy}
            className="flex-1 bg-surface border rounded-full px-4 py-2.5 text-ink text-sm outline-none focus:border-brand" />
          <button onClick={() => ask(input)} disabled={busy || (!input.trim() && !img) || !brand.trim()}
            className="w-10 h-10 rounded-full bg-brand text-white flex items-center justify-center disabled:opacity-40 flex-shrink-0">➤</button>
        </div>
      </div>
    </AppShell>
  )
}
