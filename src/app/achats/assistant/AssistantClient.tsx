'use client'
// src/app/achats/assistant/AssistantClient.tsx
//
// Assistant Achats — chat dédié avec mémoire persistante. Conseille, cherche des
// fournisseurs (web + base), inspecte les dépenses, agit.

import { useEffect, useRef, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { ShoppingCart, ArrowLeft, Send, Loader2, Sparkles, Trash2 } from 'lucide-react'

const SUGGESTIONS = [
  'Où puis-je économiser le plus en ce moment ?',
  'Trouve-moi des fournisseurs de pneus poids lourd près de Verviers',
  'Analyse ma catégorie Carburant et propose des pistes',
  'Comment réduire mes coûts de pièces détachées ?',
]

export default function AssistantClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [msgs, setMsgs] = useState<any[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const load = () => fetch('/api/admin/achats/assistant', { cache: 'no-store' }).then(r => r.json()).then(d => setMsgs(d.messages || [])).finally(() => setLoaded(true))
  useEffect(() => { load() }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  const send = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || busy) return
    setInput(''); setBusy(true)
    setMsgs(m => [...m, { role: 'user', content, id: 'tmp' + Date.now() }])
    try {
      const r = await fetch('/api/admin/achats/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
      const j = await r.json()
      setMsgs(m => [...m, { role: 'assistant', content: j.reply || ('❌ ' + (j.error || 'Erreur')), id: 'a' + Date.now() }])
    } catch { setMsgs(m => [...m, { role: 'assistant', content: '❌ Erreur réseau', id: 'e' + Date.now() }]) } finally { setBusy(false) }
  }

  const clear = async () => { if (confirm('Effacer toute la conversation ? La mémoire de l\'assistant repart de zéro.')) { await fetch('/api/admin/achats/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear' }) }); setMsgs([]) } }

  return (
    <AppShell title="Assistant Achats" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-3xl mx-auto px-4 py-4 flex flex-col" style={{ minHeight: 'calc(100vh - 120px)' }}>
        <div className="flex items-center gap-3 mb-3">
          <a href="/achats" className="p-2 rounded-lg border text-ink-muted hover:text-brand" title="Retour"><ArrowLeft size={16} /></a>
          <div className="w-10 h-10 rounded-2xl bg-brand/10 text-brand flex items-center justify-center"><Sparkles size={20} /></div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-ink leading-tight">Assistant Achats</h1>
            <p className="text-ink-muted text-xs">Ton conseiller achats dédié — mémoire, recherche de fournisseurs, analyse & actions.</p>
          </div>
          {msgs.length > 0 && <button onClick={clear} className="p-2 text-ink-muted/60 hover:text-red-500" title="Nouvelle conversation"><Trash2 size={16} /></button>}
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 pb-3">
          {loaded && !msgs.length && (
            <div className="text-center py-10">
              <div className="w-14 h-14 rounded-2xl bg-brand/10 text-brand flex items-center justify-center mx-auto mb-3"><Sparkles size={26} /></div>
              <p className="text-ink font-medium">Bonjour {(userName || '').split(' ')[0]} — je suis ton assistant achats.</p>
              <p className="text-ink-muted text-sm mt-1 mb-4">Pose-moi n'importe quoi sur tes achats : économies, fournisseurs, négociation, analyse…</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map(s => <button key={s} onClick={() => send(s)} className="text-xs px-3 py-1.5 rounded-full border text-ink-secondary hover:border-brand/40 hover:text-brand">{s}</button>)}
              </div>
            </div>
          )}
          {msgs.map(m => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${m.role === 'user' ? 'bg-brand text-white' : 'bg-surface border text-ink'}`}>{m.content}</div>
            </div>
          ))}
          {busy && <div className="flex justify-start"><div className="bg-surface border rounded-2xl px-4 py-2.5 text-sm text-ink-muted inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> réflexion… (recherche web possible)</div></div>}
          <div ref={endRef} />
        </div>

        <div className="flex gap-2 pt-2 border-t sticky bottom-0 bg-bg">
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            rows={1} placeholder="Écris ton message…  (Entrée pour envoyer)" className="flex-1 bg-surface border rounded-xl px-3 py-2.5 text-sm text-ink resize-none max-h-32" />
          <button onClick={() => send()} disabled={busy || !input.trim()} className="px-4 rounded-xl bg-brand text-white disabled:opacity-50"><Send size={17} /></button>
        </div>
      </div>
    </AppShell>
  )
}
