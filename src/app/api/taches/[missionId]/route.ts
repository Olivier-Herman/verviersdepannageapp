// src/app/api/taches/[missionId]/route.ts
//
// GET  → tout ce qu'il faut pour poser la prochaine question : fiche, run,
//        zones du parc, photos, documents scannés, assisteurs.
// POST → une réponse ({ step, answer, extra }) : on la garde dans le run et on
//        écrit sur la fiche ce qui doit y vivre (clé, forfait, client facturable,
//        n° de dossier, adresse de relivraison). Les gestes qui ont déjà leur
//        API (réimprimer, transférer de zone, ajouter des photos) sont appelés
//        par l'écran, pas dupliqués ici.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { tachesAccess } from '@/lib/taches/access'
import { nextStep, runStatus, stepsFor, KEY_ANSWER_TO_FICHE, type Answers, type Reading, type StepId } from '@/lib/taches/accident-steps'
import { getBusinessNumber } from '@/lib/settings/business'
import { KEY_LOCATION_LABELS } from '@/lib/key-location'

export const dynamic = 'force-dynamic'

const MISSION_COLS = 'id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, parc_zone_key, parc_row_number, parked_at, assigned_to, police_zone, officer_name, client_name, client_phone, client_email, client_address, label_printed_at, key_location, saisie_key_hook, driver_photos, storage_flat_htva, billed_to_id, billed_to_name, dossier_number, redelivery_address, redelivery_lat, redelivery_lng, incident_address'

async function loadContext(sb: any, missionId: string) {
  const { data: m } = await sb.from('incoming_missions').select(MISSION_COLS).eq('id', missionId).maybeSingle()
  if (!m) return null
  const [{ data: run }, { data: zones }, { data: docs }, { data: cat }, { data: driver }, { data: labelLog }, forfaitTvac] = await Promise.all([
    sb.from('process_runs').select('*').eq('mission_id', missionId).eq('process_key', 'accident_police').maybeSingle(),
    sb.from('parc_zones').select('key, label, sort_order').eq('active', true).order('sort_order'),
    sb.from('mission_documents').select('id, kind, file_name, mime_type, created_at').eq('mission_id', missionId).eq('kind', 'parc_scan').order('created_at'),
    sb.from('mission_source_catalog').select('key, label, default_billed_to_id, default_billed_to_name').eq('active', true).not('default_billed_to_id', 'is', null).order('sort_order'),
    m.assigned_to ? sb.from('users').select('name').eq('id', m.assigned_to).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('mission_logs').select('created_at').eq('mission_id', missionId).eq('action', 'label_printed').order('created_at', { ascending: false }).limit(1),
    getBusinessNumber('forfait_parc_accident_tvac'),   // réglage Montants, pas de valeur en dur
  ])
  const a: Answers = run?.answers || {}
  const reading: Reading | null = run?.reading || null
  // Assisteurs = les sources du catalogue qui ont un client facturable par défaut, hors police/privé/parc.
  const assisteurs = ((cat || []) as any[]).filter(c => !/^(police|prive|gardiennage|garage)/.test(c.key))
  return {
    mission: { ...m, driver_name: driver?.name || null, label_printed_at: m.label_printed_at || (labelLog?.[0]?.created_at ?? null), key_label: m.key_location ? KEY_LOCATION_LABELS[m.key_location] : null },
    run: run ? { status: run.status, answers: a, reading, completed_at: run.completed_at } : { status: 'todo', answers: {}, reading: null, completed_at: null },
    steps: stepsFor(a, reading, m), next: nextStep(a, reading, m),
    zones: zones || [], documents: docs || [], assisteurs,
    forfaitTvac: Number(forfaitTvac) || 0,
  }
}

export async function GET(_req: Request, { params }: { params: { missionId: string } }) {
  const acc = await tachesAccess()
  if (!acc.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ctx = await loadContext(createAdminClient(), params.missionId)
  if (!ctx) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
  return NextResponse.json(ctx)
}

export async function POST(req: Request, { params }: { params: { missionId: string } }) {
  const acc = await tachesAccess()
  if (!acc.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({})) as { step?: StepId | 'client' | 'reset'; answer?: any; extra?: Record<string, any> }
  const ctx = await loadContext(sb, params.missionId)
  if (!ctx) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
  const m: any = ctx.mission
  const answers: Answers = { ...(ctx.run.answers || {}) }
  const reading: Reading | null = ctx.run.reading
  const now = new Date().toISOString()
  const log = (action: string, notes: string, metadata: any = {}) =>
    sb.from('mission_logs').insert({ mission_id: m.id, actor_id: acc.userId, action, notes, metadata }).then(() => {}, () => {})
  const patch: Record<string, any> = {}

  if (body.step === 'client') {
    answers.client = true
    await log('process_step', 'Prise en charge : le propriétaire s’est fait connaître, les questions du dossier reprennent.')
  } else if (body.step === 'reset') {
    // Recommencer la prise en charge (rien n'est retiré de la fiche).
    for (const k of Object.keys(answers)) delete (answers as any)[k]
  } else {
    const step = body.step as StepId
    if (!step || !stepsFor(answers, reading, m).includes(step) && step !== 'photos') return NextResponse.json({ error: 'Étape inconnue ou pas encore atteinte' }, { status: 400 })
    const x = body.extra || {}
    switch (step) {
      case 'label':
        answers.label = body.answer
        await log('process_step', body.answer === 'reprint' ? 'Prise en charge : étiquette renvoyée à la Zebra.' : 'Prise en charge : étiquette collée.')
        break
      case 'zone':
        answers.zone = body.answer
        if (body.answer === 'transfer' && x.zone_key) answers.zone_key = String(x.zone_key)
        break
      case 'key':
        answers.key = body.answer
        patch.key_location = KEY_ANSWER_TO_FICHE[body.answer as keyof typeof KEY_ANSWER_TO_FICHE] || null
        if (body.answer === 'hook') { answers.key_hook = String(x.hook || '').trim(); patch.saisie_key_hook = answers.key_hook || null }
        else patch.saisie_key_hook = null
        await log('key_location', `Emplacement clé : ${KEY_LOCATION_LABELS[patch.key_location] || patch.key_location}${answers.key_hook ? ` · crochet ${answers.key_hook}` : ''}`, { key_location: patch.key_location, hook: answers.key_hook || null })
        break
      case 'docs':
        answers.docs = body.answer
        if (body.answer === 'non') { delete answers.scan; delete answers.check }
        await log('process_step', body.answer === 'oui' ? 'Prise en charge : documents à bord, à scanner.' : 'Prise en charge : aucun document à bord.')
        break
      case 'scan':
        answers.scan = body.answer   // 'fait' est normalement posé par l'API documents ; 'plus_tard' ici
        break
      case 'check':
        answers.check = body.answer
        await log('process_step', body.answer === 'oui' ? 'Prise en charge : lecture des documents confirmée.' : 'Prise en charge : lecture des documents à corriger sur la fiche.')
        break
      case 'photos':
        answers.photos = body.answer
        break
      case 'cover':
        answers.cover = body.answer
        answers.cover_name = body.answer === 'autre' ? String(x.name || '').trim() : undefined
        answers.forfait220 = !!x.forfait220
        // Le forfait est un réglage (Montants) ; la fiche le porte en HTVA, comme la coche du dispatch.
        patch.storage_flat_htva = answers.forfait220 && ctx.forfaitTvac > 0 ? Math.round((ctx.forfaitTvac / 1.21) * 100) / 100 : null
        await log('process_step', `Prise en charge : couverture « ${body.answer === 'ethias_kaze' ? 'Ethias / Kaze' : body.answer === 'autre' ? answers.cover_name || 'autre assisteur' : 'aucune connue'} »${answers.forfait220 ? ` · forfait gardiennage ${ctx.forfaitTvac} € TVAC` : ''}.`)
        break
      case 'contact':
        answers.contact = body.answer
        await log('process_step', `Prise en charge : propriétaire ${body.answer === 'joint' ? 'joint' : body.answer === 'message' ? 'message laissé' : 'injoignable'}.`)
        break
      case 'assistance': {
        answers.assistance = body.answer
        if (body.answer === 'oui') {
          const ass = (ctx.assisteurs as any[]).find(c => c.key === x.assistance_key)
          answers.assistance_key = x.assistance_key || undefined
          answers.assistance_name = ass?.label || String(x.assistance_name || '').trim() || undefined
          answers.assistance_ref = String(x.assistance_ref || '').trim() || undefined
          if (ass?.default_billed_to_id) { patch.billed_to_id = ass.default_billed_to_id; patch.billed_to_name = ass.default_billed_to_name }
          if (answers.assistance_ref) patch.dossier_number = answers.assistance_ref
          if (x.redelivery_address) {
            answers.redelivery_address = String(x.redelivery_address)
            patch.redelivery_address = answers.redelivery_address
            if (Number.isFinite(Number(x.redelivery_lat)) && Number.isFinite(Number(x.redelivery_lng))) { patch.redelivery_lat = Number(x.redelivery_lat); patch.redelivery_lng = Number(x.redelivery_lng) }
            // Même règle que la fiche (PATCH /api/missions/[id]) : une adresse de
            // relivraison sur un véhicule en parc = bascule en zone K, étiquette
            // relivraison réimprimée. La question « zone » vient après, sur la
            // zone réelle — le véhicule ne bouge qu'une fois.
            try {
              const { relivraisonZoneFor } = await import('@/lib/parc/relivraison-zone')
              const target = await relivraisonZoneFor(sb, answers.redelivery_address)
              if (target && target !== m.parc_zone_key) {
                patch.parc_zone_key = target; patch.parc_row_number = null; patch.parc_slot_index = null
                await log('auto_transfer_zone_k', `Bascule auto en zone ${target} (relivraison) après saisie de l’adresse — depuis ${m.parc_zone_key || '?'}`, { from_zone: m.parc_zone_key, to_zone: target, trigger: 'prise_en_charge' })
                if (target === 'K') { const { reprintLabelForMission } = await import('@/lib/missions/reprint-label-helper'); await reprintLabelForMission({ kind: 'uuid', value: m.id }).catch(() => {}) }
              }
            } catch (e: any) { console.warn('[taches] bascule zone K KO', e?.message) }
          }
          await log('process_step', `Prise en charge : dossier ouvert chez ${answers.assistance_name || 'l’assistance'}${answers.assistance_ref ? ` (n° ${answers.assistance_ref})` : ''}${patch.billed_to_name ? ` — client facturable : ${patch.billed_to_name}` : ''}${answers.redelivery_address ? ` — relivraison : ${answers.redelivery_address}` : ''}.`)
        } else if (body.answer === 'pas_agree') {
          answers.assistance_name = String(x.assistance_name || '').trim() || undefined
          await log('process_step', `Prise en charge : pas agréé${answers.assistance_name ? ` — assistance connue : ${answers.assistance_name}` : ''}.`)
        } else {
          await log('process_step', 'Prise en charge : pas de dossier d’assistance.')
        }
        break
      }
    }
  }

  const status = runStatus(answers, reading, m)
  const runRow = { mission_id: m.id, process_key: 'accident_police', status, answers, updated_at: now, ...(status === 'done' ? { completed_at: now } : { completed_at: null }), ...(ctx.run.completed_at || (ctx.run as any).started_by ? {} : { started_by: acc.userId }) }
  const { error } = await sb.from('process_runs').upsert(runRow, { onConflict: 'mission_id,process_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (Object.keys(patch).length) await sb.from('incoming_missions').update({ ...patch, updated_at: now }).eq('id', m.id)
  if (status === 'done' && ctx.run.status !== 'done') await log('process_done', 'Prise en charge terminée : la suite se joue dans la fiche.')
  if (status === 'waiting_owner' && ctx.run.status !== 'waiting_owner') await log('process_step', 'Prise en charge faite ; propriétaire et assurance inconnus : en attente qu’il se fasse connaître.')
  const fresh = await loadContext(sb, m.id)
  return NextResponse.json(fresh)
}
