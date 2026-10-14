'use client'

import { useEffect, useState, useRef } from 'react'
import { MessageView, toolResults, type ActionRow, type Message } from '@/components/assistant/MessageParts'
import AppShell from '@/components/layout/AppShell'

interface Props {
  userRole:    string
  userName:    string
  userEmail?:  string
  userId?:     string
  userModules: string[]
  /** 'bureau' = assistant de Jona (comprendre / corriger un dossier, Olivier 14/10/2026). */
  mode?:       'admin' | 'bureau'
}


interface Conversation {
  id:         string
  title:      string
  created_at: string
  updated_at: string
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' })
}

export default function AssistantClient(props: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const mode = props.mode || 'admin'
  const bureau = mode === 'bureau'
  const [actions, setActions] = useState<Record<string, ActionRow>>({})
  const [deciding, setDeciding] = useState<string | null>(null)
  const keepActions = (list: ActionRow[] | undefined) => setActions(Object.fromEntries((list || []).map(a => [a.id, a])))

  async function decide(actionId: string, decision: 'confirmer' | 'annuler') {
    if (!activeId || deciding) return
    setDeciding(actionId)
    try {
      const r = await fetch(`/api/assistant/actions/${actionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok && r.status !== 409 && !j.status) alert(j.error || 'Action impossible')
      await loadMessages(activeId)
    } finally { setDeciding(null) }
  }

  useEffect(() => { loadConversations() }, [])

  useEffect(() => {
    if (activeId) loadMessages(activeId)
    else setMessages([])
  }, [activeId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  async function loadConversations() {
    const r = await fetch(`/api/assistant/conversations?mode=${mode}`)
    const j = await r.json()
    setConversations(j.conversations || [])
    if (!activeId && j.conversations?.length > 0) {
      setActiveId(j.conversations[0].id)
    }
  }

  async function loadMessages(id: string) {
    setLoading(true)
    try {
      const r = await fetch(`/api/assistant/conversations/${id}`)
      const j = await r.json()
      setMessages(j.messages || [])
      keepActions(j.actions)
    } finally {
      setLoading(false)
    }
  }

  async function createConversation() {
    const r = await fetch('/api/assistant/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) })
    const j = await r.json()
    if (j.conversation) {
      setConversations(prev => [j.conversation, ...prev])
      setActiveId(j.conversation.id)
    }
  }

  async function deleteConversation(id: string) {
    if (!confirm('Supprimer cette conversation ?')) return
    await fetch(`/api/assistant/conversations/${id}`, { method: 'DELETE' })
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeId === id) setActiveId(null)
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || sending) return
    let convId = activeId
    if (!convId) {
      const r = await fetch('/api/assistant/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) })
      const j = await r.json()
      if (!j.conversation) return
      convId = j.conversation.id
      setConversations(prev => [j.conversation, ...prev])
      setActiveId(convId)
    }

    setInput('')
    setSending(true)
    // Optimistic : ajoute le message user direct
    setMessages(prev => [...prev, {
      id: 'temp-' + Date.now(),
      role: 'user',
      content: { type: 'text', text },
      created_at: new Date().toISOString(),
    }])

    try {
      const r = await fetch(`/api/assistant/conversations/${convId}/messages`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      })
      const j = await r.json()
      if (!r.ok) {
        setMessages(prev => [...prev, {
          id: 'err-' + Date.now(),
          role: 'assistant',
          content: [{ type: 'text', text: `❌ Erreur : ${j.error || 'inconnu'}` }],
          created_at: new Date().toISOString(),
        }])
      } else {
        setMessages(j.messages || [])
        keepActions(j.actions)
        // Refresh la liste pour le titre auto
        loadConversations()
      }
    } catch (e: any) {
      setMessages(prev => [...prev, {
        id: 'err-' + Date.now(),
        role: 'assistant',
        content: [{ type: 'text', text: `❌ Erreur réseau : ${e.message}` }],
        created_at: new Date().toISOString(),
      }])
    } finally {
      setSending(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <AppShell title={bureau ? 'Max — assistant bureau' : 'Assistant IA'} userRole={props.userRole} userName={props.userName} userEmail={props.userEmail} userId={props.userId} userModules={props.userModules}>
      <div className="flex h-[calc(100vh-60px)]">
        {/* Sidebar conversations */}
        <aside className="w-64 border-r border-surface-hover bg-surface flex flex-col">
          <div className="p-3 border-b border-surface-hover">
            <button
              onClick={createConversation}
              className="w-full px-3 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-medium transition"
            >
              + Nouvelle conversation
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 && (
              <p className="text-ink-faint text-xs italic p-4 text-center">Aucune conversation</p>
            )}
            {conversations.map(c => (
              <div
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`px-3 py-2 border-b border-surface-hover cursor-pointer flex items-start gap-2 group hover:bg-surface-2 ${activeId === c.id ? 'bg-surface-2 border-l-2 border-l-brand' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">{c.title}</p>
                  <p className="text-[10px] text-ink-faint">{fmtDate(c.updated_at)}</p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); deleteConversation(c.id) }}
                  className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-critical text-xs transition"
                  title="Supprimer"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Main chat */}
        <main className="flex-1 flex flex-col bg-surface-2">
          {!activeId && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md p-6">
                <h2 className="text-xl font-display font-bold text-ink mb-2">👋 Salut {props.userName.split(' ')[0]}{bureau ? ', moi c’est Max' : ''}</h2>
                {bureau ? (
                  <div className="text-ink-muted text-sm mb-4 space-y-2 text-left">
                    <p>Pose-moi tes questions sur un dossier : pourquoi il est à facturer, d'où vient un montant, à qui il se facture, ce qui bloque. Donne la plaque ou le numéro de fiche.</p>
                    <p>Je peux aussi <b>corriger</b> un dossier : je te résume ce que j'ai compris et ce que je vais changer, et rien ne se fait tant que tu n'as pas cliqué sur <b>Confirmer</b>.</p>
                    <p>Je ne fais jamais de facture : une fois le dossier corrigé, tu factures comme d'habitude.</p>
                  </div>
                ) : (
                <p className="text-ink-muted text-sm mb-4">
                  Je peux créer/modifier des tarifs, sources, règles, chercher des missions, ajouter des remarques, et répondre à tes questions sur l'app.
                </p>
                )}
                <button
                  onClick={createConversation}
                  className="px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-medium transition"
                >
                  Démarrer une conversation
                </button>
              </div>
            </div>
          )}

          {activeId && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loading && <p className="text-ink-faint text-sm italic text-center">Chargement…</p>}
                {!loading && messages.length === 0 && (
                  <p className="text-ink-faint text-sm italic text-center">Conversation vide. Pose ta première question.</p>
                )}
                {messages.map(m => <MessageView key={m.id} message={m} results={toolResults(messages)} actions={actions} deciding={deciding} onDecide={decide} />)}
                {sending && (
                  <div className="flex items-center gap-2 text-ink-faint text-sm italic">
                    <span className="inline-block w-2 h-2 bg-brand rounded-full animate-pulse"></span>
                    {bureau ? 'Max cherche…' : 'L\'assistant réfléchit…'}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="border-t border-surface-hover bg-surface p-3">
                <div className="max-w-3xl mx-auto flex items-end gap-2">
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder="Pose ta question ou demande une action… (Shift+Entrée pour saut de ligne)"
                    rows={Math.min(8, Math.max(1, input.split('\n').length))}
                    disabled={sending}
                    className="flex-1 bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand resize-none placeholder:text-ink-faint"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={sending || !input.trim()}
                    className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-xl text-sm font-medium transition flex-shrink-0"
                  >
                    {sending ? '⏳' : '→'}
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </AppShell>
  )
}

