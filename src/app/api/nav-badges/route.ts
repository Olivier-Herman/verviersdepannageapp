// src/app/api/nav-badges/route.ts
//
// Compteurs d'attention pour le menu de gauche : renvoie un objet { href: count }
// des éléments à traiter, selon le rôle du user. Le menu affiche un petit badge.
// Léger et no-store — appelé au montage de l'AppShell.
//
// Renvoie AUSSI les flags d'affichage du menu ({ flags: { nav_menu_v2 } }), déjà
// résolus côté serveur pour le rôle du user (off / superadmin / all). Ça évite une
// requête supplémentaire par page : l'AppShell appelle déjà cette route au montage.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient }  from '@/lib/supabase'
import { isPersonnelStaff }   from '@/lib/rh-access'
import { isPreviewOn }        from '@/lib/feature-flags'
import { getBusinessList }    from '@/lib/settings/business'
import { sourcesWithTag }     from '@/lib/missions/source-catalog'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ badges: {}, flags: { nav_menu_v2: false } })
  const sb = createAdminClient()
  const badges: Record<string, number> = {}
  const flags = { nav_menu_v2: await isPreviewOn('nav_menu_v2', u.role, u.id) }   // u.id : les pilotes nommés (Jona) voient le menu v3

  // Gestion du personnel : congés en attente de traitement (pending + annulation demandée).
  if (isPersonnelStaff(u)) {
    const { count } = await sb.from('conge_requests').select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'cancel_requested'])
    if (count) badges['/personnel'] = count
  }

  // TGR Gestion : demandes non traitées (statut « pending »).
  if ((u.modules || []).includes('admin') || u.role === 'superadmin') {
    const { count } = await sb.from('tgr_missions').select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    if (count) badges['/admin/tgr'] = count
  }

  // Dispatch : les missions EN COMMANDE, c'est-à-dire l'onglet « En commande »
  // du tableau (statut `new`). Olivier 2026-08-31 : « il doit compter les
  // missions en commande, c'est tout ».
  //
  // Avant, il comptait les fiches dont la tarification Siabis n'était pas
  // tranchée. Mauvais compteur pour deux raisons : ça ne correspond à aucun
  // onglet, et le drapeau survit à la clôture — une mission `completed` gardait
  // le badge allumé indéfiniment, en pointant vers un tableau où elle
  // n'apparaît plus. (Cas vu ce jour-là : #10103551, dépannage A27 du 07/08,
  // badge bloqué depuis 24 jours.)
  //
  // Mêmes filtres que l'onglet, sinon le badge annonce un chiffre qu'on ne
  // retrouve pas en cliquant : archivées exclues (filtre global de la liste) et
  // VHU exclu (il a son propre onglet).
  const roles = [u.role, ...(u.roles || [])]
  if ((u.modules || []).includes('missions') || roles.some((r: string) => ['dispatcher', 'admin', 'superadmin'].includes(r))) {
    const { VHU_SOURCE } = await import('@/lib/missions/vhu')
    const estSuperadmin = roles.includes('superadmin')
    let q = sb.from('incoming_missions').select('id', { count: 'exact', head: true })
      .eq('status', 'new')
      .neq('source', VHU_SOURCE)              // VHU → onglet dédié
      .is('archived_at', null)
      // Mêmes filtres anti-parasites que /api/missions/list, sinon le badge
      // annonce un chiffre qu'on ne retrouve pas en cliquant : sans eux on
      // comptait 49 fiches là où l'onglet en montre une poignée (corps vides,
      // expéditeur inconnu, parsing trop incertain).
      .not('external_id', 'like', 'PROCESSING_%')
      .not('external_id', 'like', 'UNKNOWN_SENDER_%')
      .or('parse_confidence.is.null,parse_confidence.gte.0.3,assigned_to.not.is.null')
    // Les fiches de test ne sont visibles qu'au superadmin, badge compris.
    if (!estSuperadmin) q = q.not('vehicle_plate', 'ilike', 'TEST')
    const { count } = await q
    if (count) badges['/dispatch'] = count
  }

  // ── Menu v3, lot 1 (09/09/2026) : compteurs sur les pages de décision ──────
  const isFourriere = roles.some((r: string) => ['admin', 'superadmin'].includes(r)) || (u.modules || []).includes('fourriere')
  const isDispatch  = (u.modules || []).includes('missions') || roles.some((r: string) => ['dispatcher', 'admin', 'superadmin'].includes(r))
  const isFactu     = (u.modules || []).includes('facturation') || roles.some((r: string) => ['admin', 'superadmin'].includes(r))
  try {
    if (isDispatch) {
      // À relivrer : véhicules au parc dans une zone de relivraison (K, K1, SNC…).
      const { data: zones } = await sb.from('parc_zones').select('key').eq('active', true).eq('zone_type', 'relivraison')
      const keys = (zones || []).map((z: any) => z.key)
      if (keys.length) {
        const { count } = await sb.from('incoming_missions').select('id', { count: 'exact', head: true })
          .eq('status', 'parked').eq('dossier_leg', false).in('parc_zone_key', keys)
        if (count) badges['/relivraison'] = count
      }
    }
    if (isFourriere) {
      // Réquisitoires à relancer : sources à réquisitoire, sans réquisitoire reçu, véhicule au parc.
      const reqSources = await sourcesWithTag('requisitoire')
      if (reqSources.length) {
        const { count } = await sb.from('incoming_missions').select('id', { count: 'exact', head: true })
          .in('source', reqSources).is('requisitoire_at', null).eq('status', 'parked').eq('dossier_leg', false)
        if (count) badges['/fourriere/relance-requisitoire'] = count
      }
      // Sortie AVP : abandons au parc depuis 60 jours ou plus (même seuil que la page).
      const limit = new Date(Date.now() - 60 * 86_400_000).toISOString()
      const { count } = await sb.from('incoming_missions').select('id', { count: 'exact', head: true })
        .eq('source', 'police_avp').in('status', ['parked', 'delivering']).eq('dossier_leg', false).lte('intervention_date', limit)
      if (count) badges['/fourriere/destruction'] = count
    }
    if (isFactu) {
      // À facturer : fiches terminées en attente de facture (même filtre que la Facturation par dossier).
      const { count } = await sb.from('incoming_missions').select('id', { count: 'exact', head: true })
        .eq('status', 'to_invoice').eq('dossier_leg', false).is('archived_at', null).not('external_id', 'like', 'PROCESSING_%')
      if (count) { badges['/facturation'] = count; badges['/facturation/dossiers'] = count }
    }
  } catch (e: any) {
    console.warn('[nav-badges] compteurs menu v3 :', e?.message || e)
  }

  // ── Zone « Maintenant » (réglage par rôle) + favoris de l'utilisateur ───────
  let now: string[] = []
  try {
    if (roles.includes('superadmin')) now = await getBusinessList('nav_now_superadmin')
    else if (isDispatch) now = await getBusinessList('nav_now_dispatcher')
    else if ((u.modules || []).includes('facturation')) now = await getBusinessList('nav_now_facturation')
  } catch (e: any) {
    console.warn('[nav-badges] réglage « Maintenant » manquant :', e?.message || e)
  }
  let favorites: string[] = []
  try {
    const { data: me } = await sb.from('users').select('nav_favorites').eq('id', u.id).maybeSingle()
    favorites = Array.isArray((me as any)?.nav_favorites) ? (me as any).nav_favorites : []
  } catch { /* colonne absente → pas de favoris */ }

  return NextResponse.json({ badges, flags, nav: { now, favorites } })
}
