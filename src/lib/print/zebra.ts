// src/lib/print/zebra.ts
//
// Helper d impression Zebra (imprimante PC Windows via ngrok). Encapsule la
// logique commune pour pouvoir l appeler depuis plusieurs endpoints :
//   - POST /api/helpdesk/[id]/print           (UI, auth NextAuth)
//   - POST /api/towsoft/callback              (callback GitHub Action, auth secret)
//   - Tout autre flow qui veut imprimer une etiquette pour un ticket Odoo.
//
// Comportement identique a l ancien Verviers-QR /api/print/[id] pour rester
// compatible avec le script existant sur le PC (pas de changement materiel).

import { odooRpc } from '@/lib/odoo'

const ZEBRA_URL = process.env.ZEBRA_REMOTE || ''
const QR_BASE   = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/v`
  : 'https://verviers-qr.vercel.app/v'  // fallback : QR existant continue

export interface PrintResult {
  ok:     boolean
  qrUrl?: string
  plate?: string
  motif?: string
  error?: string
  status?: number
}

/**
 * Imprime une etiquette Zebra pour un ticket Helpdesk Odoo donne.
 * Best effort : si l imprimante n est pas joignable, retourne { ok: false, error, status }.
 * L appelant decide si c est bloquant ou non.
 */
export async function printZebraLabelForTicket(ticketId: number): Promise<PrintResult> {
  if (!ticketId || isNaN(ticketId)) {
    return { ok: false, error: 'ID ticket invalide', status: 400 }
  }
  if (!ZEBRA_URL) {
    return { ok: false, error: 'ZEBRA_REMOTE non configure', status: 500 }
  }

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
      return { ok: false, error: 'Ticket introuvable', status: 404 }
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
      return { ok: false, error: errMsg, status: 502 }
    }

    return { ok: true, qrUrl, plate, motif }
  } catch (e: any) {
    console.error('[printZebraLabelForTicket]', e.message)
    return { ok: false, error: e.message || 'Erreur impression', status: 500 }
  }
}
