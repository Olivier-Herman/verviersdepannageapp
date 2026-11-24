// src/app/api/appels/route.ts — appels Teams rattachés aux fiches (Olivier 24/11/2026), cf src/lib/appels-fiches.ts.
// GET ?onglet=a|auto|non   : appels des 48 dernières heures (à rattacher, rattachés tout seuls, pas liés)
// GET ?mission=<id>        : appels d'une fiche (et de ses étapes) + numéros retenus
// GET ?q=<texte>           : recherche de fiches (plaque, nom, n° de fiche ou de dossier, téléphone)
// POST { action: 'rattacher', appel_id?, numero?, mission_id, retenir? } | { action: 'pas_lie' | 'detacher', appel_id }
//      | { action: 'oublier', numero8, mission_id }
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import type { Appel } from '@/lib/supervision/appels'
import { peutVoirAppels, fichesDuNumero, retenirNumero, appelUtile, motifNumero, COLS_FICHE, libelleFiche, numeroLisible, numerosPersonnel, numerosIgnores, numeroDecroche, numeroSurFiche, type FicheCourte } from '@/lib/appels-fiches'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const MODES: Record<string, string> = { auto: 'rattaché tout seul (numéro sur la fiche)', retenu: 'rattaché tout seul (numéro retenu)', manuel: 'rattaché à la main', pas_lie: 'pas lié à une fiche', organisation: 'numéro sur beaucoup de fiches (organisation) : jamais proposé' }
const normPlaque = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

async function nomsUsers(sb: ReturnType<typeof createAdminClient>, ids: (string | null)[]) {
  const u = [...new Set(ids.filter(Boolean))] as string[]
  if (!u.length) return {} as Record<string, string>
  const { data } = await sb.from('users').select('id, name').in('id', u)
  return Object.fromEntries(((data || []) as any[]).map(x => [x.id, String(x.name || '').split(' ')[0]]))
}

function vueAppel(a: Appel) {
  const duree = a.parts.reduce((s, p) => s + p.sec, 0)
  const qui = a.parts.map(p => p.qui || p.nom)
  return {
    id: a.id, debut: a.debut, sens: a.sens, perdu: a.perdu, service: a.service, numero: a.numero, numero_lisible: numeroLisible(a.numero),
    duree_s: duree, qui, renvoi: a.renvoi_externe,
    resume: a.sens === 'sortant' ? `Appelé par ${qui[0] || '?'}` : a.perdu ? 'Pas décroché' : a.renvoi_externe && !qui.length ? 'Renvoyé vers un GSM'
      : `Décroché par ${qui[0]}${qui.length > 1 ? ', repris par ' + qui.slice(1).join(', ') : ''}`,
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || !peutVoirAppels(session.user)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const qs = req.nextUrl.searchParams
  try {
    // ── Recherche de fiches ──────────────────────────────────────────────────────────────────
    const q = (qs.get('q') || '').trim()
    if (q) {
      const like = `%${q.replace(/[%,()]/g, ' ')}%`
      const num = /^\d{5,9}$/.test(q) ? Number(q) : null
      const ors = [`client_name.ilike.${like}`, `dossier_number.ilike.${like}`, `vehicle_plate.ilike.${like}`, `client_phone.ilike.${like}`, ...(num ? [`mission_number.eq.${num}`] : [])]
      const { data, error } = await sb.from('incoming_missions').select(COLS_FICHE).or(ors.join(',')).order('created_at', { ascending: false }).limit(20)
      if (error) throw new Error(error.message)
      let fiches = (data || []) as FicheCourte[]
      const p = normPlaque(q)
      if (p.length >= 4 && fiches.length < 20) {
        const { data: d2 } = await sb.from('incoming_missions').select(COLS_FICHE).not('vehicle_plate', 'is', null).order('created_at', { ascending: false }).limit(400)
        for (const f of (d2 || []) as FicheCourte[]) if (normPlaque(f.vehicle_plate || '').includes(p) && !fiches.some(x => x.id === f.id)) fiches.push(f)
      }
      if (motifNumero(q)) for (const f of await fichesDuNumero(sb, q)) if (!fiches.some(x => x.id === f.id)) fiches.push(f)
      return NextResponse.json({ fiches: fiches.slice(0, 20).map(f => ({ id: f.id, ...libelleFiche(f) })) })
    }

    // ── Appels d'une fiche ───────────────────────────────────────────────────────────────────
    const mission = qs.get('mission')
    if (mission) {
      const { data: legs } = await sb.from('incoming_missions').select('id').eq('parent_mission_id', mission)
      const ids = [mission, ...((legs || []) as any[]).map(x => x.id)]
      const { data: liens, error } = await sb.from('appel_fiches').select('appel_id, mission_id, mode, par, at').in('mission_id', ids)
      if (error) throw new Error(error.message)
      const { data: appels } = (liens || []).length ? await sb.from('supervision_appels').select('*').in('id', (liens || []).map((l: any) => l.appel_id)) : { data: [] }
      const noms = await nomsUsers(sb, (liens || []).map((l: any) => l.par))
      const { data: nums } = await sb.from('fiche_numeros').select('numero8, numero, at').eq('mission_id', mission).order('at', { ascending: false })
      const out = ((appels || []) as Appel[]).map(a => {
        const l = (liens || []).find((x: any) => x.appel_id === a.id) as any
        return { ...vueAppel(a), lien: l.mode === 'manuel' && noms[l.par] ? `rattaché à la main par ${noms[l.par]}` : MODES[l.mode] }
      }).sort((a, b) => b.debut.localeCompare(a.debut))
      // Notes « En appel » : leur motif s'affiche sur la ligne de l'appel ; sans appel retrouvé, elles ont leur propre ligne.
      const { data: notes } = await sb.from('appel_notes').select('id, at, user_id, motif, texte, numero, appel_id').in('mission_id', ids).order('at', { ascending: false })
      const nNoms = await nomsUsers(sb, ((notes || []) as any[]).map(n => n.user_id))
      const motifNote = (n: any) => [n.motif, n.texte].filter(Boolean).join(' — ')
      for (const a of out as any[]) { const n = ((notes || []) as any[]).find(x => x.appel_id === a.id); if (n) a.motif = motifNote(n) }
      const seules = ((notes || []) as any[]).filter(n => !n.appel_id || !out.some(a => a.id === n.appel_id)).map(n => ({
        id: `note:${n.id}`, debut: n.at, sens: 'note', perdu: false, service: null, numero_lisible: n.numero ? numeroLisible(n.numero) : 'Numéro à venir',
        duree_s: 0, resume: `Noté par ${nNoms[n.user_id] || '?'}`, lien: n.appel_id ? 'appel retrouvé' : 'l’appel sera retrouvé environ 30 min après la fin', motif: motifNote(n), note: true,
      }))
      const { data: mo } = await sb.from('app_settings').select('value').eq('key', 'appels_motifs').maybeSingle()
      let motifs: string[] = []; try { motifs = mo?.value ? JSON.parse(mo.value as any) : [] } catch { /* illisible */ }
      const me = (session.user as any).id as string
      const dec = await numeroDecroche(sb, me)
      return NextResponse.json({
        appels: [...out, ...seules].sort((a: any, b: any) => b.debut.localeCompare(a.debut)),
        numeros: ((nums || []) as any[]).map(n => ({ numero8: n.numero8, numero: numeroLisible(n.numero) })),
        motifs, numero_decroche: dec ? numeroLisible(dec) : null,
      })
    }

    // ── Écran « Appels à rattacher » ─────────────────────────────────────────────────────────
    const onglet = qs.get('onglet') || 'a'
    const d1 = new Date(Date.now() - 48 * 3600e3).toISOString()
    const { data: appels, error } = await sb.from('supervision_appels').select('*').gte('debut', d1).in('sens', ['entrant', 'sortant']).order('debut', { ascending: false }).limit(1000)
    if (error) throw new Error(error.message)
    const ids = ((appels || []) as Appel[]).map(a => a.id)
    const liens = new Map<string, any>()
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await sb.from('appel_fiches').select('appel_id, mission_id, mode, par, at').in('appel_id', ids.slice(i, i + 300))
      for (const r of (data || []) as any[]) liens.set(r.appel_id, r)
    }
    const [perso, ignores] = await Promise.all([numerosPersonnel(sb), numerosIgnores(sb)])
    const utiles = ((appels || []) as Appel[]).filter(a => appelUtile(a, perso))
    const ignore = (a: Appel) => ignores.has(motifNumero(a.numero) || '')
    const aRattacher = utiles.filter(a => !liens.has(a.id) && !a.perdu && !ignore(a))
    const auto = utiles.filter(a => ['auto', 'retenu', 'manuel'].includes(liens.get(a.id)?.mode))
    const nonLies = utiles.filter(a => ['pas_lie', 'organisation'].includes(liens.get(a.id)?.mode) || (ignore(a) && !liens.get(a.id)?.mission_id))
    const { data: et } = await sb.from('app_settings').select('value').eq('key', 'appels_fiches_dernier').maybeSingle()
    let releve: any = null; try { releve = et?.value ? JSON.parse(et.value as any) : null } catch { /* illisible */ }
    const comptes = { a: aRattacher.length, auto: auto.length, non: nonLies.length }
    if (qs.get('compte')) return NextResponse.json({ comptes, releve })

    const liste = onglet === 'auto' ? auto : onglet === 'non' ? nonLies : aRattacher
    // Fiches des appels déjà rattachés (titres).
    const fIds = [...new Set(liste.map(a => liens.get(a.id)?.mission_id).filter(Boolean))] as string[]
    const { data: fl } = fIds.length ? await sb.from('incoming_missions').select(COLS_FICHE).in('id', fIds) : { data: [] }
    const fiches = new Map(((fl || []) as FicheCourte[]).map(f => [f.id, f]))
    const noms = await nomsUsers(sb, liste.map(a => liens.get(a.id)?.par || null))

    const out = []
    for (const a of liste.slice(0, 60)) {
      const l = liens.get(a.id)
      let suggestions: { id: string; titre: string; detail: string }[] = []
      if (onglet === 'a') {
        // Fiches du numéro (plusieurs, sinon il serait rattaché), puis fiches touchées au bureau autour de l'appel.
        const parNumero = (await fichesDuNumero(sb, a.numero)).slice(0, 4)
        const t = +new Date(a.debut)
        const { data: logs } = await sb.from('mission_logs').select('mission_id, created_at').not('actor_id', 'is', null)
          .gte('created_at', new Date(t - 20 * 60e3).toISOString()).lte('created_at', new Date(t + 30 * 60e3).toISOString()).order('created_at').limit(200)
        const proches: string[] = []
        for (const g of (logs || []) as any[]) if (!proches.includes(g.mission_id) && !parNumero.some(f => f.id === g.mission_id)) proches.push(g.mission_id)
        // Fiche créée pendant ou juste après l'appel (appel de dépannage avant la fiche) : proposée en premier.
        const { data: creees } = await sb.from('incoming_missions').select(COLS_FICHE).eq('dossier_leg', false)
          .gte('created_at', new Date(t - 5 * 60e3).toISOString()).lte('created_at', new Date(t + 45 * 60e3).toISOString()).order('created_at').limit(5)
        const neuves = ((creees || []) as FicheCourte[]).filter(f => !parNumero.some(x => x.id === f.id))
        for (const f of neuves) { const i = proches.indexOf(f.id); if (i >= 0) proches.splice(i, 1) }
        const { data: fp } = proches.length ? await sb.from('incoming_missions').select(COLS_FICHE).in('id', proches.slice(0, 6)) : { data: [] }
        const quand = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })
        suggestions = [
          ...neuves.map(f => { const x = libelleFiche(f); return { id: f.id, titre: x.titre, detail: `${x.detail} · créée à ${quand(f.created_at)}, pendant l’appel` } }),
          ...parNumero.map(f => { const x = libelleFiche(f); return { id: f.id, titre: x.titre, detail: `${x.detail} · même numéro` } }),
          ...proches.slice(0, 6).map(id => ((fp || []) as FicheCourte[]).find(f => f.id === id)).filter(Boolean).map(f => {
            const x = libelleFiche(f!); const g = (logs as any[]).find(y => y.mission_id === f!.id)
            return { id: f!.id, titre: x.titre, detail: `${x.detail} · modifiée à ${quand(g.created_at)}` }
          }),
        ].slice(0, 8)
      }
      const f = l?.mission_id ? fiches.get(l.mission_id) : null
      out.push({
        ...vueAppel(a), suggestions, motif: motifNumero(a.numero), ignore: ignore(a),
        fiche: f ? { id: f.id, ...libelleFiche(f) } : null,
        lien: ignore(a) && !l?.mission_id ? 'numéro qu’on ne propose plus' : l ? (l.mode === 'manuel' && noms[l.par] ? `rattaché à la main par ${noms[l.par]}` : l.mode === 'pas_lie' && noms[l.par] ? `marqué « pas lié » par ${noms[l.par]}` : MODES[l.mode]) : null,
      })
    }
    return NextResponse.json({ comptes, appels: out, releve })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || !peutVoirAppels(session.user)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const me = (session.user as any).id as string
  const sb = createAdminClient()
  const b = await req.json().catch(() => ({}))
  try {
    if (b.action === 'rattacher') {
      if (!b.mission_id) return NextResponse.json({ error: 'Choisissez une fiche.' }, { status: 400 })
      let numero = b.numero as string | undefined
      if (b.appel_id) {
        const { data: a } = await sb.from('supervision_appels').select('numero').eq('id', b.appel_id).maybeSingle()
        if (!a) return NextResponse.json({ error: 'Appel introuvable.' }, { status: 404 })
        numero = (a as any).numero || numero
        const { error } = await sb.from('appel_fiches').upsert({ appel_id: b.appel_id, mission_id: b.mission_id, mode: 'manuel', par: me, at: new Date().toISOString() }, { onConflict: 'appel_id' })
        if (error) throw new Error(error.message)
      }
      if (numero && (b.retenir || !b.appel_id)) await retenirNumero(sb, numero, b.mission_id, me)
      return NextResponse.json({ ok: true })
    }
    if (b.action === 'noter') {
      // Bouton « En appel » : le motif est noté tout de suite ; le numéro aussi s'il a été transmis au décroché,
      // sinon le relevé suivant retrouve l'appel de la personne à ce moment-là (completerNotes).
      const motif = String(b.motif || '').trim().slice(0, 120), texte = String(b.texte || '').trim().slice(0, 1000)
      if (!b.mission_id || (!motif && !texte)) return NextResponse.json({ error: 'Choisissez un motif ou écrivez quelques mots.' }, { status: 400 })
      const numero = await numeroDecroche(sb, me)
      const { error } = await sb.from('appel_notes').insert({ mission_id: b.mission_id, user_id: me, motif: motif || null, texte: texte || null, numero })
      if (error) throw new Error(error.message)
      let fiche: string | null = null
      if (numero) fiche = await numeroSurFiche(sb, b.mission_id, numero, me)
      await sb.from('mission_logs').insert({ mission_id: b.mission_id, actor_id: me, action: 'note', notes: `📞 Appel${numero ? ` du ${numeroLisible(numero)}` : ''} : ${[motif, texte].filter(Boolean).join(' — ')}` }).then(() => {}, () => {})
      return NextResponse.json({ ok: true, numero: numero ? numeroLisible(numero) : null, fiche })
    }
    if (b.action === 'pas_lie' && b.appel_id) {
      const { error } = await sb.from('appel_fiches').upsert({ appel_id: b.appel_id, mission_id: null, mode: 'pas_lie', par: me, at: new Date().toISOString() }, { onConflict: 'appel_id' })
      if (error) throw new Error(error.message)
      if (b.jamais) {
        // « Ne plus proposer ce numéro » : ses appels ne sont plus jamais proposés ni rattachés tout seuls.
        const { data: a } = await sb.from('supervision_appels').select('numero').eq('id', b.appel_id).maybeSingle()
        const m = motifNumero((a as any)?.numero)
        if (m) { const { error: e2 } = await sb.from('numeros_ignores').upsert({ numero8: m, numero: (a as any).numero, par: me, at: new Date().toISOString() }, { onConflict: 'numero8' }); if (e2) throw new Error(e2.message) }
      }
      return NextResponse.json({ ok: true })
    }
    if (b.action === 'detacher' && b.appel_id) {
      // Détaché = « pas lié » : sinon le passage suivant le rattacherait de nouveau tout seul.
      const { error } = await sb.from('appel_fiches').upsert({ appel_id: b.appel_id, mission_id: null, mode: 'pas_lie', par: me, at: new Date().toISOString() }, { onConflict: 'appel_id' })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    if (b.action === 'reproposer' && b.numero8) {
      const { error } = await sb.from('numeros_ignores').delete().eq('numero8', b.numero8)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    if (b.action === 'oublier' && b.numero8 && b.mission_id) {
      const { error } = await sb.from('fiche_numeros').delete().eq('numero8', b.numero8).eq('mission_id', b.mission_id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
