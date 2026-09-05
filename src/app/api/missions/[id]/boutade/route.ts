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
import { sendNotification }  from '@/lib/notifications/send'
import Anthropic             from '@anthropic-ai/sdk'
import { ANTHROPIC_CHEAP_MODELS, createWithModelFallback } from '@/lib/anthropic-model'

export const dynamic     = 'force-dynamic'
export const maxDuration = 15

// Sujets sur lesquels on ne fait pas d'humour.
// ⚠️ Frontières de mots OBLIGATOIRES. Vu le 13/08 : « arme » matchait dans
// « alarme » — un voyant de batterie allumé suffisait à tuer la vanne. Même piège
// avec « mort » dans « mortier » ou « choc » dans « chocolat ». Un filtre trop
// large ne se voit pas : il rend juste la fonctionnalité muette.
const SERIEUX = new RegExp([
  'accident', 'bless[ée]e?s?', 'incendie', 'feu', 'collision', 'percut[ée]e?s?', 'choc',
  'mort', 'd[ée]c[èe]s', 'police', 'saisie', 'r[ée]quisit\\w*', 'agress\\w*',
  'arme', 'armes', 'urgence', 'ambulance', 'pompier',
  // \b ne marche PAS après un accent (« é » n'est pas un caractère de mot pour
  // JavaScript) : « blessé » n'était jamais reconnu. D'où ces frontières écrites
  // à la main, qui incluent les lettres accentuées.
].map(w => `(?<![\\wà-ÿ])${w}(?![\\wà-ÿ])`).join('|'), 'i')

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
  const { data: me } = await sb.from('users').select('id, name').eq('email', session.user.email).maybeSingle()
  if ((me as any)?.id !== FRANCK) return NextResponse.json({ text: null })

  const { data: m } = await sb.from('incoming_missions')
    .select('vehicle_brand, vehicle_model, vehicle_mileage, mission_type, incident_description, incident_city, incident_type, source')
    .eq('id', params.id).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const contexte = [m.incident_description, m.incident_type].filter(Boolean).join(' — ')

  // ── DEUX VANNES PRÉPARÉES, UNE SEULE FOIS CHACUNE ─────────────────────────
  // « Juste lui afficher une boutade préparée à sa prochaine intervention qui
  // concernerait une batterie, et à la prochaine crevaison » (Olivier
  // 2026-09-05). Les vannes générées à chaque mission sont coupées ; il reste
  // ces deux-là, écrites d'avance, qui partent une fois puis s'éteignent.
  //
  // Le compteur vit en BASE, pas dans le navigateur : Franck change de
  // téléphone, et une vanne « une seule fois » stockée en local se rejouerait à
  // chaque appareil.
  const PRÉPARÉES: { cle: string; motif: RegExp; texte: string }[] = [
    {
      cle:   'boutade_prete_batterie',
      motif: /batter|d[ée]marr\w*|voyant|coss|altern/i,
      texte: 'Une batterie, c’est comme l’amitié : lorsqu’elle devient faible, il vaut mieux la rebooster que de la laisser mourir.',
    },
    {
      cle:   'boutade_prete_crevaison',
      motif: /crevais|pneu|roue|jante/i,
      texte: 'Un pneu, c’est comme un ami : quand il est blessé, il vaut mieux le réparer avant qu’il ne se déchire définitivement.',
    },
  ]
  for (const p of PRÉPARÉES) {
    if (!p.motif.test(contexte)) continue
    const { data: dejaFait } = await sb.from('app_settings').select('value').eq('key', p.cle).maybeSingle()
    if ((dejaFait as any)?.value) break            // déjà servie : on ne rejoue pas
    await sb.from('app_settings').upsert(
      { key: p.cle, value: JSON.stringify({ at: new Date().toISOString(), mission_id: params.id }) },
      { onConflict: 'key' },
    )
    const vehL = [(m as any).vehicle_brand, (m as any).vehicle_model].filter(Boolean).join(' ') || null
    sb.from('boutades').insert({
      mission_id: params.id, driver_id: (me as any)?.id ?? null, driver_name: (me as any)?.name ?? 'Franck',
      text: p.texte, via: 'preparee', vehicle: vehL, city: (m as any).incident_city ?? null,
    }).then(() => {}, () => {})
    // Olivier reçoit la même chose au même moment : la vanne part une seule
    // fois, il n'y a pas de seconde chance de la voir passer.
    const { data: mobi } = await sb.from('users').select('id').eq('email', 'mobi@verviersdepannage.be').maybeSingle()
    if ((mobi as any)?.id) {
      sendNotification((mobi as any).id, 'boutade_mirror', {
        title:      '🃏 Boutade Franck',
        body:       p.texte,
        action_url: `/dispatch/${params.id}`,
        mission_id: params.id,
      }).catch(() => {})
    }
    return NextResponse.json({ text: p.texte, prepared: true })
  }
  const pick = () => REPLIS[Math.floor(Math.random() * REPLIS.length)]
  const vehLabel = [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || null

  // Mobi (superadmin) : reçoit la boutade en notif + la retrouve dans le tableau
  // dédié /admin/boutades. Résolu par email (pas de hardcode d'id).
  const { data: mobi } = await sb.from('users').select('id').eq('email', 'mobi@verviersdepannage.be').maybeSingle()

  // Historique À PART (table `boutades`) — PLUS dans mission_logs, donc n'apparaît
  // PAS sur la fiche ; visible seulement par Mobi via /admin/boutades. En parallèle,
  // on pousse la vanne en notif à Mobi. Olivier 2026-08-13.
  const journalise = (text: string, via: 'ia' | 'repli' | 'sujet-sérieux') => {
    sb.from('boutades').insert({
      mission_id: params.id, driver_id: (me as any)?.id ?? null, driver_name: (me as any)?.name ?? 'Franck',
      text, via, vehicle: vehLabel, city: m.incident_city ?? null,
    }).then(() => {}, () => {})
    if ((mobi as any)?.id) {
      sendNotification((mobi as any).id, 'boutade_mirror', {
        title:      '🃏 Boutade Franck',
        body:       text,
        action_url: `/dispatch/${params.id}`,
        mission_id: params.id,
      }).catch(() => {})
    }
  }

  // ── LA GÉNÉRATION AUTOMATIQUE EST EN VEILLE, PAS SUPPRIMÉE ────────────────
  // Olivier a coupé les vannes systématiques le 04/09 et n'en garde que deux,
  // écrites d'avance (ci-dessus). Tout ce qui suit — filtre « sujets sérieux »,
  // génération IA, phrases de repli — reste en place et prêt à resservir : il
  // suffit de repasser GENERATION_AUTO à true. Je l'avais d'abord supprimé ;
  // Olivier a demandé qu'on le garde pour une réactivation ultérieure.
  const GENERATION_AUTO = false
  if (!GENERATION_AUTO) return NextResponse.json({ text: null })

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
