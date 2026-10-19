// src/app/api/paiements/document/route.ts — aperçu du PDF d'une facture fournisseur, affiché dans la page
// Paiements sans téléchargement (Olivier 19/10/2026 : « visible directement à l'écran »).
// GET ?societe=<id>&move=<id> → le document principal joint à la facture dans l'ERP, servi « inline ».
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { accesPaiements }            from '@/lib/paiements/acces'
import { societe }                   from '@/lib/paiements/fournisseurs'
import { odooRpcCompany }            from '@/lib/odoo'

const message = (texte: string, status: number) => new NextResponse(
  `<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;color:#334155;display:grid;place-items:center;height:90vh;margin:0">${texte}</body>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

export async function GET(req: NextRequest) {
  const acc = await accesPaiements(await getServerSession(authOptions))
  if (!acc.lot) return message('Accès refusé.', 403)
  const sp = req.nextUrl.searchParams
  const moveId = Number(sp.get('move'))
  let C: number
  try { C = societe(Number(sp.get('societe'))).id } catch { return message('Société inconnue.', 400) }
  if (!moveId) return message('Facture inconnue.', 400)
  try {
    const [m]: any[] = await odooRpcCompany(C, 'account.move', 'read', [[moveId]], { fields: ['move_type', 'message_main_attachment_id'] })
    if (!m || !['in_invoice', 'in_refund'].includes(m.move_type)) return message('Facture inconnue.', 404)
    const docs: any[] = await odooRpcCompany(C, 'ir.attachment', 'search_read', [[['res_model', '=', 'account.move'], ['res_id', '=', moveId]]], { fields: ['id', 'name', 'mimetype'], order: 'id asc' })
    const ok = (d: any) => /pdf|image\//.test(d.mimetype || '')
    const doc = docs.find(d => d.id === m.message_main_attachment_id?.[0] && ok(d)) || docs.find(d => /pdf/.test(d.mimetype || '')) || docs.find(ok)
    if (!doc) return message('Aucun document joint à cette facture.', 404)
    const [full]: any[] = await odooRpcCompany(C, 'ir.attachment', 'read', [[doc.id]], { fields: ['datas'] })
    if (!full?.datas) return message('Document vide.', 404)
    return new NextResponse(Buffer.from(full.datas, 'base64'), { headers: {
      'Content-Type': doc.mimetype,
      'Content-Disposition': `inline; filename="${encodeURIComponent(doc.name || 'facture.pdf')}"`,
      'Cache-Control': 'private, max-age=300',
    } })
  } catch (e: any) {
    console.error('[paiements/document]', e?.message || e)
    return message('Document indisponible pour le moment, réessaie dans un instant.', 502)
  }
}
