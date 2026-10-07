// src/lib/especes/inventory.ts
//
// Inventaire des espèces à remettre à Momo (Olivier 06/10/2026) : paiements en espèces
// NON rapprochés de l'ERP — Dépannage caisse en entier, Encaissement Chauffeur depuis le
// 15/06/2026 — avec qui a l'argent, le client, la facture, le véhicule, le lieu et la date
// d'intervention. Un paiement déjà confirmé par Momo (ou encodé) n'est jamais représenté,
// même tant qu'il n'est pas encore rapproché.

import { odooRpc } from '@/lib/odoo'
import { createAdminClient } from '@/lib/supabase'
import { getBusinessNumber, getBusinessText } from '@/lib/settings/business'

const CHAU1_DEPUIS = '2026-06-15'
const strip = (h: string) => String(h || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type U = { id: string; name: string; odoo_user_id: number | null }

/** Qui a encaissé : un nom dans le mémo / la note / le fil, sinon l'encodeur (règle d'Olivier). */
function holderFromText(text: string, users: U[]): U | null {
  const t = norm(text)
  if (/bennane|\bmomo\b/.test(t)) return users.find(u => /momo/i.test(u.name) && u.odoo_user_id) || users.find(u => /momo/i.test(u.name)) || null
  if (/\bmobi\b/.test(t)) return users.find(u => norm(u.name) === 'mobi') || null
  // Nom complet d'abord (« Fred Palm » ≠ « Fred Bovy »).
  const full = users.filter(u => norm(u.name).length >= 5 && t.includes(norm(u.name).replace(/\s*\(.*$/, '')))
  if (full.length === 1) return full[0]
  const hits = users.filter(u => { const first = norm(u.name).split(/[\s-]+/)[0]; return first.length >= 3 && first !== 'momo' && new RegExp(`\\b${first}\\b`).test(t) })
  if (hits.length === 1) return hits[0]
  // « F. Palm », « Fred B. » …
  const ini = users.filter(u => { const [a, b] = norm(u.name).split(/\s+/); return a && b && (new RegExp(`\\b${a[0]}\\.? ?${b}\\b`).test(t) || new RegExp(`\\b${a} ${b[0]}\\.`).test(t)) })
  return ini.length === 1 ? ini[0] : null
}

const words = (s: string) => norm(s).split(/[^a-z]+/).filter(w => w.length >= 3)

/** Le mouvement d'encaissement en espèces (écran Mouvements) qui correspond au paiement :
 *  même montant, même client, à deux jours près. Un seul candidat, sinon rien. */
export async function movementFor(p: { amount: number; date: string; partner_id?: any }): Promise<any | null> {
  const day = 86_400_000, d0 = new Date(`${p.date}T00:00:00Z`).getTime()
  const { data } = await createAdminClient().from('interventions').select('driver_id, client_name, plate, brand_text, model_text, location_address, intervention_date')
    .eq('payment_mode', 'cash').eq('amount', p.amount)
    .gte('intervention_date', new Date(d0 - 2 * day).toISOString()).lt('intervention_date', new Date(d0 + 3 * day).toISOString()).limit(20)
  const client = new Set(words(String(p.partner_id?.[1] || '')))
  const hits = (data || []).filter((m: any) => m.driver_id && words(m.client_name || '').some(w => client.has(w)))
  return hits.length === 1 ? hits[0] : null
}

export async function syncCashInventory(): Promise<{ total: number; added: number; closed: number }> {
  const sb = createAdminClient()
  const [jDep, jChau, mDep, mChau] = await Promise.all([getBusinessNumber('odoo_journal_caisse_depannage'), getBusinessNumber('odoo_journal_encaissement_chauffeur'), getBusinessNumber('odoo_methode_especes_depannage'), getBusinessNumber('odoo_methode_especes_chauffeur')])
  const { data: users } = await sb.from('users').select('id, name, odoo_user_id').eq('active', true)
  const U = (users || []) as U[]
  const pays: any[] = await odooRpc('account.payment', 'search_read', [['|', '&', '&', ['journal_id', '=', jDep], ['payment_method_line_id', '=', mDep], ['state', '!=', 'canceled'],
    '&', '&', '&', ['journal_id', '=', jChau], ['payment_method_line_id', '=', mChau], ['state', '!=', 'canceled'], ['date', '>=', CHAU1_DEPUIS]]],
    { fields: ['id', 'name', 'date', 'amount', 'memo', 'partner_id', 'create_uid', 'is_matched', 'journal_id'] })
  const { data: known } = await sb.from('cash_handover_items').select('odoo_payment_id, status')
  const kmap = new Map((known || []).map((k: any) => [k.odoo_payment_id, k.status]))
  let added = 0, closed = 0
  for (const p of pays) {
    const st = kmap.get(p.id)
    if (p.is_matched) {
      // Rapproché dans l'ERP : la boucle est bouclée (ou le paiement n'était plus à remettre).
      if (st && !['reconciled'].includes(st)) {
        // Encodé dans Scrada sans passer par Momo (validé par Olivier) : l'argent sort de la caisse
        // du chauffeur quand le relevé Scrada arrive et rapproche le paiement (Olivier 07/10/2026).
        const { data: it } = await sb.from('cash_handover_items').select('holder_user_id, amount, payment_name, invoice, client, cash_transfer_id').eq('odoo_payment_id', p.id).maybeSingle()
        const receiver = await getBusinessText('especes_receveur_user_id').catch(() => '')
        // Seulement si cet encaissement figure bien dans la caisse de ce chauffeur (jamais de caisse négative).
        const { data: inBox } = it?.holder_user_id ? await sb.from('cash_register').select('id').eq('driver_id', it.holder_user_id).eq('odoo_payment_id', p.id).eq('type', 'encaissement').limit(1) : { data: [] as any[] }
        if (st === 'encoded' && it && !it.cash_transfer_id && it.holder_user_id && it.holder_user_id !== receiver && (inBox || []).length) {
          await sb.from('cash_register').insert({ driver_id: it.holder_user_id, amount: it.amount, type: 'remise', notes: `Versé dans la caisse officielle (Scrada) — ${it.payment_name} ${it.invoice || ''} ${it.client || ''}`.trim() })
        }
        await sb.from('cash_handover_items').update({ status: 'reconciled', updated_at: new Date().toISOString() }).eq('odoo_payment_id', p.id); closed++
      }
      continue
    }
    if (st) continue   // déjà suivi : on ne touche ni au statut ni à l'attribution
    const invoiceName = String(p.memo || '').split(/[\s(]/)[0]
    const inv: any[] = invoiceName ? await odooRpc('account.move', 'search_read', [[['name', '=', invoiceName], ['move_type', '=', 'out_invoice']]], { fields: ['id', 'x_studio_plaque_1'], limit: 1 }) : []
    // Qui a l'argent : le mouvement d'encaissement VD Soft fait foi (Olivier 06/10/2026),
    // puis « encaissé par », le mémo, le fil, et en dernier qui a créé le paiement.
    const mv = await movementFor(p)
    let holder: U | null = null
    if (mv) {
      holder = U.find(u => u.id === mv.driver_id) || null
      if (!holder) { const { data: d } = await sb.from('users').select('id, name, odoo_user_id').eq('id', mv.driver_id).maybeSingle(); holder = (d as U) || null }
    }
    const isChau = p.journal_id?.[0] === jChau
    const texts: string[] = [String(p.memo || '')]
    const msgs: any[] = await odooRpc('mail.message', 'search_read', [[['model', 'in', ['account.payment', 'account.move']], ['res_id', 'in', [p.id, inv[0]?.id || 0]]]], { fields: ['body', 'model'], limit: 30 })
    for (const m of msgs) texts.push(strip(m.body))
    if (!holder && isChau) {
      const by = texts.join(' ').match(/encaiss[ée] par\s+([^·.,;]+?)(?:\s*[·.,;]|$)/i)?.[1]
      if (by) holder = holderFromText(by, U)
    }
    // Le mémo d'abord (« 2026/08/595 - Axel »), puis les notes et le fil.
    if (!holder) holder = holderFromText(String(p.memo || ''), U)
    if (!holder) holder = holderFromText(texts.slice(1).join(' '), U)
    if (!holder) holder = U.find(u => u.odoo_user_id === p.create_uid?.[0]) || null
    // Véhicule, lieu, date d'intervention : mission liée à la facture, sinon par la plaque (à vérifier)
    // « Peugeot/508/CG250ZY » → « CG250ZY · Peugeot 508 »
    const vparts = inv[0]?.x_studio_plaque_1 ? String(inv[0].x_studio_plaque_1[1]).split('/') : []
    const plate = vparts.length ? vparts[vparts.length - 1] : null
    const vehicle = plate ? [plate, vparts.slice(0, -1).filter(x => x && x !== 'Autre').join(' ')].filter(Boolean).join(' · ')
      : mv?.plate ? [mv.plate, [mv.brand_text, mv.model_text].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : null
    let place: string | null = mv?.location_address || null, idate: string | null = mv?.intervention_date ? String(mv.intervention_date).slice(0, 10) : null, guessed = false
    if (invoiceName) {
      const { data: m } = await sb.from('incoming_missions').select('incident_address, vehicle_location, created_at').or(`invoice_number.eq.${invoiceName}${inv[0] ? `,invoice_odoo_id.eq.${inv[0].id}` : ''}`).limit(1)
      if (m?.[0]) { place = m[0].incident_address || m[0].vehicle_location || null; idate = String(m[0].created_at).slice(0, 10) }
    }
    if (!place && plate) {
      const { data: m } = await sb.from('incoming_missions').select('incident_address, vehicle_location, created_at').ilike('vehicle_plate', `%${plate}%`).lte('created_at', `${p.date}T23:59:59`).order('created_at', { ascending: false }).limit(1)
      if (m?.[0]) { place = m[0].incident_address || m[0].vehicle_location || null; idate = String(m[0].created_at).slice(0, 10); guessed = true }
    }
    await sb.from('cash_handover_items').insert({
      odoo_payment_id: p.id, journal: isChau ? 'CHAU1' : 'DEP1', payment_name: p.name, payment_date: p.date, amount: p.amount,
      invoice: invoiceName || null, client: p.partner_id?.[1] || null, holder_user_id: holder?.id || null, holder_label: holder ? holder.name.split(/\s+-\s+|\s*\(/)[0].trim() : 'à confirmer',
      vehicle, place, intervention_date: idate, place_guessed: guessed, status: 'pending',
    })
    added++
  }
  return { total: pays.length, added, closed }
}
