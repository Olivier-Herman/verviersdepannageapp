// Notifications email vers les garages partenaires quand le statut de
// leur mission change. Olivier 2026-06-02.
//
// Best-effort : ne fail pas la transaction qui a change le statut si l email
// echoue (log uniquement).

import { createAdminClient } from '@/lib/supabase'
import { sendEmail }         from '@/lib/emails'

type GarageEvent =
  | 'accepted'          // mission acceptee par dispatch / assignee a un chauffeur
  | 'on_way'            // chauffeur en route
  | 'completed'         // mission terminee
  | 'cancelled_direct'  // annulation directe (pas encore acceptee)
  | 'cancellation_approved_total'  // annulation totale apres decision dispatch
  | 'cancellation_approved_dpr'    // facturation DPR apres decision dispatch
  | 'cancellation_refused'         // refus annulation

interface MissionLite {
  id:                     string
  mission_number:         number | null
  vehicle_plate:          string | null
  vehicle_brand:          string | null
  vehicle_model:          string | null
  incident_address:       string | null
  mission_type:           string | null
  requested_by_garage_id: string | null
}

interface GarageContactLite {
  email: string
  name:  string
}

/**
 * Envoie un email au(x) contact(s) du garage qui a demande la mission.
 * No-op si la mission n a pas requested_by_garage_id ou si pas de contact email.
 */
export async function notifyGarageOfMissionEvent(
  missionId: string,
  event: GarageEvent,
  opts?: { decisionNote?: string | null; amountDpr?: number | null }
): Promise<void> {
  try {
    const sb = createAdminClient()
    const { data: m } = await sb
      .from('incoming_missions')
      .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, incident_address, mission_type, requested_by_garage_id')
      .eq('id', missionId)
      .maybeSingle()
    if (!m || !m.requested_by_garage_id) return  // pas une mission garage

    // Recup tous les users garage lies a ce garage_partner
    const { data: links } = await sb
      .from('garage_user_partners')
      .select('users ( email, name, active )')
      .eq('garage_partner_id', m.requested_by_garage_id)
    const contacts: GarageContactLite[] = (links || [])
      .map((l: any) => l.users)
      .filter((u: any) => u && u.active && u.email)
      .map((u: any) => ({ email: u.email, name: u.name || u.email }))

    if (contacts.length === 0) return

    const subject = subjectFor(event, m)
    const html    = buildEmailHtml(event, m, opts)
    await Promise.allSettled(contacts.map(c =>
      sendEmail(c.email, subject, html)
    ))
  } catch (e: any) {
    console.error('[notifyGarageOfMissionEvent]', e?.message || e)
  }
}

function subjectFor(event: GarageEvent, m: MissionLite): string {
  const ref = m.vehicle_plate || `#${m.mission_number || '?'}`
  switch (event) {
    case 'accepted':                       return `✅ Mission ${ref} acceptée — Verviers Dépannage`
    case 'on_way':                         return `🚗 Mission ${ref} : chauffeur en route — Verviers Dépannage`
    case 'completed':                      return `✅ Mission ${ref} terminée — Verviers Dépannage`
    case 'cancelled_direct':               return `Mission ${ref} annulée — Verviers Dépannage`
    case 'cancellation_approved_total':    return `Mission ${ref} : annulation totale validée`
    case 'cancellation_approved_dpr':      return `Mission ${ref} : facturation déplacement (DPR)`
    case 'cancellation_refused':           return `Mission ${ref} : demande d annulation refusée`
  }
}

function buildEmailHtml(event: GarageEvent, m: MissionLite, opts?: { decisionNote?: string | null; amountDpr?: number | null }): string {
  const vehicleParts: string[] = []
  if (m.vehicle_plate) vehicleParts.push(`<strong>${escapeHtml(m.vehicle_plate)}</strong>`)
  const brandModel = [m.vehicle_brand, m.vehicle_model].filter((x): x is string => !!x).map(escapeHtml).join(' ')
  if (brandModel) vehicleParts.push(brandModel)
  const vehicleLine = vehicleParts.join(' · ')
  const typeLine = m.mission_type === 'depannage' ? '🔧 Dépannage sur place' :
                   m.mission_type === 'remorquage' ? '🚛 Remorquage' :
                   m.mission_type === 'trajet_vide' ? 'Déplacement' : (m.mission_type || '')
  const address  = m.incident_address ? escapeHtml(m.incident_address) : ''

  const note   = opts?.decisionNote ? `<p style="margin:8px 0;color:#374151;font-size:13px;"><em>Note de notre équipe : « ${escapeHtml(opts.decisionNote)} »</em></p>` : ''
  const amount = opts?.amountDpr != null
    ? `<p style="margin:8px 0;color:#1f2937;font-size:14px;">Montant facturé (déplacement) : <strong>${(opts.amountDpr ?? 0).toFixed(2)} €</strong></p>`
    : ''

  const messages: Record<GarageEvent, { color: string; emoji: string; title: string; body: string }> = {
    accepted: {
      color: '#047857', emoji: '✅', title: 'Votre demande est prise en charge',
      body:  `Notre équipe a accepté la mission. Un chauffeur va intervenir prochainement.`,
    },
    on_way: {
      color: '#d97706', emoji: '🚗', title: 'Chauffeur en route',
      body:  `Le chauffeur est en route vers l'adresse d'intervention.`,
    },
    completed: {
      color: '#047857', emoji: '✅', title: 'Mission terminée',
      body:  `L'intervention est terminée. La facturation sera émise selon nos accords.`,
    },
    cancelled_direct: {
      color: '#6b7280', emoji: '✕', title: 'Mission annulée',
      body:  `Votre demande a été annulée. Aucun frais ne sera facturé.`,
    },
    cancellation_approved_total: {
      color: '#047857', emoji: '✓', title: 'Annulation acceptée',
      body:  `Notre équipe a validé votre demande d'annulation. Aucun frais ne sera facturé.`,
    },
    cancellation_approved_dpr: {
      color: '#1d4ed8', emoji: '€', title: 'Facturation déplacement',
      body:  `Notre équipe a validé votre demande d'annulation, avec facturation d'un déplacement (DPR).`,
    },
    cancellation_refused: {
      color: '#b91c1c', emoji: '✕', title: 'Demande d\'annulation refusée',
      body:  `Notre équipe n'a pas pu valider votre demande d'annulation. La mission se poursuit.`,
    },
  }

  const msg = messages[event]

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">

        <tr><td style="background:linear-gradient(135deg,#b91c1c 0%,#7f1d1d 100%);padding:24px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">VD Soft</h1>
          <p style="margin:4px 0 0 0;color:#fecaca;font-size:12px;">Verviers Dépannage</p>
        </td></tr>

        <tr><td style="padding:24px 32px 8px 32px;">
          <p style="margin:0;color:${msg.color};font-size:14px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">${msg.emoji} ${escapeHtml(msg.title)}</p>
          <p style="margin:12px 0 0 0;color:#374151;font-size:15px;line-height:1.6;">${escapeHtml(msg.body)}</p>
          ${note}
          ${amount}
        </td></tr>

        <tr><td style="padding:8px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;">
            <tr><td>
              ${typeLine ? `<p style="margin:0 0 4px 0;color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;">${typeLine}</p>` : ''}
              ${vehicleLine ? `<p style="margin:0;color:#1f2937;font-size:14px;">${vehicleLine}</p>` : ''}
              ${address ? `<p style="margin:6px 0 0 0;color:#6b7280;font-size:13px;">📍 ${address}</p>` : ''}
              ${m.mission_number ? `<p style="margin:8px 0 0 0;color:#9ca3af;font-size:11px;font-family:monospace;">#${m.mission_number}</p>` : ''}
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:16px 32px 24px 32px;text-align:center;">
          <a href="https://app.verviersdepannage.com/garage" style="display:inline-block;background:#b91c1c;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:13px;">
            Voir le suivi
          </a>
        </td></tr>

        <tr><td style="background:#f9fafb;padding:14px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:11px;">Verviers Dépannage SA · +32 87 60 08 35</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}
