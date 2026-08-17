// src/app/api/odoo/create-client/route.ts

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { odooRpc, withOdooActor, getCountryId } from '@/lib/odoo'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actorId = (session.user as any).id as string | undefined

  // Note : 'mobile' a ete retire de res.partner en Odoo 19 (Olivier 2026-05-25).
  // On accepte encore mobile dans le body (compat retro frontend) mais on le
  // concatene a phone si phone vide pour ne pas perdre l info.
  const { name, phone, mobile, street, city, zip, email, vat, is_company, countryCode } = await req.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Nom requis' }, { status: 400 })
  }

  return withOdooActor(actorId, async () => {
    try {
      const vals: Record<string, any> = {
        name:       name.trim(),
        is_company: !!is_company,
        customer_rank: 1,
      }
      const effectivePhone = (phone?.trim() || mobile?.trim() || '').trim()
      if (effectivePhone) vals.phone = effectivePhone
      if (street) vals.street = street.trim()
      if (city)   vals.city   = city.trim()
      if (zip)    vals.zip    = zip.trim()
      if (email)  vals.email  = email.trim()
      if (vat)    vals.vat    = vat.trim()
      // Pays : code ISO → id Odoo (défaut Belgique). Vient de l'autocomplete comptoir.
      if (countryCode && String(countryCode).trim()) {
        vals.country_id = await getCountryId(String(countryCode).trim())
      }

      const partnerId = await odooRpc<number>('res.partner', 'create', [vals])

      const [partner] = await odooRpc<any[]>('res.partner', 'read', [[partnerId]], {
        fields: ['id', 'name', 'phone', 'street', 'city', 'zip', 'email', 'vat', 'country_id']
      })

      return NextResponse.json({ ok: true, partner })
    } catch (err: any) {
      console.error('[Odoo create-client]', err.message)
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
  })
}
