// GET /api/journal-mobi/pdf?mois=AAAA-MM — document mensuel A4 du journal des tâches de Mobi (Olivier seul).
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { peutBasculer } from '@/lib/facturation/suspension'
import { lireMois } from '@/lib/journal-mobi'
import { pdfJournalMois } from '@/lib/journal-mobi/pdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const uid = (session?.user as any)?.id
  if (!uid || !(await peutBasculer(uid))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const mois = new URL(req.url).searchParams.get('mois') || ''
  if (!/^\d{4}-\d{2}$/.test(mois)) return NextResponse.json({ error: 'mois=AAAA-MM' }, { status: 400 })
  const pdf = await pdfJournalMois(await lireMois(createAdminClient(), mois))
  return new NextResponse(pdf as any, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="journal-taches-mobi-${mois}.pdf"` } })
}
