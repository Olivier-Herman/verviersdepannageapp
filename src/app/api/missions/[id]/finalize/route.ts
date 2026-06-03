// POST /api/missions/[id]/finalize
//
// Bascule une mission de awaiting_payment=true vers awaiting_payment=false
// + declenche les hooks externes (ticket Helpdesk Odoo + email d alerte)
// en relisant les draft_params snapshotes a la creation.
//
// Olivier 2026-06-01 : on SKIP TowSoft queue + GitHub dispatch pour ces
// missions chauffeur (pas besoin, c est une mission ponctuelle locale).
// On garde uniquement Odoo (pour le suivi facturation) + email d alerte
// (pour le dispatcher).
//
// Cette route est appelee quand le chauffeur a fini d encaisser le solde
// complet d une mission en mode draft (cf /api/missions/police/draft).

import { NextResponse }                     from 'next/server'
import { getServerSession }                 from 'next-auth'
import { authOptions }                      from '@/lib/auth'
import { createAdminClient }                from '@/lib/supabase'
import { sendPoliceEmail, buildPoliceEmailHtml } from '@/lib/emails'

export const maxDuration = 60

// Tags Odoo par type (copie de towsoft/create pour eviter import cyclique)
const POLICE_TAGS: Record<string, number> = {
  accident: 6, saisie: 5, rodeo: 5, snc: 15, mal_garee: 1, appel_prive: 25, avp: 10,
}

// Labels lisibles pour l email + le ticket Odoo
const TYPE_LABELS: Record<string, string> = {
  accident:    '🚨 Police Accident',
  saisie:      '⚖️ Saisie',
  rodeo:       '🏎️ Rodéo',
  mal_garee:   '🚫 Mal Garée',
  snc:         '🛣️ Siabis Non Couvert',
  sc:          '🛣️ Siabis Couvert',
  appel_prive: '📞 Appel Privé',
  avp:         '🔲 AVP',
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const missionId = params.id
  if (!missionId) return NextResponse.json({ error: 'missionId requis' }, { status: 400 })

  const supabase = createAdminClient()
  const user     = session.user as any

  const { data: mission, error: getErr } = await supabase
    .from('incoming_missions')
    .select('id, awaiting_payment, amount_to_collect, payment_amount, draft_params, status, source, mission_type, mission_number')
    .eq('id', missionId)
    .maybeSingle()

  if (getErr || !mission) {
    return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  }
  if (!mission.awaiting_payment) {
    return NextResponse.json({ error: 'Mission deja finalisee' }, { status: 400 })
  }

  const required = Number(mission.amount_to_collect || 0)
  const paid     = Number(mission.payment_amount    || 0)

  // Tolerance 1 centime (arrondi flottant possible)
  if (required > 0 && paid + 0.01 < required) {
    return NextResponse.json({
      error: 'Solde restant a encaisser',
      required,
      paid,
      remaining: Math.max(0, required - paid),
    }, { status: 400 })
  }

  const draft = (mission.draft_params || {}) as any
  const type  = String(draft.type || '')

  // Olivier 2026-06-02 : determine si la mission est TERMINEE apres paiement
  // (cas sans remorquage post-paiement) ou si le chauffeur doit encore livrer.
  //
  // Terminees apres paiement :
  //   - Mal Garee deplacement_paye : mission_type='trajet_vide', source='police_mg'
  //   - SNC DSP                    : mission_type='depannage',   source='police_snc'
  //   - Appel Prive DSP            : mission_type='depannage',   source='prive'
  //
  // Pas terminees (chauffeur doit encore charger + livrer) :
  //   - SNC REM client      : mission_type='remorquage', source='police_snc'
  //   - Appel Prive REM client : mission_type='remorquage', source='prive'
  //
  // On utilise les champs DB (source + mission_type) en source de verite plutot
  // que draft_params, qui peut etre vide si l ancienne version de la migration
  // a ete appliquee (sans la colonne draft_params).
  const isFullyDoneAfterPayment =
    // Trajet vide = pas de chargement = forcement done (Mal Garee deplacement_paye)
    mission.mission_type === 'trajet_vide' ||
    // Depannage = pas de remorquage = done apres paiement (SNC DSP / Prive DSP)
    mission.mission_type === 'depannage'

  // Recup le nom chauffeur (pour le ticket Odoo + email)
  const { data: dbUser } = await supabase
    .from('users')
    .select('name')
    .eq('email', user.email)
    .maybeSingle()
  const chauffeurName = dbUser?.name || user.email || 'Chauffeur'

  // ─── 1. Ticket Helpdesk Odoo (sauf appel_prive, source verite VD Soft) ───
  let odooTicketId: number | null = null
  if (type !== 'appel_prive') {
    try {
      const { createHelpdeskTicket } = await import('@/lib/odoo-fsm')
      const tagIds = POLICE_TAGS[type] ? [POLICE_TAGS[type]] : []
      const ownerFirst = draft.ownerFirstName || ''
      const ownerLast  = draft.ownerLastName  || ''
      const clientName = [ownerFirst, ownerLast].filter(Boolean).join(' ') || 'Inconnu'
      const typeLabel  = TYPE_LABELS[type] || type
      const description = buildPoliceEmailHtml({
        type, typeLabel, chauffeurName,
        date: draft.date || '', time: draft.time || '', location: draft.location || '',
        plate: draft.plate || '', vin: draft.vin || '',
        brand: draft.brand || '', model: draft.model || '',
        ownerFirstName: ownerFirst, ownerLastName: ownerLast, ownerPhone: draft.ownerPhone || '',
        remarks: draft.remarks || '',
        photoUrls: draft.photoUrls || [],
        parc: '',
      })
      const result = await createHelpdeskTicket({
        supabaseId:        missionId,
        dossierNumber:     `FINALIZED-${missionId.slice(0, 8)}`,
        source:            type.toUpperCase(),
        clientName,
        vehiclePlate:      draft.plate || '',
        vehicleBrand:      draft.brand || '',
        vehicleModel:      draft.model || '',
        vehicleVin:        draft.vin   || '',
        city:              draft.location || '',
        dateIntervention:  draft.date || '',
        missionType:       type,
        tagIds,
        description,
        teamId:            12,
        stageId:           4,  // direct "Resolu" car deja paye/cloture
      })
      odooTicketId = result.ticketId
    } catch (e: any) {
      console.error('[finalize] Helpdesk Odoo echec:', e?.message || e)
      // Non bloquant — on continue avec email + update mission
    }
  }

  // ─── 2. Email d alerte au dispatcher ──────────────────────────────────
  try {
    await sendPoliceEmail({
      type,
      typeLabel:      TYPE_LABELS[type] || type,
      chauffeurName,
      date:           draft.date || '',
      time:           draft.time || '',
      location:       draft.location || '',
      plate:          draft.plate || '',
      vin:            draft.vin || '',
      brand:          draft.brand || '',
      model:          draft.model || '',
      ownerFirstName: draft.ownerFirstName || '',
      ownerLastName:  draft.ownerLastName  || '',
      ownerPhone:     draft.ownerPhone || '',
      remarks:        draft.remarks || '',
      photoUrls:      draft.photoUrls || [],
      parc:           '',
    } as any)
  } catch (e: any) {
    console.error('[finalize] Email police echec:', e?.message || e)
  }

  // ─── 3. Update mission : awaiting_payment=false + odoo_ticket_id ──────
  const dossierFinal = odooTicketId
    ? `${(draft.type || 'POLICE').toUpperCase()}-${odooTicketId}`
    : mission.mission_number
      ? `LOCAL-${mission.mission_number}`
      : `LOCAL-${missionId.slice(0, 8)}`

  const nowIso = new Date().toISOString()
  const updatePayload: Record<string, any> = {
    awaiting_payment: false,
    odoo_ticket_id:   odooTicketId,
    dossier_number:   dossierFinal,
    updated_at:       nowIso,
  }
  // Si rien a faire apres paiement (depannage / deplacement paye), la mission
  // est techniquement terminee cote chauffeur — MAIS le devis doit etre
  // genere/valide cote facturation. Olivier 2026-06-03 : on passe a 'to_invoice'
  // (pas 'completed') pour que la mission apparaisse dans /facturation avec
  // le lien vers le devis Odoo (s il existe deja, sinon a creer via Facturer).
  // L employe facturation la sortira de la liste apres traitement.
  // Sinon (REM client : chauffeur doit encore charger + livrer), on laisse
  // le statut tel quel et le chauffeur poursuit le flow normal de DriverClient.
  if (isFullyDoneAfterPayment) {
    updatePayload.status                = 'to_invoice'
    updatePayload.completed_at          = nowIso
    if (!mission.payment_amount || mission.payment_amount === 0) {
      // edge case : montant a encaisser = 0 (genre offert) — pas d insert
      // dans interventions, mais on marque quand meme le paiement comme collecte
      updatePayload.payment_collected_at = nowIso
    }
  }

  // Olivier 2026-06-03 : pour les missions fullyDoneAfterPayment, on cree
  // AUTO le devis Odoo (sale.order) afin qu il apparaisse dans /facturation
  // avec le lien deja present. L employe facturation n a qu a valider.
  // Best-effort : on n echoue pas le finalize si le devis Odoo plante (l employe
  // pourra retenter manuellement via le bouton Facturer).
  if (isFullyDoneAfterPayment && mission.billed_to_id) {
    try {
      const origin = new URL(req.url).origin
      const quoteRes = await fetch(`${origin}/api/missions/${missionId}/quote`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie':       req.headers.get('cookie') || '',
        },
        body: JSON.stringify({}),
      })
      if (quoteRes.ok) {
        const qj = await quoteRes.json()
        // /quote retourne { ok, quote: { id, url }, summary }
        if (qj.quote?.id)  updatePayload.odoo_quote_id  = qj.quote.id
        if (qj.quote?.url) updatePayload.odoo_quote_url = qj.quote.url
        updatePayload.odoo_quoted_at = nowIso
        console.log(`[finalize] Devis Odoo cree pour mission ${missionId} : ${qj.quote?.id}`)
      } else {
        const errText = await quoteRes.text().catch(() => '')
        console.error(`[finalize] Devis Odoo echec (${quoteRes.status}) : ${errText.slice(0, 200)}`)
        console.warn(`[finalize] L employe facturation devra creer le devis manuellement via le bouton "Facturer".`)
      }
    } catch (e: any) {
      console.error('[finalize] Devis Odoo exception :', e?.message || e)
    }
  } else if (isFullyDoneAfterPayment && !mission.billed_to_id) {
    console.warn(`[finalize] Mission ${missionId} fullyDone mais billed_to_id manquant → pas de devis auto. L employe devra creer manuellement.`)
  }

  const { error: updErr } = await supabase
    .from('incoming_missions')
    .update(updatePayload)
    .eq('id', missionId)

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok:        true,
    missionId,
    finalized: true,
    odooTicketId,
    dossierNumber: dossierFinal,
  })
}
