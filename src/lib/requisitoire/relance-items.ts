// src/lib/requisitoire/relance-items.ts
//
// Saisies EN PARC sans réquisitoire reçu, avec l'état du policier (contact Odoo,
// email) — la liste de l'écran « Relance réquisitoires » et, depuis le 16/09/2026,
// de l'onglet « Manquants » de l'écran Documents (refonte Fourrière, temps 2).
// Extrait tel quel de src/app/fourriere/relance-requisitoire/page.tsx.

import { odooRpc }           from '@/lib/odoo'
import { sourcesWithTag }    from '@/lib/missions/source-catalog'

// « EN PARC » = mêmes statuts que la recherche fourrière (ACTIVE_PARC_STATUSES).
export const PARC_STATUSES = ['parked', 'delivering', 'unlocated', 'awaiting_payment']

export interface RelanceItem {
  id: string; ref: string | null; plate: string | null; vehicle: string | null
  location: string | null; saisie_at: string | null; zone: string | null
  zone_company_id: number | null
  officer_name: string | null; officer_email: string | null; officer_linked: boolean
  officer_partner_id: number | null
  token: string | null; stop: boolean; reminder_count: number; last_reminder_at: string | null
}

export async function loadRelanceItems(sb: any): Promise<RelanceItem[]> {
  const { data: rows } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, incident_address, created_at, saisie_motif_label, police_pv_number, police_zone, officer_name, officer_partner_id, requisitoire_token, requisitoire_stop, requisitoire_reminder_count, requisitoire_last_reminder_at')
    .in('source', await sourcesWithTag('requisitoire'))
    .is('requisitoire_at', null)
    .in('status', PARC_STATUSES)
    .order('created_at', { ascending: true })
    .limit(500)
  const missions = rows || []

  // Zone de police → société Odoo (autocomplete / création du policier).
  const { data: zones } = await sb.from('police_zones').select('name, odoo_company_id')
  const zoneCompany: Record<string, number | null> = {}
  for (const z of (zones || [])) if (z?.name) zoneCompany[z.name] = z.odoo_company_id ?? null

  // Emails des policiers (contacts Odoo), bornés par un timeout : jamais bloquer la liste.
  const partnerIds = [...new Set(missions.map((m: any) => m.officer_partner_id).filter(Boolean))] as number[]
  const emailMap: Record<number, string> = {}
  if (partnerIds.length) {
    try {
      const parts = await Promise.race([
        odooRpc<any[]>('res.partner', 'read', [partnerIds], { fields: ['email'] }),
        new Promise<any[]>(res => setTimeout(() => res([]), 5000)),
      ])
      for (const p of (parts || [])) if (p.email && /@/.test(p.email)) emailMap[p.id] = p.email
    } catch { /* Odoo indispo → pas d'email résolu */ }
  }

  return missions.map((m: any) => ({
    id: m.id,
    ref: m.mission_number != null ? `SAI-${m.mission_number}` : null,
    plate: m.vehicle_plate,
    vehicle: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || null,
    location: m.incident_address || null,
    saisie_at: m.created_at,
    zone: m.police_zone,
    zone_company_id: m.police_zone ? (zoneCompany[m.police_zone] ?? null) : null,
    officer_name: m.officer_name,
    officer_email: m.officer_partner_id ? (emailMap[m.officer_partner_id] || null) : null,
    officer_linked: !!m.officer_partner_id,
    officer_partner_id: m.officer_partner_id ?? null,
    token: m.requisitoire_token,
    stop: m.requisitoire_stop,
    reminder_count: m.requisitoire_reminder_count || 0,
    last_reminder_at: m.requisitoire_last_reminder_at,
  }))
}
