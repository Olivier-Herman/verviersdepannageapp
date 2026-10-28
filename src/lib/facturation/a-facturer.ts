// src/lib/facturation/a-facturer.ts — « À facturer — pourquoi ça bloque » (Olivier 28/10/2026, maquette
// https://claude.ai/artifact/8JhA5Spa6fRXrTmDYasPCH validée, écran visible par lui seul).
// Chaque fiche terminée pas encore facturée (statut to_invoice) est rangée dans UN groupe qui dit pourquoi elle
// attend et ce qu'il faut faire. Calcul en direct, rien n'est écrit.

import { createAdminClient } from '@/lib/supabase'
import { listSourceCatalog } from '@/lib/missions/source-catalog'
import { checkAutoInvoiceEligible, getAutoInvoiceRules } from '@/lib/facturation/auto-invoice'

export type CleGroupe = 'touring' | 'touring_comex' | 'forcees' | 'axa' | 'saisies' | 'siabis' | 'hexalite' | 'combinee' | 'regle' | 'normal' | 'autre'
export interface LigneAF { id: string; numero: number | null; plaque: string | null; client: string | null; terminee: string | null; jours: number; detail: string }
export interface GroupeAF { cle: CleGroupe; titre: string; pourquoi: string; afaire: string; ton: 'rouge' | 'orange' | 'bleu' | 'vert'; lignes: LigneAF[] }

const DEF: Record<CleGroupe, Omit<GroupeAF, 'cle' | 'lignes'>> = {
  touring:       { ton: 'rouge',  titre: 'Touring — pas encore proposé dans COMEX', pourquoi: 'Touring propose lui-même le montant dans COMEX ; tant qu’il ne l’a pas fait, la fiche attend. Normal quelques jours, anormal au-delà de 3 semaines.', afaire: 'réclamer à Touring les dossiers de plus de 21 jours.' },
  touring_comex: { ton: 'orange', titre: 'Touring — dans COMEX, pas encore validé', pourquoi: 'Le dossier est dans COMEX mais n’a pas été accepté : le montant de Touring ne correspond pas au nôtre, ou il reste un statut à passer.', afaire: 'comparer les montants dans COMEX et accepter ou contester.' },
  forcees:       { ton: 'orange', titre: 'Forcées « à facturer » par le dispatch', pourquoi: 'Le statut a été forcé à la main : la facturation automatique ne les prend pas.', afaire: 'facturer à la main ou remettre la fiche dans le bon circuit.' },
  axa:           { ton: 'bleu',   titre: 'AXA — client à choisir (01 ou 34)', pourquoi: 'Le client facturé n’est pas tranché entre AXA 01 et AXA 34 : la facture ne peut pas partir.', afaire: 'choisir 01 ou 34 sur la fiche.' },
  saisies:       { ton: 'orange', titre: 'Police — état de frais ou client manquant', pourquoi: 'Une fiche police se facture par état de frais ou au client qui récupère le véhicule.', afaire: 'faire l’état de frais, ou indiquer qui paie.' },
  siabis:        { ton: 'bleu',   titre: 'Siabis couvert — facturé à Touring via COMEX', pourquoi: 'Ces interventions Siabis sont payées par Touring : elles suivent le circuit COMEX.', afaire: 'suivre dans COMEX.' },
  hexalite:      { ton: 'vert',   titre: 'Allianz (Mondial) — auto-facture Hexalite attendue', pourquoi: 'Allianz crée elle-même la facture (SEL) ; elle est validée dès qu’elle arrive.', afaire: 'rien, sauf au-delà de 10 jours.' },
  combinee:      { ton: 'vert',   titre: 'Facturé avec le reste du dossier', pourquoi: 'Le remorquage et sa relivraison (ou le parc) partent sur une seule facture, quand tout le dossier est terminé.', afaire: 'rien, sauf si la relivraison traîne.' },
  regle:         { ton: 'orange', titre: 'Facturation automatique coupée pour ce cas', pourquoi: 'La règle de facturation automatique de cette source ou de ce type est désactivée, ou le type n’est pas pris en charge.', afaire: 'facturer à la main.' },
  normal:        { ton: 'vert',   titre: 'Rien à faire — part au prochain passage', pourquoi: 'La facturation automatique la prendra à son prochain passage (dans tes heures, toutes les 15 minutes).', afaire: 'rien.' },
  autre:         { ton: 'orange', titre: 'À regarder', pourquoi: 'Aucune raison connue n’explique l’attente.', afaire: 'ouvrir la fiche.' },
}
const ORDRE: CleGroupe[] = ['touring', 'forcees', 'axa', 'saisies', 'touring_comex', 'regle', 'autre', 'siabis', 'hexalite', 'combinee', 'normal']
const TYPE: Record<string, string> = { remorquage: 'Remorquage', depannage: 'Dépannage', 'REM+REL': 'Remorquage + relivraison', relivraison: 'Relivraison', REL: 'Relivraison', trajet_vide: 'Trajet vide', transport: 'Transport' }

export async function blocagesAFacturer(): Promise<{ groupes: GroupeAF[]; total: number; plus21: number }> {
  const sb = createAdminClient()
  const { data: ms } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, source, mission_type, billed_to_name, completed_at, parent_mission_id, kaze_job_id, axa_mission_order_id, touring_accepted_at, dossier_leg')
    .eq('status', 'to_invoice').eq('dossier_leg', false).order('completed_at', { ascending: true }).limit(1000)
  const fiches = ms || []
  const ids = fiches.map(m => m.id)
  const forcees = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    // Seul le forçage à la main compte : une sortie de parc (restitution, abandon) passe aussi par ce journal.
    const { data } = await sb.from('mission_logs').select('mission_id, notes').eq('action', 'force_status_to_invoice').in('mission_id', ids.slice(i, i + 200))
    for (const l of data || []) if (/statut forc/i.test(String(l.notes || ''))) forcees.add(l.mission_id)
  }
  const { data: cx } = await sb.from('touring_comex_dossiers').select('mission_id, mission_ids, in_comex, accepted_at, verdict')
  const comex = new Map<string, any>()
  for (const c of cx || []) { if (c.mission_id) comex.set(c.mission_id, c); for (const id of c.mission_ids || []) comex.set(id, c) }
  const catalogue = await listSourceCatalog()
  const hexa = new Set(catalogue.filter(r => r.tags.includes('hexalite')).map(r => r.key.toLowerCase()))
  const rules = await getAutoInvoiceRules(sb)

  const auj = Date.now()
  const groupes = new Map<CleGroupe, LigneAF[]>()
  let plus21 = 0
  for (const m of fiches) {
    const src = String(m.source || '').toLowerCase()
    const jours = m.completed_at ? Math.max(0, Math.floor((auj - Date.parse(m.completed_at)) / 86_400_000)) : 0
    if (jours > 21) plus21++
    const c = comex.get(m.id)
    let cle: CleGroupe, detail = TYPE[m.mission_type] || m.mission_type || ''
    if (forcees.has(m.id)) { cle = 'forcees'; detail += ' — statut forcé' }
    else if (/01 ou 34/i.test(String(m.billed_to_name || ''))) cle = 'axa'
    else if (src.startsWith('police_')) cle = 'saisies'
    else if (src === 'sia_couvert') cle = 'siabis'
    else if (/touring/.test(src)) { cle = c && c.in_comex && !c.accepted_at ? 'touring_comex' : 'touring'; if (c?.verdict && cle === 'touring_comex') detail += ` — verdict ${c.verdict}` }
    else if (hexa.has(src)) cle = 'hexalite'
    else {
      const chk = checkAutoInvoiceEligible(m as any, rules, false)
      if (chk.eligible) cle = 'normal'
      else if (/combin/i.test(chk.reason || '')) cle = 'combinee'
      else if (/désactivée|hors périmètre|manuelle/i.test(chk.reason || '')) { cle = 'regle'; detail += ` — ${chk.reason}` }
      else { cle = 'autre'; detail += chk.reason ? ` — ${chk.reason}` : '' }
    }
    if (cle !== 'forcees' && /^REM\+REL$|^relivraison$|^REL$/.test(String(m.mission_type || '')) && m.parent_mission_id && cle === 'normal') cle = 'combinee'
    const l: LigneAF = { id: m.id, numero: m.mission_number, plaque: m.vehicle_plate, client: m.billed_to_name, terminee: m.completed_at, jours, detail }
    groupes.set(cle, [...(groupes.get(cle) || []), l])
  }
  return {
    total: fiches.length, plus21,
    groupes: ORDRE.filter(k => groupes.get(k)?.length).map(k => ({ cle: k, ...DEF[k], lignes: groupes.get(k)!.sort((a, b) => b.jours - a.jours) })),
  }
}
