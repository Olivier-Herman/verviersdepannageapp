// src/app/api/helpdesk/[id]/route.ts
//
// GET /api/helpdesk/[id]
// Lit un ticket helpdesk Odoo (avec ses champs Studio fourriere) + son
// vehicule lie. Utilise par la page mobile /v/[id] (fiche fourriere
// scannable par QR code).

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { odooRpc, withOdooActor }  from '@/lib/odoo'
import { FOURRIERE_ZONE_BY_ID }    from '@/lib/fourriere'

export const dynamic     = 'force-dynamic'
export const maxDuration = 15

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ticketId = parseInt(params.id, 10)
  if (!ticketId || isNaN(ticketId)) {
    return NextResponse.json({ error: 'ID ticket invalide' }, { status: 400 })
  }

  const user = session.user as any

  return withOdooActor(user.id as string | undefined, async () => {
    try {
      const tickets = await odooRpc<any[]>('helpdesk.ticket', 'search_read', [
        [['id', '=', ticketId]],
      ], {
        fields: [
          'id', 'name', 'tag_ids',
          'x_studio_vehicule', 'x_studio_fiche_vehicule',
          'x_studio_mission_towsoft',
          'x_studio_date_dentree',
          'x_studio_note_sur_etiquette',
          'create_date',
        ],
        limit: 1,
      })

      if (!tickets || tickets.length === 0) {
        return NextResponse.json({ error: 'Ticket introuvable' }, { status: 404 })
      }
      const t = tickets[0]

      // Resolve helpdesk tags (motif)
      let motif = ''
      let tagNames: string[] = []
      if (t.tag_ids && t.tag_ids.length > 0) {
        const tags = await odooRpc<any[]>('helpdesk.tag', 'search_read', [
          [['id', 'in', t.tag_ids]],
        ], { fields: ['name'], limit: 10 })
        tagNames = (tags || []).map(tg => tg.name)
        motif = tagNames[0] || ''
      }

      // Resolve fleet vehicle
      const fleetId = typeof t.x_studio_fiche_vehicule === 'number'
        ? t.x_studio_fiche_vehicule
        : Array.isArray(t.x_studio_vehicule) ? t.x_studio_vehicule[0] : null

      let vehicle: any = null
      if (fleetId) {
        const fleets = await odooRpc<any[]>('fleet.vehicle', 'search_read', [
          [['id', '=', fleetId]],
        ], {
          fields: ['id', 'license_plate', 'vin_sn', 'brand_id', 'model_id', 'state_id', 'driver_id'],
          limit:  1,
        })
        vehicle = fleets?.[0] || null
      }

      // Resolve model name (parfois display_name incomplet)
      let modelName = ''
      if (vehicle?.model_id?.[0]) {
        const models = await odooRpc<any[]>('fleet.vehicle.model', 'read', [
          [vehicle.model_id[0]],
        ], { fields: ['id', 'name'] })
        modelName = models?.[0]?.name || vehicle.model_id?.[1] || ''
      }

      const stateId = vehicle?.state_id?.[0] || null
      const zone    = stateId ? FOURRIERE_ZONE_BY_ID[stateId] : null

      return NextResponse.json({
        ok: true,
        ticket: {
          id:              t.id,
          name:            t.name,
          dateEntree:      t.x_studio_date_dentree || null,
          missionTowsoft:  t.x_studio_mission_towsoft || null,
          noteEtiquette:   t.x_studio_note_sur_etiquette || '',
          motif,
          tagNames,
          createdAt:       t.create_date || null,
        },
        vehicle: vehicle ? {
          id:            vehicle.id,
          plate:         vehicle.license_plate || '',
          vin:           vehicle.vin_sn || '',
          brand:         vehicle.brand_id?.[1] || '',
          model:         modelName,
          driver:        vehicle.driver_id?.[1] || null,
          stateId,
          stateName:     vehicle.state_id?.[1] || null,
          zoneCode:      zone?.code || null,
          zoneLabel:     zone?.label || null,
          zoneFullName:  zone?.full_name || vehicle.state_id?.[1] || null,
        } : null,
      })
    } catch (e: any) {
      console.error('[helpdesk/:id] error:', e.message)
      return NextResponse.json({ error: e.message || 'Erreur Odoo' }, { status: 500 })
    }
  })
}
