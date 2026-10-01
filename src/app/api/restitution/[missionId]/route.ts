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
import { invalidateDossierCache } from '@/lib/dossier/build'
import { buildInvoiceMoveUrl } from '@/lib/odoo-quote'
import { exitParcNow } from '@/lib/parc/exit-parc'
import { releaseParcAndShift } from '@/lib/parc/release'
import { buildEncaissementUrl } from '@/lib/missions/encaissement-url'
import { getBusinessNumber } from '@/lib/settings/business'
import { sourceLabel } from '@/lib/missions/source-catalog'
import { extractJsonFromImages, ID_DOCUMENT_PROMPT } from '@/lib/ocr/vision-json'
import { cropPortrait, saveHolderPhoto } from '@/lib/restitution/holder-photo'
import { sendPushToUser } from '@/lib/push'
import {
  restitutionAccess, loadMission, findAssistanceRel, approvedDerogations, computeChecks, openLegs, payerContext, resolvePayer,
  userNames, logRestitution, markLegNoCharge, isSaisieLike, leveeOk, defaultSplit, dossierOpenInvoices,
  WHO_LABELS, POSTE_LABELS, PAYER_LABELS, type WhoKind, type Payer, type Poste,
} from '@/lib/restitution/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

const r2 = (n: number) => Math.round(n * 100) / 100
// Volets chiffrés du dossier, gardés 60 s par instance tant que la fiche ne
// bouge pas (statut, levée, parc) : le calcul coûte ~1,5 s.
const LEGS_CACHE = new Map<string, { at: number; key: string; val: { legs: any[] } }>()
async function cachedLegs(m: any, extra = '') {
  const key = [m.status, m.levee_saisie_at, m.levee_saisie_date, m.parc_zone_key, m.police_blocked, extra].join('|')
  const hit = LEGS_CACHE.get(m.id)
  if (hit && hit.key === key && Date.now() - hit.at < 60_000) return hit.val
  const val = await openLegs(m.id, m)
  LEGS_CACHE.set(m.id, { at: Date.now(), key, val })
  return val
}
const dropLegs = (id: string) => LEGS_CACHE.delete(id)
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
  const open = rest?.status === 'open' ? rest : null
  const saisie = isSaisieLike(m)
  const who = (open?.who_kind || null) as WhoKind | null
  const split = (open?.split || null) as Partial<Record<Poste, Payer>> | null
  // Montants : seulement à partir de l'étape « montant » (client identifié ou
  // dérogation d'identité), sinon le calcul du dossier (~1,5 s) ralentissait
  // chaque clic (Olivier 28/09 : « très long dans le changement de page »).
  const derogs = await approvedDerogations(sb, m.id, open?.id || null)
  const needLegs = !!open && (!!open.odoo_partner_id || derogs.some(d => d.kind === 'identite' && d.status === 'approved'))
  const invId = open?.invoice_odoo_id || null
  // Tout le reste en parallèle.
  const [meR, respR, names, rel, legsR, assist, invoice, ivR, terms] = await Promise.all([
    sb.from('users').select('id, name, odoo_api_key, restitution_responsable').eq('id', me.id).maybeSingle(),
    sb.from('users').select('id, name, verify_pin_hash').eq('restitution_responsable', true).eq('active', true).order('name'),
    userNames(sb, [...derogs.map(d => d.responsable_id), ...derogs.map(d => d.requested_by), rest?.started_by, rest?.completed_by]),
    findAssistanceRel(sb, m),
    needLegs ? cachedLegs(m, derogs.filter(d => d.status === 'approved').map(d => d.id).join(',')) : Promise.resolve({ legs: [] as any[] }),   // une dérogation « sans frais » validée change les montants
    payerContext(sb, open),
    invId ? odooRpc<any[]>('account.move', 'read', [[invId]], { fields: ['name', 'state', 'payment_state', 'amount_total', 'amount_residual'] })
      .then(([mv]) => mv ? { id: invId, name: mv.name, state: mv.state, payment_state: mv.payment_state, total: mv.amount_total, residual: mv.amount_residual, url: open?.invoice_url || buildInvoiceMoveUrl(invId) } : null)
      .catch(() => ({ id: invId, url: open?.invoice_url || buildInvoiceMoveUrl(invId), unreadable: true })) : Promise.resolve(null),
    open ? sb.from('interventions').select('amount, created_at').eq('mission_id', m.id).gte('created_at', open.started_at) : Promise.resolve({ data: [] }),
    needLegs && open?.odoo_partner_id ? sb.from('client_payment_prefs').select('deferred').eq('odoo_partner_id', open.odoo_partner_id).maybeSingle().then((r: any) => !!r.data?.deferred) : Promise.resolve(false),
  ])
  const meRow = meR.data, resp = respR.data
  // Factures du dossier déjà émises et encore ouvertes : à voir et trancher avant la
  // sortie (Olivier 30/09/2026). Seulement quand les montants sont calculés.
  // Facture d'une assistance : payée par son circuit habituel → affichée pour
  // information, sans décision au comptoir (comme les autres clients tiers).
  const openInvoices = (needLegs
    ? await dossierOpenInvoices(sb, [...new Set([m.id, ...legsR.legs.map((l: any) => l.mission_id)])], invId, open?.third_invoices || [])
    : []).map((i: any) => (assist as any).assist?.has(Number(i.partner_id)) ? { ...i, third: true, circuit: 'assistance' } : i)
  // Facture supprimée dans Odoo (brouillon effacé) : on défait le lien et les lignes
  // « facturées », sinon le dossier croit tout payé et laisse sortir le véhicule
  // pour 0 € (TEST-MG, 29/09/2026).
  if (invId && invoice === null) {
    const now = new Date().toISOString()
    await sb.from('mission_billed_items').delete().eq('invoice_odoo_id', invId)
    await sb.from('incoming_missions').update({ invoice_odoo_id: null, updated_at: now }).eq('invoice_odoo_id', invId)
    await sb.from('restitutions').update({ invoice_odoo_id: null, invoice_url: null, amount_htva: null, amount_tvac: null, updated_at: now }).eq('id', open!.id)
    await logRestitution(sb, m.id, me.id, 'invoice_deleted', 'La facture de la restitution a été supprimée dans Odoo : montant à nouveau dû, facture à recréer.', { invoice_odoo_id: invId })
    dropLegs(m.id)
    return buildContext(sb, session, missionId)
  }
  const checks = await computeChecks(sb, m, derogs, names)
  const legsOut = legsR.legs.map((l: any) => { const p = resolvePayer(l, who, saisie, split, assist, m); return { ...l, payer: p.payer, payer_partner_id: p.partner_id, payer_partner_name: p.partner_name, payer_chosen: p.chosen } })
  const dueHtva = r2(legsOut.filter((l: any) => l.payer === 'client').reduce((t: number, l: any) => t + (l.due_htva || 0), 0))
  // Groupes mis « sans frais » pendant CETTE restitution : on peut revenir dessus ici.
  const ncIds = legsOut.filter((l: any) => String(l.nothing || '').startsWith('sans frais')).map((l: any) => l.mission_id)
  const { data: ncLogs } = open && ncIds.length ? await sb.from('mission_logs').select('mission_id').in('mission_id', ncIds).eq('action', 'no_charge').eq('metadata->>restitution_id', open.id) : { data: [] as any[] }
  const driverCollected = r2(((ivR as any).data || []).reduce((t: number, x: any) => t + Number(x.amount || 0), 0))
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
  // Photo du titulaire (puce eID ou portrait découpé) : la plus récente de la fiche.
  let holderPhoto: string | null = null
  if (open) {
    const { data: ph } = await sb.from('mission_documents').select('file_path').eq('mission_id', m.id).eq('kind', 'id_photo').order('created_at', { ascending: false }).limit(1)
    if (ph?.[0]) holderPhoto = (await sb.storage.from('mission-documents').createSignedUrl(ph[0].file_path, 3600)).data?.signedUrl || null
  }
  const { count: transportDocs } = open ? await sb.from('mission_documents').select('id', { count: 'exact', head: true }).eq('mission_id', m.id).eq('kind', 'cmr').gte('created_at', open.started_at) : { count: 0 }
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
    openInvoices, openDecisions: open?.open_decisions || {}, noChargeHere: [...new Set((ncLogs || []).map((x: any) => x.mission_id))],
    invoice, driverCollected, idDoc, transportDocs: transportDocs || 0, holderPhoto, payDeferred: terms, thirdInvoices: open?.third_invoices || [], photoCount: Array.isArray(m.driver_photos) ? m.driver_photos.length : 0,
    derogations: derogs.map(d => ({ ...d, responsable_name: names[d.responsable_id] || null, requested_by_name: names[d.requested_by] || null })),
    pending: (pending || []).map((p: any) => ({ ...p, responsable_name: pNames[p.responsable_id] || null })),
    responsables: (resp || []).map((u: any) => ({ id: u.id, name: u.id === me.id ? `${u.name} (moi)` : u.name, has_pin: !!u.verify_pin_hash, me: u.id === me.id })),
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
        // Les photos sont d'abord stockées, puis rattachées au dossier TOUTES
        // ENSEMBLE après la lecture : le PC qui attend voit recto + verso d'un
        // coup (avant, il voyait le recto seul et s'arrêtait — Olivier 28/09).
        const images: { base64: string; mimeType: string }[] = []
        const uploaded: { path: string; mime: string; size: number; name: string }[] = []
        for (let i = 0; i < files.length; i++) {
          const f = files[i]
          const buf = Buffer.from(await f.arrayBuffer())
          const mime = f.type || 'image/jpeg'
          const path = `${m.id}/id_card/${Date.now()}_${i + 1}.${mime.includes('png') ? 'png' : 'jpg'}`
          const { error: upErr } = await sb.storage.from('mission-documents').upload(path, buf, { contentType: mime, upsert: false })
          if (upErr) return NextResponse.json({ error: `Photo non enregistrée : ${upErr.message}` }, { status: 500 })
          uploaded.push({ path, mime, size: buf.length, name: `piece-identite-${i === 0 ? 'recto' : 'verso'}.jpg` })
          if (/^image\/(jpeg|png|webp)$/.test(mime)) images.push({ base64: buf.toString('base64'), mimeType: mime })
        }
        let ocr: any = null
        try { const r = await extractJsonFromImages(images, ID_DOCUMENT_PROMPT, 'Lis cette pièce d’identité (recto et verso) et retourne uniquement le JSON.'); if (r.ok) ocr = r.data } catch {}
        const { data: docs } = await sb.from('mission_documents').insert(uploaded.map((u, i) => ({
          mission_id: m.id, kind: 'id_card', file_path: u.path, file_name: u.name, mime_type: u.mime, file_size: u.size, uploaded_by: actor, ocr: i === 0 ? ocr : null,
        }))).select('id')
        const first: string | null = docs?.[0]?.id || null
        if (!rest!.id_document_id && first) await upd({ id_document_id: first })
        // Portrait du titulaire découpé sur le recto → rangé dans la fiche (sans bloquer).
        if (images[0]) { try { const face = await cropPortrait(Buffer.from(images[0].base64, 'base64'), images[0].mimeType); if (face) await saveHolderPhoto(sb, m.id, face, actor, 'photo') } catch { /* facultatif */ } }
        const who = ocr ? [ocr.firstName, ocr.lastName].filter(Boolean).join(' ') : ''
        await logRestitution(sb, m.id, actor, 'id_photo', `Pièce d’identité photographiée (${files.length === 2 ? 'recto et verso' : '1 photo'}) par ${who_name}${who ? ` : ${who}` : ', lecture incomplète'}.`, { document_id: first })
        return done()
      }

      case 'transport_doc': {
        // Documents du transporteur (CMR, ordre d'enlèvement, pièce du chauffeur),
        // en rafale : une photo par appel, rangée au dossier (Olivier 29/09/2026).
        const f = form?.get('file')
        if (!(f instanceof File) || !f.size) return NextResponse.json({ error: 'Photo manquante' }, { status: 400 })
        await ensure()
        const buf = Buffer.from(await f.arrayBuffer())
        const mime = f.type || 'image/jpeg'
        const path = `${m.id}/cmr/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${mime.includes('png') ? 'png' : 'jpg'}`
        const { error: upErr } = await sb.storage.from('mission-documents').upload(path, buf, { contentType: mime, upsert: false })
        if (upErr) return NextResponse.json({ error: `Photo non enregistrée : ${upErr.message}` }, { status: 500 })
        await sb.from('mission_documents').insert({ mission_id: m.id, kind: 'cmr', file_path: path, file_name: 'document-transporteur.jpg', mime_type: mime, file_size: buf.length, uploaded_by: actor })
        const { count } = await sb.from('mission_documents').select('id', { count: 'exact', head: true }).eq('mission_id', m.id).eq('kind', 'cmr').gte('created_at', rest!.started_at)
        if (count === 1) await logRestitution(sb, m.id, actor, 'transport_doc', `Documents du transporteur photographiés par ${who_name}.`)
        return NextResponse.json({ ok: true, count: count || 0 })
      }

      case 'phone_docs': {
        // Depuis le PC : la notification ouvre l'appareil photo en rafale sur le
        // téléphone de l'utilisateur (documents du transporteur ou photos diverses).
        await ensure()
        const type = body.type === 'divers' ? 'divers' : 'transport'
        const label = type === 'divers' ? 'Photos du véhicule' : 'Documents du transporteur'
        const push = await sendPushToUser(actor, { title: label, body: `${m.vehicle_plate || 'Véhicule'} : photographiez en rafale, tout rejoint le dossier.`, url: `/restitution/${m.id}/photos?type=${type}`, tag: `restit-${type}-${m.id}` }).catch(() => ({ sent: 0 }))
        await logRestitution(sb, m.id, actor, 'phone_docs', `${label} demandés sur le téléphone de ${who_name}${push.sent ? '' : ' (notification non délivrée : ouvrez VD Soft sur le téléphone)'}.`)
        if (!push.sent) return NextResponse.json({ error: 'Notification non délivrée : ouvrez VD Soft sur votre téléphone, puis réessayez.' }, { status: 409 })
        return NextResponse.json({ ok: true })
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
        // Carte eID : la photo du titulaire (puce) attend en stockage privé → dans la fiche.
        if (c.source === 'eid' && typeof c.photo_path === 'string' && /^eid-photos\/[a-zA-Z0-9-]+\.jpg$/.test(c.photo_path)) {
          const { data: f } = await sb.storage.from('mission-documents').download(c.photo_path)
          if (f) { await saveHolderPhoto(sb, m.id, Buffer.from(await f.arrayBuffer()), actor, 'eid'); await sb.storage.from('mission-documents').remove([c.photo_path]) }
        }
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

      case 'client_existing': {
        // Client déjà dans Odoo, choisi par le bureau (Olivier 29/09/2026). Propriétaire /
        // mandataire : la photo de la pièce reste exigée ; garage, assistance, transporteur : non.
        await ensure()
        const pid = Number(body.partner_id)
        if (!pid) return NextResponse.json({ error: 'Client manquant' }, { status: 400 })
        if (['owner', 'mandate'].includes(rest!.who_kind || '') && !rest!.id_document_id) return NextResponse.json({ error: 'Photographiez d’abord la pièce d’identité.' }, { status: 400 })
        const [p] = await odooRpc<any[]>('res.partner', 'read', [[pid]], { fields: ['name', 'street', 'zip', 'city', 'phone', 'email', 'vat', 'is_company', 'country_id'] })
        if (!p) return NextResponse.json({ error: 'Client introuvable dans la facturation' }, { status: 404 })
        const client = { kind: p.is_company || p.vat ? 'pro' : 'prive', source: 'odoo', name: p.name, company: p.is_company ? p.name : null, vat: p.vat || null, street: p.street || null, zip: p.zip || null, city: p.city || null, country: 'BE', phone: p.phone || null, email: p.email || null }
        await upd({ client, odoo_partner_id: pid })
        const address = [p.street, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
        await sb.from('incoming_missions').update({ client_name: p.name, client_phone: p.phone || m.client_phone, client_email: p.email || m.client_email, client_address: address || m.client_address, updated_at: now }).eq('id', m.id)
        await logRestitution(sb, m.id, actor, 'client', `Client existant « ${p.name} » choisi par ${who_name} (fiche client n° ${pid}).`, { partner_id: pid, source: 'odoo' })
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

      case 'checks_ok': {
        // « Peut-il sortir ? » relu et validé par « Suivant » (Olivier 29/09/2026).
        await ensure()
        const cx: any = await buildContext(sb, session, m.id)
        const ko = (cx.checks || []).filter((k: any) => k.state === 'ko').map((k: any) => k.title)
        if (ko.length) return NextResponse.json({ error: `Il reste à régler : ${ko.join(', ')}.` }, { status: 409 })
        await upd({ checks_validated_at: now, checks_validated_by: actor })
        await logRestitution(sb, m.id, actor, 'checks_ok', `Contrôles de sortie relus et validés par ${who_name} : rien ne bloque.`)
        return done()
      }

      case 'pay_pref': {
        // « Paiement différé » coché ou décoché : retenu pour ce client, par défaut
        // la fois suivante (Olivier 29/09/2026).
        await ensure()
        if (!rest!.odoo_partner_id) return NextResponse.json({ error: 'Client à identifier d’abord.' }, { status: 400 })
        const deferred = body.deferred === true
        await sb.from('client_payment_prefs').upsert({ odoo_partner_id: rest!.odoo_partner_id, deferred, updated_by: actor, updated_at: now }, { onConflict: 'odoo_partner_id' })
        await logRestitution(sb, m.id, actor, 'pay_pref', `${deferred ? 'Paiement différé coché' : 'Encaissement direct remis'} par ${who_name} pour ${rest!.client?.name || 'le client'} (retenu pour la prochaine fois).`, { deferred })
        return done()
      }

      case 'leg_payer': {
        // Payeur d'un groupe : par défaut le client de la fiche, modifiable ici
        // (client présent, un client existant ou un nouveau client).
        await ensure()
        const mid = String(body.mission_id || '')
        const k = String(body.kind || '')
        const overrides = { ...(rest!.leg_payers || {}) }
        let label = ''
        if (k === 'default') { delete overrides[mid]; label = 'le client de la fiche' }
        else if (k === 'present') { overrides[mid] = { kind: 'present' }; label = `le client présent (${rest!.client?.name || '—'})` }
        else if (k === 'third' || k === 'new') {
          let pid = Number(body.partner_id) || 0
          let name = String(body.name || '').trim()
          if (k === 'new') {
            const c = body.client || {}
            const pro = c.kind === 'pro'
            name = pro ? String(c.company || '').trim() : [c.first_name, c.last_name].map((x: any) => String(x || '').trim()).filter(Boolean).join(' ')
            if (name.length < 2) return NextResponse.json({ error: pro ? 'Nom de la société requis.' : 'Nom et prénom requis.' }, { status: 400 })
            if (pro && !String(c.vat || '').trim()) return NextResponse.json({ error: 'Numéro de TVA requis pour un client pro.' }, { status: 400 })
            pid = await withOdooActor(actor, () => findOrCreatePartner({
              name, phone: c.phone || undefined, email: c.email || undefined, vat: pro ? String(c.vat).replace(/\s|\./g, '').toUpperCase() : undefined,
              street: c.street || undefined, zip: c.zip || undefined, city: c.city || undefined, countryCode: c.country || 'BE',
            }))
          }
          if (!pid) return NextResponse.json({ error: 'Client à choisir.' }, { status: 400 })
          overrides[mid] = { kind: 'third', partner_id: pid, name }
          label = `${name || `client n° ${pid}`}${k === 'new' ? ' (nouveau client créé)' : ''}`
        } else return NextResponse.json({ error: 'Choix inconnu.' }, { status: 400 })
        await upd({ leg_payers: Object.keys(overrides).length ? overrides : null })
        const { data: leg } = await sb.from('incoming_missions').select('mission_number').eq('id', mid).maybeSingle()
        await logRestitution(sb, m.id, actor, 'leg_payer', `Groupe ${leg?.mission_number || ''} facturé à ${label}, choisi par ${who_name}.`, { mission_id: mid, choice: overrides[mid] || 'default' })
        return done()
      }

      case 'invoice': {
        await ensure()
        const { data: meRow } = await sb.from('users').select('odoo_api_key').eq('id', actor).maybeSingle()
        if (!meRow?.odoo_api_key) return NextResponse.json({ error: 'Pas d’accès Odoo : passez par l’encaissement chauffeur.' }, { status: 403 })
        if (!rest!.odoo_partner_id) return NextResponse.json({ error: 'Client à identifier d’abord (étape 1).' }, { status: 400 })
        const saisie = isSaisieLike(m)
        const { legs } = await openLegs(m.id, m)
        const pctx = await payerContext(sb, rest)
        const tagged = legs.map(l => { const p = resolvePayer(l, rest!.who_kind, saisie, rest!.split, pctx, m); return { ...l, payer: p.payer, pid: p.partner_id, pname: p.partner_name } })
        // Facture du client présent déjà créée : on ne refait que celles des autres clients.
        const clientLegs = rest!.invoice_odoo_id ? [] : tagged.filter(l => l.payer === 'client' && l.due_htva > 0)
        const thirdLegs = tagged.filter(l => l.payer === 'third' && l.pid && l.due_htva > 0)
        if (!clientLegs.length && !thirdLegs.length) {
          if (rest!.invoice_odoo_id) return done()
          return NextResponse.json({ error: 'Rien à facturer : le reste à payer est à 0 €.' }, { status: 409 })
        }
        const clientName = rest!.client?.name || 'Client'
        // Chaque groupe passe au nom de son payeur (client présent ou autre client) ;
        // ceux des frais de justice au partenaire Frais de Justice (facturés ensuite par le bureau).
        for (const l of clientLegs) await sb.from('incoming_missions').update({ billed_to_id: rest!.odoo_partner_id, billed_to_name: clientName, updated_at: now }).eq('id', l.mission_id)
        for (const l of thirdLegs) await sb.from('incoming_missions').update({ billed_to_id: l.pid, billed_to_name: l.pname || `Client ${l.pid}`, updated_at: now }).eq('id', l.mission_id)
        const fdj = tagged.filter(l => l.payer === 'fdj')
        if (fdj.length) {
          const fdjId = await getBusinessNumber('odoo_partner_frais_justice')
          for (const l of fdj) await sb.from('incoming_missions').update({ billed_to_id: fdjId, billed_to_name: 'Frais de Justice Verviers', updated_at: now }).eq('id', l.mission_id)
        }
        dropLegs(m.id)
        const res = await withOdooActor(actor, () => invoiceDossierGroups({ anyMissionId: m.id, missionIds: [...clientLegs, ...thirdLegs].map(l => l.mission_id), actorUserId: actor }))
        const inv = clientLegs.length ? res.invoices.find(i => Number(i.client_id) === Number(rest!.odoo_partner_id)) : null
        const others = res.invoices.filter(i => i !== inv)
        if (!inv && !others.length) return NextResponse.json({ error: `Aucune facture créée. ${(res.warnings || []).join(' · ')}` }, { status: 409 })
        // Factures laissées en BROUILLON (Olivier 28/09/2026) : elles s'ouvrent dans Odoo,
        // on les adapte si besoin, on les valide ; seule celle du client présent s'encaisse ici.
        if (inv) {
          const total = r2(inv.total_htva || 0)
          await upd({ invoice_odoo_id: inv.odoo_id, invoice_url: inv.url, amount_htva: total, amount_tvac: r2(total * 1.21) })
          await logRestitution(sb, m.id, actor, 'invoice', `Montant confirmé (${total.toFixed(2)} € HTVA) et facture créée en brouillon dans Odoo au nom de ${clientName} par ${who_name} (à valider et encaisser dans Odoo).`, { invoice_odoo_id: inv.odoo_id, warnings: res.warnings })
        }
        if (others.length) {
          const list = [...(rest!.third_invoices || []), ...others.map(i => ({ odoo_id: i.odoo_id, url: i.url, client_id: i.client_id, client_name: i.client_name, total_htva: r2(i.total_htva || 0) }))]
          await upd({ third_invoices: list })
          await logRestitution(sb, m.id, actor, 'invoice_third', `Facture${others.length > 1 ? 's' : ''} créée${others.length > 1 ? 's' : ''} en brouillon pour ${others.map(i => `${i.client_name} (${r2(i.total_htva || 0).toFixed(2)} € HTVA)`).join(', ')} par ${who_name}, paiement à terme.`, { invoices: others.map(i => i.odoo_id) })
        }
        const c: any = await buildContext(sb, session, m.id)
        return NextResponse.json({ ...c, opened: inv ? inv.url : others[0]?.url || null })
      }

      case 'check_payment': {
        await ensure()
        if (!rest!.invoice_odoo_id) return NextResponse.json({ error: 'Pas de facture à vérifier.' }, { status: 400 })
        const [mv] = await odooRpc<any[]>('account.move', 'read', [[rest!.invoice_odoo_id]], { fields: ['name', 'state', 'payment_state', 'amount_residual'] })
        const paid = mv && mv.state === 'posted' && (['paid', 'in_payment'].includes(mv.payment_state) || Number(mv.amount_residual) <= 0.01)
        if (paid) {
          await upd({ settlement: 'paid_odoo' })
          await logRestitution(sb, m.id, actor, 'paid', `Paiement vérifié : facture ${mv.name} payée dans Odoo.`)
        }
        const c: any = await buildContext(sb, session, m.id)
        return NextResponse.json({ ...c, paymentChecked: paid ? 'paid' : mv?.state === 'draft' ? 'La facture est encore en brouillon : validez-la puis encaissez-la dans Odoo.' : `Pas encore payée (reste ${Number(mv?.amount_residual || 0).toFixed(2)} €).` })
      }

      case 'refresh': return done()   // relire Odoo (facture encaissée entre-temps)

      case 'open_decide': {
        // Facture ouverte du dossier : « le client la paiera plus tard » (ou annuler ce
        // choix). « Payée » ne se déclare pas : l'écran le constate dans Odoo.
        await ensure()
        const invId = Number(body.invoice_id)
        const cx: any = await buildContext(sb, session, m.id)
        const inv = (cx.openInvoices || []).find((i: any) => i.id === invId)
        if (!inv) return NextResponse.json({ error: 'Cette facture n’est plus ouverte (déjà payée ?). Rechargez.' }, { status: 409 })
        const dec = { ...(rest!.open_decisions || {}) }
        if (body.decision === 'clear') delete dec[invId]
        else dec[invId] = { decision: 'later', by: actor, by_name: who_name, at: new Date().toISOString() }
        await upd({ open_decisions: dec })
        await logRestitution(sb, m.id, actor, 'open_decision', body.decision === 'clear'
          ? `Décision retirée sur la facture ${inv.name} (reste ${inv.residual.toFixed(2)} €).`
          : `Facture ${inv.name} (${inv.partner}) laissée ouverte par ${who_name} : reste ${inv.residual.toFixed(2)} € à payer plus tard.`, { invoice_id: invId })
        return done()
      }

      case 'later': {
        await ensure()
        // Paiement à la facture : choisi par le bureau pour ce client (Olivier 29/09/2026 :
        // « il faut qu'on puisse cocher si on laisse le paiement à la facture ou
        // l'encaissement direct »). La facture est créée (brouillon) avant de continuer.
        const onInvoice = body.pay_on_invoice === true
        const assistOrGarage = ['garage', 'assistance'].includes(rest!.who_kind || '')
        if (!assistOrGarage && !onInvoice) return NextResponse.json({ error: 'Partir sans payer demande une dérogation, ou le choix « paiement à la facture ».' }, { status: 403 })
        if (onInvoice && !assistOrGarage && !rest!.invoice_odoo_id) return NextResponse.json({ error: 'Créez d’abord la facture : le client la paiera à réception.' }, { status: 409 })
        await upd({ settlement: 'later' })
        await logRestitution(sb, m.id, actor, 'later', onInvoice
          ? `Paiement différé choisi par ${who_name} pour ${rest!.client?.name || 'le client'} : le véhicule part, la facture sera payée à réception.`
          : `Part sans payer : à facturer (${WHO_LABELS[rest!.who_kind as WhoKind]}).`, { pay_on_invoice: onInvoice })
        return done()
      }

      case 'nothing_due': {
        await ensure()
        if (rest!.invoice_odoo_id) return NextResponse.json({ error: 'Une facture existe : elle doit être payée dans Odoo.' }, { status: 409 })
        const cx: any = await buildContext(sb, session, m.id)
        if (cx.due?.htva > 0) return NextResponse.json({ error: `Il reste ${cx.due.htva.toFixed(2)} € HTVA à payer.` }, { status: 409 })
        if (cx.legs.some((l: any) => l.payer === 'third' && l.due_htva > 0)) return NextResponse.json({ error: 'Créez d’abord les factures des autres clients.' }, { status: 409 })
        await upd({ settlement: 'nothing_due' })
        await logRestitution(sb, m.id, actor, 'nothing_due', 'Reste à payer : 0 €, aucune facture à créer.')
        return done()
      }

      // Décider qu'un groupe n'est pas facturé (Olivier 01/10/2026) : direct pour la
      // facturation (accès Odoo), motif obligatoire, tracé au journal avec son auteur ;
      // sans cet accès (chauffeur), par dérogation « sans_frais:<groupe> » (route derogation).
      // Mêmes champs que « Ne rien facturer » du dossier (no_charge_* ; gardiennage :
      // storage_waived) ; le véhicule est encore au parc : ni statut ni place touchés.
      case 'leg_no_charge':
      case 'leg_no_charge_undo': {
        await ensure()
        const { data: meRow } = await sb.from('users').select('odoo_api_key').eq('id', actor).maybeSingle()
        if (!meRow?.odoo_api_key) return NextResponse.json({ error: 'Réservé à la facturation : demandez une dérogation pour un départ sans paiement.' }, { status: 403 })
        const mid = String(body.mission_id || '')
        const { legs } = await openLegs(m.id, m)
        const leg = legs.find(l => l.mission_id === mid)
        if (!leg) return NextResponse.json({ error: 'Groupe introuvable dans ce dossier.' }, { status: 404 })
        const { data: row } = await sb.from('incoming_missions').select('id, mission_number, dossier_leg, storage_waived, no_charge_at').eq('id', mid).maybeSingle()
        if (!row) return NextResponse.json({ error: 'Groupe introuvable.' }, { status: 404 })
        if (action === 'leg_no_charge') {
          const reason = String(body.reason || '').trim()
          if (reason.length < 4) return NextResponse.json({ error: 'Motif requis (au moins 4 caractères).' }, { status: 400 })
          await markLegNoCharge(sb, { legId: mid, rootMissionId: m.id, restitutionId: rest!.id, reason, actorId: actor, decidedBy: who_name, letter: leg.letter })
        } else {
          const { data: lg } = await sb.from('mission_logs').select('metadata').eq('mission_id', mid).eq('action', 'no_charge').eq('metadata->>restitution_id', rest!.id).order('created_at', { ascending: false }).limit(1)
          if (!lg?.length) return NextResponse.json({ error: 'Ce groupe a été mis sans frais en dehors de cette restitution : voyez avec la facturation.' }, { status: 409 })
          const prev = !!(lg[0].metadata as any)?.prev_storage_waived
          await sb.from('incoming_missions').update({ ...(row.dossier_leg ? { storage_waived: prev } : {}), no_charge_at: null, no_charge_reason: null, no_charge_by: null, updated_at: now }).eq('id', mid)
          await sb.from('mission_logs').insert({ mission_id: mid, actor_id: actor, action: 'no_charge_undo', notes: `Sans frais annulé : groupe ${leg.letter} à facturer à nouveau (restitution)`, metadata: { dossier_letter: leg.letter, restitution_id: rest!.id } })
          await logRestitution(sb, m.id, actor, 'leg_no_charge_undo', `Groupe ${leg.letter} (${row.mission_number || leg.title}) à facturer à nouveau, décidé par ${who_name}.`, { mission_id: mid })
        }
        dropLegs(m.id); invalidateDossierCache()
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
        if (!rest!.checks_validated_at) blockers.push('Contrôles de sortie à valider (« Suivant »)')
        if (!rest!.odoo_partner_id && !ap('identite')) blockers.push('Pièce d’identité et client')
        let settlement = rest!.settlement as string | null
        // Une facture existe : c'est elle qui fait foi (payée ou non), jamais le « reste à 0 »
        // du dossier, qui la compte déjà comme facturée.
        if (settlement === 'nothing_due' && c.invoice) settlement = null
        if (!settlement) {
          if (c.invoice) {
            if (c.invoice.state === 'posted' && (['paid', 'in_payment'].includes(c.invoice.payment_state) || Number(c.invoice.residual) <= 0.01)) settlement = 'paid_odoo'
            else if (ap('paiement')) settlement = 'derogation'
          }
          else if (c.due.htva <= 0) settlement = 'nothing_due'
          else if (c.driverCollected >= c.due.tvac - 0.01) settlement = 'driver_cash'
          else if (ap('paiement')) settlement = 'derogation'
        }
        if (!settlement) blockers.push('Paiement')
        const undecided = (c.openInvoices || []).filter((i: any) => !i.third && !(rest!.open_decisions || {})[i.id] && !ap(`ouvert_${i.id}`))
        if (undecided.length) blockers.push(`Montants ouverts du dossier sans décision (${undecided.map((i: any) => `${i.name} : ${i.residual.toFixed(2)} €`).join(', ')})`)
        if (c.legs.some((l: any) => l.payer === 'third' && l.due_htva > 0) && !ap('paiement')) blockers.push('Factures des autres clients à créer')
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
        dropLegs(m.id)
        await upd({ status: 'done', settlement, temp_levee: temp, completed_by: actor, completed_at: now })
        // Mal garée payée dans Odoo : copie de la facture acquittée au policier de la fiche.
        if (settlement === 'paid_odoo' && rest!.invoice_odoo_id && m.source === 'police_mg') {
          try {
            const { sendPaidInvoiceToOfficer } = await import('@/lib/restitution/officer-copy')
            const name = c.invoice?.name || String(rest!.invoice_odoo_id)
            await sendPaidInvoiceToOfficer(m.id, rest!.invoice_odoo_id, name)
          } catch (e: any) { console.warn('[restitution] copie policier KO', e?.message) }
        }
        await logRestitution(sb, m.id, actor, 'done', temp
          ? `Levée temporaire : véhicule confié au garagiste par ${who_name}, il revient au parc (dossier ouvert).`
          : `Véhicule restitué à ${WHO_LABELS[rest!.who_kind as WhoKind]}${rest!.client?.name ? ` (${rest!.client.name})` : ''} par ${who_name}, zone ${m.parc_zone_key || '?'} libérée. Règlement : ${({ paid_odoo: 'facture payée dans Odoo', driver_cash: 'encaissement chauffeur', later: 'à facturer / paiement à la facture', nothing_due: 'rien à payer', derogation: 'sans paiement, par dérogation' } as any)[settlement!] || settlement}.`, { settlement, temp })
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
