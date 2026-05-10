// ============================================================
// GET /api/relances/invoice/[invoiceId]?token=<HMAC>
// ============================================================
// Telechargement du PDF facture Odoo via lien signe HMAC. Utilise
// par les liens cliquables dans les PDF de relance ("F2026-001"
// devient un lien qui ouvre cette route).
//
// Securite :
// - Token HMAC SHA256 verifie via verifyInvoiceToken (cf invoice-token.ts)
// - Token contient l invoice_id + timestamp d expiration (default 1 an)
// - On verifie que l invoice_id du token MATCH l id du path (sinon
//   un client pourrait recycler son token pour acceder a une autre
//   facture).
// - Pas de session NextAuth requise : le token signe authentifie suffit
//   (sinon le client externe ne peut pas telecharger la facture).
//
// Stream le PDF binaire avec Content-Disposition: inline (preview
// dans le navigateur) + Content-Type: application/pdf.

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { fetchInvoicePdfFromOdoo }   from '@/lib/relances/odoo'
import { verifyInvoiceToken }        from '@/lib/relances/invoice-token'

export async function GET(
  req: NextRequest,
  { params }: { params: { invoiceId: string } }
) {
  const idStr = params.invoiceId
  const url   = new URL(req.url)
  const token = url.searchParams.get('token') || ''

  const invoiceIdRequested = parseInt(idStr, 10)
  if (!invoiceIdRequested || isNaN(invoiceIdRequested)) {
    return NextResponse.json({ error: 'invoiceId invalide' }, { status: 400 })
  }

  const invoiceIdFromToken = verifyInvoiceToken(token)
  if (!invoiceIdFromToken) {
    return NextResponse.json(
      { error: 'Lien invalide ou expiré' },
      { status: 403 }
    )
  }
  if (invoiceIdFromToken !== invoiceIdRequested) {
    return NextResponse.json(
      { error: 'Lien ne correspond pas a la facture demandee' },
      { status: 403 }
    )
  }

  try {
    const pdfBuffer = await fetchInvoicePdfFromOdoo(invoiceIdRequested)

    // Stream le PDF avec content-disposition inline pour previewer
    // dans le navigateur (vs. attachment qui force le download).
    // On utilise Response native (pas NextResponse) car le DOM lib type
    // BodyInit accepte plus simplement le Buffer Node.js.
    return new Response(pdfBuffer as any, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Length':      String(pdfBuffer.length),
        'Content-Disposition': `inline; filename="facture-${invoiceIdRequested}.pdf"`,
        'Cache-Control':       'private, max-age=300',  // cache navigateur 5min
      },
    })
  } catch (e: any) {
    console.error(`[relances/invoice/${invoiceIdRequested}]`, e)
    return NextResponse.json(
      { error: `Impossible de récupérer la facture : ${e.message}` },
      { status: 500 }
    )
  }
}
