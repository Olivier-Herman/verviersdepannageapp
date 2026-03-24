import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendCheckVehiculeNonConformeReport } from '@/lib/emails'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()

  const { data: userData } = await supabase
    .from('users').select('id, name').eq('email', session.user.email).single()
  if (!userData) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  const { data: check } = await supabase
    .from('vehicle_checks')
    .select('id, status, claimed_by, vehicle:check_vehicles(name, plate)')
    .eq('id', params.id)
    .single()

  if (!check)                          return NextResponse.json({ error: 'Contrôle introuvable' },                      { status: 404 })
  if (check.status !== 'in_progress')  return NextResponse.json({ error: 'Statut invalide' },                           { status: 400 })
  if (check.claimed_by !== userData.id) return NextResponse.json({ error: 'Vous n\'êtes pas responsable de ce contrôle' }, { status: 403 })

  const { results, photos, notes } = await req.json()
  if (!results || !Array.isArray(results)) {
    return NextResponse.json({ error: 'Résultats manquants' }, { status: 400 })
  }

  const now = new Date().toISOString()

  const { data: updated, error } = await supabase
    .from('vehicle_checks')
    .update({
      status:       'completed',
      results,
      photos:       photos || [],
      notes:        notes  || null,
      completed_at: now,
      updated_at:   now,
    })
    .eq('id', params.id)
    .select('*, vehicle:check_vehicles(id, name, plate)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Envoi email si au moins un non-conforme
  const nonConformes = results.filter((r: any) => r.ok === false)
  if (nonConformes.length > 0) {
    try {
      const vehicle = (check as any).vehicle
      await sendCheckVehiculeNonConformeReport({
        vehicleName:  vehicle?.name  || 'Véhicule inconnu',
        vehiclePlate: vehicle?.plate || '—',
        checkedBy:    userData.name,
        checkedAt:    new Date(now).toLocaleDateString('fr-BE', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        }),
        results,
        notes:    notes  || undefined,
        checkId:  params.id,
      })
    } catch (emailErr) {
      // On ne bloque pas la complétion si l'email échoue
      console.error('[Check] Email non-conforme error:', emailErr)
    }
  }

  return NextResponse.json({ check: updated })
}
