// src/app/api/courrier/[id]/route.ts — un courrier : lecture, compréhension, exécution.
// POST { action: 'read' }                         → Claude lit, rattache, propose
// POST { action: 'understand', entity, doc_type, mission_id, instruction }
//                                                 → « Ce que j'ai compris » (rien n'est fait)
// POST { action: 'execute', how, entity, doc_type, mission_id, instruction, steps, keep }
//                                                 → « C'est ça » / « Faire ça »
// POST { action: 'ignore' }
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { courrierAccess } from '@/lib/courrier/access'
import { readCourrier } from '@/lib/courrier/read'
import { planCourrier } from '@/lib/courrier/plan'
import { executePlan } from '@/lib/courrier/actions'
import { findMissions, missionLabel, officePeople } from '@/lib/courrier/match'
import { DOC_TYPES, ENTITIES, senderKey, type DocType, type EntityKey, type PlanStep } from '@/lib/courrier/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function load(sb: any, id: string) {
  const { data } = await sb.from('courriers').select('*').eq('id', id).maybeSingle()
  return data
}

async function context(sb: any, c: any) {
  const pages = c.pages || []
  const signed = pages.length ? (await sb.storage.from('courrier').createSignedUrls(pages.map((p: any) => p.path), 3600)).data || [] : []
  const urls = pages.map((p: any) => ({ mime: p.mime, url: signed.find((s: any) => s.path === p.path)?.signedUrl || null }))
  const [{ data: tasks }, { data: rule }] = await Promise.all([
    sb.from('courrier_tasks').select('id, assignee_id, title, due_at, done_at').eq('courrier_id', c.id),
    c.sender_key ? sb.from('courrier_rules').select('*').eq('sender_key', c.sender_key).maybeSingle() : Promise.resolve({ data: null }),
  ])
  return { ...c, page_urls: urls, tasks: tasks || [], rule }
}

async function missionRef(sb: any, id: string | null | undefined) {
  if (!id) return null
  const { data } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, source, status, parc_zone_key, billed_to_name, dossier_number').eq('id', id).maybeSingle()
  return data ? { id: data.id, label: await missionLabel(data) } : null
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const a = await courrierAccess(); if (!a.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const c = await load(sb, params.id); if (!c) return NextResponse.json({ error: 'Courrier introuvable' }, { status: 404 })
  return NextResponse.json(await context(sb, c))
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await courrierAccess(); if (!a.ok || !a.userId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const c = await load(sb, params.id); if (!c) return NextResponse.json({ error: 'Courrier introuvable' }, { status: 404 })
  const now = new Date().toISOString()

  switch (body.action) {
    case 'read': {
      try {
        const pages: { base64: string; mime: string }[] = []
        for (const p of c.pages || []) {
          const { data } = await sb.storage.from('courrier').download(p.path)
          if (data) pages.push({ base64: Buffer.from(await data.arrayBuffer()).toString('base64'), mime: p.mime })
        }
        if (!pages.length) throw new Error('Aucune page reçue : recommencez le scan ou la photo.')
        const reading = await readCourrier(pages)
        const key = senderKey(reading.sender)
        const [cands, ruleR, people] = await Promise.all([
          findMissions(sb, reading),
          key ? sb.from('courrier_rules').select('*').eq('sender_key', key).maybeSingle() : Promise.resolve({ data: null }),
          officePeople(sb),
        ])
        const rule = (ruleR as any).data
        const candidates = await Promise.all(cands.map(async m => ({ id: m.id, label: await missionLabel(m) })))
        const entity = (rule?.entity || reading.entity || null) as EntityKey | null
        const docType = (rule?.doc_type || reading.doc_type) as DocType
        const mission = candidates[0] || null
        const plan = await planCourrier({ reading, entity, docType, mission, candidates: candidates.slice(1), rule: rule?.instruction || null, instruction: null, corrections: [], people, me: { id: a.userId, name: a.name } })
        const proposal = { entity, entity_conf: rule?.entity ? 99 : reading.entity_conf, doc_type: docType, type_conf: rule?.doc_type ? 99 : reading.type_conf, mission, candidates, plan,
          rule: rule ? { instruction: rule.instruction, validated_count: rule.validated_count } : null, weak: !entity || (!rule && reading.type_conf < 60) }
        await sb.from('courriers').update({ status: 'to_validate', error: null, reading, sender_key: key, proposal, mission_id: mission?.id || null, updated_at: now }).eq('id', c.id)
        // Contravention reconnue avec assurance : transmise d'office au module Amendes,
        // qui suit sa procédure ; le courrier est classé « traité » (Olivier 29/09/2026).
        if (docType === 'amende' && (rule?.doc_type === 'amende' || reading.type_conf >= 80)) {
          const steps = [{ kind: 'fine' as const, label: 'Transmettre le PV au module Amendes (lecture, chauffeur du jour, brouillon).', params: {} }]
          const { data: locked } = await sb.from('courriers').update({ status: 'done', decided_at: now, decided_by: c.created_by || a.userId, updated_at: now }).eq('id', c.id).eq('status', 'to_validate').select('id')
          if (locked?.length) {
            const results = await executePlan({ ...c, reading }, steps, c.created_by || a.userId, 'VD Soft')
            await sb.from('courriers').update({ decision: { how: 'automatique', by: null, by_name: 'automatique', at: now, entity, doc_type: docType, mission_id: null, instruction: null, steps, results } }).eq('id', c.id)
          }
        }
      } catch (e: any) {
        await sb.from('courriers').update({ status: 'error', error: e?.message || 'Lecture impossible', updated_at: now }).eq('id', c.id)
      }
      return NextResponse.json(await context(sb, await load(sb, c.id)))
    }

    case 'understand': {
      if (c.status !== 'to_validate') return NextResponse.json({ error: 'Ce courrier est déjà traité.' }, { status: 409 })
      const P = c.proposal || {}
      const entity = (body.entity in ENTITIES ? body.entity : P.entity) as EntityKey | null
      const docType = (body.doc_type in DOC_TYPES ? body.doc_type : P.doc_type) as DocType
      const mission = body.mission_id === null ? null : await missionRef(sb, body.mission_id || P.mission?.id)
      const corrections: string[] = []
      if (entity !== P.entity && entity) corrections.push(`c'est pour ${ENTITIES[entity].label}${P.entity ? ` et non ${ENTITIES[P.entity as EntityKey].label}` : ''}`)
      if (docType !== P.doc_type) corrections.push(`c'est « ${DOC_TYPES[docType]} » et non « ${DOC_TYPES[P.doc_type as DocType] || '?'} »`)
      if ((mission?.id || null) !== (P.mission?.id || null)) corrections.push(mission ? `à rattacher à : ${mission.label}` : 'à ne rattacher à aucune fiche')
      const { data: rule } = c.sender_key ? await sb.from('courrier_rules').select('instruction').eq('sender_key', c.sender_key).maybeSingle() : { data: null }
      try {
        const plan = await planCourrier({ reading: c.reading, entity, docType, mission, candidates: (P.candidates || []).filter((x: any) => x.id !== mission?.id), rule: rule?.instruction || null,
          instruction: String(body.instruction || '').trim() || null, corrections, people: await officePeople(sb), me: { id: a.userId!, name: a.name } })
        return NextResponse.json({ ...plan, entity, doc_type: docType, mission, corrections })
      } catch (e: any) { return NextResponse.json({ error: e?.message || 'L’agent n’a pas compris' }, { status: 502 }) }
    }

    case 'execute': {
      const how = ['validé', 'corrigé', 'consigne'].includes(body.how) ? body.how : 'validé'
      const P = c.proposal || {}
      const steps: PlanStep[] = Array.isArray(body.steps) ? body.steps : P.plan?.steps || []
      const entity = (body.entity in ENTITIES ? body.entity : P.entity) || null
      const docType = (body.doc_type in DOC_TYPES ? body.doc_type : P.doc_type) || 'autre'
      const missionId = body.mission_id === null ? null : (body.mission_id || P.mission?.id || null)
      // Verrou : un seul « Faire ça » par courrier (double clic, deux personnes).
      const { data: locked } = await sb.from('courriers').update({ status: 'done', decided_at: now, decided_by: a.userId, updated_at: now }).eq('id', c.id).eq('status', 'to_validate').select('id')
      if (!locked?.length) return NextResponse.json({ error: 'Ce courrier vient d’être traité par quelqu’un d’autre.' }, { status: 409 })
      const results = await executePlan(c, steps, a.userId, a.name || 'VD Soft')
      const instruction = String(body.instruction || '').trim() || null
      await sb.from('courriers').update({ mission_id: missionId, decision: { how, by: a.userId, by_name: a.name, at: now, entity, doc_type: docType, mission_id: missionId, instruction, steps, results, understood: body.understood || null } }).eq('id', c.id)
      // Apprentissage par expéditeur : classement toujours ; consigne seulement si « Retenir ».
      if (c.sender_key && c.reading?.sender) {
        const { data: prev } = await sb.from('courrier_rules').select('*').eq('sender_key', c.sender_key).maybeSingle()
        const keep = body.keep !== false
        if (how === 'validé' || keep) {
          await sb.from('courrier_rules').upsert({
            sender_key: c.sender_key, sender_label: c.reading.sender, entity, doc_type: docType,
            instruction: keep && instruction ? instruction : prev?.instruction || null,
            validated_count: (prev?.validated_count || 0) + (how === 'validé' ? 1 : 0),
            corrected_count: (prev?.corrected_count || 0) + (how === 'validé' ? 0 : 1),
            updated_by: a.userId, updated_at: now,
          }, { onConflict: 'sender_key' })
        }
      }
      return NextResponse.json(await context(sb, await load(sb, c.id)))
    }

    case 'ignore': {
      await sb.from('courriers').update({ status: 'ignored', decided_at: now, decided_by: a.userId, decision: { how: 'ignoré', by: a.userId, by_name: a.name, at: now }, updated_at: now }).eq('id', c.id).in('status', ['to_validate', 'error'])
      return NextResponse.json(await context(sb, await load(sb, c.id)))
    }
  }
  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
