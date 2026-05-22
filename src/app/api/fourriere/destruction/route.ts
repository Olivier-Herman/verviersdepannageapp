// src/app/api/fourriere/destruction/route.ts
//
// GET /api/fourriere/destruction
//   Liste les vehicules AVP eligibles a la destruction (≥ 60 jours en parc).
//   Permet a Olivier de voir, en fin de mois, ce qu il va envoyer detruire.
//
// POST /api/fourriere/destruction
//   Body : { mission_ids: string[] }
//   Valide la liste : passe les missions en status='completed' avec motif
//   'destroyed_avp', genere le rapport (CSV + photos URLs), envoie l email a
//   la Ville de Verviers (parc_settings.ville_destruction_email).
//
// Acces : admin / superadmin / module fourriere

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { releaseParcAndShift } from '@/lib/parc/release'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const DESTRUCTION_THRESHOLD_DAYS = 60

function escapeCsv(v: any): string {
  if (v == null) return ''
  const s = String(v)
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return iso }
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

// ─── GET : liste eligibles ──────────────────────────────────────────────
export async function GET() {
  const session = await getServerSession(authOptions)
  const access = checkAccess(session)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()

  // AVP non recuperes depuis ≥ 60 jours
  const thresholdIso = new Date(Date.now() - DESTRUCTION_THRESHOLD_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, dossier_number, vehicle_plate, vehicle_brand, vehicle_model,
      vehicle_vin, client_name, billed_to_name,
      parc_zone_key, parc_row_number, parc_slot_index,
      received_at, intervention_date,
      driver_photos, odoo_helpdesk_id, status
    `)
    .eq('source', 'police_avp')
    .in('status', ['parked', 'delivering'])
    .lte('intervention_date', thresholdIso)
    .order('intervention_date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Settings : email destinataire ville
  const { data: settings } = await sb
    .from('parc_settings')
    .select('ville_destruction_email')
    .eq('id', 1)
    .maybeSingle()

  const enriched = (data || []).map(m => ({
    ...m,
    days_in_parc: daysSince(m.intervention_date || m.received_at),
    photo_count:  Array.isArray(m.driver_photos) ? m.driver_photos.length : 0,
  }))

  return NextResponse.json({
    eligible:                enriched,
    threshold_days:          DESTRUCTION_THRESHOLD_DAYS,
    ville_destruction_email: settings?.ville_destruction_email || null,
  })
}

// ─── POST : valider la destruction ──────────────────────────────────────
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const access = checkAccess(session)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const missionIds: string[] = Array.isArray(body.mission_ids) ? body.mission_ids : []
  if (missionIds.length === 0) {
    return NextResponse.json({ error: 'Au moins une mission requise' }, { status: 400 })
  }

  const sb = createAdminClient()

  // Re-fetch les missions pour generer le rapport + secu
  const { data: missions, error: mErr } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, dossier_number, source, status,
      vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
      parc_zone_key, parc_row_number, parc_slot_index,
      intervention_date, received_at, driver_photos
    `)
    .in('id', missionIds)
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })
  if (!missions || missions.length === 0) {
    return NextResponse.json({ error: 'Aucune mission trouvee' }, { status: 404 })
  }

  // Verifie que toutes sont bien des AVP en parc
  const invalid = missions.filter(m => m.source !== 'police_avp' || !['parked', 'delivering'].includes(m.status))
  if (invalid.length > 0) {
    return NextResponse.json({
      error: `${invalid.length} mission(s) ne sont pas des AVP en parc (impossibles a detruire)`,
      invalid_ids: invalid.map(m => m.id),
    }, { status: 400 })
  }

  const now = new Date().toISOString()
  const destructionDate = fmtDate(now)

  // 1. Update status : completed + motif destroyed_avp
  await sb
    .from('incoming_missions')
    .update({
      status:           'completed',
      no_charge_at:     now,
      no_charge_reason: 'Envoi en destruction (AVP > 60j, accord Ville de Verviers)',
      no_charge_by:     (access.user as any).id,
      completed_at:     now,
      released_at:      now,
      released_by:      (access.user as any).id,
      updated_at:       now,
    })
    .in('id', missionIds)
    .then(() => {}, async () => {
      // Fallback si released_at/completed_at n existent pas
      await sb
        .from('incoming_missions')
        .update({
          status:           'completed',
          no_charge_at:     now,
          no_charge_reason: 'Envoi en destruction (AVP > 60j, accord Ville de Verviers)',
          no_charge_by:     (access.user as any).id,
        })
        .in('id', missionIds)
    })

  // 2. Libere les positions parc + shift (un par un pour propre shift)
  for (const id of missionIds) {
    try { await releaseParcAndShift(sb, id) }
    catch (e: any) { console.error('[destruction] release echec', id, e.message) }
  }

  // 3. Log mission_logs (audit)
  const logs = missions.map(m => ({
    mission_id: m.id,
    actor_id:   (access.user as any).id,
    action:     'destroyed_avp',
    notes:      `Envoyé en destruction (AVP > 60j). Ancien emplacement : ${m.parc_zone_key || '?'}${m.parc_row_number || ''}-${m.parc_slot_index || ''}.`,
    metadata:   {
      destruction_date: now,
      was_at: { zone: m.parc_zone_key, row: m.parc_row_number, slot: m.parc_slot_index },
    },
  }))
  await sb.from('mission_logs').insert(logs).then(() => {}, () => {})

  // 4. Genere le rapport CSV pour la Ville
  const csvHeader = "Date d'intervention,Marque,Modèle,Plaque,VIN,Date d'envoi en destruction,Photo URL"
  const csvRows = missions.map(m => [
    escapeCsv(fmtDate(m.intervention_date || m.received_at)),
    escapeCsv(m.vehicle_brand),
    escapeCsv(m.vehicle_model),
    escapeCsv(m.vehicle_plate),
    escapeCsv(m.vehicle_vin),
    escapeCsv(destructionDate),
    escapeCsv(Array.isArray(m.driver_photos) && m.driver_photos.length > 0 ? m.driver_photos[0] : ''),
  ].join(','))
  const csv = [csvHeader, ...csvRows].join('\n')

  // 5. Envoi email a la Ville (best effort)
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

      const htmlList = missions.map(m => `
        <tr style="border-bottom:1px solid #ddd">
          <td style="padding:6px">${fmtDate(m.intervention_date || m.received_at)}</td>
          <td style="padding:6px">${m.vehicle_brand || ''} ${m.vehicle_model || ''}</td>
          <td style="padding:6px"><strong>${m.vehicle_plate || '—'}</strong></td>
          <td style="padding:6px">${m.vehicle_vin || '—'}</td>
          <td style="padding:6px">${destructionDate}</td>
          <td style="padding:6px">${Array.isArray(m.driver_photos) && m.driver_photos.length > 0 ? `<a href="${m.driver_photos[0]}">Voir</a>` : '—'}</td>
        </tr>
      `).join('')

      const html = `
        <p>Bonjour,</p>
        <p>Conformément à notre accord, voici la liste des véhicules AVP non récupérés après 60 jours de gardiennage,
        envoyés en destruction en date du <strong>${destructionDate}</strong> :</p>
        <table style="border-collapse:collapse;width:100%;font-family:Arial;font-size:13px">
          <thead style="background:#f5f5f5">
            <tr>
              <th style="padding:6px;text-align:left;border-bottom:2px solid #ccc">Date intervention</th>
              <th style="padding:6px;text-align:left;border-bottom:2px solid #ccc">Véhicule</th>
              <th style="padding:6px;text-align:left;border-bottom:2px solid #ccc">Plaque</th>
              <th style="padding:6px;text-align:left;border-bottom:2px solid #ccc">VIN</th>
              <th style="padding:6px;text-align:left;border-bottom:2px solid #ccc">Date destruction</th>
              <th style="padding:6px;text-align:left;border-bottom:2px solid #ccc">Photo</th>
            </tr>
          </thead>
          <tbody>${htmlList}</tbody>
        </table>
        <p style="margin-top:16px">Total : <strong>${missions.length}</strong> véhicule${missions.length > 1 ? 's' : ''}.</p>
        <p style="color:#999;font-size:11px;margin-top:24px">
          Cet email est envoyé automatiquement depuis VD Soft (Verviers Dépannage).
        </p>
      `

      await sendEmail(
        villeEmail,
        `[Verviers Dépannage] Envoi en destruction AVP — ${monthLabel} (${missions.length} véhicule${missions.length > 1 ? 's' : ''})`,
        html,
        undefined,
        'fourriere@verviersdepannage.be',  // CC interne pour archivage
      )
      emailSent = true
    } catch (e: any) {
      emailError = e.message || 'Erreur envoi email'
      console.error('[destruction] Email Ville echec:', emailError)
    }
  }

  return NextResponse.json({
    ok:           true,
    count:        missions.length,
    csv,
    email_sent:   emailSent,
    email_to:     villeEmail,
    email_error:  emailError,
    destruction_date: destructionDate,
  })
}
