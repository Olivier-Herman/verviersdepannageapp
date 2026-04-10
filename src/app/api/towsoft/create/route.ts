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
      'fourriere@verviersdepannage.be',
      `${typeLabels[type]} — ${plate || 'Véhicule'} — ${date}`,
      emailBody,
    )
    console.log('[TowSoft] Email fourrière envoyé')
  } catch (e) {
    console.error('[TowSoft] Email fourrière échec:', e)
  }

  return NextResponse.json({
    ok: true,
    message: 'Mission en cours de création — Email envoyé à la fourrière',
  })
}
