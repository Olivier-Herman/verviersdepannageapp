'use client'

// Affichage d'une conversation de l'assistant (bulles, outils, encadré d'action), partagé
// par la page Assistant et la pastille Max (Olivier 14/10/2026).
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface ContentBlock {
  type:        'text' | 'tool_use' | 'tool_result'
  text?:       string
  id?:         string
  name?:       string
  input?:      any
  tool_use_id?: string
  content?:    string
  is_error?:   boolean
}

export interface Message {
  id:         string
  role:       'user' | 'assistant'
  content:    ContentBlock[] | { type: string; text?: string }
  created_at: string
}

export interface ActionRow { id: string; kind: string; resume: string; status: string; error: string | null }

/** tool_use_id → résultat (JSON) : l'encadré d'une action proposée y lit son identifiant. */
export function toolResults(messages: Message[]): Record<string, any> {
  const out: Record<string, any> = {}
  for (const m of messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_result' && b.tool_use_id) {
    try { out[b.tool_use_id] = JSON.parse(String(b.content || '{}')) } catch { out[b.tool_use_id] = null }
  }
  return out
}

export function MessageView({ message, results, actions, deciding, onDecide }: { message: Message; results: Record<string, any>; actions: Record<string, ActionRow>; deciding: string | null; onDecide: (id: string, d: 'confirmer' | 'annuler') => void }) {
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
          {blocks.map((b, i) => b.type === 'text' ? <span key={i}>{String(b.text || '').replace(/^\[Page ouverte : [^\]]*\]\n/, '')}</span> : null)}
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
export function ActionCard({ input, result, actions, deciding, onDecide }: { input: any; result: any; actions: Record<string, ActionRow>; deciding: string | null; onDecide: (id: string, d: 'confirmer' | 'annuler') => void }) {
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
