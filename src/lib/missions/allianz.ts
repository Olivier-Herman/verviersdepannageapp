// src/lib/missions/allianz.ts
// Flow complet d'authentification Hexalite avec OTP email

const BASE_URL  = 'https://global.allianzpartners-providerplatform.com'
const LOGIN_URL = `${BASE_URL}/hexalite-user-management/oauth2/token`
const OTP_URL   = `${BASE_URL}/hexalite-user-management/v1.0/otp/verify`

export interface AllianzSession {
  access_token:  string
  refresh_token: string
}

const HEADERS_BASE = {
  'Content-Type': 'application/json',
  'User-Agent':   'Mozilla/5.0 (compatible; VerviersDépannage/1.0)',
}

export async function allianzRequestOTP(): Promise<{ refNo: string; otpExpireAt: string }> {
  const res = await fetch(`${LOGIN_URL}?grant_type=password&scope=rest&cache_buster=${Date.now()}`, {
    method:  'POST',
    headers: HEADERS_BASE,
    body: JSON.stringify({
      username: process.env.ALLIANZ_LOGIN!,
      password: process.env.ALLIANZ_PASSWORD!,
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Allianz login failed ${res.status}: ${await res.text()}`)
  const data = await res.json()
  console.log(`[Allianz] OTP demandé — refNo: ${data.refNo}`)
  return { refNo: data.refNo, otpExpireAt: data.otpExpireAt }
}

export async function allianzVerifyOTP(refNo: string, otp: string): Promise<AllianzSession> {
  const res = await fetch(`${OTP_URL}?cache_buster=${Date.now()}`, {
    method:  'POST',
    headers: HEADERS_BASE,
    body: JSON.stringify({ refNo, otp }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Allianz OTP failed ${res.status}: ${err.message || ''}`)
  }
  const data  = await res.json()
  const token = data.AccessTokenResponse
  if (!token?.access_token) throw new Error('Allianz: access_token absent')
  console.log('[Allianz] Authentifié avec succès')
  return { access_token: token.access_token, refresh_token: token.refresh_token }
}

export async function allianzFetchMissionData(
  accessToken: string,
  assignmentId: string
): Promise<{ jobData: any; caseData: any } | null> {
  const headers = { ...HEADERS_BASE, 'Authorization': `Bearer ${accessToken}` }

  try {
    // 1. Job monitoring — véhicule, adresse, description
    const jobUrl = `${BASE_URL}/hexalite-job-monitoring/v1.0/assignments/${assignmentId}?cache_buster=${Date.now()}`
    const jobRes = await fetch(jobUrl, { headers, signal: AbortSignal.timeout(15000) })

    if (!jobRes.ok) {
      const errBody = await jobRes.text().catch(() => '')
      console.warn(`[Allianz] Job ${jobRes.status} — ${errBody.slice(0, 200)}`)

      // Fallback: essayer via hexalite-assignment-invoice-service/v1.0/assignments
      const altUrl = `${BASE_URL}/hexalite-assignment-invoice-service/v1.0/assignments/${assignmentId}?cache_buster=${Date.now()}`
      console.log(`[Allianz] Fallback invoice assignments...`)
      const altRes = await fetch(altUrl, { headers, signal: AbortSignal.timeout(15000) })
      if (!altRes.ok) {
        console.warn(`[Allianz] Invoice-assignments ${altRes.status}`)
        return null
      }
      const altData = await altRes.json()
      console.log(`[Allianz] Invoice-assignments OK — caseId: ${altData.assistanceCaseId?.slice(0,20)}`)

      // Fetch le case avec le caseId récupéré
      let caseData = null
      if (altData.assistanceCaseId) {
        const caseRes = await fetch(
          `${BASE_URL}/hexalite-assignment-invoice-service/v1.0/assistancecases/${altData.assistanceCaseId}?cache_buster=${Date.now()}`,
          { headers, signal: AbortSignal.timeout(15000) }
        )
        if (caseRes.ok) {
          caseData = await caseRes.json()
          console.log(`[Allianz] Case reçu — caseNumber: ${caseData.caseNumber}`)
        }
      }
      // Construire un jobData compatible depuis altData + caseData
      const syntheticJob = {
        assignmentNumber:    altData.assignmentNumber,
        assistanceCaseId:    altData.assistanceCaseId,
        assistanceCaseNumber: caseData?.caseNumber || null,
        estimatedDispatchTime: altData.creationDate || null,
        initialServiceType:  altData.assignmentType || null,
        additionalCaseRemarks: caseData?.additionalCaseRemarks || null,
        jobAssignmentVehicle: null,
        jobAssignmentCustomer: null,
      }
      return { jobData: syntheticJob, caseData }
    }

    const jobData = await jobRes.json()
    console.log(`[Allianz] Job reçu — assignmentNumber: ${jobData.assignmentNumber}`)

    // 2. Assistance case — client complet (nom, téléphone, adresse)
    let caseData = null
    if (jobData.assistanceCaseId) {
      const caseRes = await fetch(
        `${BASE_URL}/hexalite-assignment-invoice-service/v1.0/assistancecases/${jobData.assistanceCaseId}?cache_buster=${Date.now()}`,
        { headers, signal: AbortSignal.timeout(15000) }
      )
      if (caseRes.ok) {
        caseData = await caseRes.json()
        console.log(`[Allianz] Case reçu — caseNumber: ${caseData.caseNumber}`)
      }
    }
    return { jobData, caseData }
  } catch (err: any) {
    console.error('[Allianz] Erreur fetch:', err.message)
    return null
  }
}

export function allianzExtractMissionData(jobData: any, caseData?: any): Record<string, any> {
  const vehicle  = jobData?.jobAssignmentVehicle || {}
  const customer = jobData?.jobAssignmentCustomer || {}
  const location = customer.breakdownAddress || {}
  const applicant = caseData?.applicant || {}

  const phone = applicant.preferredContactChannels?.[0]?.phoneNumber
    || caseData?.contactChannel?.[0]?.phoneNumber || null

  const clientName = [applicant.firstName, applicant.lastName].filter(Boolean).join(' ') || null

  const clientAddr = applicant.address
    ? `${applicant.address.street || ''} ${applicant.address.streetNumber || ''}, ${applicant.address.zipCode || ''} ${applicant.address.city || ''}`.trim()
    : null

  const incidentAddr = location.street
    ? `${location.street} ${location.streetNumber || ''}`.trim()
    : caseData?.caseLocation?.street
      ? `${caseData.caseLocation.street} ${caseData.caseLocation.streetNumber || ''}`.trim()
      : null

  const SERVICE_MAP: Record<string, string> = {
    'XH2': 'depannage', 'XH3': 'remorquage', 'AR': 'remorquage',
    'D':   'trajet_vide', 'JS': 'depannage',  'TW': 'remorquage',
  }

  return {
    external_id:          String(jobData?.assignmentNumber || ''),
    dossier_number:       jobData?.assistanceCaseNumber || caseData?.caseNumber || null,
    mission_type:         SERVICE_MAP[jobData?.initialServiceType] || 'depannage',
    incident_type:        jobData?.initialServiceType || null,
    incident_description: jobData?.additionalCaseRemarks || caseData?.additionalCaseRemarks || null,
    client_name:          clientName,
    client_phone:         phone,
    client_address:       clientAddr,
    vehicle_plate:        vehicle.vehicleLicensePlate || null,
    vehicle_brand:        vehicle.vehicleBrand        || null,
    vehicle_model:        vehicle.vehicleModel        || null,
    vehicle_vin:          vehicle.vehicleVin          || null,
    vehicle_fuel:         null,
    vehicle_gearbox:      null,
    incident_address:     incidentAddr,
    incident_city:        location.city || caseData?.caseLocation?.city || null,
    incident_country:     location.countryCode || 'BE',
    incident_lat:         location.latitude  || caseData?.caseLocation?.geoLocation?.latitude  || null,
    incident_lng:         location.longitude || caseData?.caseLocation?.geoLocation?.longitude || null,
    destination_name:     null,
    destination_address:  null,
    amount_guaranteed:    null,
    incident_at:          jobData?.estimatedDispatchTime || null,
    confidence:           0.98,
  }
}
