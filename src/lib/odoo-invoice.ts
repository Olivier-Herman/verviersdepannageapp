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
export function buildInvoiceUrl(id: number, _moveType?: string): string {
  // Format universel qui fonctionne en Odoo 17/18/19 (legacy web client)
  return `${ODOO_URL}/web#id=${id}&model=account.move&view_type=form`
}
