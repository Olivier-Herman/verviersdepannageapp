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
const SAISIE_MISSION_SNAP = 'id, dossier_number, vehicle_plate, vehicle_brand, vehicle_model, parked_at, received_at, status, levee_saisie_at, levee_saisie_date, domaine_remise_date, domaine_enlevement_date, saisie_motif_code, saisie_motif_label'

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

// Plancher de PÉRIMÈTRE : on ne traite que les saisies entrées à partir de cette
// date (juin 2026). Les plus anciennes (ancien système / TowSoft) sont ignorées.
// Configurable via app_settings.saisie_scope_from. Olivier 2026-08-10.
export async function saisieScopeFrom(sb: any): Promise<string> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'saisie_scope_from').maybeSingle()
  try { return data?.value ? JSON.parse(data.value) : '2026-06-01' } catch { return '2026-06-01' }
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
  // Hors circuit Parquet (levée de saisie, véhicule déjà sorti…) → pas de dossier.
  const toCreate = (saisies || []).filter((m: any) => !linked.has(m.id) && !outOfParquetScope(m).out).map(snapshotSaisieMission)
  if (!toCreate.length) return 0
  const { error } = await sb.from('saisie_dossiers').insert(toCreate)
  return error ? 0 : toCreate.length
}

// ── Machine à états (pipeline) ───────────────────────────────────────────────
export const SAISIE_STATES = [
  'en_parc', 'a_facturer', 'ef_envoye', 'accepte', 'refuse',
  'justinvoice', 'liquide', 'facture', 'gardiennage_recurrent', 'clos',
] as const
export type SaisieState = typeof SAISIE_STATES[number]

// Bloc destinataire pour le PDF (adresse + e-mail routé + TVA).
export function resolveDestinataire(recipient: SaisieRecipient, mission?: any, email?: string | null): { name: string; lines: string[] } {
  if (recipient === 'parquet')
    return { name: 'Parquet', lines: ['Quai d\'Arona 4, 4500 Huy', email || 'fdj.pplge@just.fgov.be', 'TVA BE 0308.357.753'] }
  if (recipient === 'domaine')
    return { name: 'SPF Finances — Domaine', lines: ['Recette des domaines', email || ''].filter(Boolean) }
  // client : personne sur place / propriétaire
  const name = mission?.billed_to_name || mission?.client_name || 'Client'
  const lines = [[mission?.incident_address, mission?.incident_city].filter(Boolean).join(', '), email || ''].filter(Boolean)
  return { name, lines: lines.length ? lines : ['—'] }
}

const belgianToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())

// Dernier jour du mois SUIVANT une date (saisie 14/07 → 31/08) = date à partir de
// laquelle le 1er état de frais est facturable. Olivier 2026-08-10.
export function firstBillableDate(parkedAt: string): string {
  const [y, m] = String(parkedAt).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
}
function addMonthsISO(ymd: string, n: number): string {
  const dt = new Date(String(ymd).slice(0, 10) + 'T00:00:00Z')
  dt.setUTCMonth(dt.getUTCMonth() + n)
  return dt.toISOString().slice(0, 10)
}
const fmtFR = (ymd: string) => String(ymd).slice(0, 10).split('-').reverse().join('/')

// ── HORS CIRCUIT PARQUET ─────────────────────────────────────────────────────
// RÈGLE (Olivier 2026-08-24) : dès qu'il y a une LEVÉE DE SAISIE, il n'y a plus
// de facturation au Parquet — le gardiennage éventuel à partir de cette date se
// facture au client. Le dossier saisie n'a donc plus à être traité ici.
// Idem quand le véhicule est déjà sorti / facturé hors circuit Domaine.
// Exception : circuit Domaine en cours (Date IN / enlèvement) → le dossier vit.
export function outOfParquetScope(m: any): { out: boolean; reason: string } {
  if (!m) return { out: false, reason: '' }
  if (m.domaine_remise_date || m.domaine_enlevement_date) return { out: false, reason: '' }
  const levee = m.levee_saisie_at || m.levee_saisie_date
  if (levee) return { out: true, reason: `Levée de saisie du ${fmtFR(String(levee))} — plus de facturation au Parquet.` }
  if (['completed', 'to_invoice', 'cancelled'].includes(String(m.status || '')))
    return { out: true, reason: 'Véhicule sorti / facturé hors circuit Parquet-Domaine.' }
  return { out: false, reason: '' }
}

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
        .select('client_name, billed_to_name, incident_address, incident_city, vehicle_class, vehicle_vin, client_email, received_at, requisitoire_at, domaine_remise_date')
        .eq('id', d.mission_id).maybeSingle()).data
    : null

  // RÈGLE : on n'établit un état de frais que si le réquisitoire est au dossier.
  // (L'aperçu reste autorisé pour vérifier le calcul.) Olivier 2026-08-09.
  if (persist && mission && !mission.requisitoire_at) {
    throw new Error('Réquisitoire manquant — impossible d\'établir l\'état de frais')
  }

  const hasDomaine = !!(mission?.domaine_remise_date || d.domaine_remise_date)
  // RÈGLE : le 1er état de frais n'est possible qu'à partir du dernier jour du
  // mois SUIVANT la saisie — SAUF s'il y a une remise Domaine (état de clôture).
  // Olivier 2026-08-10.
  if (persist && !d.billed_to_date && !hasDomaine && d.parked_at) {
    const billable = firstBillableDate(d.parked_at)
    if (belgianToday() < billable) {
      throw new Error(`Première période non atteinte — état de frais facturable à partir du ${fmtFR(billable)}`)
    }
  }

  const recipient = (opts.recipient || d.recipient || 'parquet') as SaisieRecipient
  // Le Domaine a son propre circuit (tableau validé par Rosemarie → facture
  // trimestrielle, module Domaine) : jamais d'état de frais « domaine » ici.
  if (persist && recipient === 'domaine') {
    throw new Error('Le Domaine se facture via le module Domaine (tableau trimestriel), pas par état de frais.')
  }

  // DATE DE COUPE CALCULÉE (jamais saisie à la main). Olivier 2026-08-10 :
  //   • clôture Domaine → Date IN (remise)
  //   • 1er état de frais → dernier jour du mois suivant la saisie
  //   • gardiennage récurrent → dernière coupe + 2 mois
  // opts.billingTo reste prioritaire (le cron fournit déjà la bonne coupe).
  const remiseDate = mission?.domaine_remise_date || d.domaine_remise_date || null
  let billingTo: string
  if (opts.billingTo) billingTo = opts.billingTo.slice(0, 10)
  else if (hasDomaine && remiseDate) billingTo = String(remiseDate).slice(0, 10)
  else if (!d.billed_to_date) billingTo = firstBillableDate(d.parked_at)
  else billingTo = addMonthsISO(d.billed_to_date, 2)
  const billingFrom = d.billed_to_date || d.parked_at
  // GARDE-FOU : une coupe antérieure au début de période (ex. Date IN Domaine
  // encodée avant l'entrée en parc) produirait un état de frais absurde.
  if (billingFrom && billingTo < String(billingFrom).slice(0, 10)) {
    throw new Error(`Date de coupe incohérente (${fmtFR(billingTo)} avant le début de période ${fmtFR(String(billingFrom))}) — vérifier la Date IN / l'entrée en parc sur la fiche.`)
  }
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
  let numero = d.ef_number || 'EDF-APERÇU'
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

  // QR de RATTACHEMENT : lien de dépôt de la validation (token du dossier). En
  // persistance on garantit le token ; en aperçu on met un lien générique.
  let valToken: string | null = d.validation_token || null
  if (persist && !valToken) {
    valToken = randomUUID().replace(/-/g, '')
    await sb.from('saisie_dossiers').update({ validation_token: valToken }).eq('id', dossierId)
  }
  const qrUrl = valToken ? validationLink(valToken) : `${APP_URL}/fourriere/saisies`

  const destEmail = resolveRecipientEmail(recipient, d.motif_code, mission?.client_email)?.email || null

  const pdf = await renderEtatFraisPdf({
    numero,
    dateEmission: billingTo,
    recipient,
    destinataire: resolveDestinataire(recipient, mission, destEmail),
    pv: d.dossier_ref,
    dateSaisie: mission?.received_at || d.parked_at,
    parkedAt: d.parked_at,
    periodFrom: billingFrom,
    periodTo: billingTo,
    plate: d.vehicle_plate,
    vehicle: [d.vehicle_brand, d.vehicle_model].filter(Boolean).join(' '),
    vin: mission?.vehicle_vin || null,
    motif: d.motif_label || null,
    billing,
    qrUrl,
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
      Auriez-vous l'amabilité de nous <strong>retourner le présent état de frais signé</strong>, pour accord ou pour refus,
      par retour de courriel ou par courrier&nbsp;?
    </p>
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">
      Vous pouvez également, si vous le préférez, le déposer directement en ligne&nbsp;:
    </p>
    <p style="margin:0 0 24px;text-align:center;">${button(link, 'Déposer l\'état de frais signé')}</p>
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
  let reqDocPath: string | null = null
  if (d.mission_id) {
    const { data: m } = await sb.from('incoming_missions').select('client_email, vehicle_vin, requisitoire_doc_path').eq('id', d.mission_id).maybeSingle()
    clientEmail = m?.client_email || null
    vin = m?.vehicle_vin || null
    reqDocPath = m?.requisitoire_doc_path || null
  }
  const dest = resolveRecipientEmail(recipient, d.motif_code, clientEmail)
  if (!dest) return { ok: false, error: recipient === 'client' ? "Email du client inconnu (compléter la fiche)" : 'Destinataire Domaine non configuré' }

  // Génère (persiste) l'état de frais.
  let gen
  try {
    gen = await generateEtatFrais(sb, dossierId, { ...opts, recipient, persist: true }, userId)
  } catch (e: any) { return { ok: false, error: e?.message || 'Génération échouée' } }

  // Token de dépôt de la validation : generateEtatFrais l'a garanti → on le relit.
  let token = d.validation_token
  if (!token) {
    const { data: dd } = await sb.from('saisie_dossiers').select('validation_token').eq('id', dossierId).maybeSingle()
    token = dd?.validation_token
  }
  if (!token) {
    token = randomUUID().replace(/-/g, '')
    await sb.from('saisie_dossiers').update({ validation_token: token }).eq('id', dossierId)
  }

  // Pièces jointes : l'état de frais + le RÉQUISITOIRE (téléchargé du bucket).
  const attachments: { name: string; contentType: string; contentBytes: string }[] = [
    { name: `etat-de-frais-${gen.numero}.pdf`, contentType: 'application/pdf', contentBytes: gen.pdf.toString('base64') },
  ]
  if (reqDocPath) {
    try {
      const { data: blob } = await sb.storage.from('mission-remarks').download(reqDocPath)
      if (blob) {
        const buf = Buffer.from(await blob.arrayBuffer())
        const ext = (reqDocPath.split('.').pop() || 'pdf').toLowerCase()
        const ct = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'application/octet-stream'
        attachments.push({ name: `requisitoire-${d.vehicle_plate || 'vehicule'}.${ext}`, contentType: ct, contentBytes: buf.toString('base64') })
      }
    } catch (e: any) { console.warn('[saisie] réquisitoire non joint :', e?.message) }
  }

  const subject = `État de frais ${gen.numero} — ${d.vehicle_plate || 'véhicule'}`
  try {
    await sendEmail(
      dest.email, subject, buildEfEmailHtml(d, gen.numero, gen.totalTvac, validationLink(token), vin),
      dest.label,
      undefined,       // cc
      attachments,
      FOURRIERE_FROM,  // expéditeur (pas de copie interne)
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
