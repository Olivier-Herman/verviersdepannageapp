// /api/obd/calculateurs — apprentissage des calculateurs (Olivier 10/11/2026).
//   GET ?groupe=psa&vin=… → { appris: [{ tx, rx, systeme, nom }], essais: [tx] } : ce que la lecture du boîtier interroge
//   en plus des adresses connues d'office. Préversion : drapeau « obd_diagnostic ».
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { obdAccess, planCalculateurs } from '@/lib/obd/server'
import { groupeDe, type Groupe } from '@/lib/obd/calculateurs'
import { cleanVin, checkVin } from '@/lib/obd/vin'

export const dynamic = 'force-dynamic'

const GROUPES: Groupe[] = ['vag', 'ford', 'renault', 'toyota', 'hyundai', 'psa']

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!(await obdAccess(session?.user as any))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const q = new URL(req.url).searchParams
  const vin0 = q.get('vin') ? cleanVin(q.get('vin')!) : null
  const vin = vin0 && checkVin(vin0).valid ? vin0 : null
  // Le châssis fait foi sur le groupe annoncé par le téléphone.
  const groupe = (vin ? groupeDe(vin) : null) || (GROUPES.includes(q.get('groupe') as Groupe) ? q.get('groupe') as Groupe : null)
  if (!groupe) return NextResponse.json({ ok: true, appris: [], essais: [] })
  return NextResponse.json({ ok: true, ...(await planCalculateurs(groupe, vin)) })
}
