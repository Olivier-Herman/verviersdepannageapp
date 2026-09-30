import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { findPartnerMatch } from '@/lib/odoo'

// GET /api/partners?vat=BE0460759205
// GET /api/partners?phone=+32492...
// GET /api/partners?name=Herman Olivier
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const vat   = req.nextUrl.searchParams.get('vat')
  const phone = req.nextUrl.searchParams.get('phone')
  const name  = req.nextUrl.searchParams.get('name')

  try {
    // Même règle que la création de client (téléphone complet et identique, nom
    // entier, nom concordant pour un particulier) — Olivier 30/09/2026.
    const partner = (await findPartnerMatch({ vat: vat || undefined, phone: phone || undefined, name: name || undefined }))?.partner || null

    if (!partner) return NextResponse.json({ found: false })

    return NextResponse.json({
      found: true,
      partner: {
        id: partner.id,
        name: partner.name,
        vat: partner.vat || '',
        phone: partner.phone || '',
        email: partner.email || '',
        street: partner.street || '',
        zip: partner.zip || '',
        city: partner.city || '',
        countryCode: partner.country_id?.[1] || 'BE',
        address: [partner.street, partner.zip, partner.city].filter(Boolean).join(', '),
      }
    })
  } catch (err: any) {
    console.error('[Partners API]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
