// src/lib/missions/siabis-reprise.ts — une assistance reprend un Siabis NON couvert en cours (Olivier 30/10/2026,
// GP872CJ : AXA dit « non couvert », IMA envoie sa prise en charge pendant que Franck est sur place).
//
// Exactement le geste fait à la main ce soir-là :
//   1. la fiche de l'assistance (arrivée après, même plaque) est FUSIONNÉE dans la fiche Siabis du chauffeur
//      (la plus ancienne garde son chauffeur, ses pointages, ses photos ; l'autre est annulée et liée, son
//      historique rattaché) ;
//   2. la fiche passe en Siabis COUVERT : plus d'encaissement client ;
//   3. elle est facturée à l'assistance qui couvre, au MONTANT DU SIABIS NON COUVERT (figé en prix convenu HTVA),
//      au nom que la prise en charge demande (« Facture à établir à l'ordre de », ex. IMA ASSURANCES) ;
//   4. le chauffeur est prévenu (notification, Telegram, fenêtre Aide) : il ne fait plus payer et clôture ;
//      le dispatch aussi.
// Client déjà payé : il se fait rembourser par son assistance avec notre facture — la fiche reste non couverte,
// celle de l'assistance est seulement absorbée (31/10/2026).
// Garde-fou (sinon : rien n'est touché, le dispatch est alerté) : fiche d'assistance liée à une plateforme à
// clôturer (Touring COMEX, VAB Comet, AXA, Kaze, Allianz) — la fusion ferait perdre la clôture.

import type { createAdminClient } from '@/lib/supabase'

type Sb = ReturnType<typeof createAdminClient>
const norm = (s: string | null | undefined) => String(s || '').replace(/[-.\s_/]/g, '').toUpperCase()
const r2 = (n: number) => Math.round(n * 100) / 100
const ACTIVES = ['assigned', 'accepted', 'in_progress', 'delivering']
// Fiches qui ne sont pas une prise en charge d'assistance.
const PAS_ASSISTANCE = /^(police_|garage|unknown|prive|privé|vhu|francofolies|circuit|sia_couvert$)/i

export interface RepriseResult { traitees: string[]; alertes: string[] }

/** Entité à facturer écrite dans la prise en charge (« Facture à établir à l'ordre de : … TVA … »). */
async function entiteAFacturer(raw: string | null | undefined): Promise<{ id: number; name: string } | null> {
  const t = String(raw || '').replace(/\s+/g, ' ')
  const m = t.match(/Facture à établir à l'ordre de\s*:?\s*\|?\s*([A-Z0-9&' .-]{3,60}?)\s+\d/)
  const vat = t.match(/TVA Intra-communautaire\s*:\s*([A-Z]{2}[0-9A-Z]{6,14})/)?.[1] || null
  if (!m?.[1] && !vat) return null
  const { lookupPartner } = await import('@/lib/odoo-quote')
  return lookupPartner({ name: m?.[1]?.trim() || null, vat }).catch(() => null)
}

/** Fiche d'assistance liée à une plateforme où une clôture est attendue (on ne la fait pas disparaître). */
function plateforme(f: any): string | null {
  if (f.source_format === 'comex' || f.touring_accepted_at) return 'Touring (COMEX)'
  if (Array.isArray(f.vab_assignment_ids) && f.vab_assignment_ids.length) return 'VAB (Comet)'
  if (f.axa_mission_order_id) return 'AXA (go&assist)'
  if (f.kaze_job_id) return 'Kaze (IMA)'
  if (/^(mondial|allianz)/i.test(String(f.source || ''))) return 'Allianz (Hexalite)'
  return null
}

export async function repriseSiabisParAssistance(sb: Sb, opts: { dryRun?: boolean } = {}): Promise<RepriseResult> {
  const out: RepriseResult = { traitees: [], alertes: [] }
  const since = new Date(Date.now() - 6 * 3600_000).toISOString()
  // Siabis non couverts en cours (ou finis il y a peu sans paiement).
  const { data: sncs } = await sb.from('incoming_missions').select('*')
    .eq('source', 'police_snc').eq('dossier_leg', false).is('merged_into_mission_id', null)
    .in('status', [...ACTIVES, 'to_invoice', 'completed']).gte('received_at', new Date(Date.now() - 24 * 3600_000).toISOString()).limit(100)
  if (!sncs?.length) return out
  // Prises en charge d'assistance récentes, pas encore traitées.
  const { data: news } = await sb.from('incoming_missions').select('*')
    .in('status', ['new', 'dispatching']).is('assigned_to', null).eq('dossier_leg', false).is('merged_into_mission_id', null)
    .gte('received_at', since).limit(300)
  const mur = Date.now() - 3 * 60_000
  for (const f of news || []) {
    if (PAS_ASSISTANCE.test(String(f.source || ''))) continue
    // 3 minutes de recul : le lien plateforme (COMEX, Comet, Kaze) se pose juste après la réception du mail.
    if (Date.parse(f.created_at || f.received_at) > mur) continue
    const snc = (sncs || []).find((s: any) => norm(s.vehicle_plate) && norm(s.vehicle_plate) === norm(f.vehicle_plate)
      && Date.parse(s.received_at) <= Date.parse(f.received_at) && !(s.invoice_number || s.invoice_odoo_id))
    if (!snc) continue
    const ref = `#${snc.mission_number} ${snc.vehicle_plate}`
    // Déjà signalé pour ce couple : on ne répète pas.
    const { count: deja } = await sb.from('mission_logs').select('id', { count: 'exact', head: true }).eq('mission_id', f.id).eq('action', 'siabis_reprise_alerte')
    const alerter = async (raison: string) => {
      out.alertes.push(`${ref} ← #${f.mission_number} (${f.source}) : ${raison}`)
      if (opts.dryRun || deja) return
      await sb.from('mission_logs').insert({ mission_id: f.id, action: 'siabis_reprise_alerte', notes: `Prise en charge pour le Siabis non couvert ${ref} — pas faite automatiquement : ${raison}` })
      const { sendNotificationToRoles } = await import('@/lib/notifications/send')
      await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'siabis_couvert_request', {
        title: `🔵 ${f.vehicle_plate} : mission ${f.source} reçue pour le Siabis non couvert ${ref}`,
        body: `À vérifier : ${raison}. Si l'assistance couvre l'intervention : passer ${ref} en couvert et prévenir le chauffeur de ne pas faire payer. Si c'est la suite du dossier (relivraison), la rattacher comme telle — pas de fusion.`,
        mission_id: snc.id, action_url: `/dispatch/${snc.id}`,
      }).catch(() => {})
    }
    const pf = plateforme(f)
    if (pf) { await alerter(`la fiche de l'assistance attend sa clôture chez ${pf}`); continue }
    // Client déjà payé : il s'arrange avec son assistance en lui envoyant notre facture (Olivier 31/10/2026).
    // On ne change rien au Siabis non couvert ; la fiche de l'assistance est seulement absorbée (pas de doublon
    // à dispatcher), sans prévenir personne.
    if (Number(snc.payment_amount || 0) > 0) {
      out.traitees.push(`${ref} ← #${f.mission_number} (${f.source}) : client déjà payé, reste non couvert (fusion seule)`)
      if (opts.dryRun) continue
      const now = new Date().toISOString()
      await sb.from('incoming_missions').update({
        remarks_billing: [snc.remarks_billing, `Prise en charge ${f.source} ${f.dossier_number || f.external_id || ''} reçue après le paiement du client (${Number(snc.payment_amount).toFixed(2)} €) : le client se fait rembourser par son assistance avec notre facture.`].filter(Boolean).join('\n'),
        remarks_general: [snc.remarks_general, `— Fusion de la fiche #${f.mission_number} (${f.source}) le ${now.slice(0, 10)} : client déjà payé, reste non couvert`].filter(Boolean).join('\n'),
        updated_at: now,
      }).eq('id', snc.id)
      await sb.from('incoming_missions').update({ status: 'cancelled', merged_into_mission_id: snc.id, closing_notes: `Fusionnée dans #${snc.mission_number}`, updated_at: now }).eq('id', f.id).in('status', ['new', 'dispatching'])
      await sb.from('mission_logs').update({ mission_id: snc.id }).eq('mission_id', f.id)
      await sb.from('mission_logs').insert([
        { mission_id: snc.id, action: 'merge_in', notes: `Fiche #${f.mission_number} (${f.source}) fusionnée dans celle-ci — client déjà payé : il se fait rembourser par son assistance`, metadata: { secondary_id: f.id, auto: 'siabis_reprise_paye' } },
        { mission_id: f.id, action: 'merged', notes: `Fusionnée dans #${snc.mission_number}`, metadata: { master_id: snc.id } },
      ])
      continue
    }

    const montantTvac = Number(snc.amount_to_collect || 0)
    const entite = (await entiteAFacturer(f.raw_content)) || (f.billed_to_id ? { id: f.billed_to_id, name: f.billed_to_name } : null)
    out.traitees.push(`${ref} ← #${f.mission_number} (${f.source}) → ${entite?.name || 'client à préciser'}${montantTvac > 0 ? ` · ${montantTvac.toFixed(2)} € TVAC` : ''}`)
    if (opts.dryRun) continue

    const now = new Date().toISOString()
    const pec = String(f.raw_content || '').replace(/\s+/g, ' ').match(/(\d+[.,]\d{2})\s*euros?\s*TTC/i)?.[1] || null
    const upd: Record<string, any> = {
      source: 'sia_couvert', amount_to_collect: null, awaiting_payment: false,
      origin_source: snc.origin_source || f.source,
      ...(entite ? { billed_to_id: entite.id, billed_to_name: entite.name } : {}),
      // La référence de l'assistance devient celle de la facture ; celle du Siabis reste dans le dossier.
      external_id: f.external_id || snc.external_id,
      dossier_number: [f.dossier_number, snc.dossier_number].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' / ') || null,
      // Facturé au montant du Siabis non couvert (prix convenu HTVA).
      ...(montantTvac > 0 ? { special_tarif_htva: r2(montantTvac / 1.21) } : {}),
      siabis_couvert_decision: 'approved', siabis_couvert_decided_at: now, updated_at: now,
      remarks_billing: [`COUVERT par ${f.source} (reprise du Siabis non couvert) : prise en charge ${f.dossier_number || f.external_id || ''}${pec ? ` = ${pec} € TTC` : ''}. Facturé à ${entite?.name || 'l’assistance'}${montantTvac > 0 ? ` au montant du Siabis non couvert (${montantTvac.toFixed(2)} € TVAC)` : ''}.`, snc.remarks_billing ? `(Avant : ${snc.remarks_billing})` : ''].filter(Boolean).join('\n'),
      remarks_general: [snc.remarks_general, `— Fusion de la fiche #${f.mission_number} (${f.source}, ${f.dossier_number || ''}) le ${now.slice(0, 10)} : Siabis couvert par l’assistance (automatique)`].filter(Boolean).join('\n'),
    }
    // Comble les trous de la fiche Siabis avec ce que donne l'assistance (jamais d'écrasement, sauf valeurs bouche-trou).
    for (const k of ['client_name', 'client_phone', 'vehicle_vin', 'assisted_name', 'assisted_phone']) if (!snc[k] && f[k]) upd[k] = f[k]
    for (const k of ['vehicle_brand', 'vehicle_model']) if ((!snc[k] || /^(other|nc|autre|inconnu)$/i.test(String(snc[k]))) && f[k]) upd[k] = f[k]
    const { error: e1 } = await sb.from('incoming_missions').update(upd).eq('id', snc.id).eq('source', 'police_snc')
    if (e1) { out.alertes.push(`${ref} : ${e1.message}`); continue }
    await sb.from('incoming_missions').update({ status: 'cancelled', merged_into_mission_id: snc.id, closing_notes: `Fusionnée dans #${snc.mission_number}`, updated_at: now }).eq('id', f.id).in('status', ['new', 'dispatching'])
    await sb.from('mission_logs').update({ mission_id: snc.id }).eq('mission_id', f.id)
    await sb.from('mission_logs').insert([
      { mission_id: snc.id, action: 'merge_in', notes: `Fiche #${f.mission_number} (${f.source}, ${f.dossier_number || ''}) fusionnée dans celle-ci — prise en charge reçue pendant le Siabis non couvert`, metadata: { secondary_id: f.id, auto: 'siabis_reprise' } },
      { mission_id: f.id, action: 'merged', notes: `Fusionnée dans #${snc.mission_number}`, metadata: { master_id: snc.id } },
      { mission_id: snc.id, action: 'siabis_couvert_approved', notes: `Passage en Siabis couvert : ${f.source} reprend le dossier — plus d’encaissement client. Facture à ${entite?.name || 'l’assistance'}${montantTvac > 0 ? `, ${r2(montantTvac / 1.21).toFixed(2)} € HTVA (montant du Siabis non couvert)` : ''}.` },
    ])

    // Chauffeur : notification, Telegram, fenêtre Aide.
    if (snc.assigned_to && ACTIVES.includes(String(snc.status))) {
      const { agentDuMoment } = await import('@/lib/sam/core')
      const agent = agentDuMoment()
      const texte = `${snc.vehicle_plate} : l'assistance reprend le dossier, c'est maintenant un Siabis couvert. Ne fais plus payer le client : il n'y a plus rien à encaisser. Recharge ta fiche et clôture normalement.`
      const { sendNotification } = await import('@/lib/notifications/send')
      await sendNotification(snc.assigned_to, 'siabis_couvert_decided', { title: `✅ Siabis COUVERT — ${snc.vehicle_plate}`, body: texte, mission_id: snc.id, action_url: `/mission/${snc.id}`, data: { decision: 'approve' } }).catch(() => {})
      const { data: link } = await sb.from('telegram_links').select('chat_id').eq('user_id', snc.assigned_to).maybeSingle()
      if (link?.chat_id) { const { tgSend } = await import('@/lib/sam/telegram'); await tgSend(Number(link.chat_id), texte, [], agent).catch(() => {}) }
      await sb.from('sam_alertes').insert({ mission_id: snc.id, user_id: snc.assigned_to, kind: 'siabis_reprise', agent, texte, boutons: [{ libelle: '👍 Compris', valeur: 'ok' }] }).then(() => {}, () => {})
    }
    const { sendNotificationToRoles } = await import('@/lib/notifications/send')
    await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'siabis_couvert_request', {
      title: `🔵 ${snc.vehicle_plate} : Siabis repris par ${f.source}`,
      body: `#${f.mission_number} fusionnée dans #${snc.mission_number}, passé en couvert, facturé à ${entite?.name || 'l’assistance (à préciser)'}. Le chauffeur est prévenu.`,
      mission_id: snc.id, action_url: `/dispatch/${snc.id}`,
    }).catch(() => {})
  }
  return out
}
