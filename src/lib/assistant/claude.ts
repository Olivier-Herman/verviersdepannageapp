// src/lib/assistant/claude.ts
//
// Wrapper Anthropic pour l assistant. Gere :
//   - System prompt (identite, capacites, tools disponibles, memoire user)
//   - Tool use loop : execute les tools demandes par Claude, re-appelle jusqu a
//     reponse texte finale.
//   - Persiste tous les messages (user, assistant, tool_use, tool_result) en DB
//     dans assistant_messages.
//   - Log des tool calls dans assistant_tool_calls (audit).

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase'
import { ALL_TOOLS, TOOLS_BY_NAME, toolsForClaude, ToolContext } from './tools'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOOL_ITERATIONS = 10  // safety : eviter boucle infinie

let cachedClient: Anthropic | null = null
function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant en env vars')
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

/**
 * Charge la memoire long-terme de l user et la formate pour le system prompt.
 */
async function loadUserMemoryText(userId: string): Promise<string> {
  const sb = createAdminClient()
  const { data } = await sb.from('assistant_memory').select('key, value').eq('user_id', userId)
  if (!data || data.length === 0) return ''
  return [
    '== Memoire long-terme (faits persistants entre conversations) ==',
    ...data.map(e => `- [${e.key}] : ${e.value}`),
  ].join('\n')
}

function systemPrompt(userMemoryText: string, ctx: ToolContext): string {
  const today = new Date().toISOString().slice(0, 10)
  return `Tu es l assistant personnel de ${ctx.userName} (${ctx.userEmail}) au sein de l'application VD Soft, une app interne pour Verviers Depannage SA.

Date du jour : ${today}.

## Ton role
Tu aides ${ctx.userName.split(' ')[0]} a gerer son activite : creer/modifier des tarifs et regles tarifaires, gerer les sources de mission, chercher des informations sur les missions, ajouter des remarques, etc. Tu as acces a un ensemble d'outils (tools) pour AGIR sur les donnees de l'app.

## Domaine metier
VD Soft est l'app interne d'une societe de depannage automobile. Concepts cles :
- **Mission** : intervention (remorquage REM, depannage DSP, trajet vide). Vient d'une source (assurance comme Touring/VAB/Ethias, ou prive/garage).
- **Source** : compagnie/canal qui apporte la mission. Catalogue dans mission_source_catalog.
- **Tarif (source_tariffs)** : grille forfait + km + parc par (source, mission_type). Champ km_basis : 'charged' (incident->dest, assurances) ou 'total' (depot->...->depot, prive/garage).
- **Regle dynamique (tariff_rules)** : exception temporelle (ex: surcharge carburant +2.5eur en mai 2026 pour VAB).
- **Surcharge** : majoration horaire nuit/weekend/jour ferie, configuree separement (module Surcharges).
- **DSP = Depannage = Reparation sur place** (tous synonymes en DB).

## Comment travailler
1. **Comprends d abord ce que veut l user** avant d agir. Si la demande est ambigue, pose UNE question de clarification courte.
2. **Resume ce que tu vas faire** avant d agir, surtout pour les actions qui modifient les donnees. Sois concis.
3. **Actions destructives** (update, delete, toggle) : EXPLIQUE l action, montre l etat actuel, demande confirmation "OK pour continuer ?" et attends un "oui" / "vas-y" explicite AVANT d appeler le tool.
4. **Actions creatrices simples** (create_tariff, create_source, add_mission_remark) : tu peux executer directement, mais resume avant ce que tu vas faire.
5. **Lectures** (list_*, search_*, get_*, read_memory) : libre service.
6. **Apres action** : confirme ce qui s est passe, montre l ID de l objet cree/modifie.
7. **Si tu ne peux pas faire** quelque chose avec tes tools : explique la procedure manuelle a suivre dans l app (sois precis : page, bouton, champ).

## Memoire
Quand l user dit "souviens-toi" / "note que" / "retiens" → appelle write_memory.
Au debut de chaque conversation, lis sa memoire (deja injectee ci-dessous). Si elle est vide, ne dis rien dessus.

## Style
- Reponses courtes et directes. Pas de blabla. Pas d emojis decoratifs.
- Francais. Tutoiement.
- Code/IDs entre backticks.
- Si une action a echoue, dis pourquoi et propose comment recuperer.

${userMemoryText ? '\n' + userMemoryText : ''}`
}

interface ChatTurnInput {
  conversationId: string
  ctx:            ToolContext
  userMessage:    string  // contenu du dernier message user (sera persiste)
}

interface ChatTurnOutput {
  assistantText: string   // dernier texte assistant a afficher
  toolCalls:     { tool: string; args: any; result: any; success: boolean; error?: string }[]
}

/**
 * Execute un tour complet : sauve user msg, appelle Claude, gere les tools jusqu a
 * obtenir un message texte final, persiste tout.
 */
export async function runChatTurn(input: ChatTurnInput): Promise<ChatTurnOutput> {
  const sb = createAdminClient()

  // 1. Sauve le message user
  await sb.from('assistant_messages').insert({
    conversation_id: input.conversationId,
    role:            'user',
    content:         { type: 'text', text: input.userMessage },
  })

  // 2. Charge l historique des messages de la conversation
  const { data: history } = await sb
    .from('assistant_messages')
    .select('role, content, tool_call_id, tool_name')
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: true })

  // 3. Convertit en format Anthropic
  const claudeMessages: any[] = []
  for (const m of history || []) {
    if (m.role === 'user') {
      const c = m.content as any
      // 'user' message simple texte, OU resultat de tool (content = array de tool_result)
      if (Array.isArray(c)) {
        claudeMessages.push({ role: 'user', content: c })
      } else {
        claudeMessages.push({ role: 'user', content: c?.text || '' })
      }
    } else if (m.role === 'assistant') {
      const c = m.content as any
      claudeMessages.push({ role: 'assistant', content: Array.isArray(c) ? c : [{ type: 'text', text: c?.text || '' }] })
    }
    // role 'tool' n existe pas chez Anthropic — les results sont packs en user content blocks (tool_result)
  }

  const memoryText = await loadUserMemoryText(input.ctx.userId)
  const system = systemPrompt(memoryText, input.ctx)

  // 4. Tool use loop
  const allToolCalls: ChatTurnOutput['toolCalls'] = []
  let finalText = ''
  const client = getClient()

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const resp = await client.messages.create({
      model:      MODEL,
      max_tokens: 4096,
      system,
      tools:      toolsForClaude(),
      messages:   claudeMessages,
    })

    // Sauvegarde le message assistant (avec tous ses content blocks, y compris tool_use)
    await sb.from('assistant_messages').insert({
      conversation_id: input.conversationId,
      role:            'assistant',
      content:         resp.content as any,
    })

    claudeMessages.push({ role: 'assistant', content: resp.content })

    // Si stop_reason 'end_turn' ou pas de tool_use → reponse finale
    const toolUses = (resp.content as any[]).filter(b => b.type === 'tool_use')
    if (toolUses.length === 0 || resp.stop_reason === 'end_turn') {
      const textBlock = (resp.content as any[]).find(b => b.type === 'text')
      finalText = textBlock?.text || ''
      break
    }

    // Execute tous les tool_use en parallele
    const toolResults: any[] = []
    for (const tu of toolUses) {
      const tool = TOOLS_BY_NAME[tu.name]
      const t0 = Date.now()
      let result: any
      let success = true
      let errorMsg: string | undefined

      try {
        if (!tool) throw new Error(`Tool inconnu: ${tu.name}`)
        result = await tool.execute(tu.input || {}, input.ctx)
      } catch (e: any) {
        success = false
        errorMsg = e?.message || String(e)
        result = { error: errorMsg }
      }

      const durationMs = Date.now() - t0
      allToolCalls.push({ tool: tu.name, args: tu.input, result, success, error: errorMsg })

      // Audit log (best effort)
      sb.from('assistant_tool_calls').insert({
        conversation_id: input.conversationId,
        user_id:         input.ctx.userId,
        tool_name:       tu.name,
        args:            tu.input || {},
        result,
        success,
        error:           errorMsg || null,
        duration_ms:     durationMs,
      }).then(() => {})

      toolResults.push({
        type:        'tool_result',
        tool_use_id: tu.id,
        content:     JSON.stringify(result).slice(0, 50000),  // safety cap
        is_error:    !success,
      })
    }

    // Sauve le message user qui contient les tool_results
    await sb.from('assistant_messages').insert({
      conversation_id: input.conversationId,
      role:            'user',
      content:         toolResults as any,
    })

    claudeMessages.push({ role: 'user', content: toolResults })
  }

  // Met a jour updated_at de la conversation
  await sb.from('assistant_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', input.conversationId)

  return { assistantText: finalText, toolCalls: allToolCalls }
}
