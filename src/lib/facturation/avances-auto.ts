// src/lib/facturation/avances-auto.ts — refacturation AUTOMATIQUE des avances de fonds (Olivier 24/11/2026 :
// « Les avances de fonds sont importantes, il ne faut pas qu'il y ait des manques. Si on encode des achats sans
// refacturer les avances de fond, notre automatisation ne sert à rien » ; « ça doit être automatique »).
//
// Avant : la refacturation dépendait de Florent, qui devait penser à la proposer après avoir relié la plaque.
// Oublis constatés : Plateau 1BMY317 (BILL/2026/11/0053, Allianz) et Logicx 1STG090 (BILL/2026/11/0041, Touring).
//
// Ici, sans agent : toute facture d'achat VALIDÉE de Verviers Dépannage, reliée à un véhicule dont la fiche est
// payée par une assistance (payeur renseigné, source ni police ni privé), et qui n'a pas encore de vente d'avance,
// part dans le circuit habituel « Refacturation d'une avance de fonds » (bouton de l'ERP, client = l'assistance de
// la fiche, n° de dossier de la fiche, justificatif joint, envoi mail + Peppol), au nom de Florent.
// Un cas douteux (plusieurs assistances ou dossiers possibles, pas de n° de dossier) ne part jamais : question à Mobi.
import { createAdminClient } from '@/lib/supabase'
import { odooRpcCompany } from '@/lib/odoo'
import { journal } from '@/lib/agents/core'

const VD = 1
const norm = (p: unknown) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const PAS_ASSISTANCE = /^(police|prive|particulier|gardiennage|unknown|circuit|interne)/i

export interface AvanceAuto { achat: string; plaque: string; statut: 'deposee' | 'deja' | 'douteux' | 'erreur'; detail: string }

/** Une vente d'avance existe-t-elle déjà pour cet achat (bouton, ou faite à la main sur le même dossier/véhicule) ? */
export async function avanceDejaRefacturee(achat: { id: number; name: string; amount_untaxed: number; amount_total?: number; plaqueId?: number | null }, dossier?: string | null): Promise<string | null> {
  const parOrigine: any[] = await odooRpcCompany(VD, 'account.move', 'search_read', [[['move_type', '=', 'out_invoice'], ['invoice_origin', '=', achat.name], ['state', '!=', 'cancel']]], { fields: ['name'], limit: 1 })
  if (parOrigine.length) return parOrigine[0].name || 'brouillon'
  const or: any[] = []
  if (dossier) or.push(['move_id.ref', 'ilike', dossier.replace(/-REL$/i, '')])
  if (achat.plaqueId) or.push(['move_id.x_studio_plaque_1', '=', achat.plaqueId])
  if (!or.length) return null
  const dom: any[] = [['move_id.move_type', '=', 'out_invoice'], ['parent_state', '!=', 'cancel'], '|', ['name', 'ilike', 'avance'], ['product_id.name', 'ilike', 'avance']]
  if (or.length === 2) dom.push('|')
  dom.push(...or)
  const lignes: any[] = await odooRpcCompany(VD, 'account.move.line', 'search_read', [dom], { fields: ['move_id', 'price_subtotal', 'price_total'] })
  // Même avance : refacturée au HTVA de l'achat, ou au total payé SANS la TVA étrangère non récupérable
  // (achat allemand 89,25 € TVAC refacturé 75,00 € : TVA de 0 à 27 %). Fourchette [TTC / 1,27 ; TTC].
  const ttc = Number(achat.amount_total ?? achat.amount_untaxed)
  const meme = lignes.find(l => {
    const ht = Number(l.price_subtotal)
    return Math.abs(ht - achat.amount_untaxed) < 0.02 || (ht >= ttc / 1.27 - 0.02 && ht <= ttc + 0.02)
  })
  return meme ? meme.move_id[1] : null
}

export async function refacturerAvancesManquantes(opts: { depuis?: string; simuler?: boolean } = {}): Promise<AvanceAuto[]> {
  const depuis = opts.depuis || new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10)
  const sb = createAdminClient()
  const out: AvanceAuto[] = []
  const achats: any[] = await odooRpcCompany(VD, 'account.move', 'search_read', [[['move_type', '=', 'in_invoice'], ['state', '=', 'posted'], ['invoice_date', '>=', depuis], ['x_studio_plaque_1', '!=', false]]],
    { fields: ['id', 'name', 'ref', 'partner_id', 'invoice_date', 'amount_untaxed', 'amount_total', 'x_studio_plaque_1'], order: 'invoice_date asc' })
  const { data: flor } = await sb.from('agent_accounts').select('id, name, role_label, companies, kinds, direct_kinds, validator_user_id, active').eq('name', 'Florent').maybeSingle()
  for (const a of achats) {
    const plaque = norm(String(a.x_studio_plaque_1[1]).split('/').pop())
    if (plaque.length < 5) continue
    // Fiche(s) du véhicule payées par une assistance, autour de la date de l'achat.
    const debut = new Date(new Date(a.invoice_date).getTime() - 120 * 86_400_000).toISOString()
    const fin = new Date(new Date(a.invoice_date).getTime() + 10 * 86_400_000).toISOString()
    const { data: fiches } = await sb.from('incoming_missions').select('mission_number, source, billed_to_id, billed_to_name, dossier_number, created_at, dossier_leg')
      .ilike('vehicle_plate', `%${plaque}%`).gte('created_at', debut).lte('created_at', fin).not('billed_to_id', 'is', null)
    const ass = (fiches || []).filter((f: any) => !PAS_ASSISTANCE.test(String(f.source || '')) && !f.dossier_leg)
    if (!ass.length) continue
    const deja = await avanceDejaRefacturee({ id: a.id, name: a.name, amount_untaxed: Number(a.amount_untaxed), amount_total: Number(a.amount_total), plaqueId: a.x_studio_plaque_1[0] }, ass[0].dossier_number)
    if (deja) continue
    const clients = [...new Set(ass.map((f: any) => Number(f.billed_to_id)))]
    const dossiers = [...new Set(ass.map((f: any) => String(f.dossier_number || '').replace(/-REL$/i, '')).filter(Boolean))]
    const lib = `${a.name} (${a.partner_id?.[1] || ''}, ${Number(a.amount_total).toFixed(2)} € TVAC) · ${plaque}`
    if (clients.length !== 1 || dossiers.length !== 1) {
      out.push({ achat: a.name, plaque, statut: 'douteux', detail: `${lib} : ${clients.length} payeur(s) et ${dossiers.length} dossier(s) possibles (${ass.map((f: any) => `#${f.mission_number} ${f.billed_to_name} ${f.dossier_number || 'sans dossier'}`).join(' ; ')})` })
      continue
    }
    if (opts.simuler || !flor?.active) { out.push({ achat: a.name, plaque, statut: 'deposee', detail: `${lib} → ${ass[0].billed_to_name}, dossier ${dossiers[0]}${opts.simuler ? ' (simulation)' : ' (Florent inactif : rien déposé)'}` }); continue }
    try {
      const { submitProposal } = await import('@/lib/agents/proposals')
      const r = await submitProposal(flor as any, {
        type: 'refacturation_avance', societe: VD,
        contenu: { achat_id: a.id, client_id: clients[0], dossier: dossiers[0] },
        pourquoi: `Contrôle automatique des avances de fonds : achat validé relié à ${plaque}, fiche #${ass[0].mission_number} payée par ${ass[0].billed_to_name} (dossier ${dossiers[0]}), aucune vente d'avance trouvée pour cet achat.`,
      })
      out.push({ achat: a.name, plaque, statut: r.error ? 'erreur' : 'deposee', detail: `${lib} → ${ass[0].billed_to_name}, dossier ${dossiers[0]} : ${r.status}${r.note ? ' — ' + r.note : ''}${r.error ? ' — ' + r.error : ''}` })
    } catch (e: any) {
      out.push({ achat: a.name, plaque, statut: 'erreur', detail: `${lib} : ${String(e?.message || e).slice(0, 300)}` })
    }
  }
  // Un cas douteux ou en échec n'est signalé qu'UNE fois (pas toutes les heures) : réglage avances_auto_signalees.
  if (!opts.simuler) {
    const { data: s } = await sb.from('app_settings').select('value').eq('key', 'avances_auto_signalees').maybeSingle()
    let deja: string[] = []; try { deja = JSON.parse(String(s?.value || '[]')) } catch { deja = [] }
    const nouveaux = out.filter(x => (x.statut === 'douteux' || x.statut === 'erreur') && !deja.includes(x.achat))
    for (const o of nouveaux) await journal({ agent: 'Florent', company: VD, action: o.statut === 'douteux' ? 'avance à trancher' : 'avance non refacturée', detail: o.detail, ok: false })
    if (nouveaux.length) await sb.from('app_settings').upsert({ key: 'avances_auto_signalees', value: JSON.stringify([...deja, ...nouveaux.map(x => x.achat)].slice(-500)) }, { onConflict: 'key' })
  }
  return out
}
