// src/app/api/towsoft/create/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendEmail }         from '@/lib/emails'

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

  // Déclencher la GitHub Action
  try {
    const ghRes = await fetch(
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
            queue_id:     queueEntry.id,
            mission_type: type,
            date, time, plate, vin, brand, model,
            location,
            officer_name: officerName || '',
            owner_first:  ownerFirstName || '',
            owner_last:   ownerLastName || '',
            owner_phone:  ownerPhone || '',
            remarks:      remarks || '',
            driver_name:  dbUser.towsoft_name,
            parc:         config.parc,
            motif:        config.motif,
          },
        }),
      }
    )

    if (!ghRes.ok) {
      const err = await ghRes.text()
      console.error('[TowSoft] GitHub dispatch error:', err)
    } else {
      console.log('[TowSoft] GitHub Action déclenchée pour queue:', queueEntry.id)
    }
  } catch (e) {
    console.error('[TowSoft] GitHub dispatch exception:', e)
  }

  // Envoyer l'email récapitulatif
  try {
    const emailBody = `
<h2>${config.label}</h2>
<p><strong>Chauffeur :</strong> ${dbUser.name}</p>
<p><strong>Date/Heure :</strong> ${date} à ${time}</p>
<p><strong>Lieu :</strong> ${location}</p>
<p><strong>Zone de police :</strong> ${policeZone || '—'}</p>
${officerName ? `<p><strong>Policier :</strong> ${officerName}</p>` : ''}
<hr/>
<p><strong>Véhicule :</strong> ${[plate, brand, model].filter(Boolean).join(' — ') || '—'}</p>
${vin ? `<p><strong>VIN :</strong> ${vin}</p>` : ''}
<hr/>
${ownerFirstName || ownerLastName ? `<p><strong>Propriétaire :</strong> ${ownerFirstName || ''} ${ownerLastName || ''}</p>` : ''}
${ownerPhone ? `<p><strong>Tél propriétaire :</strong> ${ownerPhone}</p>` : ''}
${remarks ? `<p><strong>Remarques :</strong> ${remarks}</p>` : ''}
<hr/>
<p><strong>Création TowSoft :</strong> En cours via GitHub Actions...</p>
${photoUrls?.length ? `<p><strong>Photos :</strong> ${photoUrls.length} photo(s)</p>` : ''}
    `.trim()

    await sendEmail(
      'info@verviersdepannage.com',
      `${config.label} — ${plate || 'Véhicule'} — ${date}`,
      emailBody,
    )
  } catch (e) {
    console.error('[TowSoft] Email échec:', e)
  }

  // Créer fiche Helpdesk Odoo
  try {
    const { createHelpdeskTicket } = await import('@/lib/odoo-fsm')
    await createHelpdeskTicket({
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
    console.log('[TowSoft] Helpdesk Odoo créé')
  } catch (e) {
    console.error('[TowSoft] Helpdesk Odoo échec:', e)
  }

  return NextResponse.json({
    ok: true,
    queueId: queueEntry.id,
    message: 'Mission en cours de création',
  })
}
