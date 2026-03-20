import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { checkVat } from '@/lib/vies'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const vat = req.nextUrl.searchParams.get('vat')
  if (!vat) return NextResponse.json({ error: 'Paramètre vat manquant' }, { status: 400 })

  const result = await checkVat(vat)
  return NextResponse.json(result)
}
