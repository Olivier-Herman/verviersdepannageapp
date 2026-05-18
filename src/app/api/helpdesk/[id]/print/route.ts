// src/app/api/helpdesk/[id]/print/route.ts
//
// POST /api/helpdesk/[id]/print
// Demande au PC Windows (imprimante Zebra via ngrok) d imprimer une etiquette
// pour ce ticket helpdesk. Assemble le payload depuis Odoo (ticket + vehicule)
// puis POST a l URL Zebra (env ZEBRA_REMOTE).
//
// Comportement identique a Verviers-QR /api/print/[id] pour rester compatible
// avec le script existant sur le PC (pas de changement materiel).

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { odooRpc, withOdooActor }  from '@/lib/odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 20

const ZEBRA_URL = process.env.ZEBRA_REMOTE || ''
const QR_BASE   = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/v`
  : 'https://verviers-qr.vercel.app/v'  // fallback : QR existant continue

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ticketId = parseInt(params.id, 10)
  if (!ticketId || isNaN(ticketId)) {
    return NextResponse.json({ error: 'ID ticket invalide' }, { status: 400 })
  }

  if (!ZEBRA_URL) {
    return NextResponse.json({
      error: 'ZEBRA_REMOTE non configure (env var manquante)',
    }, { status: 500 })
  }

  return withOdooActor(user.id as string | undefined, async () => {
    try {
      // 1. Lit le ticket avec champs utiles a l etiquette
      const tickets = await odooRpc<any[]>('helpdesk.ticket', 'search_read', [
        [['id', '=', ticketId]],
      ], {
        fields: [
          'id', 'tag_ids',
          'x_studio_vehicule',
          'x_studio_date_dentree',
          'x_studio_note_sur_etiquette',
        ],
        limit: 1,
      })
      if (!tickets || tickets.length === 0) {
        return NextResponse.json({ error: 'Ticket introuvable' }, { status: 404 })
      }
      const t = tickets[0]

      // 2. Resolve motif (1er tag)
      let motif = ''
      if (t.tag_ids?.length > 0) {
        const tags = await odooRpc<any[]>('helpdesk.tag', 'search_read', [
          [['id', 'in', t.tag_ids]],
        ], { fields: ['name'], limit: 5 })
        motif = tags?.[0]?.name || ''
      }

      // 3. Format date d entree
      let date = ''
      if (t.x_studio_date_dentree) {
        const d = new Date(t.x_studio_date_dentree)
        date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`
      }

      const note = (t.x_studio_note_sur_etiquette && t.x_studio_note_sur_etiquette !== false)
        ? t.x_studio_note_sur_etiquette : ''

      // 4. Resolve vehicule (plaque, VIN, marque, modele)
      let plate = '', vin = '', brand = '', model = ''
      const vehiculeId = Array.isArray(t.x_studio_vehicule) ? t.x_studio_vehicule[0] : t.x_studio_vehicule
      if (vehiculeId && vehiculeId !== false) {
        const fleets = await odooRpc<any[]>('fleet.vehicle', 'search_read', [
          [['id', '=', vehiculeId]],
        ], { fields: ['license_plate', 'vin_sn', 'model_id'], limit: 1 })
        if (fleets && fleets.length > 0) {
          plate = fleets[0].license_plate || ''
          vin   = fleets[0].vin_sn || ''
          const modelName = Array.isArray(fleets[0].model_id) ? fleets[0].model_id[1] : ''
          const parts = modelName.split(/[\s\/]+/)
          brand = parts[0] || ''
          model = parts.slice(1).join(' ') || ''
        }
      }

      // 5. POST au PC Windows via ngrok (memes champs que Verviers-QR)
      const qrUrl = `${QR_BASE}/${ticketId}`
      const printRes = await fetch(`${ZEBRA_URL.replace(/\/$/, '')}/print`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({ qrUrl, motif, date, note, plate, vin, brand, model }),
        signal: AbortSignal.timeout(10000),
      })

      const printData = await printRes.json().catch(() => ({}))
      if (!printRes.ok || !printData.ok) {
        const errMsg = printData?.error || `Imprimante ${printRes.status}`
        return NextResponse.json({ error: errMsg }, { status: 502 })
      }

      return NextResponse.json({ ok: true, qrUrl, plate, motif })
    } catch (e: any) {
      console.error('[helpdesk/:id/print]', e.message)
      return NextResponse.json({ error: e.message || 'Erreur impression' }, { status: 500 })
    }
  })
}
