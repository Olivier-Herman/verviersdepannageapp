// src/lib/missions/processor.ts

import { createAdminClient }            from '@/lib/supabase'
import { detectSource, extractContent } from './extractor'
import { parseMissionContent }          from './parser'
import { sendPushToRole }               from '@/lib/push'

const MISSIONS_EMAIL = process.env.MISSIONS_EMAIL!

// ── Graph helpers ─────────────────────────────────────────────────────────────
//
// Cache token Microsoft Graph (incident 10/05/2026) :
// - Tokens client_credentials valent 1h. Sans cache module-level, chaque appel
//   re-fetch — coût + risque d'erreur 401 quand Next.js cache la réponse OAuth.
// - Avec cache : on stocke { token, expiresAt } et on refresh -60s avant
//   l'expiration réelle (marge pour clock skew + temps de propagation).
// - Promise sharing (`inFlight`) : si plusieurs callers concurrents demandent
//   un token expiré simultanément, ils partagent la même promesse au lieu
//   d'envoyer N requêtes OAuth parallèles.
// - `cache: 'no-store'` sur le fetch : bypass explicite du cache Next.js qui
//   peut persister la réponse OAuth même pour des POST sur instances warm.

let tokenCache: { token: string; expiresAt: number } | null = null
let inFlightToken: Promise<string> | null = null

async function fetchNewGraphToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type:    'client_credentials',
        scope:         'https://graph.microsoft.com/.default',
      }),
      // Bypass le cache fetch de Next.js — on veut TOUJOURS la réponse fraîche
      // d'Azure (sinon le token cached côté Next.js peut être expiré).
      cache: 'no-store',
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`Graph token: ${data.error_description || data.error}`)

  // Microsoft renvoie expires_in en secondes (typiquement 3599 = ~1h).
  // Marge de sécurité -60s pour éviter les races de fin de validité.
  const expiresInMs = ((data.expires_in as number) || 3600) * 1000
  const expiresAt   = Date.now() + expiresInMs - 60_000

  tokenCache = { token: data.access_token, expiresAt }
  console.log(`[Graph] token refreshed, expires in ${Math.floor(expiresInMs / 1000)}s`)
  return data.access_token
}

export async function getGraphToken(): Promise<string> {
  // Réutilise le token caché s'il est encore valide
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token
  }

  // Si une requête OAuth est déjà en cours, on partage sa promesse pour éviter
  // d'envoyer N appels Azure en parallèle quand plusieurs callers arrivent
  // simultanément après une expiration.
  if (inFlightToken) return inFlightToken

  inFlightToken = fetchNewGraphToken().finally(() => { inFlightToken = null })
  return inFlightToken
}

async function graphGet(token: string, path: string): Promise<any> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph GET ${res.status} ${path}: ${err.slice(0, 200)}`)
  }
  return res.json()
}

async function markAsRead(token: string, messageId: string): Promise<void> {
  await fetch(
    `https://graph.microsoft.com/v1.0/users/${MISSIONS_EMAIL}/messages/${messageId}`,
    {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ isRead: true })
    }
  )
}

/**
 * Récupère les pièces jointes avec contentBytes.
 * Retourne [] si /attachments 404 OU si aucun contentBytes n'est présent
 * (le caller utilisera alors le fallback MIME $value).
 */
async function getAttachmentsWithContent(token: string, messageId: string): Promise<any[]> {
  // 1. Lister les pièces jointes
  let meta: any[] = []
  try {
    const listing = await graphGet(
      token,
      `/users/${MISSIONS_EMAIL}/messages/${messageId}/attachments?$select=id,name,contentType,size`
    )
    meta = listing.value || []
  } catch {
    console.warn('[Processor] /attachments 404 → MIME fallback')
    return []
  }

  if (!meta.length) return []

  console.log(`[Processor] ${meta.length} pièce(s) jointe(s):`,
    meta.map((a: any) => `${a.name} (${a.size}b)`).join(', ')
  )

  // 2. Fetcher chaque pièce jointe individuellement pour avoir contentBytes
  const attachments = await Promise.all(
    meta.map(async (att: any) => {
      try {
        const full = await graphGet(
          token,
          `/users/${MISSIONS_EMAIL}/messages/${messageId}/attachments/${att.id}`
        )
        if (full.contentBytes) {
          console.log(`[Processor] contentBytes OK: ${att.name} (${full.contentBytes.length} chars base64)`)
        } else {
          console.warn(`[Processor] contentBytes ABSENT pour ${att.name} — sera ignoré`)
        }
        return full
      } catch (e: any) {
        console.warn(`[Processor] Erreur fetch pièce jointe ${att.name}:`, e.message)
        return att
      }
    })
  )

  // 3. Vérifier qu'au moins une pièce jointe a contentBytes
  const hasContent = attachments.some(a => a.contentBytes && a.contentBytes.length > 0)
  if (!hasContent) {
    console.warn('[Processor] Aucun contentBytes dans les pièces jointes → MIME fallback')
    return []
  }

  return attachments
}

/**
 * Fallback MIME : récupère le message brut via /$value et extrait les pièces jointes.
 */
async function getAttachmentsFromMime(token: string, messageId: string): Promise<any[]> {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${MISSIONS_EMAIL}/messages/${messageId}/$value`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      console.warn(`[Processor] MIME $value ${res.status}`)
      return []
    }
    const mimeRaw = await res.text()
    console.log(`[Processor] MIME brut: ${mimeRaw.length} chars`)
    return parseMimeAttachments(mimeRaw)
  } catch (e: any) {
    console.error('[Processor] Erreur MIME $value:', e.message)
    return []
  }
}

/**
 * Parse les pièces jointes depuis un MIME multipart brut.
 */
function parseMimeAttachments(mime: string): any[] {
  const attachments: any[] = []

  const boundaryMatch = mime.match(/boundary="?([^"\r\n;]+)"?/i)
  if (!boundaryMatch) {
    console.warn('[Processor] Pas de boundary MIME')
    return []
  }

  const boundary = boundaryMatch[1].trim()
  const parts    = mime.split(`--${boundary}`)

  for (const part of parts) {
    if (part.trim() === '' || part.trim() === '--') continue

    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd === -1) continue

    const headers = part.substring(0, headerEnd).toLowerCase()
    const body    = part.substring(headerEnd + 4)

    if (!headers.includes('content-disposition') || !headers.includes('attachment')) continue

    const nameMatch   = part.match(/filename=["']?([^"'\r\n;]+)["']?/i)
    const name        = nameMatch?.[1]?.trim() || 'attachment'
    const ctMatch     = part.match(/content-type:\s*([^\r\n;]+)/i)
    const contentType = ctMatch?.[1]?.trim() || 'application/octet-stream'
    const encMatch    = part.match(/content-transfer-encoding:\s*([^\r\n]+)/i)
    const encoding    = encMatch?.[1]?.trim().toLowerCase() || 'base64'

    // Nettoyer le contenu (supprimer le boundary de fin)
    const rawContent  = body.replace(/[\r\n]--[\s\S]*$/, '').trim()

    let contentBytes: string
    if (encoding === 'base64') {
      contentBytes = rawContent.replace(/\s/g, '')
    } else {
      contentBytes = Buffer.from(rawContent, encoding as BufferEncoding).toString('base64')
    }

    console.log(`[Processor] Pièce jointe MIME: ${name} (${contentType}) ${contentBytes.length} chars`)
    attachments.push({ name, contentType, contentBytes })
  }

  return attachments
}

// ── Enrichissement IMA ───────────────────────────────────────────────────────

/**
 * Si la mission vient d'ETHIAS/Vivium (IMA), fetch le portail IMA pour enrichir les données.
 * Appelé automatiquement après le parsing initial, avant la sauvegarde en DB.
 */
async function enrichFromIMAPortal(
  rawContent: string,
  source: string,
  parsedData: any
): Promise<Partial<typeof parsedData>> {
  const imaLinkMatch = rawContent.match(/https:\/\/imamobile\.ima\.eu\/[^\s"<>]+/)
  if (!imaLinkMatch) return {}

  const imaUrl = imaLinkMatch[0]
  console.log(`[Processor] Enrichissement IMA: ${imaUrl}`)

  try {
    const res = await fetch(imaUrl, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (compatible; VerviersDépannage/1.0)',
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-BE,fr;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      console.warn(`[Processor] IMA portal ${res.status}`)
      return {}
    }

    const html = await res.text()
    if (html.length < 100) return {}

    // Convertir HTML en texte
    const text = html
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n').replace(/<\/tr>/gi, '\n')
      .replace(/<\/td>/gi, ' | ').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&').replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è')
      .replace(/&agrave;/g, 'à').replace(/&ecirc;/g, 'ê')
      .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

    console.log(`[Processor] IMA portal HTML: ${text.length} chars`)

    // Parser avec Claude
    const { parseMissionContent } = await import('./parser')
    const enriched = await parseMissionContent(
      source as any,
      { textContent: text, sourceFormat: 'email_plain', rawContent: html.slice(0, 15000) },
      `IMA Portal enrichment`
    )

    // Retourner seulement les champs qui manquaient dans le parsing initial
    const updates: Record<string, any> = {}
    const fields = [
      'client_name', 'client_phone', 'client_address',
      'incident_address', 'incident_city',
      'destination_name', 'destination_address',
      'amount_guaranteed', 'vehicle_vin', 'vehicle_fuel',
      'vehicle_gearbox', 'incident_type', 'incident_description',
      'incident_at', 'dossier_number',
    ] as const

    for (const field of fields) {
      if (enriched[field] && !parsedData[field]) {
        updates[field] = enriched[field]
      }
    }

    const count = Object.keys(updates).length
    console.log(`[Processor] IMA enrichi: ${count} champ(s) ajouté(s)`)
    return updates

  } catch (err: any) {
    console.warn(`[Processor] IMA portal erreur: ${err.message}`)
    return {}
  }
}

// ── Déclenchement flow Allianz ───────────────────────────────────────────────

async function triggerAllianzFlow(rawContent: string, missionId: string | undefined): Promise<void> {
  const supabase = createAdminClient()
  try {
    // Extraire le lien dispatch-drawer
    const linkMatch = rawContent.match(/https:\/\/www\.allianzpartners-providerplatform\.com\/dispatch\/dispatch-drawer\/([^\s/"<>]+)\/([^\s/"<>]+)/i)
    const dispatchLink = linkMatch?.[0] || null

    // L'assignmentId est la première partie du token (V290DB4B9...)
    // C'est ce qu'on utilise pour appeler /hexalite-job-monitoring/v1.0/assignments/{id}
    const assignmentId = linkMatch?.[1] || rawContent.match(/no\.\s*(\d+)/i)?.[1] || `unknown_${Date.now()}`
    console.log('[Allianz] assignmentId extrait:', assignmentId.slice(0, 30))

    console.log(`[Allianz] Demande OTP pour mission ${assignmentId}`)

    // Demander l'OTP
    const { allianzRequestOTP } = await import('./allianz')
    const { refNo } = await allianzRequestOTP()

    // Stocker le refNo en attente dans la DB
    const { error: insertError } = await supabase.from('allianz_otp_pending').insert({
      ref_no:        refNo,
      assignment_id: assignmentId,
      dispatch_link: dispatchLink,
      mission_id:    missionId || null,
      status:        'waiting',
    })

    if (insertError) {
      console.error('[Allianz] ERREUR INSERT allianz_otp_pending:', JSON.stringify(insertError))
      throw new Error(`INSERT failed: ${insertError.message}`)
    }

    // Vérifier que l'INSERT est bien visible
    const { data: verify } = await supabase.from('allianz_otp_pending').select('id,ref_no').eq('ref_no', refNo).maybeSingle()
    console.log(`[Allianz] refNo ${refNo} stocké — vérification: ${verify ? 'OK id=' + verify.id : 'INTROUVABLE!'}`)
  } catch (err: any) {
    console.error('[Allianz] Erreur triggerAllianzFlow:', err.message)
  }
}

// ── Handler OTP Allianz ──────────────────────────────────────────────────────

async function handleAllianzOTP(message: any, token: string): Promise<void> {
  const supabase = createAdminClient()
  try {
    // Extraire l'OTP depuis le body HTML du mail
    const body = message.body?.content || ''
    const otpMatch = body.match(/Your One Time Password.*?<b>(\d{4,8})<\/b>/i)
      || body.match(/OTP.*?:\s*<b>(\d{4,8})<\/b>/i)
      || body.match(/<b>(\d{6})<\/b>/)

    if (!otpMatch) {
      console.warn('[Allianz] OTP non trouvé dans le mail')
      return
    }

    const otp = otpMatch[1]
    console.log(`[Allianz] OTP extrait: ${otp}`)

    // Récupérer le refNo — retry jusqu'a 30s (race condition possible avec l'INSERT)
    let pending: any = null
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) {
        console.log(`[Allianz] Retry ${attempt}/5 — attente 5s...`)
        await new Promise(r => setTimeout(r, 5000))
      }
      const { data } = await supabase
        .from('allianz_otp_pending')
        .select('*')
        .eq('status', 'waiting')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data) { pending = data; break }
    }

    if (!pending) {
      console.warn('[Allianz] Aucun refNo trouve apres 30s — abandon')
      return
    }

    // Vérifier l'OTP avec Allianz API
    const { allianzVerifyOTP } = await import('./allianz')
    const session = await allianzVerifyOTP(pending.ref_no, otp)

    // Mettre à jour le statut
    await supabase.from('allianz_otp_pending')
      .update({ status: 'verified', access_token: session.access_token })
      .eq('id', pending.id)

    // Récupérer les données via les APIs Hexalite
    // assignmentId = le token V290DB4... extrait du lien dispatch-drawer
    const { allianzFetchMissionData, allianzExtractMissionData } = await import('./allianz')
    const missionData = await allianzFetchMissionData(session.access_token, pending.assignment_id)

    let extracted: Record<string, any> = {}
    if (missionData) {
      extracted = allianzExtractMissionData(missionData.jobData, missionData.caseData)
      console.log(`[Allianz] Données extraites: ${extracted.external_id} — ${extracted.client_name} — ${extracted.vehicle_plate}`)
    } else {
      console.warn('[Allianz] Aucune donnée récupérée')
    }

    console.log(`[Allianz] Mission extraite: ${extracted.external_id}`)

    // Mettre à jour la mission en DB — NON DESTRUCTIF (Olivier 2026-06-19).
    // Avant : update complet `champ: extracted.x || null` → si une ré-extraction
    // OTP était vide/partielle, on ÉCRASAIT en null des données déjà bonnes et
    // on remettait status:'new' (reset d'une mission avancée). C'était la cause
    // des fiches Allianz "mal complétées" qui se re-vidaient. Désormais : on ne
    // pose QUE les champs réellement extraits, et on ne touche pas au statut
    // d'une mission déjà prise en charge.
    if (pending.mission_id) {
      const { data: cur } = await supabase
        .from('incoming_missions').select('status').eq('id', pending.mission_id).maybeSingle()
      const LOCKED = ['assigned', 'accepted', 'in_progress', 'delivering', 'parked', 'to_invoice', 'completed']
      const isLocked = !!(cur && LOCKED.includes(cur.status))

      const upd: Record<string, any> = {
        source:        'mondial',
        source_format: 'email_plain',
        parsed_data:   { ...extracted, allianz_session: true },
        updated_at:    new Date().toISOString(),
      }
      if (extracted.confidence) upd.parse_confidence = extracted.confidence
      if (!isLocked)            upd.status = 'new'

      const dataMap: Record<string, any> = {
        external_id:          extracted.external_id,
        dossier_number:       extracted.dossier_number,
        mission_type:         extracted.mission_type,
        incident_type:        extracted.incident_type,
        incident_description: extracted.incident_description,
        client_name:          extracted.client_name,
        client_phone:         extracted.client_phone,
        client_address:       extracted.client_address,
        vehicle_plate:        extracted.vehicle_plate,
        vehicle_brand:        extracted.vehicle_brand,
        vehicle_model:        extracted.vehicle_model,
        vehicle_vin:          extracted.vehicle_vin,
        vehicle_fuel:         extracted.vehicle_fuel,
        vehicle_gearbox:      extracted.vehicle_gearbox,
        incident_address:     extracted.incident_address,
        incident_city:        extracted.incident_city,
        incident_country:     extracted.incident_country,
        incident_lat:         extracted.incident_lat,
        incident_lng:         extracted.incident_lng,
        incident_at:          extracted.incident_at,
      }
      for (const [k, v] of Object.entries(dataMap)) {
        if (v !== null && v !== undefined && v !== '') upd[k] = v
      }

      const { error: updateError } = await supabase.from('incoming_missions').update(upd).eq('id', pending.mission_id)

      if (updateError) {
        console.error('[Allianz] ERREUR UPDATE:', JSON.stringify(updateError))
      } else {
        await supabase.from('mission_logs').insert({
          mission_id: pending.mission_id,
          action:     'enriched',
          notes:      'Mission enrichie automatiquement via API Allianz/Hexalite',
        })
        await supabase.from('allianz_otp_pending').update({ status: 'done' }).eq('id', pending.id)
        console.log(`[Allianz] Mission ${pending.mission_id} enrichie avec succès`)
      }

      // Olivier 2026-06-19 : FILET anti-"mal complétée". Après l'enrichissement
      // OTP/drawer, on complète les champs encore vides depuis l'API Hexalite
      // (token persistant, sans OTP) — surtout la destination garage / le
      // véhicule complet que le drawer peut rater, ou TOUT si le fetch OTP a
      // échoué. Non destructif (ne remplit que les trous). Best-effort.
      try {
        const { completeAllianzMissionFromApi } = await import('@/lib/allianz/intake')
        const r = await completeAllianzMissionFromApi(pending.mission_id)
        if (r.ok && r.filled.length) {
          console.log(`[Allianz] Filet API : ${r.filled.length} champ(s) complété(s) — ${r.filled.join(', ')}`)
        } else if (!r.ok) {
          console.warn(`[Allianz] Filet API non appliqué : ${r.reason}`)
        }
      } catch (e: any) {
        console.warn('[Allianz] Filet API exception:', e?.message)
      }
    }

  } catch (err: any) {
    console.error('[Allianz] Erreur handleAllianzOTP:', err.message)
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProcessResult =
  | { status: 'inserted';  missionId: string; externalId: string; source: string }
  | { status: 'duplicate'; externalId: string; source: string }
  | { status: 'skipped';   reason: string }
  | { status: 'error';     error: string; missionId?: string }

// ── Traitement d'un email ─────────────────────────────────────────────────────

export async function processEmailMessage(messageId: string): Promise<ProcessResult> {
  const t0         = Date.now()
  const msgIdShort = messageId.slice(-12)
  const supabase   = createAdminClient()
  let placeholderId: string | undefined

  // ── Outer try/catch (hotfix webhook) — protège l'INSERT placeholder + SELECT id ──
  // Si l'INSERT lui-même crashe (réseau Supabase, RLS), le catch ligne ~683
  // ne pourrait rien update faute de placeholderId. On retourne tôt avec
  // un status error pour que le caller (webhook ou poll-missions) le sache.
  try {
    // 0. Anti-doublon pre-check (Olivier 2026-06-02).
    // Avant : on insertait directement le placeholder et on attrapait l erreur
    // 23505 si source_email_id existait deja. PROBLEME : l INSERT consomme
    // nextval('mission_number_seq') AVANT que la contrainte UNIQUE ne fire,
    // donc chaque re-poll IMAP d un meme email faisait sauter le compteur
    // mission_number (50+ numeros perdus par jour selon trafic).
    // Maintenant : on fait un SELECT prealable pour skipper le doublon sans
    // consommer la sequence. La race condition residuelle (2 polls paralleles
    // sur le meme message) reste geree par le catch 23505 plus bas — rare.
    const { data: existing } = await supabase
      .from('incoming_missions')
      .select('id')
      .eq('source_email_id', messageId)
      .maybeSingle()

    if (existing?.id) {
      console.log(`[Processor] Email deja traite (source_email_id=${msgIdShort}) — skip pre-INSERT`)
      return { status: 'duplicate', externalId: 'already_processed', source: 'unknown' }
    }

    // Pas de doublon detecte → INSERT placeholder. received_at/intervention_date
    // = now() pour respecter NOT NULL ; remplaces par le vrai receivedDateTime
    // du message a l UPDATE final.
    console.log(`[Processor] step=insert_placeholder messageId=${msgIdShort}`)
    const placeholderTs = new Date().toISOString()
    const { error: lockError } = await supabase
      .from('incoming_missions')
      .insert({
        external_id:       `PROCESSING_${messageId.slice(-16)}`,
        source:            'unknown',
        source_format:     'unknown',
        source_email_id:   messageId,
        status:            'new',
        received_at:       placeholderTs,
        intervention_date: placeholderTs,
      })

    if (lockError) {
      if (lockError.code === '23505') {
        // Race condition : un autre poll concurrent a insere entre notre SELECT
        // et notre INSERT. Pas grave, on skip.
        console.log(`[Processor] Doublon ignoré (race condition): ${msgIdShort}`)
        return { status: 'duplicate', externalId: 'already_processing', source: 'unknown' }
      }
      console.warn('[Processor] Lock warning:', lockError.message)
    }

    const { data: placeholder } = await supabase
      .from('incoming_missions')
      .select('id')
      .eq('source_email_id', messageId)
      .maybeSingle()

    placeholderId = placeholder?.id
  } catch (outerErr: any) {
    console.error(`[Processor] step=insert_placeholder FAILED messageId=${msgIdShort}:`, outerErr.message)
    return { status: 'error', error: `INSERT placeholder: ${outerErr.message}` }
  }

  try {
    console.log(`[Processor] step=graph_get_message messageId=${msgIdShort}`)
    const token   = await getGraphToken()
    const message = await graphGet(
      token,
      `/users/${MISSIONS_EMAIL}/messages/${messageId}` +
      `?$select=id,subject,from,receivedDateTime,hasAttachments,body`
    )

    const fromEmail  = (message.from?.emailAddress?.address as string) || ''
    const subject    = (message.subject as string)                      || ''
    const receivedAt = (message.receivedDateTime as string)             || new Date().toISOString()

    console.log(`[Processor] Email: from="${fromEmail}" subject="${subject}" hasAttachments=${message.hasAttachments}`)

    console.log(`[Processor] step=detect_source messageId=${msgIdShort}`)
    const source = await detectSource(fromEmail, subject)
    console.log(`[Processor] step=detect_source messageId=${msgIdShort} source=${source}`)

    // ── Détection OTP Allianz (intercepté depuis la boîte assistance@) ──────
    // Le sujet contient "One Time Password" — c'est un OTP pour le login Hexalite
    if (subject.toLowerCase().includes('one time password') && fromEmail.toLowerCase().includes('allianz')) {
      console.log('[Processor] OTP Allianz intercepté — traitement asynchrone')
      // L'OTP sera traité par le AllianzOTPHandler via la table allianz_otp_pending
      await handleAllianzOTP(message, token)
      await markAsRead(token, messageId)
      if (placeholderId) await supabase.from('incoming_missions').delete().eq('id', placeholderId)
      return { status: 'skipped', reason: 'OTP Allianz intercepté et traité' }
    }

    // ── Mondial/Allianz : ignorer les notifications "verlopen" (expirées) ───
    // Quand une mission Mondial expire, ils renvoient un mail dont le sujet
    // contient "verlopen" (NL = "expiré"). Sans filtre, on créait une mission
    // vide en BDD. Cf. user feedback 2026-05-18.
    if (source === 'mondial' && subject.toLowerCase().includes('verlopen')) {
      console.log(`[Processor] Mail Mondial "verlopen" ignoré: ${subject.slice(0, 80)}`)
      await markAsRead(token, messageId)
      if (placeholderId) await supabase.from('incoming_missions').delete().eq('id', placeholderId)
      return { status: 'skipped', reason: 'Mondial verlopen (mission expirée)' }
    }

    // ── Mondial : ignorer les OTP "Hexalite - One Time Password" ────────────
    // Ce sujet n est pas une mission mais une demande de code OTP de la
    // plateforme Hexalite (utilisee par Mondial/Allianz). Sans filtre on
    // creait une mission vide. Cf. user feedback 2026-05-20.
    if (source === 'mondial' && subject.toLowerCase().includes('hexalite')
        && subject.toLowerCase().includes('one time password')) {
      console.log(`[Processor] Mail Hexalite OTP ignoré: ${subject.slice(0, 80)}`)
      await markAsRead(token, messageId)
      if (placeholderId) await supabase.from('incoming_missions').delete().eq('id', placeholderId)
      return { status: 'skipped', reason: 'Hexalite OTP (pas une mission)' }
    }

    // ── AG Insurance : uniquement "Remorquage frontalier" ───────────────────
    // Touring assistance route certains AG Insurance via aginsurance@... mais
    // VD ne traite QUE les remorquages frontaliers de cette source. Tout
    // autre type (depannage local, etc.) est ignoré.
    if (source === 'aginsurance') {
      const bodyText = String(message.body?.content || '')
      const haystack = `${subject} ${bodyText}`.toLowerCase()
      if (!haystack.includes('remorquage frontalier')) {
        console.log(`[Processor] AG Insurance hors scope (pas "Remorquage frontalier"): ${subject.slice(0, 80)}`)
        await markAsRead(token, messageId)
        if (placeholderId) await supabase.from('incoming_missions').delete().eq('id', placeholderId)
        return { status: 'skipped', reason: 'AG Insurance hors scope (pas Remorquage frontalier)' }
      }
    }

    // Récupérer les pièces jointes avec contentBytes
    let attachments: any[] = []
    if (message.hasAttachments) {
      attachments = await getAttachmentsWithContent(token, messageId)

      // Fallback MIME si aucun contentBytes disponible
      if (attachments.length === 0) {
        console.log('[Processor] Fallback MIME $value...')
        attachments = await getAttachmentsFromMime(token, messageId)
      }
    }

    console.log(`[Processor] step=extract_content messageId=${msgIdShort}`)
    const content = await extractContent(message, attachments, source)
    console.log(`[Processor] step=extract_content messageId=${msgIdShort} format=${content.sourceFormat} length=${content.textContent.length}`)

    // Source inconnue → stocker + notifier
    if (source === 'unknown') {
      console.warn(`[Processor] Source inconnue: ${fromEmail}`)
      if (placeholderId) {
        await supabase.from('incoming_missions').update({
          external_id:       `UNKNOWN_SENDER_${Date.now()}`,
          source:            'unknown',
          source_format:     content.sourceFormat,
          status:            'new',
          raw_content:       content.rawContent.slice(0, 10000),
          sender_email:      fromEmail,
          received_at:       receivedAt,
          intervention_date: receivedAt,
        }).eq('id', placeholderId)
        // Push uniquement si placeholder REELLEMENT cree en BD. Sinon = INSERT a
        // echoue silencieusement (cache PostgREST stale, perm, etc.) -> on spam
        // sans qu une mission existe. Olivier 2026-05-26 incident debug.
        await sendPushToRole(['admin', 'superadmin'], {
          title: '⚠️ Expéditeur inconnu',
          body:  `Email de ${fromEmail} — à identifier dans les paramètres`,
          url:   '/admin/settings',
          tag:   `unknown-sender-${fromEmail}`,
          icon:  '/icons/apple-touch-icon.png'
        })
      } else {
        console.error(`[Processor] Skip push "Expediteur inconnu" : placeholder INSERT a echoue (cache PostgREST stale ?) fromEmail=${fromEmail}`)
      }
      await markAsRead(token, messageId)
      return { status: 'skipped', reason: `Source inconnue: ${fromEmail}${placeholderId ? ' (stockee)' : ' (placeholder INSERT failed)'}` }
    }

    // Contenu vide → skip
    if (!content.textContent && !content.pdfBase64) {
      console.warn(`[Processor] Contenu vide pour ${source}`)
      if (placeholderId) await supabase.from('incoming_missions').delete().eq('id', placeholderId)
      await markAsRead(token, messageId)
      return { status: 'skipped', reason: `Contenu vide (source: ${source})` }
    }

    // Parser avec Claude
    console.log(`[Processor] step=parse_mission messageId=${msgIdShort} contentBytes=${content.pdfBase64?.length || content.textContent.length}`)
    let parsed
    try {
      parsed = await parseMissionContent(source, content, subject)
    } catch (parseErr: any) {
      console.error(`[Processor] Erreur parsing:`, parseErr.message)
      if (placeholderId) {
        await supabase.from('incoming_missions').update({
          external_id:       `ERR_${Date.now()}_${messageId.slice(-8)}`,
          source,
          source_format:     content.sourceFormat,
          status:            'parse_error',
          raw_content:       content.rawContent.slice(0, 10000),
          sender_email:      fromEmail,
          received_at:       receivedAt,
          intervention_date: receivedAt,
        }).eq('id', placeholderId)
        await supabase.from('mission_logs').insert({
          mission_id: placeholderId,
          action:     'error',
          notes:      parseErr.message,
          metadata:   { from: fromEmail, subject }
        })
      }
      await markAsRead(token, messageId)
      return { status: 'error', error: parseErr.message, missionId: placeholderId }
    }

    // Enrichissement automatique depuis le portail IMA
    console.log(`[Processor] step=ima_enrich messageId=${msgIdShort}`)
    const imaEnrichment = await enrichFromIMAPortal(content.rawContent, source, parsed)
    if (Object.keys(imaEnrichment).length > 0) {
      Object.assign(parsed, imaEnrichment)
      console.log('[Processor] Parsed enrichi avec données IMA')
    }

    // ── Déduplication sur dossier_number ────────────────────────────────────
    // Calculer le "groupe dossier" selon la source
    let dossierGroup: string | null = null
    if (parsed.dossier_number) {
      const dn = parsed.dossier_number.trim()
      if (['ethias', 'vivium', 'p&v', 'ima'].includes(source)) {
        // Ethias/P&V/IMA : dossier = référence sans les 2 dernières lettres
        dossierGroup = dn.length > 2 ? dn.slice(0, -2) : dn
      } else {
        // Touring et autres : dossier_number est déjà le groupe
        dossierGroup = dn
      }
    }

    // Chercher une mission existante avec le même groupe dossier.
    // Olivier 2026-06-17 : robustesse anti-doublon. Touring renvoie un 2e mail
    // (ex: remorquage après un dépannage) sur le MÊME N° Dossier. Avant, deux
    // soucis créaient des doublons :
    //   1) .maybeSingle() LÈVE une erreur s'il y a déjà >1 ligne → data=null →
    //      on retombait sur un INSERT (doublon en cascade). On passe en
    //      .order().limit(1) + [0] : on récupère toujours la plus récente.
    //   2) si le parsing ratait le dossier_number, plus aucun rapprochement.
    //      On ajoute un repli sur external_id (N° Commande), souvent stable.
    let existingMissionId: string | null = null
    let existingKazeJobId: string | null = null
    let existingStatus:    string | null = null

    // Olivier 2026-06-18 : PRIORITÉ KAZE robuste. On ne prend plus seulement la
    // fiche la plus récente — on récupère TOUS les candidats du même dossier et,
    // si l'un d'eux est une mission Kaze (kaze_job_id présent), on la choisit en
    // priorité quel que soit l'ordre d'arrivée. Sans ça, un mail Ethias arrivé
    // après la fiche Kaze (ou une 2e fiche plus récente) faisait rater la
    // détection Kaze → doublon Ethias visible au dispatch.
    const findExisting = async (apply: (q: any) => any) => {
      let q = supabase
        .from('incoming_missions')
        .select('id, external_id, status, kaze_job_id')
        .not('id', 'eq', placeholderId || '')
        .not('status', 'in', '("ignored","cancelled","completed")')
      q = apply(q)
      const { data } = await q.order('created_at', { ascending: false })
      const rows = data || []
      return rows.find((r: any) => r.kaze_job_id) || rows[0] || null
    }

    if (dossierGroup) {
      const isImaLike = ['ethias', 'vivium', 'p&v', 'ima'].includes(source)
      const existing = await findExisting(q =>
        isImaLike ? q.ilike('dossier_number', `${dossierGroup}%`) : q.eq('dossier_number', dossierGroup)
      )
      if (existing) {
        existingMissionId = existing.id
        existingKazeJobId = (existing as any).kaze_job_id || null
        existingStatus    = (existing as any).status || null
        console.log(`[Processor] Dossier existant trouvé (dossier_number): ${existing.external_id} (${existing.id}) → mise à jour`)
      }
    }

    // Repli : pas de rapprochement par dossier → tenter par external_id
    // (N° Commande). Évite le doublon quand le LLM n'a pas extrait le dossier.
    if (!existingMissionId && parsed.external_id && !parsed.external_id.startsWith('UNKNOWN_') && !parsed.external_id.startsWith('ERR_')) {
      const existing = await findExisting(q => q.eq('external_id', parsed.external_id).eq('source', source))
      if (existing) {
        existingMissionId = existing.id
        existingKazeJobId = (existing as any).kaze_job_id || null
        existingStatus    = (existing as any).status || null
        console.log(`[Processor] Dossier existant trouvé (external_id): ${existing.external_id} (${existing.id}) → mise à jour`)
      }
    }

    // Protection Kaze : si la mission existante vient deja de l API Kaze (IMA),
    // les donnees Kaze sont plus fiables que le parsing email. On marque juste
    // le mail comme lu + log + on ne touche pas aux champs business.
    // Sera enlevee quand IMA cessera definitivement l envoi email pour les
    // sources couvertes par Kaze.
    if (existingMissionId && existingKazeJobId) {
      console.log(`[Processor] Dossier ${dossierGroup} deja synchronise via Kaze (job ${existingKazeJobId}) — skip update email`)
      await markAsRead(token, messageId)
      // Olivier 2026-06-18 : SUPPRIMER le placeholder. Avant, le skip retournait
      // sans nettoyer → le placeholder restait en base comme fiche fantôme
      // "unknown / PROCESSING_" visible au dispatch. C'est la source des doublons
      // "unknown" qu'on voyait apparaître à côté de la mission Kaze.
      if (placeholderId && placeholderId !== existingMissionId) {
        await supabase.from('incoming_missions').delete().eq('id', placeholderId)
      }
      await supabase.from('mission_logs').insert({
        mission_id: existingMissionId,
        action:     'email_skipped_kaze_priority',
        notes:      `Mail ${source.toUpperCase()} ignoré : mission deja synchronisée via Kaze (priorité Kaze)`,
        metadata:   { source_email_id: messageId, kaze_job_id: existingKazeJobId, from: fromEmail },
      })
      return { status: 'duplicate', externalId: parsed.external_id, source }
    }

    // Olivier 2026-06-19 : ANTI-ÉCRASEMENT d'une mission déjà prise en charge.
    // Cas réel (#10019769, Allianz) : Allianz renvoie 2-3 fois une notification
    // "Nieuwe toewijzing" qui ne contient QUE un lien (aucune donnée). À chaque
    // ré-arrivée, on ré-parsait ce mail vide et on ÉCRASAIT les données déjà
    // enrichies (client, plaque, adresses, type) d'une mission assignée/en cours/
    // terminée → fiche "mal complétée". Désormais, si la mission existante est
    // déjà au-delà du dispatch (assignée et +), on marque le mail lu + log, sans
    // toucher à la fiche. Une mission encore 'new'/'dispatching' peut toujours
    // être complétée par un mail ultérieur.
    const LOCKED_STATUSES = ['assigned', 'accepted', 'in_progress', 'delivering', 'parked', 'to_invoice', 'completed']
    if (existingMissionId && existingStatus && LOCKED_STATUSES.includes(existingStatus)) {
      console.log(`[Processor] Mission ${existingMissionId} déjà ${existingStatus} — mail ré-arrivé ignoré (pas d'écrasement)`)
      await markAsRead(token, messageId)
      if (placeholderId && placeholderId !== existingMissionId) {
        await supabase.from('incoming_missions').delete().eq('id', placeholderId)
      }
      await supabase.from('mission_logs').insert({
        mission_id: existingMissionId,
        action:     'email_skipped_active',
        notes:      `Mail ${source.toUpperCase()} ré-arrivé ignoré : mission déjà ${existingStatus} (pas d'écrasement des données)`,
        metadata:   { source_email_id: messageId, from: fromEmail, status: existingStatus },
      })
      return { status: 'duplicate', externalId: parsed.external_id, source }
    }

    // Si dossier existant → mettre à jour + supprimer le placeholder
    const targetId = existingMissionId || placeholderId!

    // Déclenchement flow Allianz si email de mission Allianz (pas OTP)
    if (source === 'mondial' && content.rawContent.includes('allianzpartners-providerplatform.com')) {
      console.log(`[Processor] step=allianz_flow messageId=${msgIdShort}`)
      await triggerAllianzFlow(content.rawContent, placeholderId)
    }

    // Mettre à jour la mission (existante ou nouveau placeholder).
    // intervention_date = received_at à l'insert (sub-phase D) — le dispatcher
    // peut l'ajuster manuellement via la barre rouge MissionDetailClient (B1).
    // Sur une mise à jour de dossier existant, on préserve la valeur
    // intervention_date déjà en base si le dispatcher l'a modifiée.
    console.log(`[Processor] step=update_final messageId=${msgIdShort} source=${source} targetId=${targetId}`)

    // Lookup du client par defaut pour cette source (mission_source_catalog).
    // Si defini, on pre-remplit billed_to_id / billed_to_name pour eviter au
    // dispatcher de saisir manuellement (ex: Ethias → Ethias SA, Vivium → ...)
    // Le dispatcher peut toujours modifier dans /dispatch/[id].
    let defaultBilledToId:   number | null = null
    let defaultBilledToName: string | null = null
    try {
      const { data: srcCat } = await supabase
        .from('mission_source_catalog')
        .select('default_billed_to_id, default_billed_to_name')
        .eq('key', source)
        .maybeSingle()
      if (srcCat?.default_billed_to_id) {
        defaultBilledToId   = srcCat.default_billed_to_id
        defaultBilledToName = srcCat.default_billed_to_name || null
        console.log(`[Processor] billed_to default applique : ${source} → #${defaultBilledToId} (${defaultBilledToName})`)
      }
    } catch (e: any) {
      console.warn(`[Processor] Lookup billed_to default failed (non bloquant):`, e.message)
    }

    const updatePayload: Record<string, unknown> = {
      external_id:          parsed.external_id,
      // Olivier 2026-06-18 : si l'assistance n'a pas de N° Dossier distinct, on
      // recopie sa référence (external_id) dans NOTRE champ dossier_number — sinon
      // il reste vide et n'arrive pas en référence (client_order_ref) du devis.
      dossier_number:       parsed.dossier_number || parsed.external_id || null,
      source,
      source_format:        content.sourceFormat,
      mission_type:         parsed.mission_type,
      incident_type:        parsed.incident_type,
      incident_description: parsed.incident_description,
      client_name:          parsed.client_name,
      client_phone:         parsed.client_phone,
      client_address:       parsed.client_address,
      vehicle_plate:        parsed.vehicle_plate,
      vehicle_brand:        parsed.vehicle_brand,
      vehicle_model:        parsed.vehicle_model,
      vehicle_vin:          parsed.vehicle_vin,
      vehicle_fuel:         parsed.vehicle_fuel,
      vehicle_gearbox:      parsed.vehicle_gearbox,
      incident_address:     parsed.incident_address,
      incident_city:        parsed.incident_city,
      incident_country:     parsed.incident_country || 'BE',
      destination_name:     parsed.destination_name,
      destination_address:  parsed.destination_address,
      amount_guaranteed:    parsed.amount_guaranteed,
      // incident_at peut être une date mal formée renvoyée par le LLM →
      // rejet Postgres (timestamptz) qui ferait échouer TOUT l'UPDATE. On la
      // valide : si non parseable → null. (Olivier 2026-06-16)
      incident_at:          (parsed.incident_at && !isNaN(Date.parse(String(parsed.incident_at)))) ? parsed.incident_at : null,
      received_at:          receivedAt,
      // status/dispatch_mode : set UNIQUEMENT pour nouvelles missions (cf. block
      // conditionnel ci-dessous). Sinon les emails redondants Touring/IMA/etc.
      // ecrasaient le statut d une mission deja avancee (bug 2026-05-18 :
      // mission to_invoice -> remise a new par un email redondant 2h plus tard).
      raw_content:          content.rawContent.slice(0, 10000),
      parsed_data:          parsed,
      parse_confidence:     parsed.confidence,
      sender_email:         fromEmail,
    }
    // Pre-remplissage du client a facturer si la source a un default defini
    // ET que la mission est nouvelle (on n'ecrase pas si le dispatcher a deja
    // modifie manuellement sur un dossier existant)
    if (!existingMissionId && defaultBilledToId) {
      updatePayload.billed_to_id   = defaultBilledToId
      updatePayload.billed_to_name = defaultBilledToName
    }

    // Nouvelle mission (placeholder) → init intervention_date + status + dispatch_mode.
    // Mise à jour d'un dossier existant → ne pas écraser ces valeurs (le
    // dispatcher peut avoir deja confirme/assigne/complete la mission).
    if (!existingMissionId) {
      updatePayload.intervention_date = receivedAt
      updatePayload.status            = 'new'
      updatePayload.dispatch_mode     = 'manual'
    }
    const { error: finalUpdErr } = await supabase.from('incoming_missions').update(updatePayload).eq('id', targetId)

    // Olivier 2026-06-16 : supabase.update() ne LÈVE PAS d'exception en cas
    // d'erreur — il renvoie { error }. Sans ce check, un UPDATE qui échoue
    // (contrainte / valeur invalide sur ce mail précis) laissait le placeholder
    // VIDE tout en envoyant quand même la notif → mission fantôme `unknown`
    // invisible au dispatch (alors que la montre recevait les infos).
    //
    // GO-LIVE : une mission ne DOIT JAMAIS disparaître. On réessaie donc avec un
    // payload MINIMAL nettoyé (champs cœur + valeurs tronquées) pour que la
    // mission apparaisse quand même au dispatch en `new`. Dernier recours :
    // parse_error (au moins visible dans l'onglet Erreurs).
    if (finalUpdErr) {
      console.error(`[Processor] step=update_final FAILED messageId=${msgIdShort} targetId=${targetId}: ${finalUpdErr.message} — retry payload minimal`)
      const s = (v: any, n: number) => (v == null ? null : String(v).slice(0, n) || null)
      const minimal: Record<string, unknown> = {
        external_id:    parsed.external_id || `MISSION_${Date.now()}_${messageId.slice(-8)}`,
        source,
        source_format:  content.sourceFormat,
        mission_type:   parsed.mission_type || null,
        client_name:    s(parsed.client_name, 200),
        client_phone:   s(parsed.client_phone, 60),
        vehicle_plate:  s(parsed.vehicle_plate, 32),
        vehicle_brand:  s(parsed.vehicle_brand, 80),
        vehicle_model:  s(parsed.vehicle_model, 120),
        incident_address: s(parsed.incident_address, 300),
        incident_city:  s(parsed.incident_city, 120),
        raw_content:    content.rawContent.slice(0, 10000),
        parsed_data:    parsed,
        parse_confidence: parsed.confidence,
        sender_email:   fromEmail,
        received_at:    receivedAt,
      }
      if (!existingMissionId) {
        minimal.status            = 'new'
        minimal.intervention_date = receivedAt
        minimal.dispatch_mode     = 'manual'
      }
      const { error: retryErr } = await supabase.from('incoming_missions').update(minimal).eq('id', targetId)
      if (retryErr) {
        // Vraiment irrécupérable → parse_error (visible onglet Erreurs).
        console.error(`[Processor] retry minimal AUSSI échoué: ${retryErr.message}`)
        if (placeholderId && !existingMissionId) {
          await supabase.from('incoming_missions').update({
            external_id: `ERR_${Date.now()}_${messageId.slice(-8)}`, source,
            source_format: content.sourceFormat, status: 'parse_error',
            raw_content: content.rawContent.slice(0, 10000), parsed_data: parsed,
            sender_email: fromEmail, received_at: receivedAt, intervention_date: receivedAt,
          }).eq('id', placeholderId).then(() => {}, () => {})
        }
        await supabase.from('mission_logs').insert({
          mission_id: targetId, action: 'error',
          notes: `UPDATE final + retry minimal échoués : ${finalUpdErr.message} / ${retryErr.message}`,
          metadata: { from: fromEmail, subject, source_email_id: messageId },
        }).then(() => {}, () => {})
        await markAsRead(token, messageId)
        return { status: 'error', error: `UPDATE final: ${finalUpdErr.message}`, missionId: placeholderId }
      }
      // Sauvée en mode minimal : on loggue pour diagnostiquer le champ fautif,
      // mais la mission est bien visible au dispatch → on continue (notif OK).
      await supabase.from('mission_logs').insert({
        mission_id: targetId, action: 'received_degraded',
        notes: `Mission sauvée en mode minimal (UPDATE complet échoué : ${finalUpdErr.message})`,
        metadata: { from: fromEmail, subject, source_email_id: messageId },
      }).then(() => {}, () => {})
    }

    // Supprimer le placeholder si on a mis à jour une mission existante
    if (existingMissionId && placeholderId && existingMissionId !== placeholderId) {
      await supabase.from('incoming_missions').delete().eq('id', placeholderId)
      console.log(`[Processor] Placeholder supprimé: ${placeholderId}`)
    }

    await markAsRead(token, messageId)

    await supabase.from('mission_logs').insert({
      mission_id: targetId,
      action:     'received',
      notes:      `Reçu de ${source.toUpperCase()} — ${subject}`,
      metadata:   { source_email_id: messageId, confidence: parsed.confidence, from: fromEmail }
    })

    const typeLabel    = parsed.mission_type === 'remorquage' ? '🚛 Remorquage'
                       : parsed.mission_type === 'depannage'  ? '🔧 Dépannage'
                       : parsed.mission_type === 'transport'  ? '🚐 Transport'
                       : '📋 Mission'
    const vehicleLabel = [parsed.vehicle_brand, parsed.vehicle_model, parsed.vehicle_plate]
      .filter(Boolean).join(' ')

    // Notification push seulement si c'est une nouvelle mission
    if (!existingMissionId) await sendPushToRole(['admin', 'superadmin', 'dispatcher'], {
      title: `${typeLabel} — ${source.toUpperCase()}`,
      body:  vehicleLabel || parsed.client_name || 'Nouvelle mission reçue',
      url:   '/dispatch',
      tag:   `mission-${targetId}`,
      icon:  '/icons/apple-touch-icon.png'
    }, 'dispatch_new_mission')

    const durationMs = Date.now() - t0
    console.log(`[Processor] step=done messageId=${msgIdShort} durationMs=${durationMs} ${source}/${parsed.external_id} (conf: ${parsed.confidence}) ${existingMissionId ? '→ mise à jour dossier existant' : '→ nouveau'}`)
    return { status: existingMissionId ? 'duplicate' : 'inserted', missionId: targetId, externalId: parsed.external_id, source }

  } catch (err: any) {
    const durationMs = Date.now() - t0
    console.error(`[Processor] step=error messageId=${msgIdShort} durationMs=${durationMs}:`, err.message)
    if (placeholderId) {
      await supabase.from('incoming_missions').update({
        status:      'parse_error',
        raw_content: `Erreur: ${err.message}`.slice(0, 10000),
      }).eq('id', placeholderId)
    }
    return { status: 'error', error: err.message, missionId: placeholderId }
  }
}
