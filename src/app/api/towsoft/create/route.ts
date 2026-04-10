// src/app/api/towsoft/create/route.ts

import { NextResponse }          from 'next/server'
import { getServerSession }      from 'next-auth'
import { authOptions }           from '@/lib/auth'
import { createAdminClient }     from '@/lib/supabase'
import { createTowsoftMission }  from '@/lib/towsoft'
import { sendEmail }             from '@/lib/emails'

export const maxDuration = 60

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

  // Récupérer le towsoft_name du chauffeur
  const { data: dbUser } = await supabase
    .from('users')
    .select('towsoft_name, name')
    .eq('email', user.email)
    .maybeSingle()

  if (!dbUser?.towsoft_name) {
    return NextResponse.json({ error: 'Votre profil TowSoft n\'est pas configuré. Contactez l\'administrateur.' }, { status: 400 })
  }

  const typeLabels: Record<string, string> = {
    accident:  '🚨 Police Accident',
    saisie:    '⚖️ Saisie',
    mal_garee: '🚫 Mal Garée',
    snc:       '🛣️ Siabis Non Couvert',
  }

  // Lancer TowSoft en arrière-plan
  const runTowsoft = async () => {
    const result = await createTowsoftMission({
      type, date, time, plate, vin, brand, model,
      location, policeZone, officerName,
      ownerFirstName, ownerLastName, ownerPhone,
      remarks, driverTowsoftName: dbUser.towsoft_name,
    })
    console.log('[TowSoft] Résultat:', result)
  }
  runTowsoft().catch(console.error)

  // Envoyer l'email via le service emails centralisé
  try {
    const emailBody = `
<h2>${typeLabels[type] || type}</h2>
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
<p><strong>Création TowSoft :</strong> En cours de création...</p>
${photoUrls?.length ? `<p><strong>Photos :</strong> ${photoUrls.length} photo(s)</p>` : ''}
    `.trim()

    await sendEmail(
      'info@verviersdepannage.com',
      `${typeLabels[type]} — ${plate || 'Véhicule'} — ${date}`,
      emailBody,
    )
    console.log('[TowSoft] Email fourrière envoyé')
  } catch (e) {
    console.error('[TowSoft] Email fourrière échec:', e)
  }

  // Créer fiche Helpdesk Odoo équipe ID 12
  try {
    const { createHelpdeskTicket } = await import('@/lib/odoo-fsm')
    const typeContextMap: Record<string, string> = {
      accident:  'POLICE',
      saisie:    'SAISIE_POLICE',
      mal_garee: 'MAL_GAREE',
      snc:       'SNC',
    }
    await createHelpdeskTicket({
      supabaseId:    `police-${Date.now()}`,
      dossierNumber: `${typeLabels[type]} — ${date}`,
      source:        'POLICE',
      clientName:    [ownerFirstName, ownerLastName].filter(Boolean).join(' ') || 'Inconnu',
      vehiclePlate:  plate || '',
      city:          location || '',
      description:   [
        `Chauffeur: ${dbUser.name}`,
        `Lieu: ${location}`,
        `Zone police: ${policeZone}`,
        officerName ? `Policier: ${officerName}` : '',
        plate ? `Plaque: ${plate}` : '',
        vin ? `VIN: ${vin}` : '',
        brand ? `Marque: ${brand} ${model || ''}` : '',
        ownerPhone ? `Tél propriétaire: ${ownerPhone}` : '',
        remarks ? `Remarques: ${remarks}` : '',
      ].filter(Boolean).join(' | '),
      teamId: 12,
    })
    console.log('[TowSoft] Fiche Helpdesk Odoo créée')
  } catch (e) {
    console.error('[TowSoft] Helpdesk Odoo échec:', e)
  }

  return NextResponse.json({
    ok: true,
    message: 'Mission en cours de création — Email envoyé',
  })
}
