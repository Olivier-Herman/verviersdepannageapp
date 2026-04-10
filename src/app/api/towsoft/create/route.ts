// src/app/api/towsoft/create/route.ts

import { NextResponse }          from 'next/server'
import { getServerSession }      from 'next-auth'
import { authOptions }           from '@/lib/auth'
import { createAdminClient }     from '@/lib/supabase'
import { createTowsoftMission }  from '@/lib/towsoft'

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

  // Envoyer l'email via Microsoft Graph directement
  try {
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     process.env.AZURE_AD_CLIENT_ID!,
          client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
          grant_type:    'client_credentials',
          scope:         'https://graph.microsoft.com/.default',
        }),
      }
    )
    const tokenData = await tokenRes.json()
    const token = tokenData.access_token

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

    await fetch(
      `https://graph.microsoft.com/v1.0/users/${process.env.MISSIONS_EMAIL}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            subject: `${typeLabels[type]} — ${plate || 'Véhicule'} — ${date}`,
            body: { contentType: 'HTML', content: emailBody },
            toRecipients: [{ emailAddress: { address: 'fourriere@verviersdepannage.be' } }],
          },
          saveToSentItems: false,
        }),
      }
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
