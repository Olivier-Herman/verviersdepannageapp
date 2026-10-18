// /api/fourriere/releve — Relevé de parc sans étiquette (Olivier 18/10/2026).
//   GET                       → relevés récents
//   GET ?id=…                 → un relevé et ses véhicules
//   POST { lieu }             → ouvre un relevé
//   POST { id, action:'cloturer' } → termine le relevé
//   POST { id, action:'rechercher', saisie } → ce qu'on sait du véhicule (VD Soft, Towsoft, mails, ERP)
//   POST { id, action:'decider', saisie, candidates, decision, mission_id?, source?, zone?, remark? }
//        decision : present_ok (la fiche trouvée est bien ici) | garder (créer la fiche si besoin + étiquette)
//                   | scratch (épave, sortie du parc) | note (juste noter)
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { rechercherVehicule, RELEVE_LIEUX, norm } from '@/lib/parc/releve'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function acces() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const u = session.user as any
  const modules: string[] = u.modules || []
  if (!modules.includes('fourriere') && !['admin', 'superadmin'].includes(u.role || '')) return null
  const { data: me } = await createAdminClient().from('users').select('id, name').eq('email', u.email).maybeSingle()
  return me
}

// V100, V101… : numérotation continue sur tous les relevés de Verviers.
async function prochaineRefCraie(sb: ReturnType<typeof createAdminClient>): Promise<string> {
  const { data } = await sb.from('parc_releve_items').select('ref_craie').not('ref_craie', 'is', null).like('ref_craie', 'V%')
  const max = (data || []).reduce((m, r: any) => Math.max(m, parseInt(String(r.ref_craie).slice(1), 10) || 0), 99)
  return `V${max + 1}`
}

export async function GET(req: Request) {
  const me = await acces(); if (!me) return NextResponse.json({ error: 'Accès réservé à la fourrière.' }, { status: 403 })
  const sb = createAdminClient()
  const qs = new URL(req.url).searchParams
  const id = qs.get('id')
  // Export Excel construit côté serveur : le téléchargement depuis la page ne marche pas sur la tablette Android
  // (Olivier 18/10/2026). ?format=csv avec ?id=… (un relevé) ou ?jour=AAAA-MM-JJ&lieu=… (tous les relevés du jour).
  if (qs.get('format') === 'csv') {
    let rq = sb.from('parc_releves').select('id, lieu, started_at').order('started_at')
    if (id) rq = rq.eq('id', id)
    else {
      const jour = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('jour') || '') ? qs.get('jour')! : new Date().toISOString().slice(0, 10)
      rq = rq.gte('started_at', `${jour}T00:00:00+02:00`).lt('started_at', `${jour}T23:59:59+02:00`)
      if (qs.get('lieu')) rq = rq.eq('lieu', qs.get('lieu')!)
    }
    const { data: rels } = await rq
    const ids = (rels || []).map(r => r.id)
    const { data: its } = ids.length ? await sb.from('parc_releve_items').select('*').in('releve_id', ids).order('created_at') : { data: [] as any[] }
    const DEC: Record<string, string> = { present_ok: 'Fiche confirmée', garder: 'Gardé au parc', scratch: 'Scratch', note: 'Noté' }
    const relDe = new Map((rels || []).map(r => [r.id, r]))
    const head = ['Relevé', 'Heure', 'Réf. craie', 'Plaque', 'Châssis', 'Marque', 'Modèle', 'Date intervention', 'Décision', 'Fiche VD Soft', 'Fiche créée', 'Étiquette imprimée', 'Résultat', 'Remarque']
    const rows = (its || []).map((i: any) => {
      const r: any = relDe.get(i.releve_id)
      return [`${RELEVE_LIEUX[r?.lieu]?.label || r?.lieu} ${new Date(r?.started_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })}`,
        new Date(i.created_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }),
        i.ref_craie, i.plate, i.vin, i.brand, i.model, i.intervention_date, DEC[i.decision] || i.decision,
        i.mission_number ? `#${i.mission_number}` : '', i.created_mission ? 'oui' : '', i.label_printed ? 'oui' : 'non', i.result, i.remark]
    })
    const csv = '\ufeff' + [head, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const nom = id ? `releve-${String((rels || [])[0]?.started_at || '').slice(0, 10)}-${String(id).slice(0, 6)}` : `releves-${qs.get('jour') || new Date().toISOString().slice(0, 10)}`
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nom}.csv"`, 'Cache-Control': 'no-store' } })
  }
  if (id) {
    const { data: r } = await sb.from('parc_releves').select('*').eq('id', id).maybeSingle()
    const { data: items } = await sb.from('parc_releve_items').select('*').eq('releve_id', id).order('created_at')
    return NextResponse.json({ releve: r, items: items || [] })
  }
  const { data } = await sb.from('parc_releves').select('*').order('started_at', { ascending: false }).limit(20)
  return NextResponse.json({ releves: data || [], lieux: RELEVE_LIEUX })
}

export async function POST(req: Request) {
  const me = await acces(); if (!me) return NextResponse.json({ error: 'Accès réservé à la fourrière.' }, { status: 403 })
  const sb = createAdminClient()
  const b = await req.json().catch(() => ({}))

  if (!b.id) {
    if (!RELEVE_LIEUX[b.lieu]) return NextResponse.json({ error: 'Lieu inconnu.' }, { status: 400 })
    const { data, error } = await sb.from('parc_releves').insert({ lieu: b.lieu, started_by: me.id }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ releve: data })
  }
  const { data: rel } = await sb.from('parc_releves').select('*').eq('id', b.id).maybeSingle()
  if (!rel) return NextResponse.json({ error: 'Relevé introuvable.' }, { status: 404 })

  if (b.action === 'cloturer') {
    await sb.from('parc_releves').update({ closed_at: new Date().toISOString() }).eq('id', rel.id)
    return NextResponse.json({ ok: true })
  }

  const s = b.saisie || {}
  if (b.action === 'rechercher') {
    if (!norm(s.plate) && !norm(s.vin) && String(s.brand || '').trim().length < 2 && String(s.model || '').trim().length < 2) return NextResponse.json({ error: 'Donne au moins la plaque, le châssis, ou la marque / le modèle.' }, { status: 400 })
    return NextResponse.json(await rechercherVehicule(s))
  }

  if (b.action !== 'decider') return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 })
  const decision = String(b.decision || '')
  if (!['present_ok', 'garder', 'scratch', 'note'].includes(decision)) return NextResponse.json({ error: 'Décision inconnue.' }, { status: 400 })
  const lieu = RELEVE_LIEUX[rel.lieu]
  const zone = lieu?.zone || (b.zone ? String(b.zone) : null)
  const plate = norm(s.plate) || null, vin = norm(s.vin) || null
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(s.date || '')) ? String(s.date) : null
  const now = new Date().toISOString()
  let missionId: string | null = b.mission_id || null
  let created = false, printed = false
  let refCraie: string | null = null
  const result: string[] = []

  // Fiche existante choisie : contrôle
  let fiche: any = null
  if (missionId) {
    const { data } = await sb.from('incoming_missions').select('id, mission_number, status, parc_zone_key, vehicle_plate, vehicle_vin, remarks_general').eq('id', missionId).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Fiche introuvable.' }, { status: 404 })
    fiche = data
  }

  // Créer la fiche si on garde ou scratche un véhicule inconnu de VD Soft
  if (!fiche && (decision === 'garder' || decision === 'scratch')) {
    if (!zone && decision === 'garder') return NextResponse.json({ error: 'Choisis la zone de parc.' }, { status: 400 })
    const ts = (b.candidates?.towsoft || [])[0]
    const source = String(b.source || 'legacy_towsoft_migration')
    const intervention = date ? `${date}T12:00:00+00:00` : (ts?.date ? `${ts.date}T12:00:00+00:00` : now)
    const remarque = [`Fiche créée au relevé de parc ${lieu?.label || rel.lieu} du ${new Date(rel.started_at).toLocaleDateString('fr-BE')} (${me.name}).`,
      ts ? `Towsoft ${ts.num} (${ts.date}, ${ts.type || ''}${ts.dossier ? `, « ${ts.dossier} »` : ''}${ts.client ? `, ${ts.client}` : ''}).` : 'Aucune fiche Towsoft.',
      b.remark ? `Remarque : ${String(b.remark).slice(0, 500)}` : null].filter(Boolean).join(' ')
    const { data: m, error } = await sb.from('incoming_missions').insert({
      external_id: `RELEVE-${plate || vin || 'X'}-${Date.now()}`, source, source_format: 'manual', mission_type: 'remorquage',
      status: 'parked', dispatch_mode: 'manual', vehicle_plate: plate, vehicle_vin: vin,
      vehicle_brand: s.brand || null, vehicle_model: s.model || null, vehicle_class: 'car',
      received_at: intervention, intervention_date: intervention, parked_at: intervention, parc_zone_key: zone,
      remarks_general: remarque,
    }).select('id, mission_number, status, parc_zone_key, remarks_general').single()
    if (error) return NextResponse.json({ error: `Création de la fiche : ${error.message}` }, { status: 500 })
    fiche = m; missionId = m.id; created = true
    result.push(`fiche #${m.mission_number} créée`)
    await sb.from('mission_logs').insert({ mission_id: m.id, action: 'received', notes: remarque, actor_id: me.id }).then(() => {}, () => {})
  }

  if (decision === 'present_ok' || decision === 'garder') {
    if (fiche && !created) {
      const upd: any = { updated_at: now }
      if (zone && fiche.parc_zone_key !== zone) upd.parc_zone_key = zone
      if (!['parked', 'gardiennage'].includes(fiche.status)) result.push(`⚠ la fiche #${fiche.mission_number} est « ${fiche.status} » dans VD Soft : à vérifier au bureau`)
      if (Object.keys(upd).length > 1) { await sb.from('incoming_missions').update(upd).eq('id', fiche.id); result.push(`zone → ${zone}`) }
      await sb.from('mission_logs').insert({ mission_id: fiche.id, action: 'note', notes: `Vu au relevé de parc ${lieu?.label || rel.lieu} (${me.name})${upd.parc_zone_key ? ` — zone ${upd.parc_zone_key}` : ''}.`, actor_id: me.id }).then(() => {}, () => {})
      result.push(`fiche #${fiche.mission_number} confirmée au parc`)
    }
    if (decision === 'garder' || (decision === 'present_ok' && b.reimprimer)) {
      // Verviers : référence à la craie V100, V101… reprise sur l'étiquette (Olivier 18/10/2026)
      if (rel.lieu === 'verviers') {
        refCraie = await prochaineRefCraie(sb)
        result.push(`réf. craie ${refCraie}`)
        await sb.from('incoming_missions').update({ remarks_general: `${(fiche as any)?.remarks_general ? `${(fiche as any).remarks_general}\n` : ''}Réf. craie ${refCraie} (relevé de Verviers du ${new Date(rel.started_at).toLocaleDateString('fr-BE')}).` }).eq('id', missionId!)
        await sb.from('mission_logs').insert({ mission_id: missionId, action: 'note', notes: `Référence ${refCraie} notée à la craie sur le pare-brise (relevé de Verviers).`, actor_id: me.id }).then(() => {}, () => {})
      }
      try {
        const { reprintLabelForMission } = await import('@/lib/missions/reprint-label-helper')
        const r = await reprintLabelForMission({ kind: 'uuid', value: missionId! }, refCraie ? { banner: refCraie } : undefined)
        printed = !!r.ok; result.push(r.ok ? 'étiquette imprimée' : `étiquette non imprimée (${(r as any).error || '?'})`)
      } catch (e: any) { result.push(`étiquette non imprimée (${e?.message})`) }
    }
  }

  if (decision === 'scratch' && missionId) {
    const { scratchMission } = await import('@/lib/missions/scratch')
    const r = await scratchMission(sb, missionId, me.id, `Relevé de parc ${lieu?.label || rel.lieu}${b.remark ? ` — ${String(b.remark).slice(0, 200)}` : ''}`)
    result.push(r.ok ? 'mis en épave (scratch), sorti du parc' : `scratch refusé : ${r.error}`)
  }
  if (decision === 'note') result.push('noté sans action')

  const { data: item, error: iErr } = await sb.from('parc_releve_items').insert({
    releve_id: rel.id, plate, vin, brand: s.brand || null, model: s.model || null, intervention_date: date, remark: b.remark || null,
    candidates: b.candidates || null, decision, mission_id: missionId, mission_number: fiche?.mission_number ?? null,
    created_mission: created, label_printed: printed, ref_craie: refCraie, result: result.join(' · '), created_by: me.id,
  }).select().single()
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })
  return NextResponse.json({ item })
}
