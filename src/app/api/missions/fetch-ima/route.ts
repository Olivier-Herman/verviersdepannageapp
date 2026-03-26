// src/app/api/missions/fetch-ima/route.ts
// Fetch la page IMA depuis le lien dans le raw_content et met à jour la mission

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { parseMissionContent } from '@/lib/missions/parser'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mission_id } = await req.json()
  if (!mission_id) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const supabase = createAdminClient()

  // Récupérer la mission
  const { data: mission, error: mErr } = await supabase
    .from('incoming_missions')
    .select('id, source, raw_content, external_id')
    .eq('id', mission_id)
    .single()

  if (mErr || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Extraire le lien IMA du raw_content
  const imaLinkMatch = mission.raw_content?.match(/https:\/\/imamobile\.ima\.eu\/[^\s"<>]+/)
  if (!imaLinkMatch) {
    return NextResponse.json({ error: 'Aucun lien IMA trouvé dans le contenu' }, { status: 400 })
  }

  const imaUrl = imaLinkMatch[0]
  console.log(`[FetchIMA] Fetching: ${imaUrl}`)

  try {
    // Fetch la page IMA côté serveur (pas de restriction robots.txt en Node.js)
    const res = await fetch(imaUrl, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (compatible; VerviersDépannage/1.0)',
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-BE,fr;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      return NextResponse.json({ error: `IMA a retourné ${res.status}` }, { status: 502 })
    }

    const html = await res.text()
    console.log(`[FetchIMA] HTML reçu: ${html.length} chars`)

    if (html.length < 100) {
      return NextResponse.json({ error: 'Page IMA vide ou inaccessible' }, { status: 502 })
    }

    // Parser le HTML avec Claude pour extraire les données
    const parsed = await parseMissionContent(
      mission.source as any,
      {
        textContent:  htmlToText(html),
        sourceFormat: 'ima_portal',
        rawContent:   html.slice(0, 15000),
      },
      `IMA Portal — ${mission.external_id}`
    )

    // Mettre à jour la mission avec les nouvelles données
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }

    // Seulement mettre à jour les champs qui étaient vides
    if (parsed.client_name     && !mission.raw_content?.includes('client_name')) updates.client_name     = parsed.client_name
    if (parsed.client_phone)    updates.client_phone    = parsed.client_phone
    if (parsed.client_address)  updates.client_address  = parsed.client_address
    if (parsed.incident_address) updates.incident_address = parsed.incident_address
    if (parsed.incident_city)   updates.incident_city   = parsed.incident_city
    if (parsed.destination_name)    updates.destination_name    = parsed.destination_name
    if (parsed.destination_address) updates.destination_address = parsed.destination_address
    if (parsed.amount_guaranteed)   updates.amount_guaranteed   = parsed.amount_guaranteed
    if (parsed.vehicle_vin)     updates.vehicle_vin     = parsed.vehicle_vin
    if (parsed.vehicle_fuel)    updates.vehicle_fuel    = parsed.vehicle_fuel
    if (parsed.vehicle_gearbox) updates.vehicle_gearbox = parsed.vehicle_gearbox
    if (parsed.incident_type)   updates.incident_type   = parsed.incident_type
    if (parsed.incident_description) updates.incident_description = parsed.incident_description

    // Stocker le HTML complet comme contenu enrichi
    updates.raw_content    = html.slice(0, 10000)
    updates.parse_confidence = Math.max(parsed.confidence, 0.95)
    updates.parsed_data    = { ...parsed, ima_url: imaUrl, enriched_at: new Date().toISOString() }

    await supabase.from('incoming_missions').update(updates).eq('id', mission_id)

    await supabase.from('mission_logs').insert({
      mission_id,
      action: 'enriched',
      notes:  `Données enrichies depuis le portail IMA`,
      metadata: { ima_url: imaUrl, fields_updated: Object.keys(updates) }
    })

    return NextResponse.json({ ok: true, fields_updated: Object.keys(updates), parsed })

  } catch (err: any) {
    console.error('[FetchIMA] Erreur:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── HTML → texte lisible ──────────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi,      '\n')
    .replace(/<\/div>/gi,    '\n')
    .replace(/<\/tr>/gi,     '\n')
    .replace(/<\/td>/gi,     ' | ')
    .replace(/<\/th>/gi,     ' | ')
    .replace(/<[^>]+>/g,     '')
    .replace(/&nbsp;/g,      ' ')
    .replace(/&lt;/g,        '<')
    .replace(/&gt;/g,        '>')
    .replace(/&amp;/g,       '&')
    .replace(/&eacute;/g,    'é')
    .replace(/&egrave;/g,    'è')
    .replace(/&agrave;/g,    'à')
    .replace(/&ecirc;/g,     'ê')
    .replace(/&#[0-9]+;/g,   '')
    .replace(/[ \t]+/g,      ' ')
    .replace(/\n{3,}/g,      '\n\n')
    .trim()
}
