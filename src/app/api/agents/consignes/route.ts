// /api/agents/consignes — tâches confiées d'un agent à un autre (Olivier 07/10/2026).
//   GET  ?pour=moi[&etat=ouverte]  → consignes reçues par l'agent appelant
//   GET  ?de=moi                   → consignes qu'il a déposées, avec les réponses
//   POST { pour, societe?, texte, lien? }      → dépôt
//   PATCH { id, etat: prise|faite|refusee, reponse? } → par le destinataire seulement
import { NextResponse } from 'next/server'
import { authenticateAgent, journal } from '@/lib/agents/core'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
const unauth = () => NextResponse.json({ error: 'Clé d’agent absente, invalide ou désactivée.' }, { status: 401 })

export async function GET(req: Request) {
  const agent = await authenticateAgent(req); if (!agent) return unauth()
  const q = new URL(req.url).searchParams
  let s = createAdminClient().from('agent_consignes').select('*').order('created_at', { ascending: false }).limit(100)
  s = q.get('de') === 'moi' ? s.eq('de', agent.name) : s.eq('pour', agent.name)
  if (q.get('etat')) s = s.eq('etat', q.get('etat')!)
  const { data, error } = await s
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, consignes: data })
}

export async function POST(req: Request) {
  const agent = await authenticateAgent(req); if (!agent) return unauth()
  const b = await req.json().catch(() => ({}))
  const pour = String(b?.pour || '').trim(), texte = String(b?.texte || '').trim().slice(0, 4000)
  if (!pour || !texte) return NextResponse.json({ error: 'pour et texte obligatoires.' }, { status: 400 })
  const sb = createAdminClient()
  const { data: dest } = await sb.from('agent_accounts').select('name, active').eq('name', pour).maybeSingle()
  if (!dest?.active) return NextResponse.json({ error: `Agent « ${pour} » inconnu ou désactivé.` }, { status: 400 })
  const societe = b?.societe == null ? null : Number(b.societe)
  if (societe != null && !agent.companies.includes(societe)) return NextResponse.json({ error: 'Société hors de vos droits.' }, { status: 403 })
  const { data, error } = await sb.from('agent_consignes').insert({ de: agent.name, pour, societe, texte, lien: String(b?.lien || '').slice(0, 500) || null }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await journal({ agent: agent.name, company: societe, action: 'consigne déposée', detail: `pour ${pour} : ${texte.slice(0, 200)}` })
  return NextResponse.json({ ok: true, id: data.id })
}

export async function PATCH(req: Request) {
  const agent = await authenticateAgent(req); if (!agent) return unauth()
  const b = await req.json().catch(() => ({}))
  if (!['prise', 'faite', 'refusee'].includes(b?.etat) || typeof b?.id !== 'string') return NextResponse.json({ error: 'id et etat (prise|faite|refusee) obligatoires.' }, { status: 400 })
  const sb = createAdminClient()
  const { data: c } = await sb.from('agent_consignes').select('pour, de').eq('id', b.id).maybeSingle()
  if (!c || c.pour !== agent.name) return NextResponse.json({ error: 'Consigne introuvable parmi les vôtres.' }, { status: 404 })
  await sb.from('agent_consignes').update({ etat: b.etat, reponse: b.reponse ? String(b.reponse).slice(0, 4000) : undefined, updated_at: new Date().toISOString() }).eq('id', b.id)
  await journal({ agent: agent.name, action: `consigne ${b.etat}`, detail: `de ${c.de}${b.reponse ? ` : ${String(b.reponse).slice(0, 200)}` : ''}` })
  return NextResponse.json({ ok: true })
}
