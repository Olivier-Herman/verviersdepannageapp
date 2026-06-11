// src/app/api/fourriere/destruction/route.ts
//
// Process "Sortie AVP" (fourriere) :
//
// GET /api/fourriere/destruction
//   Liste les vehicules AVP en parc depuis ≥ 60 jours, avec leur emplacement,
//   date d entree, jours de parc et frais arretes a ce jour (forfait + gardiennage).
//
// POST /api/fourriere/destruction
//   Body : { mission_ids: string[], format?: 'xlsx' | 'pdf' }
//   - passe les missions en status='completed' + scratched_at (tampon EPAVE)
//   - libere la place dans le parc
//   - genere le rapport (xlsx ou pdf) avec frais arretes a la date de sortie
//   - envoie le rapport en piece jointe a avp@verviers.be (boite Ville) depuis
//     fourriere@verviersdepannage.be, CC interne pour archivage
//   - AUCUNE facture n est emise : dossiers simplement clotures
//
// Acces : admin / superadmin / module fourriere

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { releaseParcAndShift } from '@/lib/parc/release'
import {
  buildDestructionXlsx, buildDestructionPdf, computeDestructionFees,
  type DestructionVehicle,
} from '@/lib/fourriere/destruction-report'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const DESTRUCTION_THRESHOLD_DAYS = 60
const FOURRIERE_FROM_EMAIL       = 'fourriere@verviersdepannage.be'

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return iso }
}

/** Date d entree en parc : parked_at en priorite, puis fallbacks. */
function entryDate(m: any): string | null {
  return m.parked_at || m.intervention_date || m.received_at || null
}

function daysSince(iso: string | null): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return 0
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000))
}

function checkAccess(session: any): { ok: boolean; user?: any } {
  if (!session) return { ok: false }
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return { ok: false }
  }
  return { ok: true, user }
}

// ─── GET : liste eligibles (≥ 60 jours) ─────────────────────────────────
export async function GET() {
  const session = await getServerSession(authOptions)
  const access = checkAccess(session)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()

  // Tous les AVP en parc — on calcule le delai en JS (fallback parked_at) puis
  // on filtre ≥ 60 jours, pour ne pas dependre d un seul champ date.
  const { data, error } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, dossier_number, vehicle_plate, vehicle_brand, vehicle_model,
      vehicle_vin, client_name, billed_to_name,
      parc_zone_key, parc_row_number, parc_slot_index,
      parked_at, received_at, intervention_date,
      driver_photos, odoo_helpdesk_id, status
    `)
    .eq('source', 'police_avp')
    .in('status', ['parked', 'delivering'])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const nowIso = new Date().toISOString()
  const enriched = (data || [])
    .map(m => {
      const entry = entryDate(m)
      const days  = daysSince(entry)
      const fees  = computeDestructionFees(entry, nowIso)
      return {
        ...m,
        entry_date:   entry,
        days_in_parc: days,
        photo_count:  Array.isArray(m.driver_photos) ? m.driver_photos.length : 0,
        fees,
      }
    })
    .filter(m => m.days_in_parc >= DESTRUCTION_THRESHOLD_DAYS)
    .sort((a, b) => b.days_in_parc - a.days_in_parc)

  const { data: settings } = await sb
    .from('parc_settings')
    .select('ville_destruction_email')
    .eq('id', 1)
    .maybeSingle()

  return NextResponse.json({
    eligible:                enriched,
    threshold_days:          DESTRUCTION_THRESHOLD_DAYS,
    ville_destruction_email: settings?.ville_destruction_email || null,
  })
}

// ─── POST : valider la sortie AVP (epave) + rapport + email ──────────────
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const access = checkAccess(session)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const missionIds: string[] = Array.isArray(body.mission_ids) ? body.mission_ids : []
  const format: 'xlsx' | 'pdf' = body.format === 'pdf' ? 'pdf' : 'xlsx'
  if (missionIds.length === 0) {
    return NextResponse.json({ error: 'Au moins une mission requise' }, { status: 400 })
  }

  const sb = createAdminClient()

  const { data: missions, error: mErr } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, dossier_number, source, status,
      vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
      parc_zone_key, parc_row_number, parc_slot_index,
      parked_at, intervention_date, received_at, driver_photos
    `)
    .in('id', missionIds)
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })
  if (!missions || missions.length === 0) {
    return NextResponse.json({ error: 'Aucune mission trouvee' }, { status: 404 })
  }

  // Securite : uniquement des AVP en parc
  const invalid = missions.filter(m => m.source !== 'police_avp' || !['parked', 'delivering'].includes(m.status))
  if (invalid.length > 0) {
    return NextResponse.json({
      error: `${invalid.length} mission(s) ne sont pas des AVP en parc (impossibles a detruire)`,
      invalid_ids: invalid.map(m => m.id),
    }, { status: 400 })
  }

  const now = new Date().toISOString()
  const destructionDate = fmtDate(now)
  const actorId = (access.user as any).id

  // 1. Update : completed + tampon EPAVE (scratched_at) + sans frais
  const epaveNote = `ÉPAVE — sortie le ${destructionDate}`
  await sb
    .from('incoming_missions')
    .update({
      status:           'completed',
      scratched_at:     now,
      scratched_by:     actorId,
      closing_notes:    epaveNote,
      no_charge_at:     now,
      no_charge_reason: 'Sortie AVP en épave (> 60j, accord Ville de Verviers)',
      no_charge_by:     actorId,
      completed_at:     now,
      released_at:      now,
      released_by:      actorId,
      updated_at:       now,
    })
    .in('id', missionIds)
    .then(() => {}, async () => {
      // Fallback minimal si colonnes optionnelles absentes
      await sb
        .from('incoming_missions')
        .update({
          status:           'completed',
          scratched_at:     now,
          scratched_by:     actorId,
          closing_notes:    epaveNote,
          no_charge_at:     now,
          no_charge_reason: 'Sortie AVP en épave (> 60j, accord Ville de Verviers)',
          no_charge_by:     actorId,
        })
        .in('id', missionIds)
    })

  // 2. Libere les positions parc + shift
  for (const id of missionIds) {
    try { await releaseParcAndShift(sb, id) }
    catch (e: any) { console.error('[destruction] release echec', id, e.message) }
  }

  // 3. Log audit
  const logs = missions.map(m => ({
    mission_id: m.id,
    actor_id:   actorId,
    action:     'scratched',
    notes:      `Sortie AVP en épave (> 60j). Ancien emplacement : ${m.parc_zone_key || '?'}${m.parc_row_number || ''}-${m.parc_slot_index ?? ''}.`,
    metadata:   {
      destruction_date: now,
      avp_epave: true,
      was_at: { zone: m.parc_zone_key, row: m.parc_row_number, slot: m.parc_slot_index },
    },
  }))
  await sb.from('mission_logs').insert(logs).then(() => {}, () => {})

  // 4. Construit le rapport (frais arretes a la date de sortie)
  const vehicles: DestructionVehicle[] = missions.map(m => ({
    plate:    m.vehicle_plate,
    brand:    m.vehicle_brand,
    model:    m.vehicle_model,
    vin:      m.vehicle_vin,
    zone:     m.parc_zone_key,
    row:      m.parc_row_number,
    slot:     m.parc_slot_index,
    entryIso: m.parked_at || m.intervention_date || m.received_at || null,
    exitIso:  now,
  }))

  const fileBuffer = format === 'pdf'
    ? await buildDestructionPdf(vehicles)
    : buildDestructionXlsx(vehicles)
  const fileBase64 = fileBuffer.toString('base64')
  const fileName   = `Sortie-AVP-${destructionDate.replace(/\//g, '-')}.${format}`
  const fileMime   = format === 'pdf'
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  // 5. Email a la Ville (best effort) avec piece jointe
  const { data: settings } = await sb
    .from('parc_settings')
    .select('ville_destruction_email')
    .eq('id', 1)
    .maybeSingle()
  const villeEmail = settings?.ville_destruction_email || null

  let emailSent = false
  let emailError: string | null = null
  if (villeEmail) {
    try {
      const { sendEmail } = await import('@/lib/emails')
      const monthLabel = new Date().toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' })

      const htmlList = vehicles.map(v => {
        const fees = computeDestructionFees(v.entryIso, v.exitIso)
        return `
        <tr style="border-bottom:1px solid #ddd">
          <td style="padding:6px"><strong>${v.plate || 'SANS PLAQUE'}</strong></td>
          <td style="padding:6px">${[v.brand, v.model].filter(Boolean).join(' ') || '—'}</td>
          <td style="padding:6px">${v.vin || '—'}</td>
          <td style="padding:6px">${fmtDate(v.entryIso)}</td>
          <td style="padding:6px">${destructionDate}</td>
          <td style="padding:6px;text-align:right">${fees.days} j</td>
        </tr>`
      }).join('')

      const html = `
        <p>Bonjour,</p>
        <p>Conformément à notre accord, voici la liste des véhicules AVP non récupérés après 60 jours de gardiennage,
        sortis du parc et mis en épave en date du <strong>${destructionDate}</strong>. Ces dossiers sont clôturés (aucune facturation).</p>
        <table style="border-collapse:collapse;width:100%;font-family:Arial;font-size:13px">
          <thead style="background:#f5f5f5">
            <tr>
              <th style="padding:6px;text-align:left;border-bottom:2px solid #ccc">Plaque</th>
              <th style="padding:6px;text-align:left;border-bottom:2px solid #ccc">Véhicule</th>
              <th style="padding:6px;text-align:left;border-bottom:2px solid #ccc">VIN</th>
              <th style="padding:6px;text-align:left;border-bottom:2px solid #ccc">Date entrée</th>
              <th style="padding:6px;text-align:left;border-bottom:2px solid #ccc">Date sortie</th>
              <th style="padding:6px;text-align:right;border-bottom:2px solid #ccc">Jours parc</th>
            </tr>
          </thead>
          <tbody>${htmlList}</tbody>
        </table>
        <p style="margin-top:16px">Total : <strong>${vehicles.length}</strong> véhicule${vehicles.length > 1 ? 's' : ''}.
        Le détail complet (avec frais arrêtés) est joint à cet email au format ${format.toUpperCase()}.</p>
        <p style="color:#999;font-size:11px;margin-top:24px">
          Cet email est envoyé automatiquement depuis VD Soft (Verviers Dépannage).
        </p>
      `

      await sendEmail(
        villeEmail,
        `[Verviers Dépannage] Sortie AVP en épave — ${monthLabel} (${vehicles.length} véhicule${vehicles.length > 1 ? 's' : ''})`,
        html,
        'Ville de Verviers',
        undefined,                                              // pas de CC : copie deja dans Envoyes de fourriere@
        [{ name: fileName, contentType: fileMime, contentBytes: fileBase64 }],
        FOURRIERE_FROM_EMAIL,                                   // expediteur = boite fourriere
      )
      emailSent = true
    } catch (e: any) {
      emailError = e.message || 'Erreur envoi email'
      console.error('[destruction] Email Ville echec:', emailError)
    }
  }

  return NextResponse.json({
    ok:               true,
    count:            missions.length,
    format,
    file_base64:      fileBase64,
    file_name:        fileName,
    file_mime:        fileMime,
    email_sent:       emailSent,
    email_to:         villeEmail,
    email_error:      emailError,
    destruction_date: destructionDate,
  })
}
