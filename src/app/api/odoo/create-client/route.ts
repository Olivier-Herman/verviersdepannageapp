// src/app/api/odoo/create-client/route.ts

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { odooRpc, withOdooActor, findOrCreatePartner } from '@/lib/odoo'

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
      // Idempotent : retrouve le partner existant (par TVA / e-mail / tél / nom)
      // et complète ses champs manquants, sinon le crée. Évite les doublons Odoo.
      const effectivePhone = (phone?.trim() || mobile?.trim() || '').trim()
      const partnerId = await findOrCreatePartner({
        name:        name.trim(),
        phone:       effectivePhone || undefined,
        email:       email?.trim()  || undefined,
        vat:         vat?.trim()    || undefined,
        street:      street?.trim() || undefined,
        zip:         zip?.trim()    || undefined,
        city:        city?.trim()   || undefined,
        countryCode: (countryCode && String(countryCode).trim()) || undefined,
      })

      // Marquer société si demandé explicitement (le pro coche au comptoir).
      if (is_company) {
        await odooRpc('res.partner', 'write', [[partnerId], { company_type: 'company' }]).catch(() => {})
      }

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
