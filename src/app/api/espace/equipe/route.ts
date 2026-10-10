// /api/espace/equipe — collaborateurs (Olivier 10/10/2026).
// Le gestionnaire (Justin) crée des collaborateurs, chacun rattaché à UNE société, et décide s'il peut
// à son tour en ajouter d'autres (dans sa société). Un collaborateur ne voit que ses propres commandes.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getEspaceSession, normEmail, type EspaceCompte } from '@/lib/espace/session'
import { envoyerInvitation } from '@/lib/espace/mails'

export const dynamic = 'force-dynamic'

const peutGerer = (c: EspaceCompte) => c.role === 'gestionnaire' || (c.role === 'collaborateur' && c.peut_inviter)

export async function GET() {
  const s = await getEspaceSession()
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  if (!peutGerer(s.compte)) return NextResponse.json({ membres: [] })
  const ids = s.societes.map(x => x.id)
  const { data } = await createAdminClient().from('espace_comptes').select('id, nom, emails, role, societe_ids, peut_inviter, active, derniere_connexion, invite_par, created_at')
    .eq('role', 'collaborateur').overlaps('societe_ids', ids).order('created_at', { ascending: false })
  const nom = new Map(s.societes.map(x => [x.id, x.nom]))
  return NextResponse.json({
    membres: (data || []).map((m: any) => ({ id: m.id, nom: m.nom, email: m.emails[0], societe: nom.get(m.societe_ids[0]) || '', peutInviter: m.peut_inviter, actif: m.active, derniereConnexion: m.derniere_connexion, creeLe: m.created_at, moi: m.id === s.compte.id })),
  })
}

export async function POST(req: Request) {
  const s = await getEspaceSession()
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  if (!peutGerer(s.compte)) return NextResponse.json({ error: 'Vous ne pouvez pas ajouter de collaborateur.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const nom = String(b?.nom || '').trim().slice(0, 120)
  const email = normEmail(b?.email)
  const societe = s.societes.find(x => x.id === b?.societeId) || (s.societes.length === 1 ? s.societes[0] : null)
  if (!nom) return NextResponse.json({ error: 'Le nom est obligatoire.' }, { status: 400 })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Adresse mail invalide.' }, { status: 400 })
  if (!societe) return NextResponse.json({ error: 'Choisissez la société du collaborateur.' }, { status: 400 })
  const sb = createAdminClient()
  const { data: deja } = await sb.from('espace_comptes').select('id').contains('emails', [email]).limit(1)
  if (deja?.length) return NextResponse.json({ error: 'Cette adresse a déjà un accès.' }, { status: 409 })
  const { data: c, error } = await sb.from('espace_comptes').insert({
    nom, emails: [email], role: 'collaborateur', societe_ids: [societe.id],
    peut_inviter: s.compte.role === 'gestionnaire' ? b?.peutInviter === true : false,
    invite_par: s.compte.id,
  }).select('id').single()
  if (error || !c) return NextResponse.json({ error: 'Création impossible.' }, { status: 500 })
  let invite = true
  try { await envoyerInvitation(email, nom, s.compte.nom, societe.nom) } catch { invite = false }
  return NextResponse.json({ ok: true, id: c.id, invite })
}

export async function PATCH(req: Request) {
  const s = await getEspaceSession()
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  if (!peutGerer(s.compte)) return NextResponse.json({ error: 'Action non autorisée.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const sb = createAdminClient()
  const { data: m } = await sb.from('espace_comptes').select('id, role, societe_ids, session_version').eq('id', String(b?.id || '')).maybeSingle()
  if (!m || m.role !== 'collaborateur' || !m.societe_ids.some((id: string) => s.societes.some(x => x.id === id)) || m.id === s.compte.id) return NextResponse.json({ error: 'Collaborateur introuvable.' }, { status: 404 })
  const up: any = { updated_at: new Date().toISOString() }
  if (typeof b?.actif === 'boolean') { up.active = b.actif; if (!b.actif) up.session_version = m.session_version + 1 }
  if (typeof b?.peutInviter === 'boolean' && s.compte.role === 'gestionnaire') up.peut_inviter = b.peutInviter
  await sb.from('espace_comptes').update(up).eq('id', m.id)
  return NextResponse.json({ ok: true })
}
