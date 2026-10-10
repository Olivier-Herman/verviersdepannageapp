// /api/missions/[id]/paiement-client — paiement demandé dans l'app VD Assistance du client (Olivier 10/10/2026).
// Le client est connu (il a commandé depuis l'app) : pas d'assistant d'encaissement. Le chauffeur touche « Demander le
// paiement » sur la mission ; le client paie sur la page SumUp depuis son iPhone.
//   POST → crée le paiement SumUp du solde de la mission, prévient le client (notification + Dynamic Island).
//   GET  → statut ; dès que SumUp confirme, enregistre le paiement par la route d'encaissement habituelle
//          (/api/interventions : ligne d'encaissement, mission payée, prix figé, rapprochement SumUp).
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { createCheckout, getCheckoutStatus } from '@/lib/sumup'

export const dynamic = 'force-dynamic'

async function contexte(id: string) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.email) return { erreur: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, role, roles').eq('email', u.email).maybeSingle()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, assigned_to, espace_client_id, amount_to_collect, payment_amount, client_paiement, vehicle_plate, vehicle_brand, vehicle_model, incident_address, billed_to_id, billed_to_name, client_phone')
    .eq('id', id).maybeSingle()
  if (!m || !me) return { erreur: NextResponse.json({ error: 'Mission introuvable' }, { status: 404 }) }
  const bureau = [me.role, ...(me.roles || [])].some((r: string) => ['dispatcher', 'admin', 'superadmin'].includes(r))
  if (m.assigned_to !== me.id && !bureau) return { erreur: NextResponse.json({ error: 'Mission non attribuée' }, { status: 403 }) }
  if (!m.espace_client_id) return { erreur: NextResponse.json({ error: 'Cette mission n’a pas été commandée depuis VD Assistance.' }, { status: 400 }) }
  return { sb, m }
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const c = await contexte(params.id)
  if ('erreur' in c) return c.erreur
  const { sb, m } = c
  const reste = Math.round((Number(m.amount_to_collect || 0) - Number(m.payment_amount || 0)) * 100) / 100
  if (!(reste > 0)) return NextResponse.json({ error: 'Rien à encaisser sur cette mission.' }, { status: 400 })
  const { count } = await sb.from('espace_client_push').select('id', { count: 'exact', head: true }).eq('client_id', m.espace_client_id).eq('kind', 'apns')
  if (!count) return NextResponse.json({ error: 'Le client n’a pas activé l’app VD Assistance sur son iPhone : encaisse avec le terminal.' }, { status: 400 })
  try {
    const reference = `VDA${m.mission_number || ''}-${Date.now().toString(36).toUpperCase()}`
    const { id, checkoutUrl } = await createCheckout({
      amount: reste, reference,
      description: `Dépannage ${[m.vehicle_brand, m.vehicle_model, m.vehicle_plate].filter(Boolean).join(' ')}`,
      returnUrl: `${process.env.NEXT_PUBLIC_APP_URL}/assistance/paye`,
    })
    await sb.from('incoming_missions').update({ client_paiement: { checkout_id: id, url: checkoutUrl, montant: reste, reference, demande_le: new Date().toISOString() } }).eq('id', m.id)
    const { demanderPaiementClient } = await import('@/lib/espace/client-notif')
    await demanderPaiementClient(m.id, reste)
    return NextResponse.json({ ok: true, montant: reste })
  } catch (e: any) {
    console.error('[paiement client] SumUp KO', e?.message)
    return NextResponse.json({ error: 'SumUp ne répond pas : réessaie, ou encaisse avec le terminal.' }, { status: 502 })
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const c = await contexte(params.id)
  if ('erreur' in c) return c.erreur
  const { sb, m } = c
  const p = m.client_paiement as any
  if (!p?.checkout_id) return NextResponse.json({ etat: 'aucun' })
  if (p.enregistre_le) return NextResponse.json({ etat: 'paye', montant: p.montant })
  const st = await getCheckoutStatus(p.checkout_id).catch(() => null)
  if (!st || st.status === 'PENDING') return NextResponse.json({ etat: 'attente', montant: p.montant, demande_le: p.demande_le })
  if (st.status !== 'PAID') return NextResponse.json({ etat: 'echec', montant: p.montant })
  // Payé : un seul enregistrement, même si le chauffeur et le bureau regardent en même temps.
  const { data: pris } = await sb.from('incoming_missions').update({ client_paiement: { ...p, enregistre_le: new Date().toISOString(), transaction: st.transactionId || null } })
    .eq('id', m.id).filter('client_paiement->>enregistre_le', 'is', null).select('id')
  if (pris?.length) {
    const { data: cl } = await sb.from('espace_clients').select('prenom, nom, tel, adresse').eq('id', m.espace_client_id).maybeSingle()
    const r = await fetch(`${new URL(req.url).origin}/api/interventions`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') || '' },
      body: JSON.stringify({
        service_type: 'encaissement', mission_id: m.id, plate: m.vehicle_plate, brand_text: m.vehicle_brand, model_text: m.vehicle_model,
        motif_id: 'depannage', motif_text: 'Dépannage VD Assistance', location_address: m.incident_address,
        amount: p.montant, payment_mode: 'sumup', payment_reference: p.reference,
        client_id: m.billed_to_id || null, client_name: m.billed_to_name || (cl ? `${cl.prenom} ${cl.nom}` : null),
        client_phone: cl?.tel || m.client_phone || null, client_address: cl?.adresse || null,
        notes: 'Payé par le client dans l’app VD Assistance (SumUp en ligne).',
      }),
    }).catch(() => null)
    if (!r?.ok) {
      // On rend la main : le prochain contrôle réessaiera l'enregistrement.
      await sb.from('incoming_missions').update({ client_paiement: p }).eq('id', m.id)
      return NextResponse.json({ etat: 'attente', montant: p.montant, alerte: 'Paiement reçu chez SumUp, enregistrement en cours…' })
    }
  }
  return NextResponse.json({ etat: 'paye', montant: p.montant })
}
