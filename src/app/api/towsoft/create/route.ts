// src/app/api/towsoft/create/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendEmail, sendPoliceEmail } from '@/lib/emails'

export const maxDuration = 30

const TYPE_CONFIG: Record<string, { label: string; parc: string; motif: string }> = {
  accident:  { label: '🚨 Police Accident',    parc: 'K3', motif: 'ACCIDENT' },
  saisie:    { label: '⚖️ Saisie',             parc: 'J',  motif: 'SAISIE' },
  mal_garee: { label: '🚫 Mal Garée',          parc: 'L',  motif: 'MAL GARÉE' },
  snc:       { label: '🛣️ Siabis Non Couvert', parc: 'K2', motif: 'SIABIS NON COUVERT' },
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    type, date, time, plate, vin, brand, model,
    location, policeZone, officerName,
    ownerFirstName, ownerLastName, ownerPhone,
    remarks, photoUrls,
  } = body

  if (!type || !date || !time || !location) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const user = session.user as any

  const { data: dbUser } = await supabase
    .from('users')
    .select('towsoft_name, name')
    .eq('email', user.email)
    .maybeSingle()

  if (!dbUser?.towsoft_name) {
    return NextResponse.json({ error: 'Profil TowSoft non configuré. Contactez l\'administrateur.' }, { status: 400 })
  }

  const config = TYPE_CONFIG[type]
  if (!config) return NextResponse.json({ error: 'Type invalide' }, { status: 400 })

  // Sauvegarder dans la queue
  const { data: queueEntry, error: queueError } = await supabase
    .from('towsoft_queue')
    .insert({
      mission_type: type,
      date, time, plate, vin, brand, model,
      location,
      police_zone:  policeZone,
      officer_name: officerName,
      owner_first:  ownerFirstName,
      owner_last:   ownerLastName,
      owner_phone:  ownerPhone,
      remarks,
      driver_name:  dbUser.towsoft_name,
      parc:         config.parc,
      motif:        config.motif,
      status:       'pending',
    })
    .select('id')
    .single()

  if (queueError) {
    console.error('[TowSoft] Queue error:', queueError)
    return NextResponse.json({ error: 'Erreur création queue' }, { status: 500 })
  }

  // Ajouter les URLs des photos dans les remarques
  const remarksWithPhotos = [
    remarks,
    photoUrls?.length ? `Photos: ${photoUrls.join(' | ')}` : '',
  ].filter(Boolean).join(' --- ')

  // Lancer GitHub Action + Email + Helpdesk en parallèle
  await Promise.allSettled([

    // 1. GitHub Action TowSoft
    fetch(
      `https://api.github.com/repos/Olivier-Herman/verviersdepannageapp/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          event_type: 'create-towsoft-mission',
          client_payload: {
            queue_id: queueEntry.id,
            data: JSON.stringify({
              mission_type: type,
              date, time, plate, vin, brand, model,
              location,
              officer_name: officerName || '',
              owner_first:  ownerFirstName || '',
              owner_last:   ownerLastName || '',
              owner_phone:  ownerPhone || '',
              remarks:      remarksWithPhotos || '',
              driver_name:  dbUser.towsoft_name,
              parc:         config.parc,
              motif:        config.motif,
            }),
          },
        }),
      }
    ).then(r => {
      if (!r.ok) r.text().then(e => console.error('[TowSoft] GitHub dispatch error:', e))
      else console.log('[TowSoft] GitHub Action déclenchée pour queue:', queueEntry.id)
    }),

    // 2. Email récapitulatif
    sendPoliceEmail({
      type, typeLabel: config.label, chauffeurName: dbUser.name,
      date, time, location,
      policeZone:     policeZone || '',
      officerName:    officerName || '',
      plate:          plate || '',
      vin:            vin || '',
      brand:          brand || '',
      model:          model || '',
      ownerFirstName: ownerFirstName || '',
      ownerLastName:  ownerLastName || '',
      ownerPhone:     ownerPhone || '',
      remarks:        remarksWithPhotos || '',
      photoUrls:      photoUrls || [],
      parc:           config.parc,
    }).then(() => console.log('[TowSoft] Email envoyé'))
     .catch(e => console.error('[TowSoft] Email échec:', e)),

    // 3. Helpdesk Odoo
    import('@/lib/odoo-fsm').then(({ createHelpdeskTicket }) =>
      createHelpdeskTicket({
        supabaseId:    queueEntry.id,
        dossierNumber: `${config.label} — ${date}`,
        source:        'POLICE',
        clientName:    [ownerFirstName, ownerLastName].filter(Boolean).join(' ') || 'Inconnu',
        vehiclePlate:  plate || '',
        city:          location || '',
        description:   [
          `Chauffeur: ${dbUser.name}`,
          `Lieu: ${location}`,
          officerName ? `Policier: ${officerName}` : '',
          plate ? `Plaque: ${plate}` : '',
          brand ? `Véhicule: ${brand} ${model || ''}` : '',
          remarks ? `Remarques: ${remarks}` : '',
        ].filter(Boolean).join(' | '),
        teamId: 12,
      })
    ).then(() => console.log('[TowSoft] Helpdesk Odoo créé'))
     .catch(e => console.error('[TowSoft] Helpdesk Odoo échec:', e)),

  ])

  return NextResponse.json({
    ok: true,
    queueId: queueEntry.id,
    message: 'Mission en cours de création',
  })
}
