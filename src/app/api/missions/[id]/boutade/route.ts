// src/app/api/missions/[id]/boutade/route.ts
//
// GET — une petite phrase drôle sur la mission qui démarre, pour le chauffeur.
// Demande d'Olivier (2026-08-13) : « un petit pop-up humoristique sur la
// situation quand on lui assigne une mission et qu'il démarre dessus ».
//
// Deux règles qui ne se négocient pas :
//   • on se moque de la PANNE, du véhicule, de la météo, du sort — JAMAIS du
//     client, ni du chauffeur, ni de personne ;
//   • dès qu'il y a accident, blessé, incendie, police ou saisie, on ne
//     plaisante pas : on renvoie un mot d'encouragement neutre.
// La phrase est journalisée sur la fiche (Olivier 2026-08-13) : c'est le seul
// moyen de relire ce qui a été dit et d'ajuster le ton sans passer par Franck.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import Anthropic             from '@anthropic-ai/sdk'
import { ANTHROPIC_CHEAP_MODELS, createWithModelFallback } from '@/lib/anthropic-model'

export const dynamic     = 'force-dynamic'
export const maxDuration = 15

// Sujets sur lesquels on ne fait pas d'humour.
const SERIEUX = /accident|bless|incendie|feu\b|collision|percut|choc|mort|décès|deces|police|saisie|réquisit|requisit|agress|arme|urgence|ambulance|pompier/i

const REPLIS = [
  'Bonne route — roule prudemment.',
  'C’est parti. Prends ton temps, personne n’est pressé à ce point.',
  'En route. Le café t’attendra au retour.',
]

// Réservé à Franck : c'est SA vanne, pas une fonctionnalité de la flotte.
const FRANCK = 'de9a37aa-41b5-4a56-894b-cc304f601d1a'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id').eq('email', session.user.email).maybeSingle()
  if ((me as any)?.id !== FRANCK) return NextResponse.json({ text: null })

  const { data: m } = await sb.from('incoming_missions')
    .select('vehicle_brand, vehicle_model, vehicle_mileage, mission_type, incident_description, incident_city, incident_type, source')
    .eq('id', params.id).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const contexte = [m.incident_description, m.incident_type].filter(Boolean).join(' — ')
  const pick = () => REPLIS[Math.floor(Math.random() * REPLIS.length)]

  // Journal : discret, une ligne, pour pouvoir relire et régler le ton.
  const journalise = (text: string, via: 'ia' | 'repli' | 'sujet-sérieux') =>
    sb.from('mission_logs').insert({
      mission_id: params.id, actor_id: (me as any)?.id ?? null,
      action: 'boutade', notes: text, metadata: { via },
    }).then(() => {}, () => {})

  if (SERIEUX.test(`${contexte} ${m.source || ''}`)) {
    const t = pick()
    await journalise(t, 'sujet-sérieux')
    return NextResponse.json({ text: t, serious: true })
  }

  const heure = new Date().toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })
  const veh   = [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || 'un véhicule'
  const km    = (m as any).vehicle_mileage ? Number((m as any).vehicle_mileage).toLocaleString('fr-BE') : null

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const resp = await createWithModelFallback(client, ANTHROPIC_CHEAP_MODELS, {
      max_tokens: 90,
      system: `Tu écris UNE phrase drôle et courte (20 mots maximum) pour Franck, dépanneur à Verviers, qui démarre une mission.

REGISTRE : liégeois, chaleureux, taquin — le ton d'un collègue en salle de garde.
Tu peux placer « Oufti », « Nom di dju », « Allez hein », « Va-z-y » — au plus UN par phrase, et pas systématiquement.
Le surnom « Monsieur Toucour » existe : garde-le pour les grandes occasions, pas à chaque fois.

TU TE MOQUES de la panne, du véhicule, de la météo, de l'heure, du kilométrage, du sort.
JAMAIS du client, jamais de Franck, jamais de personne. Aucune moquerie sur quelqu'un.

Exemples du ton attendu :
— Oufti, encore une batterie qui a décidé que c'était férié. Va-z-y Monsieur Toucour.
— Elle démarrait très bien hier, paraît-il. Comme toutes.
— Nom di dju, un moteur qui fait des misères un mardi. En route.
— Le voyant est allumé depuis trois semaines, mais c'est aujourd'hui qu'il est pressé.
— Allez hein, le plateau va encore travailler. Bonne route.
— 280 000 km au compteur. Elle a bien mérité une petite pause.
— Il drache et t'as une mission. Le métier rentre.

Pas d'emoji, pas de guillemets, un seul point final. Tutoiement.
Réponds UNIQUEMENT la phrase, rien d'autre.`,
      messages: [{
        role: 'user',
        content: `Mission : ${m.mission_type || 'intervention'} sur ${veh} à ${m.incident_city || 'quelque part'}, ${heure}.`
          + ` Panne annoncée : ${contexte || 'non précisée'}.`
          + (km ? ` Compteur : ${km} km.` : ''),
      }],
    })
    const text = resp.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim()
      .replace(/^["'«»\s]+|["'«»\s]+$/g, '')
    const ok = !!text && text.length <= 200
    const out = ok ? text : pick()
    await journalise(out, ok ? 'ia' : 'repli')
    return NextResponse.json({ text: out })
  } catch {
    const t = pick()
    await journalise(t, 'repli')
    return NextResponse.json({ text: t })
  }
}
