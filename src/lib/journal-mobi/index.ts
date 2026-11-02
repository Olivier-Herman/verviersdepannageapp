// src/lib/journal-mobi/index.ts — journal des tâches de Mobi (Olivier 02/11/2026, maquette
// https://claude.ai/artifact/LQbVEa6GPfXt1RhvJu8reJ). Deux parts, toujours séparées :
//   • « Mobi lui-même » (type mobi) : ses mises en ligne (une ligne par modification de VD Soft) et ce qu'il fait en
//     séance (fusions, envois, décisions) ;
//   • « automatismes de Mobi » (type auto) : tout ce que les outils font sans qu'aucun nom ne soit enregistré, compté
//     chaque nuit par catégorie.
// Ce qui porte le nom d'un membre de l'équipe n'y figure jamais. Conservation : 12 mois.

import type { createAdminClient } from '@/lib/supabase'

type Sb = ReturnType<typeof createAdminClient>

// ── Domaines des tâches de Mobi (d'après le sujet de la modification) ──────────────────────────────────────────
export const DOMAINES = [
  { cle: 'app', titre: 'Dispatch & chauffeurs', re: /^(sam|chauffeur|driver|pause|dispatch|siabis|mission|cloture|clôture|parc-chauffeur|app|watch|talkie|garde|market|i18n|onsite|pointage|vr)/i },
  { cle: 'assist', titre: 'Assistances & intégrations', re: /^(touring|comex|vab|kaze|ima|axa|allianz|hexalite|anwb|mondial|tse|eurocross|assist)/i },
  { cle: 'factu', titre: 'Facturation & comptabilité', re: /^(factur|a-facturer|invoice|achats|compta|relance|releve|rapproch|finance|paiement|tva|odoo|especes|caisse|encaiss|paie)/i },
  { cle: 'fourriere', titre: 'Fourrière, parc & Justice', re: /^(fourriere|fourrière|parc|saisie|requisitoire|réquisitoire|domaine|edf|justice|peppol|levee|restitution)/i },
  { cle: 'exploit', titre: 'Organisation & communication', re: /./ },
] as const

export function domaineDe(scope: string): string {
  return (DOMAINES.find(d => d.re.test(scope)) || DOMAINES[DOMAINES.length - 1]).titre
}

// ── Catégories des automatismes (actions de fiche sans nom) ──────────────────────────────────────────────────────
export const CATEGORIES: { cle: string; titre: string; test: (a: string) => boolean }[] = [
  { cle: 'missions', titre: 'Missions reçues des assistances et créées automatiquement', test: a => a === 'received' },
  { cle: 'relances', titre: 'Rappels et relances (réquisitoires, fiches ouvertes, pauses)', test: a => /relance|reminder|overdue/.test(a) },
  { cle: 'fourriere', titre: 'Fourrière, parc et Justice (états de frais, Domaine, contrôles du parc)', test: a => /etat_frais|requisitoire|officer|justinvoice|levee_saisie|domaine|parc_|zone_k|zone_t|gardiennage|exit_control|epave/.test(a) },
  { cle: 'facturation', titre: 'Facturation automatique (factures émises, fiches clôturées)', test: a => /^(invoiced|invoice_autoposted|auto_completed|completed|rapport_facture|billing_updated)$/.test(a) },
  { cle: 'paiements', titre: 'Paiements reconnus et rapprochés', test: a => a === 'invoice_paid' },
  { cle: 'assistances', titre: 'Synchronisations avec les plateformes des assistances', test: a => /kaze|touring|vab|axa|comex|cancelled_by|anwb|^note$/.test(a) },
  { cle: 'preparation', titre: 'Fiches préparées (adresses localisées, compléments, doublons évités)', test: a => /enrich|geocod|email_|address_change|source_|auto_convert|escalated|vehicle_ocr/.test(a) },
  { cle: 'sam', titre: 'Sam et Sonic : alertes et conversations avec les chauffeurs', test: a => a === 'sam_copilote' },
  { cle: 'appels', titre: 'Appels téléphoniques automatiques', test: a => /appel|_call$/.test(a) },
  { cle: 'dispatch', titre: 'Dispatch, relivraisons et étiquettes', test: a => /dispatched|rel_|relivraison|reoffered|label|cancelled|merged|transfer/.test(a) },
  { cle: 'autres', titre: 'Autres contrôles et corrections', test: () => true },
]
export const categorieDe = (action: string) => CATEGORIES.find(c => c.test(action))!

// ── Ce que Mobi signe lui-même dans VD Soft (actions de fiche à son nom) ──────────────────────────────────────────
// Les améliorations de l'app n'y figurent pas : c'est le support de l'app, pas une tâche pour VD (Olivier 02/11/2026).
export const CATEGORIES_MOBI: { cle: string; titre: string; test: (a: string) => boolean }[] = [
  { cle: 'm_factu', titre: 'Facturation des dossiers (factures, fiches sans frais, clôtures, commissions)', test: a => /dossier_invoice|invoiced|no_charge|force_status|auto_completed|commission|regularisation|correction|^completed$|billing/.test(a) },
  { cle: 'm_fourriere', titre: 'Fourrière : restitutions, levées de saisie, Domaine, états de frais, abandons', test: a => /restitution|levee_saisie|abandon|domaine|^ef_|etat_frais|scratch|requisitoire/.test(a) },
  { cle: 'm_parc', titre: 'Parc : transferts de zone, gardiennage, blocages police', test: a => /parc|zone|gardiennage|police_block/.test(a) },
  { cle: 'm_dispatch', titre: 'Dispatch et suivi des assistances (attributions, relivraisons, adresses, fusions)', test: a => /dispatch|rel_|relivraison|reoffered|address|redelivery|cancel|merge|pause|resumed|pointages|checkpoint|delivery|siabis|snc_|reactivated|touring|axa|vab|kaze|odoo_synced|flux2/.test(a) },
  { cle: 'm_autres', titre: 'Autres interventions sur les fiches (notes, photos, corrections)', test: () => true },
]
// Comptes d'Olivier : réglage mobi_user_ids (VD Soft) ; comptes de l'ERP : mobi_odoo_uids (lui) et auto_odoo_uids
// (VD Soft et l'ERP qui travaillent seuls).
async function liste(key: string): Promise<string[]> {
  const { getBusinessList } = await import('@/lib/settings/business')
  return (await getBusinessList(key).catch(() => [] as string[])).map(String)
}

/** Bornes UTC d'un jour belge (AAAA-MM-JJ). */
function bornes(jour: string): [string, string] {
  const off = (d: string) => {
    const s = new Date(`${d}T12:00:00Z`).toLocaleString('en-US', { timeZone: 'Europe/Brussels', timeZoneName: 'shortOffset' })
    const m = s.match(/GMT([+-]\d+)/); return m ? Number(m[1]) : 1
  }
  const start = new Date(`${jour}T00:00:00Z`); start.setUTCHours(-off(jour))
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1)
  return [start.toISOString(), end.toISOString()]
}

/** Compte les automatismes d'un jour et les enregistre (idempotent), puis purge au-delà de 12 mois. */
export async function agregerJour(sb: Sb, jour: string): Promise<Record<string, number>> {
  const [d1, d2] = bornes(jour)
  const counts: Record<string, number> = {}
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from('mission_logs').select('action').is('actor_id', null).gte('created_at', d1).lt('created_at', d2).range(off, off + 999)
    if (error) throw new Error(error.message)
    for (const x of data || []) { const c = categorieDe(String(x.action)).cle; counts[c] = (counts[c] || 0) + 1 }
    if ((data || []).length < 1000) break
  }
  const { count: conv } = await sb.from('sam_conversations').select('id', { count: 'exact', head: true }).gte('started_at', d1).lt('started_at', d2)
  if (conv) counts.sam = (counts.sam || 0) + conv
  const rows: any[] = Object.entries(counts).filter(([, n]) => n > 0).map(([cle, n]) => ({
    jour, type: 'auto', domaine: cle, titre: CATEGORIES.find(c => c.cle === cle)!.titre, quantite: n, ref: `auto:${jour}:${cle}`,
  }))

  // Mobi lui-même : ses actions signées dans VD Soft.
  const mobiIds = await liste('mobi_user_ids')
  const mc: Record<string, number> = {}
  if (mobiIds.length) for (let off = 0; ; off += 1000) {
    const { data } = await sb.from('mission_logs').select('action').in('actor_id', mobiIds).gte('created_at', d1).lt('created_at', d2).range(off, off + 999)
    for (const x of data || []) { const c = CATEGORIES_MOBI.find(k => k.test(String(x.action)))!.cle; mc[c] = (mc[c] || 0) + 1 }
    if ((data || []).length < 1000) break
  }
  for (const [cle, n] of Object.entries(mc)) rows.push({ jour, type: 'mobi', domaine: cle, titre: CATEGORIES_MOBI.find(c => c.cle === cle)!.titre, quantite: n, ref: `mobi:${jour}:${cle}` })

  // L'ERP : pièces comptables et lettrages, par Mobi d'un côté, par les automatismes de l'autre.
  try {
    const { odooRpc } = await import('@/lib/odoo')
    const dt = (iso: string) => iso.slice(0, 19).replace('T', ' ')
    const compte = async (model: string, uids: number[]) => uids.length ? Number(await odooRpc(model, 'search_count', [[['create_uid', 'in', uids], ['create_date', '>=', dt(d1)], ['create_date', '<', dt(d2)]]])) : 0
    const mUids = (await liste('mobi_odoo_uids')).map(Number), aUids = (await liste('auto_odoo_uids')).map(Number)
    const lignes: [string, 'mobi' | 'auto', string, number][] = [
      ['erp_pieces', 'mobi', 'Comptabilité : pièces encodées dans l’ERP (factures, achats, notes de crédit, opérations diverses)', await compte('account.move', mUids)],
      ['erp_lettrages', 'mobi', 'Comptabilité : paiements lettrés et rapprochements bancaires', await compte('account.partial.reconcile', mUids)],
      ['erp_pieces_auto', 'auto', 'Comptabilité automatique : pièces créées seules (factures, achats reçus, relevés)', await compte('account.move', aUids)],
      ['erp_lettrages_auto', 'auto', 'Comptabilité automatique : paiements lettrés et rapprochements', await compte('account.partial.reconcile', aUids)],
    ]
    for (const [cle, type, titre, n] of lignes) if (n > 0) rows.push({ jour, type, domaine: cle, titre, quantite: n, ref: `${type}:${jour}:${cle}` })
  } catch (e: any) { console.warn('[journal-mobi] ERP', e?.message) }

  // Ses mails envoyés (mobi@).
  try {
    const boite = (await liste('mobi_boite_mail'))[0]
    if (boite) {
      const { getAppOnlyToken } = await import('@/lib/graph-mail-search')
      const tok = await getAppOnlyToken()
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${boite}/mailFolders/sentitems/messages?$filter=sentDateTime ge ${d1} and sentDateTime lt ${d2}&$select=id&$top=999`, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' })
      const n = r.ok ? ((await r.json()).value || []).length : 0
      if (n) rows.push({ jour, type: 'mobi', domaine: 'mails', titre: 'Mails envoyés (assistances, fournisseurs, comptable, administrations)', quantite: n, ref: `mobi:${jour}:mails` })
    }
  } catch (e: any) { console.warn('[journal-mobi] mails', e?.message) }
  if (rows.length) { const { error } = await sb.from('journal_mobi').upsert(rows, { onConflict: 'ref' }); if (error) throw new Error(error.message) }
  const limite = new Date(); limite.setUTCMonth(limite.getUTCMonth() - 12)
  await sb.from('journal_mobi').delete().lt('jour', limite.toISOString().slice(0, 10))
  return counts
}

/** Ajoute une tâche de Mobi (séance, intervention). `ref` évite les doublons. */
export async function noterTache(sb: Sb, t: { at?: string; domaine?: string; titre: string; detail?: string; ref?: string }) {
  const at = t.at || new Date().toISOString()
  const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(at))
  const { error } = await sb.from('journal_mobi').upsert({ jour, at, type: 'mobi', domaine: t.domaine || DOMAINES[DOMAINES.length - 1].titre, titre: t.titre.slice(0, 300), detail: t.detail || null, ref: t.ref || `seance:${at}:${t.titre.slice(0, 40)}` }, { onConflict: 'ref' })
  if (error) throw new Error(error.message)
}

export interface MoisJournal {
  mois: string                                    // AAAA-MM
  taches: { jour: string; at: string | null; domaine: string; titre: string; detail: string | null }[]   // séances
  mobi: { jour: string; cle: string; titre: string; quantite: number }[]                                    // comptées
  auto: { jour: string; cle: string; titre: string; quantite: number }[]
}

export async function lireMois(sb: Sb, mois: string): Promise<MoisJournal> {
  const [y, m] = mois.split('-').map(Number)
  const fin = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  const all: any[] = []
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from('journal_mobi').select('jour, at, type, domaine, titre, detail, quantite, ref').gte('jour', `${mois}-01`).lt('jour', fin).order('jour').order('at').range(off, off + 999)
    all.push(...(data || [])); if ((data || []).length < 1000) break
  }
  return {
    mois,
    taches: all.filter(r => r.type === 'mobi' && String(r.ref || '').startsWith('seance:')).map(r => ({ jour: r.jour, at: r.at, domaine: r.domaine || '', titre: r.titre, detail: r.detail })),
    mobi: all.filter(r => r.type === 'mobi' && !String(r.ref || '').startsWith('seance:')).map(r => ({ jour: r.jour, cle: r.domaine, titre: r.titre, quantite: r.quantite || 0 })),
    auto: all.filter(r => r.type === 'auto').map(r => ({ jour: r.jour, cle: r.domaine, titre: r.titre, quantite: r.quantite || 0 })),
  }
}
