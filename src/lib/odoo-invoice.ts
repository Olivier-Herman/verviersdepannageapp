// src/lib/odoo-invoice.ts
//
// Helpers pour relier une facture Odoo a une mission de l'app.
// Utilises a la fois par l'endpoint /api/missions/[id]/invoice (resolution
// synchrone optimiste) et par le cron /api/cron/sync-invoice-urls (best-effort
// resilient).

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8')
const ODOO_API_KEY = process.env.ODOO_API_KEY!

async function rpc<T = any>(model: string, method: string, args: any[] = [], kwargs: object = {}): Promise<T> {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      id: Date.now(),
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs]
      }
    })
  })
  const data = await res.json()
  if (data.error) throw new Error(`Odoo RPC [${model}.${method}]: ${JSON.stringify(data.error)}`)
  return data.result
}

export interface ResolvedInvoice {
  id: number
  name: string
  url: string
  move_type: string
}

/**
 * Recherche dans Odoo la facture (account.move) dont le numero (`name`) correspond
 * exactement au numero saisi par l'employe facturation. Renvoie l'id Odoo et
 * l'URL directe pour ouvrir la facture dans le client web Odoo.
 *
 * Retourne null si la facture n'est pas (encore) trouvee — le cron re-essayera.
 */
export async function resolveInvoiceByNumber(invoiceNumber: string): Promise<ResolvedInvoice | null> {
  if (!invoiceNumber) return null
  const cleaned = invoiceNumber.trim()
  if (!cleaned) return null

  let results: any[]
  try {
    results = await rpc<any[]>('account.move', 'search_read',
      [[['name', '=', cleaned]]],
      { fields: ['id', 'name', 'move_type'], limit: 1 }
    )
  } catch (e: any) {
    console.error('[odoo-invoice] search_read error:', e.message)
    return null
  }

  if (!results || results.length === 0) return null
  const move = results[0]
  return {
    id:        move.id,
    name:      move.name,
    move_type: move.move_type,
    url:       buildInvoiceUrl(move.id, move.move_type),
  }
}

/** Construit l'URL interne Odoo pour une facture. Couvre les move_type courants. */
/**
 * Brouillons devenus factures : pour des ids account.move, lit nom + état dans
 * Odoo ; si la facture est validée (posted, nom ≠ '/'), écrit le numéro sur
 * les fiches et les lignes comptables qui pointent cet id. Renvoie id → numéro.
 * Olivier 08/09/2026 : « il affiche toujours un brouillon alors que la facture
 * est confirmée dans Odoo ».
 */
export async function syncDraftInvoiceNumbers(sb: any, odooIds: number[]): Promise<Record<number, string>> {
  const ids = Array.from(new Set(odooIds.filter(n => Number.isFinite(n) && n > 0)))
  const out: Record<number, string> = {}
  if (!ids.length) return out
  let moves: any[] = []
  try { moves = await rpc<any[]>('account.move', 'read', [ids], { fields: ['id', 'name', 'state', 'move_type'] }) } catch (e: any) { console.warn('[odoo-invoice] sync brouillons KO:', e?.message); return out }
  const now = new Date().toISOString()
  for (const mv of moves || []) {
    if (mv.state !== 'posted' || !mv.name || mv.name === '/') continue
    out[mv.id] = String(mv.name)
    const url = buildInvoiceUrl(mv.id, mv.move_type)
    await sb.from('incoming_missions').update({ invoice_number: mv.name, invoice_url: url, updated_at: now }).eq('invoice_odoo_id', mv.id).is('invoice_number', null).then(() => {}, () => {})
    await sb.from('mission_billed_items').update({ invoice_number: mv.name }).eq('invoice_odoo_id', mv.id).is('invoice_number', null).then(() => {}, () => {})
  }
  return out
}

/**
 * Postes d'une facture PARTIELLE classique : ils ne portent que le devis Odoo
 * (odoo_quote_id) ; quand le devis est facturé et la facture postée, on
 * ramène son numéro et son id sur les postes — sinon la Vue dossier ne voit
 * pas que le poste est réglé (HSAV6087, 09/09/2026 : « tarif introuvable »
 * alors que la facture 2026/09/148 existait).
 */
export async function syncQuoteInvoiceNumbers(sb: any, limit = 200): Promise<number> {
  const { data: items } = await sb.from('mission_billed_items').select('id, odoo_quote_id').not('odoo_quote_id', 'is', null).is('invoice_number', null).limit(limit)
  const quoteIds = Array.from(new Set((items || []).map((i: any) => Number(i.odoo_quote_id)).filter((n: number) => n > 0)))
  if (!quoteIds.length) return 0
  let orders: any[] = []
  try { orders = await rpc<any[]>('sale.order', 'read', [quoteIds], { fields: ['id', 'invoice_ids'] }) } catch (e: any) { console.warn('[odoo-invoice] sync devis KO:', e?.message); return 0 }
  const moveIds = Array.from(new Set(orders.flatMap(o => Array.isArray(o.invoice_ids) ? o.invoice_ids : [])))
  if (!moveIds.length) return 0
  let moves: any[] = []
  try { moves = await rpc<any[]>('account.move', 'read', [moveIds], { fields: ['id', 'name', 'state', 'move_type'] }) } catch { return 0 }
  const posted = new Map<number, any>(moves.filter(m => m.state === 'posted' && m.name && m.name !== '/' && m.move_type === 'out_invoice').map(m => [m.id, m]))
  let n = 0
  for (const o of orders) {
    const mv = (Array.isArray(o.invoice_ids) ? o.invoice_ids : []).map((id: number) => posted.get(id)).find(Boolean)
    if (!mv) continue
    const { count } = await sb.from('mission_billed_items').update({ invoice_number: mv.name, invoice_odoo_id: mv.id }, { count: 'exact' }).eq('odoo_quote_id', o.id).is('invoice_number', null)
    n += count || 0
  }
  return n
}

export function buildInvoiceUrl(id: number, _moveType?: string): string {
  // Format universel qui fonctionne en Odoo 17/18/19 (legacy web client)
  return `${ODOO_URL}/web#id=${id}&model=account.move&view_type=form`
}
