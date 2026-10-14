'use client'

import { useEffect, useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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

interface ActionRow { id: string; kind: string; resume: string; status: string; error: string | null }

interface Conversation {
  id:         string
  title:      string
  created_at: string
  updated_at: string
}

interface ContentBlock {
  type:        'text' | 'tool_use' | 'tool_result'
  text?:       string
  id?:         string
  name?:       string
  input?:      any
  tool_use_id?: string
  content?:    string
  is_error?:   boolean
}

interface Message {
  id:         string
  role:       'user' | 'assistant'
  content:    ContentBlock[] | { type: string; text?: string }
  created_at: string
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
    <AppShell title={bureau ? 'Assistant bureau' : 'Assistant IA'} userRole={props.userRole} userName={props.userName} userEmail={props.userEmail} userId={props.userId} userModules={props.userModules}>
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
                <h2 className="text-xl font-display font-bold text-ink mb-2">👋 Salut {props.userName.split(' ')[0]}</h2>
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
                    L'assistant réfléchit…
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

/** tool_use_id → résultat (JSON) : l'encadré d'une action proposée y lit son identifiant. */
function toolResults(messages: Message[]): Record<string, any> {
  const out: Record<string, any> = {}
  for (const m of messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_result' && b.tool_use_id) {
    try { out[b.tool_use_id] = JSON.parse(String(b.content || '{}')) } catch { out[b.tool_use_id] = null }
  }
  return out
}

function MessageView({ message, results, actions, deciding, onDecide }: { message: Message; results: Record<string, any>; actions: Record<string, ActionRow>; deciding: string | null; onDecide: (id: string, d: 'confirmer' | 'annuler') => void }) {
  const blocks = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text' as const, text: (message.content as any)?.text || '' }]

  // Skip messages that are pure tool_result (already shown grouped with tool_use)
  const onlyToolResults = blocks.every(b => b.type === 'tool_result')
  if (onlyToolResults && message.role === 'user') return null

  // Décision sur une action (écrite par VD Soft dans la conversation) : note centrée.
  if (message.role === 'user' && blocks.length === 1 && blocks[0].type === 'text' && String(blocks[0].text || '').startsWith('⚙️')) {
    return <p className="text-center text-xs text-ink-muted italic">{blocks[0].text}</p>
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-2xl bg-brand text-white rounded-2xl rounded-br-sm px-4 py-2 text-sm whitespace-pre-wrap break-words">
          {blocks.map((b, i) => b.type === 'text' ? <span key={i}>{b.text}</span> : null)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-3xl space-y-2 w-full">
        {blocks.map((b, i) => {
          if (b.type === 'text' && b.text) {
            return (
              <div key={i} className="bg-surface border rounded-2xl rounded-bl-sm px-4 py-3 text-ink text-sm break-words assistant-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                  {b.text}
                </ReactMarkdown>
              </div>
            )
          }
          if (b.type === 'tool_use' && b.name === 'proposer_action') {
            return <ActionCard key={i} input={b.input} result={b.id ? results[b.id] : null} actions={actions} deciding={deciding} onDecide={onDecide} />
          }
          if (b.type === 'tool_use') {
            return <ToolUseBlock key={i} name={b.name || ''} input={b.input} />
          }
          return null
        })}
      </div>
    </div>
  )
}

const MarkdownComponents = {
  p:      (props: any) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  h1:     (props: any) => <h1 className="font-display font-bold text-lg mt-3 mb-2" {...props} />,
  h2:     (props: any) => <h2 className="font-display font-bold text-base mt-3 mb-2" {...props} />,
  h3:     (props: any) => <h3 className="font-semibold text-sm mt-3 mb-1.5" {...props} />,
  ul:     (props: any) => <ul className="my-2 ml-4 list-disc space-y-1" {...props} />,
  ol:     (props: any) => <ol className="my-2 ml-4 list-decimal space-y-1" {...props} />,
  li:     (props: any) => <li className="leading-relaxed" {...props} />,
  a:      (props: any) => <a className="text-brand hover:underline" target="_blank" rel="noopener" {...props} />,
  strong: (props: any) => <strong className="font-semibold text-ink" {...props} />,
  em:     (props: any) => <em className="italic" {...props} />,
  blockquote: (props: any) => <blockquote className="border-l-2 border-brand/40 pl-3 my-2 text-ink-muted italic" {...props} />,
  hr:     () => <hr className="my-3 border-surface-hover" />,
  code:   ({ inline, className, children, ...props }: any) =>
    inline
      ? <code className="bg-surface-2 px-1.5 py-0.5 rounded text-[12px] font-mono text-brand" {...props}>{children}</code>
      : <code className={className} {...props}>{children}</code>,
  pre:    (props: any) => <pre className="bg-surface-2 border rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono" {...props} />,
  table:  (props: any) => <div className="my-3 overflow-x-auto"><table className="w-full text-xs border-collapse" {...props} /></div>,
  thead:  (props: any) => <thead className="bg-surface-2" {...props} />,
  th:     (props: any) => <th className="border border-surface-hover px-2 py-1.5 text-left font-semibold text-ink-secondary" {...props} />,
  td:     (props: any) => <td className="border border-surface-hover px-2 py-1.5 align-top" {...props} />,
  tr:     (props: any) => <tr className="hover:bg-surface-2/50" {...props} />,
}

function ToolUseBlock({ name, input }: { name: string; input: any }) {
  const [expanded, setExpanded] = useState(false)
  const summary = (() => {
    if (name === 'list_tariffs')         return `Liste les tarifs${input?.source ? ` pour "${input.source}"` : ''}`
    if (name === 'create_tariff')        return `Crée un tarif ${input?.source}/${input?.mission_type} : ${input?.unit_price}€${input?.km_price ? ` + ${input.km_price}€/km` : ''}`
    if (name === 'update_tariff')        return `Modifie le tarif ${input?.id}`
    if (name === 'delete_tariff')        return `Désactive le tarif ${input?.id}`
    if (name === 'list_sources')         return 'Liste les sources'
    if (name === 'create_source')        return `Crée la source "${input?.label}"`
    if (name === 'update_source')        return `Modifie la source "${input?.key}"`
    if (name === 'toggle_source')        return `${input?.active ? 'Active' : 'Désactive'} la source "${input?.key}"`
    if (name === 'delete_source')        return `Supprime la source "${input?.key}"`
    if (name === 'list_tariff_rules')    return 'Liste les règles dynamiques'
    if (name === 'create_tariff_rule')   return `Crée règle : ${input?.reason}`
    if (name === 'update_tariff_rule')   return `Modifie la règle ${input?.id}`
    if (name === 'toggle_tariff_rule')   return `${input?.active ? 'Active' : 'Désactive'} la règle ${input?.id}`
    if (name === 'delete_tariff_rule')   return `Supprime la règle ${input?.id}`
    if (name === 'update_mission')       return `Modifie la mission ${input?.id}`
    if (name === 'list_mission_remarks') return `Liste remarques mission ${input?.mission_id}`
    if (name === 'delete_mission_remark')return `Supprime remarque ${input?.id}`
    if (name === 'create_surcharge')     return `Crée surcharge "${input?.label}" (+${input?.rate_pct}%)`
    if (name === 'update_surcharge')     return `Modifie surcharge ${input?.id}`
    if (name === 'delete_surcharge')     return `Supprime surcharge ${input?.id}`
    if (name === 'update_user')          return `Modifie user ${input?.id}`
    if (name === 'set_user_module')      return `${input?.granted ? 'Active' : 'Retire'} module "${input?.module_id}" pour user ${input?.user_id}`
    if (name === 'list_modules')         return 'Liste les modules'
    if (name === 'list_drivers')         return 'Liste les chauffeurs'
    if (name === 'list_depots')          return 'Liste les dépôts'
    if (name === 'create_depot')         return `Crée dépôt "${input?.name}"`
    if (name === 'update_depot')         return `Modifie dépôt ${input?.id}`
    if (name === 'search_missions')      return `Recherche missions : "${input?.query || '(toutes)'}"${input?.status ? ` [${input.status}]` : ''}`
    if (name === 'get_mission')          return `Récupère mission ${input?.id}`
    if (name === 'add_mission_remark')   return `Ajoute remarque sur mission ${input?.mission_id}`
    if (name === 'list_users')           return 'Liste les utilisateurs'
    if (name === 'list_surcharges')      return 'Liste les surcharges'
    if (name === 'read_memory')          return `Lit mémoire ${input?.key ? `"${input.key}"` : '(toutes)'}`
    if (name === 'chercher_fiches')      return `Cherche les fiches « ${input?.texte || ''} »`
    if (name === 'lire_fiche')           return `Lit la fiche ${input?.ref || ''}`
    if (name === 'lire_dossier')         return `Lit le dossier ${input?.ref || ''}`
    if (name === 'chercher_mails')       return `Cherche dans les mails « ${input?.texte || ''} »`
    if (name === 'lire_mail')            return `Lit un mail (${input?.boite || ''})`
    if (name === 'signaler_doute')       return 'Prévient Mobi d’un doute'
    if (name === 'write_memory')         return `Mémoire : ${input?.key} = "${(input?.value || '').slice(0, 80)}…"`
    return name
  })()

  return (
    <div className="bg-surface-2 border border-brand/20 rounded-xl px-3 py-2 text-xs">
      <button onClick={() => setExpanded(e => !e)} className="w-full text-left flex items-center justify-between gap-2 text-ink-secondary hover:text-ink">
        <span className="flex items-center gap-2">
          <span className="text-brand">🔧</span>
          <code className="text-[10px] bg-surface px-1.5 py-0.5 rounded">{name}</code>
          <span>{summary}</span>
        </span>
        <span className="text-ink-faint">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <pre className="mt-2 pt-2 border-t border-surface-hover text-[10px] text-ink-faint overflow-x-auto">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  )
}

/** Action proposée par l'assistant bureau : rien n'est fait avant « Confirmer ». */
function ActionCard({ input, result, actions, deciding, onDecide }: { input: any; result: any; actions: Record<string, ActionRow>; deciding: string | null; onDecide: (id: string, d: 'confirmer' | 'annuler') => void }) {
  const id: string | undefined = result?.action_id
  const row = id ? actions[id] : undefined
  const status = row?.status || (id ? 'en_attente' : 'refusee')
  const show = (v: any) => v == null ? '—' : typeof v === 'object' ? JSON.stringify(v, null, 1).replace(/[{}"]/g, '').trim() : String(v)
  const tone = status === 'faite' ? 'border-green-300 bg-green-50' : status === 'echec' || status === 'refusee' ? 'border-red-300 bg-red-50' : status === 'annulee' ? 'border-slate-300 bg-slate-50' : 'border-amber-300 bg-amber-50'
  return (
    <div className={`border-2 rounded-2xl px-4 py-3 text-sm ${tone}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">{result?.type || 'Action proposée'}</p>
      <p className="mt-1 text-slate-900">{input?.resume}</p>
      {result?.avant !== undefined && (
        <div className="mt-2 grid sm:grid-cols-2 gap-2 text-xs">
          <div><p className="font-semibold text-slate-700">Avant</p><pre className="whitespace-pre-wrap break-words text-slate-800">{show(result.avant)}</pre></div>
          <div><p className="font-semibold text-slate-700">Après</p><pre className="whitespace-pre-wrap break-words text-slate-800">{show(result.apres)}</pre></div>
        </div>
      )}
      {!id && <p className="mt-2 text-xs text-red-800">Proposition refusée par VD Soft : {result?.error || 'erreur'}</p>}
      {id && status === 'en_attente' && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => onDecide(id, 'confirmer')} disabled={!!deciding} className="min-h-[44px] px-4 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold disabled:opacity-50">{deciding === id ? 'En cours…' : 'Confirmer'}</button>
          <button onClick={() => onDecide(id, 'annuler')} disabled={!!deciding} className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white text-slate-800 font-semibold disabled:opacity-50">Annuler</button>
        </div>
      )}
      {status === 'en_cours' && <p className="mt-2 text-xs text-slate-700">En cours…</p>}
      {status === 'faite' && <p className="mt-2 text-xs font-semibold text-green-800">✓ Fait</p>}
      {status === 'annulee' && <p className="mt-2 text-xs text-slate-700">Annulée — rien n’a été modifié.</p>}
      {status === 'echec' && <p className="mt-2 text-xs text-red-800">Refusé par VD Soft : {row?.error}</p>}
    </div>
  )
}
