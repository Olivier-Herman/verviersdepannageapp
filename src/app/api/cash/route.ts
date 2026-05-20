import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import bcrypt from 'bcryptjs'

// GET /api/cash — solde caisse du chauffeur connecté
// GET /api/cash?driverId=xxx — solde d'un chauffeur (admin)
// GET /api/cash?all=true — tous les chauffeurs (admin)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const isAdmin = ['admin', 'superadmin', 'dispatcher'].includes(session.user.role)
  const all = req.nextUrl.searchParams.get('all')
  const driverId = req.nextUrl.searchParams.get('driverId')

  // Récupérer l'ID du chauffeur connecté + son mapping Odoo
  // Note : odoo_user_id requiert la migration 202605041200_cash_odoo_sync.sql appliquée.
  const { data: me } = await supabase
    .from('users').select('id, can_verify, odoo_user_id').eq('email', session.user.email).single()

  if (all && isAdmin) {
    // Tous les chauffeurs avec leur solde
    const { data: drivers } = await supabase
      .from('users')
      .select('id, name, email')
      .or('role.eq.driver,roles.cs.{driver}')
      .eq('active', true)

    const results = await Promise.all((drivers || []).map(async (driver) => {
      const { data: entries } = await supabase
        .from('cash_register')
        .select('amount, type')
        .eq('driver_id', driver.id)

      const balance = (entries || []).reduce((sum, e) => {
        if (e.type === 'encaissement') return sum + e.amount
        if (e.type === 'remise') return sum - e.amount
        if (e.type === 'reception') return sum + e.amount
        return sum
      }, 0)

      return { ...driver, balance: Math.round(balance * 100) / 100 }
    }))

    return NextResponse.json(results)
  }

  // Liste des responsables disponibles pour le transfert
  const getVerifiers = req.nextUrl.searchParams.get('verifiers')
  if (getVerifiers) {
    const { data: verifiers } = await supabase
      .from('users')
      .select('id, name, verify_pin_hash')
      .eq('can_verify', true)
      .eq('active', true)
      .order('name')

    return NextResponse.json(
      (verifiers || []).map(v => ({
        id: v.id,
        name: v.name,
        hasPin: !!v.verify_pin_hash
      }))
    )
  }
  const targetId = driverId || me?.id
  if (!targetId) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })

  const { data: entries } = await supabase
    .from('cash_register')
    .select('*, intervention:interventions(reference, plate, amount, created_at)')
    .eq('driver_id', targetId)
    .order('created_at', { ascending: false })

  // Enrichir les remises/receptions avec le nom de l autre user du transfert.
  // Le RPC transfer_cash_atomic cree 2 entries cash_register (1 remise + 1 reception)
  // depuis 1 cash_transfers row. On matche par amount + timestamp proche (<5s).
  const transferEntries = (entries || []).filter(e => e.type === 'remise' || e.type === 'reception')
  if (transferEntries.length > 0) {
    const { data: transfers } = await supabase
      .from('cash_transfers')
      .select(`
        id, sender_id, receiver_id, amount, created_at,
        sender:users!cash_transfers_sender_id_fkey(name),
        receiver:users!cash_transfers_receiver_id_fkey(name)
      `)
      .or(`sender_id.eq.${targetId},receiver_id.eq.${targetId}`)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(200)

    for (const e of transferEntries) {
      const eTs = new Date(e.created_at).getTime()
      const eAmt = Number(e.amount)
      const match = (transfers || []).find(t => {
        const tTs = new Date(t.created_at).getTime()
        if (Math.abs(tTs - eTs) > 5000) return false           // 5s de tolerance
        if (Math.abs(Number(t.amount) - eAmt) > 0.01) return false
        // remise = chauffeur est sender ; reception = chauffeur est receveur
        if (e.type === 'remise'    && t.sender_id   !== targetId) return false
        if (e.type === 'reception' && t.receiver_id !== targetId) return false
        return true
      })
      if (match) {
        const otherName = e.type === 'remise'
          ? (match.receiver as any)?.name
          : (match.sender   as any)?.name
        if (otherName) (e as any).other_user_name = otherName
      }
    }
  }

  const balance = (entries || []).reduce((sum, e) => {
    if (e.type === 'encaissement') return sum + e.amount
    if (e.type === 'reception') return sum + e.amount
    if (e.type === 'remise') return sum - e.amount
    return sum
  }, 0)

  return NextResponse.json({
    balance: Math.round(balance * 100) / 100,
    entries: entries || [],
    odoo_user_id: me?.odoo_user_id ?? null,
  })
}

// POST /api/cash — ajouter une remise + valider avec PIN
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json()
  const { action, amount, driverId, pin, notes } = body
  const supabase = createAdminClient()

  if (action === 'remise') {
    // L'ancienne action remise (transfert PIN) est obsolète depuis la Phase 3 du chantier caisse.
    // Le nouveau flow passe par /api/cash/transfer (peer-to-peer atomique avec validation push).
    return NextResponse.json(
      { error: 'Cette action est obsolète. Utilisez /api/cash/transfer.' },
      { status: 410 }
    )
  }

  if (action === 'misc_income') {
    // Réception d'un paiement divers (Rent a car, etc.) — réservé aux users liés à Odoo.
    // Crée un mouvement type='encaissement' sans intervention liée, motif libre dans notes.
    const { motif } = body
    const amt = parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })
    }
    if (!motif || !motif.trim()) {
      return NextResponse.json({ error: 'Motif requis' }, { status: 400 })
    }
    if (motif.length > 500) {
      return NextResponse.json({ error: 'Motif trop long (500 caractères max)' }, { status: 400 })
    }

    const { data: me } = await supabase
      .from('users')
      .select('id, odoo_user_id')
      .eq('email', session.user.email)
      .single()

    if (!me?.id) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
    if (!me.odoo_user_id) {
      return NextResponse.json({ error: 'Réservé aux comptes liés à Odoo' }, { status: 403 })
    }

    const { data: entry, error } = await supabase
      .from('cash_register')
      .insert({
        driver_id:       me.id,
        amount:          amt,
        type:            'encaissement',
        intervention_id: null,
        notes:           motif.trim(),
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, entry })
  }

  if (action === 'set_pin') {
    // Modifier son propre PIN
    const { newPin } = body
    if (!newPin || newPin.toString().length !== 4) {
      return NextResponse.json({ error: 'Le PIN doit être à 4 chiffres' }, { status: 400 })
    }

    const hash = await bcrypt.hash(newPin.toString(), 10)
    const { error } = await supabase
      .from('users')
      .update({ verify_pin_hash: hash })
      .eq('email', session.user.email)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
