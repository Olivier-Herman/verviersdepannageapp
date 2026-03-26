// src/lib/missions/allianz.ts
// Flow complet d'authentification Hexalite avec OTP email

const BASE_URL  = 'https://global.allianzpartners-providerplatform.com'
const LOGIN_URL = `${BASE_URL}/hexalite-user-management/oauth2/token`
const OTP_URL   = `${BASE_URL}/hexalite-user-management/v1.0/otp/verify`

export interface AllianzSession {
  access_token:  string
  refresh_token: string
}

// ── Étape 1 : Login → obtenir le refNo pour l'OTP ────────────────────────────

export async function allianzRequestOTP(): Promise<{ refNo: string; otpExpireAt: string }> {
  const res = await fetch(`${LOGIN_URL}?grant_type=password&scope=rest&cache_buster=${Date.now()}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':   'Mozilla/5.0 (compatible; VerviersDépannage/1.0)',
    },
    body: JSON.stringify({
      username: process.env.ALLIANZ_LOGIN!,
      password: process.env.ALLIANZ_PASSWORD!,
    }),
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Allianz login failed ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  console.log(`[Allianz] OTP demandé — refNo: ${data.refNo}, expire: ${data.otpExpireAt}`)
  return { refNo: data.refNo, otpExpireAt: data.otpExpireAt }
}

// ── Étape 2 : Soumettre l'OTP → obtenir le token d'accès ─────────────────────

export async function allianzVerifyOTP(refNo: string, otp: string): Promise<AllianzSession> {
  const res = await fetch(`${OTP_URL}?cache_buster=${Date.now()}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':   'Mozilla/5.0 (compatible; VerviersDépannage/1.0)',
    },
    body: JSON.stringify({ refNo, otp }),
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Allianz OTP verify failed ${res.status}: ${err.message || ''}`)
  }

  const data = await res.json()
  const token = data.AccessTokenResponse
  if (!token?.access_token) throw new Error('Allianz: access_token absent dans la réponse')

  console.log(`[Allianz] Authentifié avec succès`)
  return {
    access_token:  token.access_token,
    refresh_token: token.refresh_token,
  }
}

// ── Étape 3 : Récupérer les détails d'une mission ────────────────────────────

export async function allianzFetchAssignment(
  accessToken: string,
  assignmentId: string
): Promise<any> {
  // Récupérer depuis l'API search/assignments avec filtre sur le no de mission
  const now    = new Date()
  const from   = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('.')[0] + '+00:00'
  const to     = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('.')[0] + '+00:00'

  const searchUrl = `${BASE_URL}/hexalite-job-monitoring/v2.0/search/assignments` +
    `?estimatedDispatchTimeFrom=${encodeURIComponent(from)}` +
    `&estimatedDispatchTimeTo=${encodeURIComponent(to)}` +
    `&fromCache=false&cache_buster=${Date.now()}`

  const res = await fetch(searchUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type':  'application/json',
      'User-Agent':    'Mozilla/5.0 (compatible; VerviersDépannage/1.0)',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) throw new Error(`Allianz assignments failed ${res.status}`)

  const data = await res.json()
  const assignments = data.assignmentJobDataPage?.content || []

  console.log(`[Allianz] ${assignments.length} mission(s) trouvée(s)`)

  // Chercher la mission spécifique par ID
  const match = assignments.find((a: any) =>
    String(a.id) === String(assignmentId) ||
    String(a.assignmentNumber) === String(assignmentId) ||
    String(a.caseNumber) === String(assignmentId)
  )

  return match || assignments[0] || null
}

// ── Étape 4 : Récupérer le détail complet d'une mission ──────────────────────

export async function allianzFetchAssignmentDetail(
  accessToken: string,
  assignmentId: string
): Promise<any> {
  const res = await fetch(
    `${BASE_URL}/hexalite-job-monitoring/v2.0/assignments/${assignmentId}?cache_buster=${Date.now()}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
        'User-Agent':    'Mozilla/5.0 (compatible; VerviersDépannage/1.0)',
      },
      signal: AbortSignal.timeout(15000),
    }
  )

  if (!res.ok) {
    console.warn(`[Allianz] Detail ${res.status} pour ${assignmentId}`)
    return null
  }

  return res.json()
}

// ── Extraction des données depuis la réponse API ──────────────────────────────

export function allianzExtractMissionData(assignment: any): Record<string, any> {
  if (!assignment) return {}

  const vehicle    = assignment.vehicle || assignment.vehicleData || {}
  const customer   = assignment.customer || assignment.insuredPerson || {}
  const breakdown  = assignment.breakdownLocation || assignment.incidentLocation || {}
  const destination = assignment.destination || {}

  return {
    external_id:          String(assignment.id || assignment.assignmentNumber || assignment.caseNumber || ''),
    dossier_number:       assignment.caseNumber || assignment.fileNumber || null,
    mission_type:         mapMissionType(assignment.serviceType || assignment.type),
    incident_type:        assignment.serviceType || assignment.breakdownType || null,
    incident_description: assignment.description || assignment.comment || null,
    // Client
    client_name:          formatName(customer.firstName, customer.lastName) || customer.name || null,
    client_phone:         customer.phoneNumber || customer.phone || null,
    client_address:       formatAddress(customer.address) || null,
    // Véhicule
    vehicle_plate:        vehicle.licensePlate || vehicle.plate || null,
    vehicle_brand:        vehicle.brand || vehicle.make || null,
    vehicle_model:        vehicle.model || null,
    vehicle_vin:          vehicle.vin || vehicle.vinNumber || null,
    vehicle_fuel:         vehicle.fuelType || null,
    vehicle_gearbox:      vehicle.transmission || null,
    // Lieu incident
    incident_address:     formatAddress(breakdown) || breakdown.street || null,
    incident_city:        breakdown.city || breakdown.zipCode || null,
    incident_country:     breakdown.country || 'BE',
    incident_lat:         breakdown.latitude  || breakdown.lat  || null,
    incident_lng:         breakdown.longitude || breakdown.lng  || null,
    // Destination
    destination_name:     destination.name || null,
    destination_address:  formatAddress(destination) || null,
    // Montant
    amount_guaranteed:    assignment.guaranteedAmount || assignment.maxAmount || null,
    incident_at:          assignment.estimatedDispatchTime || assignment.createdAt || null,
    confidence:           0.95,
  }
}

function mapMissionType(type: string): string {
  if (!type) return 'depannage'
  const t = type.toUpperCase()
  if (t.includes('TOW') || t.includes('REMOR') || t.includes('SLEEP'))  return 'remorquage'
  if (t.includes('REPAIR') || t.includes('ROAD') || t.includes('DSP'))  return 'depannage'
  if (t.includes('TRANSPORT') || t.includes('REPATR'))                   return 'transport'
  return 'depannage'
}

function formatName(first?: string, last?: string): string {
  return [first, last].filter(Boolean).join(' ')
}

function formatAddress(addr: any): string {
  if (!addr || typeof addr === 'string') return addr || ''
  return [addr.streetName || addr.street, addr.streetNumber || addr.number, addr.zipCode || addr.zip, addr.city]
    .filter(Boolean).join(', ')
}
