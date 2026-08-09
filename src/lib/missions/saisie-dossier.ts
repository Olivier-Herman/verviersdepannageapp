// src/lib/missions/saisie-dossier.ts
//
// Logique métier des DOSSIERS DE FACTURATION SAISIE (table saisie_dossiers).
// Machine à états + génération d'état de frais (numérotation EF séquentielle,
// snapshot des lignes, avancement du pipeline). Utilisé par les routes
// /api/fourriere/saisies*. Olivier 2026-08-09.

import { randomUUID } from 'crypto'
import { computeSaisieBilling, type SaisieRecipient } from '@/lib/missions/saisie-billing'
import { renderEtatFraisPdf } from '@/lib/missions/saisie-etat-frais-pdf'
import { sendEmail, emailLayout, button, infoRow, divider } from '@/lib/emails'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
const FOURRIERE_FROM = 'fourriere@verviersdepannage.be'

// Boîtes SPF Justice (Olivier 2026-08-09) — routées selon le MOTIF de saisie :
//   • Saisie générale + Défaut d'assurance → Parquet
//   • Saisie judiciaire                     → Frais de justice
const MAIL_PARQUET        = 'fdj.pplge@just.fgov.be'
const MAIL_FRAIS_JUSTICE  = 'frais.justice.verviers@just.fgov.be'

/** Boîte destinataire selon le destinataire + le motif. null si inconnue (ex client sans email). */
export function resolveRecipientEmail(recipient: SaisieRecipient, motifCode?: string | null, clientEmail?: string | null): { email: string; label: string } | null {
  if (recipient === 'parquet') {
    const judiciaire = String(motifCode || '').toUpperCase() === 'SAISIE_JUDICIAIRE'
    return judiciaire
      ? { email: MAIL_FRAIS_JUSTICE, label: 'Frais de justice (Verviers)' }
      : { email: MAIL_PARQUET, label: 'Parquet' }
  }
  if (recipient === 'client') {
    const e = (clientEmail || '').trim()
    return e && /@/.test(e) ? { email: e, label: 'Client' } : null
  }
  return null  // domaine : à câbler
}

// ── Auto-intégration des NOUVELLES saisies ───────────────────────────────────
// À partir de la date `saisie_autointegrate_since` (app_settings), toute mission
// police_saisie en parc crée automatiquement son dossier. Le parc antérieur reste
// intégré à la main (tri). Olivier 2026-08-10.
const SAISIE_MISSION_SNAP = 'id, dossier_number, vehicle_plate, vehicle_brand, vehicle_model, parked_at, received_at, levee_saisie_date, saisie_motif_code, saisie_motif_label'

function snapshotSaisieMission(m: any) {
  return {
    mission_id:    m.id,
    vehicle_plate: m.vehicle_plate || null,
    vehicle_brand: m.vehicle_brand || null,
    vehicle_model: m.vehicle_model || null,
    dossier_ref:   m.dossier_number || null,
    parked_at:     (m.parked_at || m.received_at || '').slice(0, 10) || null,
    levee_date:    m.levee_saisie_date ? String(m.levee_saisie_date).slice(0, 10) : null,
    motif_code:    m.saisie_motif_code || null,
    motif_label:   m.saisie_motif_label || null,
  }
}

export async function autoIntegrateNewSaisies(sb: any): Promise<number> {
  const { data: cfg } = await sb.from('app_settings').select('value').eq('key', 'saisie_autointegrate_since').maybeSingle()
  let since = ''
  try { since = cfg?.value ? JSON.parse(cfg.value) : '' } catch {}
  if (!since) return 0   // désactivé tant que la date n'est pas posée

  const { data: linkedRows } = await sb.from('saisie_dossiers').select('mission_id')
  const linked = new Set((linkedRows || []).map((d: any) => d.mission_id).filter(Boolean))
  const { data: saisies } = await sb.from('incoming_missions')
    .select(SAISIE_MISSION_SNAP)
    .eq('source', 'police_saisie').eq('status', 'parked')
    .gte('received_at', since).limit(300)
  const toCreate = (saisies || []).filter((m: any) => !linked.has(m.id)).map(snapshotSaisieMission)
  if (!toCreate.length) return 0
  const { error } = await sb.from('saisie_dossiers').insert(toCreate)
  return error ? 0 : toCreate.length
}

// ── Machine à états (pipeline) ───────────────────────────────────────────────
export const SAISIE_STATES = [
  'en_parc', 'a_facturer', 'ef_envoye', 'accepte', 'refuse',
  'justinvoice', 'facture', 'gardiennage_recurrent', 'clos',
] as const
export type SaisieState = typeof SAISIE_STATES[number]

// Destinataires connus (adresses réelles pour le PDF).
export function resolveDestinataire(recipient: SaisieRecipient, mission?: any): { name: string; lines: string[] } {
  if (recipient === 'parquet')
    return { name: 'Parquet', lines: ['Quai d\'Arona 4', '4500 Huy'] }
  if (recipient === 'domaine')
    return { name: 'SPF Finances — Domaine', lines: ['Recette des domaines'] }
  // client : personne sur place / propriétaire
  const name = mission?.billed_to_name || mission?.client_name || 'Client'
  const lines = [mission?.incident_address, mission?.incident_city].filter(Boolean)
  return { name, lines: lines.length ? lines : ['—'] }
}

const belgianToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())

// Franchise km SAISIE : on ne facture les km qu'AU-DELÀ de 30 km ALLER-RETOUR.
// « On les compte au-dessus de 30 kms aller-retour » — Olivier 2026-08-09.
export const SAISIE_FREE_KM = 30

/** Numéro EF suivant : 1er = EF-AAAA-NNNN ; suivants = même n° suffixé -B, -C… */
function suffixed(base: string, seqIndex: number): string {
  if (seqIndex <= 0) return base
  return `${base}-${String.fromCharCode(65 + seqIndex)}`  // -B, -C, -D…
}

export interface GenerateEfResult {
  pdf: Buffer
  numero: string
  totalHtva: number
  totalTvac: number
  efRowId: string
}

/**
 * Génère un état de frais pour un dossier :
 *  - calcule les lignes (dépannage la 1re fois, puis gardiennage depuis billed_to_date)
 *  - attribue/réutilise le numéro EF
 *  - persiste une ligne saisie_etats_frais + avance le dossier
 *  - renvoie le PDF prêt à afficher/envoyer
 */
export async function generateEtatFrais(
  sb: any,
  dossierId: string,
  opts: { billingTo?: string; recipient?: SaisieRecipient; chargedKmBeyond?: number; roundTripKm?: number; persist?: boolean } = {},
  userId?: string | null,
): Promise<GenerateEfResult> {
  const persist = opts.persist !== false   // défaut true ; false = aperçu (ne consomme pas de n°, n'avance pas)
  const { data: d, error } = await sb.from('saisie_dossiers').select('*').eq('id', dossierId).maybeSingle()
  if (error || !d) throw new Error('Dossier introuvable')

  const mission = d.mission_id
    ? (await sb.from('incoming_missions')
        .select('client_name, billed_to_name, incident_address, incident_city, vehicle_class, requisitoire_at')
        .eq('id', d.mission_id).maybeSingle()).data
    : null

  // RÈGLE : on n'établit un état de frais que si le réquisitoire est au dossier.
  // (L'aperçu reste autorisé pour vérifier le calcul.) Olivier 2026-08-09.
  if (persist && mission && !mission.requisitoire_at) {
    throw new Error('Réquisitoire manquant — impossible d\'établir l\'état de frais')
  }

  const recipient = (opts.recipient || d.recipient || 'parquet') as SaisieRecipient
  const billingTo = (opts.billingTo || belgianToday()).slice(0, 10)
  const billingFrom = d.billed_to_date || d.parked_at
  const includeDepannage = !d.depannage_billed
  // km facturés = au-delà de 30 km aller-retour (franchise). Priorité à une
  // valeur déjà calculée (chargedKmBeyond), sinon on dérive des km aller-retour.
  const km = opts.chargedKmBeyond != null ? opts.chargedKmBeyond
           : opts.roundTripKm != null ? Math.max(0, opts.roundTripKm - SAISIE_FREE_KM)
           : 0

  const billing = await computeSaisieBilling({
    parkedAt: d.parked_at,
    billingTo,
    billingFrom,
    recipient,
    includeDepannage,
    vehicleClass: mission?.vehicle_class || 'car',
    chargedKmBeyond: km,
    leveeSaisieDate: d.levee_date || null,
  })

  // APERÇU : ne consomme pas de numéro, ne persiste rien, n'avance pas le dossier.
  let numero = d.ef_number || 'EF-APERÇU'
  let efRowId = ''
  if (persist) {
    // Numérotation : 1er EF → attribue le n° au dossier. Suivants → suffixe.
    const { count } = await sb.from('saisie_etats_frais').select('id', { count: 'exact', head: true }).eq('dossier_id', dossierId)
    const existing = count || 0
    let base = d.ef_number
    if (!base) {
      const year = Number(billingTo.slice(0, 4))
      const { data: num, error: rpcErr } = await sb.rpc('next_saisie_ef_number', { p_year: year })
      if (rpcErr || !num) throw new Error('Numérotation EF échouée : ' + (rpcErr?.message || ''))
      base = num as string
      await sb.from('saisie_dossiers').update({ ef_number: base }).eq('id', dossierId)
    }
    numero = suffixed(base, existing)

    const { data: efRow, error: insErr } = await sb.from('saisie_etats_frais').insert({
      dossier_id: dossierId, numero, recipient,
      period_from: billingFrom, period_to: billingTo,
      include_depannage: includeDepannage,
      total_htva: billing.totalHtva, total_tvac: billing.totalTvac,
      lines_json: billing.lines, created_by: userId || null,
    }).select('id').single()
    if (insErr) throw new Error('Insert état de frais échoué : ' + insErr.message)
    efRowId = efRow.id

    // Avancement du dossier : marque le dépannage facturé, la date de coupe, l'état.
    const nextState = ['en_parc', 'a_facturer'].includes(d.state) ? 'ef_envoye' : d.state
    await sb.from('saisie_dossiers').update({
      depannage_billed: d.depannage_billed || includeDepannage,
      billed_to_date: billingTo,
      recipient,
      state: nextState,
      last_ef_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', dossierId)
  }

  const pdf = await renderEtatFraisPdf({
    numero,
    dateEmission: billingTo,
    recipient,
    destinataire: resolveDestinataire(recipient, mission),
    vehicle: { plate: d.vehicle_plate, brand: d.vehicle_brand, model: d.vehicle_model },
    dossierRef: d.dossier_ref,
    parkedAt: d.parked_at,
    billingTo,
    leveeSaisieDate: d.levee_date || null,
    billing,
  })

  return { pdf, numero, totalHtva: billing.totalHtva, totalTvac: billing.totalTvac, efRowId }
}

// ── Envoi de l'état de frais au destinataire (mail + lien de dépôt validation) ─
export interface SendEfResult { ok: boolean; email?: string; numero?: string; error?: string }

export function validationLink(token: string): string { return `${APP_URL}/saisie-validation/${token}` }

function buildEfEmailHtml(d: any, numero: string, totalTvac: number, link: string, vin?: string | null): string {
  const veh = [d.vehicle_brand, d.vehicle_model].filter(Boolean).join(' ') || '—'
  const eur = `${totalTvac.toFixed(2).replace('.', ',')} €`
  const content = `
    <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111;">État de frais ${numero}</p>
    <p style="margin:0 0 20px;font-size:14px;color:#888;">Verviers Dépannage SA</p>
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">
      Madame, Monsieur,<br><br>
      Veuillez trouver ci-joint l'état de frais relatif au véhicule saisi repris ci-dessous.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
      ${infoRow('Plaque', d.vehicle_plate || '—')}
      ${infoRow('Véhicule', veh)}
      ${vin ? infoRow('N° de châssis (VIN)', vin) : ''}
      ${d.dossier_ref ? infoRow('N° PV', d.dossier_ref) : ''}
      ${infoRow('Montant TVAC', eur)}
    </table>
    ${divider()}
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">
      Auriez-vous l'amabilité de nous retourner votre validation (cachet / signature) en cliquant sur le bouton ci-dessous&nbsp;?
    </p>
    <p style="margin:0 0 24px;text-align:center;">${button(link, 'Déposer la validation')}</p>
    <p style="margin:0 0 20px;font-size:14px;color:#333;line-height:1.6;">
      Vous pouvez également, si vous le préférez, répondre à cet e-mail en y joignant le document validé.
    </p>
    <p style="margin:24px 0 0;font-size:13px;color:#888;">Nous vous remercions par avance.<br>Le service Fourrière — Verviers Dépannage</p>
  `
  return emailLayout(content, `État de frais ${numero}`)
}

/** Génère l'état de frais, l'envoie au destinataire routé (selon motif) avec lien de dépôt. */
export async function sendEtatFrais(
  sb: any,
  dossierId: string,
  opts: { billingTo?: string; recipient?: SaisieRecipient; roundTripKm?: number } = {},
  userId?: string | null,
): Promise<SendEfResult> {
  const { data: d } = await sb.from('saisie_dossiers').select('*').eq('id', dossierId).maybeSingle()
  if (!d) return { ok: false, error: 'Dossier introuvable' }

  const recipient = (opts.recipient || d.recipient || 'parquet') as SaisieRecipient
  // Infos fiche : email client (si destinataire=client) + VIN (si connu, ajouté au mail).
  let clientEmail: string | null = null
  let vin: string | null = null
  if (d.mission_id) {
    const { data: m } = await sb.from('incoming_missions').select('client_email, vehicle_vin').eq('id', d.mission_id).maybeSingle()
    clientEmail = m?.client_email || null
    vin = m?.vehicle_vin || null
  }
  const dest = resolveRecipientEmail(recipient, d.motif_code, clientEmail)
  if (!dest) return { ok: false, error: recipient === 'client' ? "Email du client inconnu (compléter la fiche)" : 'Destinataire Domaine non configuré' }

  // Génère (persiste) l'état de frais.
  let gen
  try {
    gen = await generateEtatFrais(sb, dossierId, { ...opts, recipient, persist: true }, userId)
  } catch (e: any) { return { ok: false, error: e?.message || 'Génération échouée' } }

  // Token de dépôt de la validation (stable une fois créé).
  let token = d.validation_token
  if (!token) {
    token = randomUUID().replace(/-/g, '')
    await sb.from('saisie_dossiers').update({ validation_token: token }).eq('id', dossierId)
  }

  const subject = `État de frais ${gen.numero} — ${d.vehicle_plate || 'véhicule'}`
  try {
    await sendEmail(
      dest.email, subject, buildEfEmailHtml(d, gen.numero, gen.totalTvac, validationLink(token), vin),
      dest.label,
      undefined,  // cc
      [{ name: `etat-de-frais-${gen.numero}.pdf`, contentType: 'application/pdf', contentBytes: gen.pdf.toString('base64') }],
      FOURRIERE_FROM,
      FOURRIERE_FROM,  // bcc = trace interne
    )
  } catch (e: any) { return { ok: false, error: `Envoi impossible : ${e?.message || e}` } }

  // Si c'était l'état de frais de CLÔTURE Domaine (envoyé au Parquet jusqu'à la
  // Date IN), la facturation future bascule au Domaine.
  const wasCloture = d.pending_action === 'cloture_domaine'
  await sb.from('saisie_dossiers').update({
    sent_to: dest.email, sent_at: new Date().toISOString(), state: 'ef_envoye',
    pending_action: null, pending_action_at: null,
    ...(wasCloture ? { recipient: 'domaine' } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', dossierId)

  return { ok: true, email: dest.email, numero: gen.numero }
}
