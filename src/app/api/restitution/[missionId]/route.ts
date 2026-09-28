// src/app/api/restitution/[missionId]/route.ts
//
// Restitution unifiée (Olivier 28/09/2026). GET = tout ce que l'écran doit
// afficher ; POST { action } = un geste du parcours, tracé au journal de la
// fiche avec son auteur. Règles : src/lib/restitution/server.ts.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc, withOdooActor, findOrCreatePartner } from '@/lib/odoo'
import { invoiceDossierGroups } from '@/lib/dossier/invoice'
import { buildInvoiceMoveUrl } from '@/lib/odoo-quote'
import { exitParcNow } from '@/lib/parc/exit-parc'
import { releaseParcAndShift } from '@/lib/parc/release'
import { buildEncaissementUrl } from '@/lib/missions/encaissement-url'
import { getBusinessNumber } from '@/lib/settings/business'
import { sourceLabel } from '@/lib/missions/source-catalog'
import { extractJsonFromImages, ID_DOCUMENT_PROMPT } from '@/lib/ocr/vision-json'
import { sendPushToUser } from '@/lib/push'
import {
  restitutionAccess, loadMission, findAssistanceRel, approvedDerogations, computeChecks, openLegs, payerFor,
  assistancePartnerIds, userNames, logRestitution, isSaisieLike, leveeOk, defaultSplit,
  WHO_LABELS, POSTE_LABELS, PAYER_LABELS, type WhoKind, type Payer, type Poste,
} from '@/lib/restitution/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

const r2 = (n: number) => Math.round(n * 100) / 100
const WHO: WhoKind[] = ['owner', 'mandate', 'garage', 'assistance', 'transport']

async function ctxFor(sb: any, session: any, missionId: string) {
  const me = session.user as any
  const m = await loadMission(sb, missionId)
  if (!m) return { error: 'Fiche introuvable', status: 404 as const }
  const access = restitutionAccess(session, m.source)
  if (!access.ok) return { error: m.source === 'police_mg' ? 'Accès refusé' : 'Les chauffeurs restituent uniquement les mal garées.', status: 403 as const }
  const { data: rows } = await sb.from('restitutions').select('*').eq('mission_id', m.id).order('started_at', { ascending: false }).limit(1)
  const rest = rows?.[0] || null
  return { m, access, rest, me }
}

async function buildContext(sb: any, session: any, missionId: string) {
  const base = await ctxFor(sb, session, missionId)
  if ('error' in base) return base
  const { m, access, rest, me } = base
  const [{ data: meRow }, { data: resp }] = await Promise.all([
    sb.from('users').select('id, name, odoo_api_key, restitution_responsable').eq('id', me.id).maybeSingle(),
    sb.from('users').select('id, name, verify_pin_hash').eq('restitution_responsable', true).eq('active', true).order('name'),
  ])
  const open = rest?.status === 'open' ? rest : null
  const derogs = await approvedDerogations(sb, m.id, open?.id || null)
  const names = await userNames(sb, [...derogs.map(d => d.responsable_id), ...derogs.map(d => d.requested_by), rest?.started_by, rest?.completed_by])
  const rel = await findAssistanceRel(sb, m)
  const saisie = isSaisieLike(m)
  const checks = await computeChecks(sb, m, derogs, names)
  const { legs } = await openLegs(m.id, m)
  const assist = await assistancePartnerIds(sb)
  const who = (open?.who_kind || null) as WhoKind | null
  const split = (open?.split || null) as Partial<Record<Poste, Payer>> | null
  const legsOut = legs.map(l => ({ ...l, payer: payerFor(l, who, saisie, split, assist, m) }))
  const dueHtva = r2(legsOut.filter(l => l.payer === 'client').reduce((t, l) => t + (l.due_htva || 0), 0))

  // Facture de la restitution (ou déjà existante sur la fiche) : état lu dans Odoo.
  let invoice: any = null
  const invId = open?.invoice_odoo_id || null
  if (invId) {
    try {
      const [mv] = await odooRpc<any[]>('account.move', 'read', [[invId]], { fields: ['name', 'state', 'payment_state', 'amount_total', 'amount_residual'] })
      if (mv) invoice = { id: invId, name: mv.name, state: mv.state, payment_state: mv.payment_state, total: mv.amount_total, residual: mv.amount_residual, url: open?.invoice_url || buildInvoiceMoveUrl(invId) }
    } catch { invoice = { id: invId, url: open?.invoice_url || buildInvoiceMoveUrl(invId), unreadable: true } }
  }
  // Encaissement chauffeur fait depuis le début de la restitution.
  let driverCollected = 0
  if (open) {
    const { data: iv } = await sb.from('interventions').select('amount, created_at').eq('mission_id', m.id).gte('created_at', open.started_at)
    driverCollected = r2((iv || []).reduce((t: number, x: any) => t + Number(x.amount || 0), 0))
  }
  // Sorti par l'encaissement chauffeur pendant la restitution : on la clôt.
  if (open && m.status !== 'parked' && driverCollected > 0) {
    const now = new Date().toISOString()
    await sb.from('restitutions').update({ status: 'done', settlement: 'driver_cash', completed_by: open.started_by, completed_at: now, updated_at: now }).eq('id', open.id)
    await logRestitution(sb, m.id, me.id, 'done', `Véhicule restitué après l’encaissement chauffeur (${driverCollected.toFixed(2)} €).`, { settlement: 'driver_cash' })
    open.status = 'done'
  }
  // Pièce d'identité photographiée pendant cette restitution (PC ou téléphone).
  let idDoc: any = null
  if (open) {
    const { data: docs } = await sb.from('mission_documents').select('id, ocr, created_at').eq('mission_id', m.id).eq('kind', 'id_card').gte('created_at', open.started_at).order('created_at', { ascending: true })
    if (docs?.length) {
      idDoc = { count: docs.length, ocr: docs.find((d: any) => d.ocr)?.ocr || null, ids: docs.map((d: any) => d.id) }
      if (!open.id_document_id) { await sb.from('restitutions').update({ id_document_id: docs[0].id }).eq('id', open.id); open.id_document_id = docs[0].id }
    }
  }
  const { data: logs } = await sb.from('mission_logs').select('id, action, notes, created_at, actor_id').eq('mission_id', m.id).like('action', 'restitution_%').order('created_at', { ascending: false }).limit(60)
  const logNames = await userNames(sb, (logs || []).map((l: any) => l.actor_id))
  const { data: pending } = open ? await sb.from('derogation_requests').select('id, kind, reason, status, responsable_id, created_at').eq('restitution_id', open.id).eq('status', 'pending').order('created_at', { ascending: false }) : { data: [] }
  const pNames = await userNames(sb, (pending || []).map((p: any) => p.responsable_id))

  return {
    ok: true,
    mission: {
      id: m.id, number: m.mission_number, status: m.status, source: m.source, source_label: await sourceLabel(m.source),
      plate: m.vehicle_plate, brand: m.vehicle_brand, model: m.vehicle_model, zone: m.parc_zone_key, parked_at: m.parked_at || m.received_at,
      police_blocked: !!m.police_blocked, saisie, levee: leveeOk(m), temp_out: !!(m.temp_garage_out_at && !m.temp_returned_at),
    },
    mode: m.status !== 'parked' ? 'not_parked' : rel ? 'rel_assistance' : 'restitution',
    rel,
    restitution: rest ? { ...rest, started_by_name: names[rest.started_by] || null, completed_by_name: names[rest.completed_by] || null } : null,
    checks,
    legs: legsOut, due: { htva: dueHtva, tvac: r2(dueHtva * 1.21) }, splitDefault: defaultSplit(m),
    invoice, driverCollected, idDoc,
    derogations: derogs.map(d => ({ ...d, responsable_name: names[d.responsable_id] || null, requested_by_name: names[d.requested_by] || null })),
    pending: (pending || []).map((p: any) => ({ ...p, responsable_name: pNames[p.responsable_id] || null })),
    responsables: (resp || []).filter((u: any) => u.id !== me.id).map((u: any) => ({ id: u.id, name: u.name, has_pin: !!u.verify_pin_hash })),
    me: { id: me.id, name: meRow?.name || me.name, hasOdoo: !!meRow?.odoo_api_key, driverOnly: access.driverOnly },
    journal: (logs || []).map((l: any) => ({ at: l.created_at, by: logNames[l.actor_id] || null, notes: l.notes, action: l.action })),
    labels: { who: WHO_LABELS, poste: POSTE_LABELS, payer: PAYER_LABELS },
  }
}

export async function GET(_req: Request, { params }: { params: { missionId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const c = await buildContext(sb, session, params.missionId)
  if ('error' in c) return NextResponse.json({ error: c.error }, { status: c.status })
  return NextResponse.json(c)
}

export async function POST(req: Request, { params }: { params: { missionId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const base = await ctxFor(sb, session, params.missionId)
  if ('error' in base) return NextResponse.json({ error: base.error }, { status: base.status })
  const { m, me } = base
  const actor = me.id as string
  const who_name = me.name || me.email || 'utilisateur'
  const isMultipart = (req.headers.get('content-type') || '').includes('multipart/form-data')
  const form = isMultipart ? await req.formData() : null
  const body: any = isMultipart ? Object.fromEntries(Array.from(form!.entries()).filter(([, v]) => typeof v === 'string')) : await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const now = new Date().toISOString()
  const done = async () => { const c = await buildContext(sb, session, m.id); return NextResponse.json(c) }

  // Restitution ouverte (créée au premier geste).
  let rest = base.rest?.status === 'open' ? base.rest : null
  const ensure = async () => {
    if (rest) return rest
    if (m.status !== 'parked') throw new Error('Le véhicule n’est plus au parc.')
    const { data, error } = await sb.from('restitutions').insert({ mission_id: m.id, started_by: actor }).select('*').single()
    if (error) {
      const { data: again } = await sb.from('restitutions').select('*').eq('mission_id', m.id).eq('status', 'open').maybeSingle()
      if (!again) throw new Error(error.message)
      rest = again; return rest
    }
    rest = data
    await logRestitution(sb, m.id, actor, 'start', `Restitution commencée par ${who_name}.`)
    return rest
  }
  const upd = async (patch: any) => { await sb.from('restitutions').update({ ...patch, updated_at: now }).eq('id', rest!.id) }

  try {
    switch (action) {
      case 'start': { await ensure(); return done() }

      case 'who': {
        const w = String(body.who) as WhoKind
        if (!WHO.includes(w)) return NextResponse.json({ error: 'Choix inconnu' }, { status: 400 })
        await ensure(); await upd({ who_kind: w, split: null })
        await logRestitution(sb, m.id, actor, 'who', `Reprise par ${WHO_LABELS[w]}.`, { who: w })
        return done()
      }

      case 'id_photo': {
        // Recto et verso (1 à 2 photos), lues tout de suite pour pré-remplir le client.
        const files = (form?.getAll('files') || []).filter((f): f is File => f instanceof File && f.size > 0).slice(0, 2)
        const single = form?.get('file'); if (!files.length && single instanceof File && single.size) files.push(single)
        if (!files.length) return NextResponse.json({ error: 'Photo manquante' }, { status: 400 })
        await ensure()
        const images: { base64: string; mimeType: string }[] = []
        let first: string | null = null
        for (let i = 0; i < files.length; i++) {
          const f = files[i]
          const buf = Buffer.from(await f.arrayBuffer())
          const mime = f.type || 'image/jpeg'
          const path = `${m.id}/id_card/${Date.now()}_${i + 1}.${mime.includes('png') ? 'png' : 'jpg'}`
          const { error: upErr } = await sb.storage.from('mission-documents').upload(path, buf, { contentType: mime, upsert: false })
          if (upErr) return NextResponse.json({ error: `Photo non enregistrée : ${upErr.message}` }, { status: 500 })
          const { data: doc } = await sb.from('mission_documents').insert({ mission_id: m.id, kind: 'id_card', file_path: path, file_name: `piece-identite-${i === 0 ? 'recto' : 'verso'}.jpg`, mime_type: mime, file_size: buf.length, uploaded_by: actor }).select('id').single()
          if (doc && !first) first = doc.id
          if (/^image\/(jpeg|png|webp)$/.test(mime)) images.push({ base64: buf.toString('base64'), mimeType: mime })
        }
        let ocr: any = null
        try { const r = await extractJsonFromImages(images, ID_DOCUMENT_PROMPT, 'Lis cette pièce d’identité (recto et verso) et retourne uniquement le JSON.'); if (r.ok) ocr = r.data } catch {}
        if (first && ocr) await sb.from('mission_documents').update({ ocr }).eq('id', first)
        if (!rest!.id_document_id && first) await upd({ id_document_id: first })
        const who = ocr ? [ocr.firstName, ocr.lastName].filter(Boolean).join(' ') : ''
        await logRestitution(sb, m.id, actor, 'id_photo', `Pièce d’identité photographiée (${files.length === 2 ? 'recto et verso' : '1 photo'}) par ${who_name}${who ? ` : ${who}` : ', lecture incomplète'}.`, { document_id: first })
        return done()
      }

      case 'phone_photo': {
        // Depuis le PC : la notification ouvre l'appareil photo sur le téléphone de l'utilisateur.
        await ensure()
        const push = await sendPushToUser(actor, { title: 'Photo de la pièce d’identité', body: `${m.vehicle_plate || 'Véhicule'} : photographiez le recto puis le verso.`, url: `/restitution/${m.id}/piece`, tag: `restit-piece-${m.id}` }).catch(() => ({ sent: 0 }))
        await logRestitution(sb, m.id, actor, 'phone_photo', `Photo de la pièce demandée sur le téléphone de ${who_name}${push.sent ? '' : ' (notification non délivrée : ouvrez VD Soft sur le téléphone)'}.`)
        const c: any = await buildContext(sb, session, m.id)
        return NextResponse.json({ ...c, notified: push.sent > 0 })
      }

      case 'client': {
        const c = body.client || {}
        const kind = c.kind === 'pro' ? 'pro' : 'prive'
        const src = c.source === 'eid' ? 'eid' : 'manual'
        const name = kind === 'pro' ? String(c.company || '').trim() : [c.first_name, c.last_name].map((x: any) => String(x || '').trim()).filter(Boolean).join(' ')
        if (name.length < 2) return NextResponse.json({ error: kind === 'pro' ? 'Nom de la société requis (vérifiez la TVA).' : 'Nom et prénom requis.' }, { status: 400 })
        if (kind === 'pro' && !String(c.vat || '').trim()) return NextResponse.json({ error: 'Numéro de TVA requis pour un client pro.' }, { status: 400 })
        await ensure()
        if (src === 'manual' && !rest!.id_document_id) return NextResponse.json({ error: 'Photographiez d’abord la pièce d’identité.' }, { status: 400 })
        const partnerId = await withOdooActor(actor, () => findOrCreatePartner({
          name, phone: c.phone || undefined, email: c.email || undefined, vat: kind === 'pro' ? String(c.vat).replace(/\s|\./g, '').toUpperCase() : undefined,
          street: c.street || undefined, zip: c.zip || undefined, city: c.city || undefined, countryCode: c.country || 'BE',
        }))
        const client = { kind, source: src, name, first_name: c.first_name || null, last_name: c.last_name || null, company: c.company || null, vat: c.vat || null, contact: c.contact || null,
          street: c.street || null, zip: c.zip || null, city: c.city || null, country: c.country || 'BE', phone: c.phone || null, email: c.email || null,
          national_number: c.national_number || null, birth_date: c.birth_date || null }
        await upd({ client, odoo_partner_id: partnerId })
        const address = [c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
        await sb.from('incoming_missions').update({ client_name: kind === 'pro' && c.contact ? `${c.contact} (${name})` : name, client_phone: c.phone || m.client_phone, client_email: c.email || m.client_email, client_address: address || m.client_address, updated_at: now }).eq('id', m.id)
        await logRestitution(sb, m.id, actor, 'client', `Client ${kind === 'pro' ? 'pro' : 'privé'} « ${name} »${kind === 'pro' ? ` (TVA ${c.vat})` : ''} ${src === 'eid' ? 'lu sur la carte eID' : 'encodé d’après la pièce photographiée'}, fiche client n° ${partnerId}.`, { partner_id: partnerId, source: src, kind })
        return done()
      }

      case 'split': {
        const s = body.split || {}
        const clean: Record<string, Payer> = {}
        for (const p of ['dep', 'avant', 'apres'] as Poste[]) if (['client', 'parquet', 'fdj'].includes(s[p])) clean[p] = s[p]
        await ensure(); await upd({ split: clean })
        await logRestitution(sb, m.id, actor, 'split', `Qui paie quoi : ${Object.entries(clean).map(([k, v]) => `${POSTE_LABELS[k as Poste]} → ${PAYER_LABELS[v]}`).join(', ')}.`, { split: clean })
        return done()
      }

      case 'invoice': {
        await ensure()
        const { data: meRow } = await sb.from('users').select('odoo_api_key').eq('id', actor).maybeSingle()
        if (!meRow?.odoo_api_key) return NextResponse.json({ error: 'Pas d’accès Odoo : passez par l’encaissement chauffeur.' }, { status: 403 })
        if (rest!.invoice_odoo_id) return done()   // déjà créée : on la rouvre
        if (!rest!.odoo_partner_id) return NextResponse.json({ error: 'Client à identifier d’abord (étape 1).' }, { status: 400 })
        const saisie = isSaisieLike(m)
        const { legs } = await openLegs(m.id, m)
        const assist = await assistancePartnerIds(sb)
        const tagged = legs.map(l => ({ ...l, payer: payerFor(l, rest!.who_kind, saisie, rest!.split, assist, m) }))
        const clientLegs = tagged.filter(l => l.payer === 'client' && l.due_htva > 0)
        if (!clientLegs.length) return NextResponse.json({ error: 'Rien à facturer au client : le reste à payer est à 0 €.' }, { status: 409 })
        const clientName = rest!.client?.name || 'Client'
        // Les volets payés par le client passent à son nom ; ceux des frais de justice
        // au partenaire Frais de Justice (facturés ensuite par le bureau).
        for (const l of clientLegs) await sb.from('incoming_missions').update({ billed_to_id: rest!.odoo_partner_id, billed_to_name: clientName, updated_at: now }).eq('id', l.mission_id)
        const fdj = tagged.filter(l => l.payer === 'fdj')
        if (fdj.length) {
          const fdjId = await getBusinessNumber('odoo_partner_frais_justice')
          for (const l of fdj) await sb.from('incoming_missions').update({ billed_to_id: fdjId, billed_to_name: 'Frais de Justice Verviers', updated_at: now }).eq('id', l.mission_id)
        }
        const res = await withOdooActor(actor, () => invoiceDossierGroups({ anyMissionId: m.id, missionIds: clientLegs.map(l => l.mission_id), actorUserId: actor }))
        const inv = res.invoices.find(i => Number(i.client_id) === Number(rest!.odoo_partner_id)) || res.invoices[0]
        if (!inv) return NextResponse.json({ error: `Aucune facture créée. ${(res.warnings || []).join(' · ')}` }, { status: 409 })
        // Postée pour pouvoir l'encaisser tout de suite dans Odoo — sauf véhicule de
        // test (plaque TEST…) : la facture reste en brouillon, supprimable sans avoir.
        const isTest = /^TEST/i.test(String(m.vehicle_plate || ''))
        if (!isTest) await withOdooActor(actor, () => odooRpc('account.move', 'action_post', [[inv.odoo_id]])).catch((e: any) => console.warn('[restitution] action_post KO', e?.message))
        const total = r2(inv.total_htva || 0)
        await upd({ invoice_odoo_id: inv.odoo_id, invoice_url: inv.url, amount_htva: total, amount_tvac: r2(total * 1.21) })
        await logRestitution(sb, m.id, actor, 'invoice', `Montant confirmé (${total.toFixed(2)} € HTVA) et facture créée dans Odoo au nom de ${clientName} par ${who_name}${isTest ? ' (véhicule de test : facture laissée en brouillon)' : ''}.`, { invoice_odoo_id: inv.odoo_id, warnings: res.warnings, test: isTest })
        return done()
      }

      case 'check_payment': {
        await ensure()
        if (!rest!.invoice_odoo_id) return NextResponse.json({ error: 'Pas de facture à vérifier.' }, { status: 400 })
        const [mv] = await odooRpc<any[]>('account.move', 'read', [[rest!.invoice_odoo_id]], { fields: ['name', 'payment_state', 'amount_residual'] })
        const paid = mv && (['paid', 'in_payment'].includes(mv.payment_state) || Number(mv.amount_residual) <= 0.01)
        if (paid) {
          await upd({ settlement: 'paid_odoo' })
          await logRestitution(sb, m.id, actor, 'paid', `Paiement vérifié : facture ${mv.name} payée dans Odoo.`)
        }
        const c: any = await buildContext(sb, session, m.id)
        return NextResponse.json({ ...c, paymentChecked: paid ? 'paid' : `Pas encore payée (reste ${Number(mv?.amount_residual || 0).toFixed(2)} €).` })
      }

      case 'later': {
        await ensure()
        if (!['garage', 'assistance'].includes(rest!.who_kind || '')) return NextResponse.json({ error: 'Partir sans payer demande une dérogation (sauf garage ou assistance).' }, { status: 403 })
        await upd({ settlement: 'later' })
        await logRestitution(sb, m.id, actor, 'later', `Part sans payer : à facturer (${WHO_LABELS[rest!.who_kind as WhoKind]}).`)
        return done()
      }

      case 'nothing_due': {
        await ensure(); await upd({ settlement: 'nothing_due' })
        await logRestitution(sb, m.id, actor, 'nothing_due', 'Reste à payer : 0 €, aucune facture à créer.')
        return done()
      }

      case 'driver_cash': {
        await ensure()
        const amount = Number(body.amount_tvac || 0)
        await logRestitution(sb, m.id, actor, 'driver_cash', `Encaissement chauffeur ouvert pour ${amount.toFixed(2)} € TVAC par ${who_name}.`)
        const url = buildEncaissementUrl(m as any, { amount, returnTo: `/restitution/${m.id}` })
        return NextResponse.json({ ok: true, url })
      }

      case 'sign': {
        await ensure()
        const sig = String(body.signature || '')
        let path: string | null = null
        if (sig.startsWith('data:image/png;base64,')) {
          path = `${m.id}/signature/${Date.now()}.png`
          const buf = Buffer.from(sig.split(',')[1], 'base64')
          const { error } = await sb.storage.from('mission-documents').upload(path, buf, { contentType: 'image/png', upsert: false })
          if (error) return NextResponse.json({ error: `Signature non enregistrée : ${error.message}` }, { status: 500 })
          await sb.from('mission_documents').insert({ mission_id: m.id, kind: 'signature', file_path: path, file_name: 'attestation-restitution.png', mime_type: 'image/png', file_size: buf.length, uploaded_by: actor })
        }
        await upd({ signed_at: path ? now : null, signature_path: path })
        await logRestitution(sb, m.id, actor, 'sign', path ? 'Attestation de sortie signée par le client.' : 'Sortie sans signature.')
        return done()
      }

      case 'complete': {
        await ensure()
        const c: any = await buildContext(sb, session, m.id)
        const blockers: string[] = []
        for (const k of c.checks) if (k.state === 'ko') blockers.push(k.title)
        const ap = (k: string) => c.derogations.some((d: any) => d.kind === k && d.status === 'approved' && (d.restitution_id === rest!.id || k === 'blk'))
        if (!rest!.who_kind) blockers.push('Qui vient le reprendre')
        if (!rest!.odoo_partner_id && !ap('identite')) blockers.push('Pièce d’identité et client')
        let settlement = rest!.settlement as string | null
        if (!settlement) {
          if (c.due.htva <= 0) settlement = 'nothing_due'
          else if (c.invoice && (['paid', 'in_payment'].includes(c.invoice.payment_state) || Number(c.invoice.residual) <= 0.01)) settlement = 'paid_odoo'
          else if (c.driverCollected >= c.due.tvac - 0.01) settlement = 'driver_cash'
          else if (ap('paiement')) settlement = 'derogation'
        }
        if (!settlement) blockers.push('Paiement')
        if (blockers.length) return NextResponse.json({ error: `Il reste à régler : ${blockers.join(', ')}.` }, { status: 409 })

        const fresh = await loadMission(sb, m.id)
        const temp = fresh.levee_saisie_type === 'temporaire'
        if (fresh.status === 'parked') {
          if (temp) {
            if (fresh.parc_zone_key) await releaseParcAndShift(sb, m.id)
            await sb.from('incoming_missions').update({ temp_garage_out_at: now, temp_returned_at: null, updated_at: now }).eq('id', m.id)
          } else {
            const ex = await exitParcNow(sb, m.id, { id: actor, name: who_name }, 'restitution', 'Restitution au comptoir')
            if (!ex.ok) return NextResponse.json({ error: ex.error }, { status: ex.status })
          }
        }
        await upd({ status: 'done', settlement, temp_levee: temp, completed_by: actor, completed_at: now })
        await logRestitution(sb, m.id, actor, 'done', temp
          ? `Levée temporaire : véhicule confié au garagiste par ${who_name}, il revient au parc (dossier ouvert).`
          : `Véhicule restitué à ${WHO_LABELS[rest!.who_kind as WhoKind]}${rest!.client?.name ? ` (${rest!.client.name})` : ''} par ${who_name}, zone ${m.parc_zone_key || '?'} libérée. Règlement : ${({ paid_odoo: 'facture payée dans Odoo', driver_cash: 'encaissement chauffeur', later: 'à facturer', nothing_due: 'rien à payer', derogation: 'sans paiement, par dérogation' } as any)[settlement!] || settlement}.`, { settlement, temp })
        return done()
      }

      case 'cancel': {
        if (rest) { await upd({ status: 'cancelled' }); await logRestitution(sb, m.id, actor, 'cancel', `Restitution abandonnée par ${who_name}.`) }
        return done()
      }
    }
    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  } catch (e: any) {
    console.error('[restitution]', action, e?.message)
    return NextResponse.json({ error: e?.message || 'Erreur' }, { status: 500 })
  }
}
