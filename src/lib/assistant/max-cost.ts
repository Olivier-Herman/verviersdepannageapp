// src/lib/assistant/max-cost.ts — ce que Max a coûté, par mois et par personne (Olivier
// 14/10/2026 : « chaque mois voir le coût qu'a coûté Max afin que je vois si je dois le
// facturer ou pas à Verviers Dépannage »). Source : conso_ia, fonction « assistant/max »,
// déclencheur « max:<personne> » ; questions = messages écrits par la personne.
import { createAdminClient } from '@/lib/supabase'

export interface MaxMonth { mois: string; libelle: string; cout_usd: number; appels: number; questions: number; personnes: { nom: string; cout_usd: number; questions: number }[] }

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const r2 = (n: number) => Math.round(n * 100) / 100

/** Mois « AAAA-MM » : coût, appels, questions, détail par personne. */
export async function maxMonth(mois: string): Promise<MaxMonth> {
  const sb = createAdminClient()
  const [y, m] = mois.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, 1)).toISOString(), to = new Date(Date.UTC(y, m, 1)).toISOString()
  const rows: any[] = []
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from('conso_ia').select('declencheur, cout_usd').eq('fonction', 'assistant/max').gte('at', from).lt('at', to).order('id').range(off, off + 999)
    rows.push(...(data || [])); if (!data || data.length < 1000) break
  }
  const per = new Map<string, { nom: string; cout_usd: number; questions: number }>()
  const P = (nom: string) => { const k = nom || '—'; if (!per.has(k)) per.set(k, { nom: k, cout_usd: 0, questions: 0 }); return per.get(k)! }
  for (const r of rows) P(String(r.declencheur || '').replace(/^max:/, '')).cout_usd += Number(r.cout_usd) || 0
  // Questions : messages texte des personnes dans les conversations Max du mois.
  const { data: convs } = await sb.from('assistant_conversations').select('id, user_id').eq('mode', 'bureau')
  const { data: users } = await sb.from('users').select('id, name, email')
  const nm = Object.fromEntries((users || []).map((u: any) => [u.id, u.name || u.email]))
  const owner = Object.fromEntries((convs || []).map((c: any) => [c.id, nm[c.user_id] || '—']))
  const ids = Object.keys(owner)
  let questions = 0
  for (let i = 0; i < ids.length; i += 200) {
    const { data: msgs } = await sb.from('assistant_messages').select('conversation_id, content').eq('role', 'user').in('conversation_id', ids.slice(i, i + 200)).gte('created_at', from).lt('created_at', to)
    for (const msg of msgs || []) {
      const c: any = msg.content
      if (Array.isArray(c) || !c?.text || String(c.text).startsWith('⚙️')) continue
      questions++; P(owner[msg.conversation_id]).questions++
    }
  }
  const personnes = [...per.values()].map(p => ({ ...p, cout_usd: r2(p.cout_usd) })).sort((a, b) => b.cout_usd - a.cout_usd)
  return { mois, libelle: `${MOIS[m - 1]} ${y}`, cout_usd: r2(rows.reduce((s, r) => s + (Number(r.cout_usd) || 0), 0)), appels: rows.length, questions, personnes }
}

/** « AAAA-MM » du mois courant (Bruxelles) décalé de `delta` mois. */
export function monthKey(delta = 0): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Brussels' }))
  const d = new Date(now.getFullYear(), now.getMonth() + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
