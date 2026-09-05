// src/app/api/caisse/ecran/route.ts
//
// Écran client face-comptoir.
//   GET  ?key=…                         → état courant de l'écran (public : la
//                                          tablette kiosque le lit sans login).
//   POST { action:'push', key, … }      → affiche une facture (montant + détail
//                                          + 2 QR SumUp/SEPA), TTL 2 min.
//        { action:'clear', key }         → repos.
//        { action:'eid', key, request_id } → mode « lecture carte eID / création
//                                          client » (consentement), TTL 5 min.
//        { action:'eid_submit', key, request_id, data } → PUBLIC : renvoi du
//                                          client (Nom/Prénom/Adresse + email/tél)
//                                          → écrit dans response/response_at.
//   POST push/eid renvoient { occupied, occupant } si l'écran affiche déjà
//   quelqu'un (sauf force:true) → garde-fou anti-écrasement. Olivier 2026-07-28.

import { NextResponse }        from 'next/server'
import { getServerSession }    from 'next-auth'
import { authOptions }         from '@/lib/auth'
import { createAdminClient }   from '@/lib/supabase'
import { createCheckout }      from '@/lib/sumup'
import { buildEpcQrPayload, bankConfigFromEnv } from '@/lib/payments/epc-qr'
import { checkVat }             from '@/lib/vies'
import { odooRpc }             from '@/lib/odoo'
import { armExitControlFromVisit } from '@/lib/missions/exit-control'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const TTL_MIN = 2
const sumupQrFor = (checkoutUrl: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=${encodeURIComponent(checkoutUrl)}`

// Résout le montant TVAC à afficher + le détail des lignes pour une mission,
// à partir de son id. Priorité : facture Odoo détectée → brouillon de lignes
// préparé → CA HTVA figé au to_invoice → tarif spécial → montant à encaisser.
// Renvoie aussi les métas véhicule/client. Olivier 2026-07-28.
// Appelle en interne l'endpoint price-estimate (même calcul que la modale :
// SNC + gardiennage, tarif spécial, tarifs source). Renvoie total HTVA + détail.
async function fetchLiveEstimate(origin: string, missionId: string) {
  try {
    const r = await fetch(`${origin}/api/missions/${missionId}/price-estimate`, {
      headers: { 'x-internal-secret': process.env.NEXTAUTH_SECRET || '' },
      cache: 'no-store',
    })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

async function resolveMissionBilling(sb: any, missionId: string, origin: string) {
  const { data: m } = await sb.from('incoming_missions')
    .select('mission_number, dossier_number, external_id, vehicle_plate, vehicle_brand, vehicle_model, client_name, estimated_htva, special_tarif_htva, amount_to_collect, odoo_quote_id, invoice_odoo_id')
    .eq('id', missionId).maybeSingle()
  if (!m) return null

  const meta = {
    client:    m.client_name || null,
    plate:     m.vehicle_plate || null,
    brand:     m.vehicle_brand || null,
    model:     m.vehicle_model || null,
    reference: m.mission_number != null ? String(m.mission_number) : (m.external_id || m.dossier_number || null),
  }
  let amount = 0
  let lines: { label: string; amount: number }[] = []

  // 1) Facture Odoo détectée → montant total (TVAC) + lignes (sous-total HTVA).
  try {
    if (m.odoo_quote_id || m.invoice_odoo_id) {
      const moveIds = new Set<number>()
      if (m.odoo_quote_id) {
        const orders = await odooRpc<any[]>('sale.order', 'read', [[m.odoo_quote_id]], { fields: ['invoice_ids'] })
        for (const id of (orders?.[0]?.invoice_ids || [])) moveIds.add(Number(id))
      }
      if (m.invoice_odoo_id) moveIds.add(Number(m.invoice_odoo_id))
      if (moveIds.size) {
        const moves = await odooRpc<any[]>('account.move', 'read', [[...moveIds]], { fields: ['move_type', 'state', 'amount_total', 'invoice_line_ids'] })
        const kept = (moves || []).filter(x => x.move_type === 'out_invoice' && x.state !== 'cancel')
        const inv = kept[kept.length - 1]
        if (inv && Number(inv.amount_total) > 0) {
          amount = Math.round(Number(inv.amount_total) * 100) / 100
          const lids = (inv.invoice_line_ids || []).map(Number)
          if (lids.length) {
            const rows = await odooRpc<any[]>('account.move.line', 'read', [[...lids]], { fields: ['name', 'price_subtotal', 'display_type'] })
            lines = (rows || [])
              .filter((l: any) => l.display_type !== 'line_section' && l.display_type !== 'line_note')
              .map((l: any) => ({ label: String(l.name || '').replace(/^\[[^\]]*\]\s*/, '').replace(/\s*\n+\s*/g, ' — ').trim(), amount: Math.round(Number(l.price_subtotal || 0) * 100) / 100 }))
          }
        }
      }
    }
  } catch { /* Odoo indispo → on retombe sur le brouillon / le figé */ }

  // 2) Pas de facture → brouillon de lignes préparé dans la modale.
  if (amount <= 0) {
    const { data: draft } = await sb.from('mission_invoice_drafts').select('lines').eq('mission_id', missionId).maybeSingle()
    const dl: any[] = Array.isArray(draft?.lines) ? draft.lines : []
    const htva = dl.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price_unit) || 0), 0)
    if (htva > 0) {
      amount = Math.round(htva * 1.21 * 100) / 100
      lines = dl
        .filter(l => (Number(l.qty) || 0) * (Number(l.price_unit) || 0) !== 0)
        .map(l => ({ label: String(l.name || l.kind || ''), amount: Math.round((Number(l.qty) || 0) * (Number(l.price_unit) || 0) * 1.21 * 100) / 100 }))
    }
  }

  // 3) Calcul live (même endpoint que la modale) : gère SNC/gardiennage, tarif
  //    spécial, montant à réclamer, tarifs source. total_eur = HTVA → ×1,21.
  if (amount <= 0) {
    const est = await fetchLiveEstimate(origin, missionId)
    if (est?.ok && Number(est.total_eur) > 0) {
      amount = Math.round(Number(est.total_eur) * 1.21 * 100) / 100
      lines = (Array.isArray(est.breakdown) ? est.breakdown : [])
        .filter((b: any) => typeof b.amount === 'number' && b.amount)
        .map((b: any) => ({ label: String(b.label || ''), amount: Math.round(Number(b.amount) * 1.21 * 100) / 100 }))
    }
  }

  // 4) CA HTVA figé au to_invoice.  5) Tarif spécial.  6) Montant à encaisser (déjà TVAC).
  if (amount <= 0 && Number(m.estimated_htva)     > 0) amount = Math.round(Number(m.estimated_htva)     * 1.21 * 100) / 100
  if (amount <= 0 && Number(m.special_tarif_htva) > 0) amount = Math.round(Number(m.special_tarif_htva) * 1.21 * 100) / 100
  if (amount <= 0 && Number(m.amount_to_collect)  > 0) amount = Math.round(Number(m.amount_to_collect)  * 100) / 100

  return { ...meta, amount, lines }
}

// ── GET : état de l'écran (public) ──────────────────────────────────────────
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key') || 'facturation'
  const sb = createAdminClient()
  const { data } = await sb.from('customer_display').select('payload, expires_at, label, response, response_at').eq('key', key).maybeSingle()
  const expired = data?.expires_at ? new Date(data.expires_at).getTime() < Date.now() : true
  return NextResponse.json({
    key,
    label:   data?.label || null,
    payload: (data?.payload && !expired) ? data.payload : null,
    expires_at: expired ? null : data?.expires_at || null,
    // Canal retour eID : la fiche opérateur lit ici les données renvoyées par le client.
    response:    data?.response || null,
    response_at: data?.response_at || null,
  })
}

// ── POST : push / clear / eid (session requise) — eid_submit PUBLIC (kiosque) ─
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const key = String(body.key || 'facturation')
  const sb = createAdminClient()
  const now = Date.now()

  // ── eid_submit : RENVOI du client depuis le kiosque (PUBLIC, pas de session) ─
  // Le client n'est pas authentifié : on n'accepte l'écriture QUE si l'écran est
  // bien en mode eID avec le request_id attendu et non expiré (corrélation forte).
  if (body.action === 'eid_submit') {
    const reqId = String(body.request_id || '')
    const { data: cur } = await sb.from('customer_display')
      .select('payload, expires_at').eq('key', key).maybeSingle()
    const p: any = cur?.payload || null
    const live = cur?.expires_at && new Date(cur.expires_at).getTime() > now
    if (!p || p.mode !== 'eid' || !live || !reqId || p.request_id !== reqId) {
      return NextResponse.json({ error: 'Aucune demande eID active pour cet écran.' }, { status: 409 })
    }
    const d = (body.data && typeof body.data === 'object') ? body.data : {}
    const response = {
      request_id: reqId,
      lastName:  d.lastName  ? String(d.lastName).slice(0, 120)  : null,
      firstName: d.firstName ? String(d.firstName).slice(0, 120) : null,
      street:    d.street    ? String(d.street).slice(0, 200)    : null,
      zip:       d.zip       ? String(d.zip).slice(0, 20)        : null,
      city:      d.city      ? String(d.city).slice(0, 120)      : null,
      country:   d.country   ? String(d.country).slice(0, 80)    : null,
      nationalNumber: d.nationalNumber ? String(d.nationalNumber).slice(0, 40) : null,
      birthDate: d.birthDate ? String(d.birthDate).slice(0, 40)  : null,
      email:     d.email     ? String(d.email).slice(0, 160)     : null,
      phone:     d.phone     ? String(d.phone).slice(0, 40)      : null,
    }
    // Réponse enregistrée + écran passe en « merci » (bref) puis retombe au repos.
    await sb.from('customer_display').update({
      payload: { mode: 'eid', request_id: reqId, step: 'done' },
      expires_at: new Date(now + 10_000).toISOString(),
      response,
      response_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('key', key)
    return NextResponse.json({ ok: true })
  }

  // ── manual_submit : RENVOI des coordonnées saisies au comptoir (PUBLIC) ──────
  // Comme eid_submit : accepté seulement si l'écran est en mode manual avec le bon
  // request_id non expiré. Le pays est renvoyé avec son code ISO (autocomplete).
  if (body.action === 'manual_submit') {
    const reqId = String(body.request_id || '')
    const { data: cur } = await sb.from('customer_display')
      .select('payload, expires_at').eq('key', key).maybeSingle()
    const p: any = cur?.payload || null
    const live = cur?.expires_at && new Date(cur.expires_at).getTime() > now
    if (!p || p.mode !== 'manual' || !live || !reqId || p.request_id !== reqId) {
      return NextResponse.json({ error: 'Aucune demande d\'info active pour cet écran.' }, { status: 409 })
    }
    const d = (body.data && typeof body.data === 'object') ? body.data : {}
    const response = {
      request_id:  reqId,
      name:        d.name    ? String(d.name).slice(0, 200)    : null,
      street:      d.street  ? String(d.street).slice(0, 200)  : null,
      zip:         d.zip     ? String(d.zip).slice(0, 20)      : null,
      city:        d.city    ? String(d.city).slice(0, 120)    : null,
      country:     d.country ? String(d.country).slice(0, 80)  : null,
      countryCode: d.countryCode ? String(d.countryCode).slice(0, 4).toUpperCase() : null,
      email:       d.email   ? String(d.email).slice(0, 160)   : null,
      phone:       d.phone   ? String(d.phone).slice(0, 40)    : null,
      vat:         d.vat     ? String(d.vat).slice(0, 32).toUpperCase() : null,
      isCompany:   !!d.isCompany,
      manual:      true,
    }
    await sb.from('customer_display').update({
      payload: { mode: 'manual', request_id: reqId, step: 'done' },
      expires_at: new Date(now + 10_000).toISOString(),
      response, response_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('key', key)
    return NextResponse.json({ ok: true })
  }

  // ── vies : recherche TVA depuis le kiosque (PUBLIC) ─────────────────────────
  // Le client professionnel au comptoir tape son n° de TVA → on interroge VIES.
  // Accepté seulement si l'écran est en mode manual actif (corrélation forte).
  if (body.action === 'vies') {
    const reqId = String(body.request_id || '')
    const vat   = String(body.vat || '').trim()
    if (!vat) return NextResponse.json({ valid: false, error: 'TVA manquante' }, { status: 400 })
    const { data: cur } = await sb.from('customer_display')
      .select('payload, expires_at').eq('key', key).maybeSingle()
    const p: any = cur?.payload || null
    const live = cur?.expires_at && new Date(cur.expires_at).getTime() > now
    if (!p || p.mode !== 'manual' || !live || !reqId || p.request_id !== reqId) {
      return NextResponse.json({ valid: false, error: 'Aucune demande active.' }, { status: 409 })
    }
    const result = await checkVat(vat)
    return NextResponse.json(result)
  }

  // ── visitor_submit : RENVOI du visiteur depuis le kiosque (PUBLIC) ──────────
  // Mode « registre de visite » (véhicule en parc). Comme eid_submit : on
  // n'accepte l'écriture que si l'écran est bien en mode visitor avec le bon
  // request_id non expiré. La visite est INSÉRÉE côté serveur dans
  // mission_visitors (mission_id mémorisé dans le payload à l'ouverture).
  if (body.action === 'visitor_submit') {
    const reqId = String(body.request_id || '')
    const { data: cur } = await sb.from('customer_display')
      .select('payload, expires_at').eq('key', key).maybeSingle()
    const p: any = cur?.payload || null
    const live = cur?.expires_at && new Date(cur.expires_at).getTime() > now
    if (!p || p.mode !== 'visitor' || !live || !reqId || p.request_id !== reqId) {
      return NextResponse.json({ error: 'Aucune demande de visite active pour cet écran.' }, { status: 409 })
    }
    const d = (body.data && typeof body.data === 'object') ? body.data : {}
    const lastName  = d.lastName  ? String(d.lastName).slice(0, 120)  : null
    const firstName = d.firstName ? String(d.firstName).slice(0, 120) : null
    const motifs    = Array.isArray(d.motifs) ? d.motifs.map((m: any) => String(m).trim()).filter(Boolean).slice(0, 12) : []
    if ((!lastName && !firstName) || !motifs.length) {
      return NextResponse.json({ error: 'Nom/prénom et motif requis.' }, { status: 400 })
    }
    const response = {
      request_id: reqId, lastName, firstName,
      birthDate: d.birthDate ? String(d.birthDate).slice(0, 40) : null,
      nationalNumber: d.nationalNumber ? String(d.nationalNumber).slice(0, 40) : null,
      motifs, expert_bureau: d.expert_bureau ? String(d.expert_bureau).slice(0, 160) : null,
      note: d.note ? String(d.note).slice(0, 500) : null,
    }
    // Insertion de la visite (source eID). mission_id vient du payload d'ouverture.
    if (p.mission_id) {
      const { data: visitRow } = await sb.from('mission_visitors').insert({
        mission_id: p.mission_id, visited_at: new Date().toISOString(),
        last_name: lastName, first_name: firstName, birth_date: response.birthDate,
        motifs, expert_bureau: response.expert_bureau, note: response.note,
        national_number: response.nationalNumber, source: 'eid', created_by: p.opened_by || null,
      }).select('id, visited_at, first_name, last_name, motifs, expert_bureau').maybeSingle()
      // Passage d'un expert sur une épave Police – Accident → contrôle de sortie. 2026-09-05.
      if (visitRow) await armExitControlFromVisit(sb, p.mission_id, visitRow).catch(() => {})
      await sb.from('mission_logs').insert({
        mission_id: p.mission_id, action: 'visitor',
        notes: `Visite : ${[firstName, lastName].filter(Boolean).join(' ')} — ${motifs.join(', ')}${response.expert_bureau ? ` (${response.expert_bureau})` : ''} [eid]`,
        metadata: { motifs, expert_bureau: response.expert_bureau, source: 'eid' },
      }).then(() => {}, () => {})
    }
    await sb.from('customer_display').update({
      payload: { mode: 'visitor', request_id: reqId, step: 'done' },
      expires_at: new Date(now + 10_000).toISOString(),
      response, response_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('key', key)
    return NextResponse.json({ ok: true })
  }

  // ── Toutes les autres actions : session requise (OU appel interne) ──────────
  const isInternal = !!process.env.NEXTAUTH_SECRET && req.headers.get('x-internal-secret') === process.env.NEXTAUTH_SECRET
  const session = isInternal ? null : await getServerSession(authOptions)
  const user = (session?.user as any) || {}
  // Rôles : vérifier role (singulier) ET roles[] (array) — les 2 coexistent.
  const roles: string[] = [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])].filter(Boolean)
  const modules: string[] = user?.modules || []
  // 'dispatcher' autorisé aussi (crée des missions/clients au comptoir).
  const ok = isInternal || roles.some(r => ['admin', 'superadmin', 'dispatcher'].includes(r))
    || modules.includes('facturation') || modules.includes('encaissement') || modules.includes('encaissements')
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (body.action === 'clear') {
    await sb.from('customer_display').upsert(
      { key, payload: null, expires_at: null, response: null, response_at: null, updated_at: new Date().toISOString(), updated_by: user.id || null },
      { onConflict: 'key' },
    )
    return NextResponse.json({ ok: true })
  }

  // ── eid : COMMANDE « lire une carte d'identité » depuis la fiche opérateur ──
  // Affiche l'écran de consentement eID. request_id corrèle la réponse à venir.
  if (body.action === 'eid') {
    const reqId = String(body.request_id || '').slice(0, 80) || `eid-${now}`
    // Garde-fou anti-écrasement (comme push) : écran déjà occupé et pas de force.
    if (!body.force) {
      const { data: cur } = await sb.from('customer_display').select('payload, expires_at').eq('key', key).maybeSingle()
      const active = cur?.payload && cur.expires_at && new Date(cur.expires_at).getTime() > now
      if (active) {
        const occ: any = cur!.payload
        return NextResponse.json({ occupied: true, occupant: { client: occ.client || null, plate: occ.plate || null, mode: occ.mode || 'facture' } }, { status: 409 })
      }
    }
    // TTL plus long (le client lit/saisit) : 5 min. On efface toute réponse précédente.
    const expires_at = new Date(now + 5 * 60_000).toISOString()
    await sb.from('customer_display').upsert(
      { key, payload: { mode: 'eid', request_id: reqId, step: 'consent' }, expires_at, response: null, response_at: null, updated_at: new Date().toISOString(), updated_by: user.id || null },
      { onConflict: 'key' },
    )
    return NextResponse.json({ ok: true, request_id: reqId, expires_at })
  }

  // ── manual : COMMANDE « saisie manuelle des coordonnées » depuis la fiche ─────
  // Affiche sur l'écran comptoir un formulaire de coordonnées (nom, adresse avec
  // autocomplete, email, tél) + choix de langue. request_id corrèle la réponse.
  if (body.action === 'manual') {
    const reqId = String(body.request_id || '').slice(0, 80) || `man-${now}`
    if (!body.force) {
      const { data: cur } = await sb.from('customer_display').select('payload, expires_at').eq('key', key).maybeSingle()
      const active = cur?.payload && cur.expires_at && new Date(cur.expires_at).getTime() > now
      if (active) {
        const occ: any = cur!.payload
        return NextResponse.json({ occupied: true, occupant: { client: occ.client || null, plate: occ.plate || null, mode: occ.mode || 'facture' } }, { status: 409 })
      }
    }
    const expires_at = new Date(now + 5 * 60_000).toISOString()
    await sb.from('customer_display').upsert(
      { key, payload: { mode: 'manual', request_id: reqId, step: 'form' }, expires_at, response: null, response_at: null, updated_at: new Date().toISOString(), updated_by: user.id || null },
      { onConflict: 'key' },
    )
    return NextResponse.json({ ok: true, request_id: reqId, expires_at })
  }

  // ── visitor : COMMANDE « registre de visite » depuis la fiche véhicule en parc ─
  // Affiche l'écran de consentement + lecture carte + choix du/des motif(s).
  // On embarque dans le payload les catalogues actifs (motifs + bureaux) car le
  // kiosque est public et n'interroge pas la config. mission_id → insertion à la
  // validation (visitor_submit).
  if (body.action === 'visitor') {
    if (!body.mission_id) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })
    const reqId = String(body.request_id || '').slice(0, 80) || `vis-${now}`
    if (!body.force) {
      const { data: cur } = await sb.from('customer_display').select('payload, expires_at').eq('key', key).maybeSingle()
      const active = cur?.payload && cur.expires_at && new Date(cur.expires_at).getTime() > now
      if (active) {
        const occ: any = cur!.payload
        return NextResponse.json({ occupied: true, occupant: { client: occ.client || null, plate: occ.plate || null, mode: occ.mode || 'facture' } }, { status: 409 })
      }
    }
    const [motifsRes, bureauxRes] = await Promise.all([
      sb.from('visitor_motifs').select('label, is_expert').eq('active', true).order('sort_order').order('label'),
      sb.from('expertise_bureaus').select('name').eq('active', true).order('sort_order').order('name'),
    ])
    const motifs  = (motifsRes.data  || []).map((m: any) => ({ label: m.label, is_expert: !!m.is_expert }))
    const bureaux = (bureauxRes.data || []).map((b: any) => b.name)
    const expires_at = new Date(now + 5 * 60_000).toISOString()
    await sb.from('customer_display').upsert(
      { key, payload: { mode: 'visitor', request_id: reqId, step: 'consent', mission_id: String(body.mission_id), plate: body.plate || null, opened_by: user.id || null, motifs, bureaux }, expires_at, response: null, response_at: null, updated_at: new Date().toISOString(), updated_by: user.id || null },
      { onConflict: 'key' },
    )
    return NextResponse.json({ ok: true, request_id: reqId, expires_at })
  }

  // action = 'push'
  // Card facturation : seul le mission_id est fourni → on résout montant + lignes
  // + métas côté serveur. Modale : amount + lines déjà calculés (prioritaires).
  const origin = new URL(req.url).origin
  const resolved = body.mission_id ? await resolveMissionBilling(sb, String(body.mission_id), origin) : null

  const amount = Math.round((Number(body.amount) > 0 ? Number(body.amount) : Number(resolved?.amount || 0)) * 100) / 100
  if (!amount || amount <= 0) return NextResponse.json({ error: 'Montant à facturer indisponible sur cette fiche.' }, { status: 400 })

  const client = body.client ?? resolved?.client ?? null
  const plate  = body.plate  ?? resolved?.plate  ?? null
  const brand  = body.brand  ?? resolved?.brand  ?? null
  const model  = body.model  ?? resolved?.model  ?? null
  const lines  = (Array.isArray(body.lines) && body.lines.length) ? body.lines : (resolved?.lines || [])

  // Garde-fou : écran déjà occupé (payload non expiré) et pas de force.
  if (!body.force) {
    const { data: cur } = await sb.from('customer_display').select('payload, expires_at').eq('key', key).maybeSingle()
    const active = cur?.payload && cur.expires_at && new Date(cur.expires_at).getTime() > now
    if (active) {
      return NextResponse.json({ occupied: true, occupant: { client: cur!.payload.client, plate: cur!.payload.plate } }, { status: 409 })
    }
  }

  // Référence de paiement (SumUp + virement). Par défaut = n° de mission + plaque.
  // paymentRef explicite (ex. n° de facture Odoo pour réconciliation) → verbatim.
  const refBase   = String(body.reference || body.mission_number || resolved?.reference || '').trim()
  const plateRef  = String(plate || '').trim()
  const reference = body.paymentRef
    ? String(body.paymentRef).slice(0, 100)
    : ([refBase, plateRef].filter(Boolean).join(' ') || 'VD Soft').slice(0, 100)
  const label = [brand, model].filter(Boolean).join(' ')

  // 1) Checkout SumUp (QR carte, montant pré-rempli). Best-effort.
  let sumupQrUrl: string | null = null, sumupCheckoutId: string | null = null
  try {
    const co = await createCheckout({ amount, reference, description: `${label} ${plate || ''}`.trim() || reference })
    if (co?.checkoutUrl) { sumupQrUrl = sumupQrFor(co.checkoutUrl); sumupCheckoutId = co.id || null }
  } catch (e) { /* SumUp indispo → on affiche quand même le virement */ }

  // 2) QR virement SEPA/EPC (montant + communication).
  let epcPayload: string | null = null
  try {
    const bank = bankConfigFromEnv()
    if (bank) epcPayload = buildEpcQrPayload({ name: bank.name, iban: bank.iban, bic: bank.bic, amount, remittance: reference })
  } catch (e) { /* ignore */ }

  // amountTotal : total TVAC de la facture (affiché en petit) quand le montant
  // poussé est un SOLDE après paiement partiel. Optionnel.
  const amountTotal = Number(body.amountTotal) > 0 ? Math.round(Number(body.amountTotal) * 100) / 100 : null
  const payload = {
    client, plate, brand, model,
    reference,
    amount,                                   // solde à payer (TVAC) → QR
    amountTotal,                              // total TVAC (petit) si paiement partiel
    lines,
    sumupQrUrl, sumupCheckoutId, epcPayload,
  }
  const expires_at = new Date(now + TTL_MIN * 60_000).toISOString()
  await sb.from('customer_display').upsert(
    { key, payload, expires_at, updated_at: new Date().toISOString(), updated_by: user.id || null },
    { onConflict: 'key' },
  )
  return NextResponse.json({ ok: true, expires_at })
}
