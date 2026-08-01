// src/app/api/paie/mine/route.ts
//
// Fiches de paie de l'utilisateur connecté (accès perso). Résout la ou les
// fiche(s) « personnel » liée(s) à son compte, puis ses bulletins.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()

  const { data: persons } = await sb.from('personnel')
    .select('id, name, company_code, adresse, code_postal, ville, etat_civil, personnes_charge, iban, phone, email, contact_urgence_nom, contact_urgence_tel')
    .eq('user_id', u.id)
  const persIds = (persons || []).map((p: any) => p.id)
  if (!persIds.length) return NextResponse.json({ payslips: [], linked: false })

  // Infos éditables par le travailleur (self-service) — prises sur la 1re fiche liée.
  const src = persons![0]
  const me = {
    adresse: src.adresse, code_postal: src.code_postal, ville: src.ville,
    etat_civil: src.etat_civil, personnes_charge: src.personnes_charge, iban: src.iban,
    phone: src.phone, email: src.email,
    contact_urgence_nom: src.contact_urgence_nom, contact_urgence_tel: src.contact_urgence_tel,
  }

  const { data: slips } = await sb.from('payslips')
    .select('id, period, company_code, worker_name, type, label, pages, vac_total, vac_used, vac_available')
    .in('personnel_id', persIds).order('period', { ascending: false })

  // Solde congés = le plus récent bulletin qui porte un compteur.
  const vsrc = (slips || []).find((s: any) => s.vac_available != null || s.vac_total != null)
  const vacation = vsrc ? { total: vsrc.vac_total, used: vsrc.vac_used, available: vsrc.vac_available, period: vsrc.period } : null

  return NextResponse.json({ payslips: slips || [], linked: true, name: persons?.[0]?.name || u.name, vacation, me })
}
