// src/app/api/mecano/chat/route.ts
//
// « La tête à Matthieu » — assistant mécano des dépanneurs.
// POST { mission_id? | brand?, model?, messages[], images?[] }
//   messages : [{role:'user'|'assistant', content:string}]
//   images   : [{ data:base64, media_type }] joints au DERNIER message user (photo à analyser)
// → cadre le véhicule (génération/motorisation), demande photo/VIN si incertain,
//   s.appuie sur les fiches, répond en « Matthieu ».
// Accès (test) : superadmin + Matthieu.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { normVehicle }       from '@/lib/mecano/ingest'
import { canUseMatthieu }    from '@/lib/mecano/access'
import Anthropic             from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL }   from '@/lib/anthropic-model'

export const dynamic     = 'force-dynamic'
export const maxDuration  = 60

const MAX_DOCS = 5
const TYPE_PRIORITY = ['tips', 'ouverture', 'gestion_moteur', 'electricite', 'remorquage', 'hv_securite', 'emergency', 'identification', 'autre']

const SYSTEM = `Tu es « La tête à Matthieu », le mécano-dépanneur expert de Verviers Dépannage — la référence que tous les chauffeurs appellent sur le terrain. Tu réponds comme lui : direct, concret, orienté terrain, la SÉCURITÉ d'abord, tutoiement, en français.

Adresse-toi au chauffeur par son PRÉNOM (donné dans le contexte). Au tout premier message, commence par « Salut <prénom> ». N'utilise JAMAIS « collègue », ni un nom de famille.

PÉRIMÈTRE STRICT : tu es un mécano-dépanneur hyper compétent, PAS un psy, pas un coach, pas un conseiller de vie, pas un moteur de recherche généraliste. Tu ne parles QUE de véhicules, pannes, dépannage, remorquage et sécurité d'intervention. Si on te pose une question hors sujet (perso, sentimentale, existentielle, psychologique, politique, blague sans rapport, devoirs, cuisine…), tu RECADRES avec humour mais fermement et correctement, sans jamais être blessant — par ex. « Gros, je suis mécano, pas psy 😄 T'as un souci sur un véhicule, là je suis ton homme. » Puis tu ramènes direct sur l'intervention. Ne te laisse pas entraîner, même si on insiste.

SOURCE : ta connaissance vient de TOI, « La tête à Matthieu ». Ne cite JAMAIS « Touring » (ni aucune marque de base de données externe) comme source. Parle de « ma fiche », « ma doc », « d'expérience », « ce que je connais sur ce modèle ». Le mot « Touring » ne doit jamais apparaître dans tes réponses.

RÈGLE ABSOLUE — CADRER AVANT DE RÉPONDRE :
Ne donne JAMAIS une procédure précise (ouverture, coupure haute tension, point d'ancrage, mode remorquage, gestion moteur) sans être CERTAIN du véhicule EXACT : marque, modèle, **génération/année**, et **motorisation** (essence/diesel/hybride/électrique). Une même appellation couvre plusieurs générations très différentes — se tromper de génération peut être dangereux.
- Si la génération ou la motorisation n'est pas certaine, POSE la question d'abord (propose les générations disponibles listées dans le contexte).
- Si le chauffeur ne sait pas : demande-lui **une photo** (du véhicule, du compartiment moteur, de la plaque motorisation, du tableau de bord) que tu analyseras, ou **le VIN** (n° de châssis, 17 caractères — le 10e caractère code l'année). Tu peux déduire beaucoup d'une photo ou d'un VIN.
- Une fois le véhicule confirmé, réponds sur base de tes fiches fournies.

MONTRER UNE FICHE :
Tu PEUX montrer un schéma/diagramme au chauffeur — utilise l'outil \`montrer_fiche\` (type = ouverture, remorquage, electricite, gestion_moteur, tips, hv_securite…) en précisant la génération confirmée. La fiche s'affichera dans le chat. Fais-le dès que le chauffeur veut VOIR quelque chose (« montre-moi », « t'as un schéma ? », points d'ancrage, emplacement d'un point…). Montre UNIQUEMENT la fiche concernée par sa question, jamais tout. Commente brièvement ce qu'il doit y regarder.

STYLE :
- Réponses courtes et actionnables (le chauffeur est en intervention, souvent une main sur le téléphone). Étapes numérotées pour une procédure.
- Cite ce que dit la fiche (emplacement fusible, point d'ancrage, procédure d'ouverture, coupure HT…). Si l'info n'y est pas : dis-le et donne ton meilleur conseil en le signalant (« pas dans la fiche, mais d'expérience… »).
- Rappelle toujours les précautions de sécurité pertinentes (batterie, airbags, haute tension sur électriques/hybrides, boîte auto, freins de parking électriques…).`

function pickDocs(all: any[], missionModel: string): any[] {
  const mNorm = normVehicle(missionModel)
  const core = normVehicle((missionModel || '').trim().split(/\s+/)[0] || '')
  const scored = all.map(d => {
    let score = 0
    if (core && d.model_norm && (d.model_norm.startsWith(core) || d.model_norm.includes(core))) score += 100
    if (mNorm && d.model_norm && (mNorm.includes(d.model_norm) || d.model_norm.includes(mNorm))) score += 50
    score += Math.max(0, 20 - TYPE_PRIORITY.indexOf(d.doc_type))
    return { d, score }
  }).sort((a, b) => b.score - a.score)
  const out: any[] = []; const typesSeen = new Map<string, number>()
  for (const { d } of scored) {
    if (out.length >= MAX_DOCS) break
    const n = typesSeen.get(d.doc_type) || 0
    if (n >= 2) continue
    out.push(d); typesSeen.set(d.doc_type, n + 1)
  }
  return out
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, role, name, surnom').eq('email', u.email).maybeSingle()
  if (!canUseMatthieu(me?.role, me?.id)) return NextResponse.json({ error: 'Accès réservé (test)' }, { status: 403 })
  // Nom d'appel : surnom que Matthieu utilise s'il existe, sinon le prénom.
  const firstName = String(me?.surnom || '').trim() || String(me?.name || '').trim().split(/\s+/)[0] || ''

  const body = await req.json().catch(() => ({}))
  let brand = String(body.brand || '').trim()
  let model = String(body.model || '').trim()
  if (body.mission_id) {
    const { data: m } = await sb.from('incoming_missions').select('vehicle_brand, vehicle_model').eq('id', String(body.mission_id)).maybeSingle()
    if (m) { brand = brand || m.vehicle_brand || ''; model = model || m.vehicle_model || '' }
  }

  // Fiches + générations disponibles pour la marque
  let chosen: any[] = []
  let generations: string[] = []
  if (brand) {
    const { data: docs } = await sb.from('mecano_docs')
      .select('id, section, model, model_norm, doc_type, label, storage_path')
      .eq('brand_norm', normVehicle(brand)).not('storage_path', 'is', null)
    if (docs?.length) {
      generations = [...new Set(docs.map(d => d.model))].sort()
      chosen = pickDocs(docs, model)
    }
  }

  // PDF choisis → blocs document
  const pdfBlocks: any[] = []
  const used: any[] = []
  for (const d of chosen) {
    const { data: file } = await sb.storage.from('mecano').download(d.storage_path)
    if (!file) continue
    const b64 = Buffer.from(await file.arrayBuffer()).toString('base64')
    pdfBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 },
      title: `${d.section === 'remorquage' ? 'REMORQUAGE' : 'DÉPANNAGE'} · ${d.model} · ${d.label}` })
    used.push({ section: d.section, model: d.model, type: d.doc_type, label: d.label })
  }

  // Photos jointes ce tour (vision)
  const imgs: any[] = (Array.isArray(body.images) ? body.images : [])
    .filter((x: any) => x && typeof x.data === 'string')
    .slice(0, 3)
    .map((x: any) => ({ type: 'image', source: { type: 'base64', media_type: x.media_type || 'image/jpeg', data: x.data } }))

  const history: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(body.messages)
    ? body.messages.filter((x: any) => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string')
    : []
  const question = String(body.question || '').trim()
  if (question) history.push({ role: 'user', content: question })
  if (!history.length && !imgs.length) return NextResponse.json({ error: 'Question vide' }, { status: 400 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'IA indisponible (clé manquante)' }, { status: 503 })
  const client = new Anthropic({ apiKey })

  const ctx = `Chauffeur (prénom à utiliser) : ${firstName || 'inconnu'}\n\nContexte véhicule (à CONFIRMER avant toute procédure) :\n- Marque : ${brand || 'INCONNUE'}\n- Modèle annoncé sur la fiche : ${model || 'non précisé'}\n${generations.length ? `- Générations que tu connais pour ${brand} : ${generations.join(' · ')}` : brand ? `- (pas encore de fiches importées pour ${brand})` : ''}`

  const lastUserIdx = (() => { for (let i = history.length - 1; i >= 0; i--) if (history[i].role === 'user') return i; return -1 })()
  const msgs: any[] = history.map((h, i) => {
    const blocks: any[] = []
    if (i === 0) { blocks.push(...pdfBlocks); blocks.push({ type: 'text', text: ctx }) }
    if (i === lastUserIdx && imgs.length) blocks.push(...imgs)
    blocks.push({ type: 'text', text: h.content || (imgs.length ? 'Analyse cette photo pour identifier le véhicule.' : '') })
    return { role: h.role, content: blocks.length === 1 ? blocks[0].text : blocks }
  })

  // Outil « montrer une fiche » : Claude choisit type + génération → on renvoie
  // la fiche (URL signée) que le client affiche.
  const tools = [{
    name: 'montrer_fiche',
    description: 'Affiche au chauffeur UNE fiche technique précise (la partie concernée par sa question, pas toute la doc).',
    input_schema: {
      type: 'object' as const,
      properties: {
        type:       { type: 'string', description: 'Type de fiche', enum: ['ouverture', 'remorquage', 'tips', 'electricite', 'gestion_moteur', 'hv_securite', 'emergency', 'identification'] },
        generation: { type: 'string', description: 'Génération/année confirmée du véhicule (ex. "A4 2015-"). Optionnel si évident.' },
      },
      required: ['type'],
    },
  }]

  async function resolveFiche(input: any): Promise<{ ok: boolean; title?: string; url?: string; section?: string; note?: string }> {
    if (!brand) return { ok: false, note: 'véhicule non identifié' }
    let q = sb.from('mecano_docs').select('section, model, model_norm, doc_type, label, storage_path')
      .eq('brand_norm', normVehicle(brand)).eq('doc_type', String(input?.type || '')).not('storage_path', 'is', null)
    const { data: cands } = await q
    if (!cands?.length) return { ok: false, note: `pas de fiche ${input?.type} pour ${brand}` }
    const gen = normVehicle(String(input?.generation || model || ''))
    const best = gen ? (cands.find(c => c.model_norm === gen) || cands.find(c => c.model_norm.includes(gen) || gen.includes(c.model_norm)) || cands[0]) : cands[0]
    const { data: signed } = await sb.storage.from('mecano').createSignedUrl(best.storage_path, 3600)
    if (!signed?.signedUrl) return { ok: false, note: 'fiche indisponible' }
    return { ok: true, title: `${best.section === 'remorquage' ? 'Remorquage' : 'Dépannage'} · ${best.model} · ${best.label}`, url: signed.signedUrl, section: best.section }
  }

  try {
    const attachments: any[] = []
    let guard = 0
    while (guard++ < 4) {
      const resp: any = await client.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 1500, system: SYSTEM, tools, messages: msgs })
      if (resp.stop_reason === 'tool_use') {
        msgs.push({ role: 'assistant', content: resp.content })
        const results: any[] = []
        for (const b of resp.content) {
          if (b.type !== 'tool_use') continue
          const r = await resolveFiche(b.input)
          if (r.ok) attachments.push({ title: r.title, url: r.url, section: r.section })
          results.push({ type: 'tool_result', tool_use_id: b.id, content: r.ok ? `Fiche affichée au chauffeur : ${r.title}` : `Impossible : ${r.note}` })
        }
        msgs.push({ role: 'user', content: results })
        continue
      }
      const text = resp.content.find((b: any) => b.type === 'text') as any
      const answer = text?.text || '(pas de réponse)'
      // Trace de la conversation (supervision superadmin + persistance mission).
      // conversation_id = la mission (1 conversation/mission), sinon id fourni.
      const convId = String(body.conversation_id || body.mission_id || '') || crypto.randomUUID()
      const lastUser = [...history].reverse().find(h => h.role === 'user')?.content || question || (imgs.length ? '[photo]' : '')
      const base = { conversation_id: convId, user_id: me?.id || null, user_name: firstName, mission_id: body.mission_id || null, brand, model }
      await sb.from('mecano_messages').insert([
        { ...base, role: 'user',      content: lastUser, images_count: imgs.length },
        { ...base, role: 'assistant', content: answer, attachments: attachments.length ? attachments : null },
      ]).then(() => {}, () => {})
      return NextResponse.json({ ok: true, answer, brand, model, generations, docs_used: used, attachments, conversation_id: convId })
    }
    return NextResponse.json({ ok: true, answer: 'Réessaie ta question 🙂', attachments })
  } catch (e: any) {
    return NextResponse.json({ error: `Matthieu bloque là : ${e?.message || 'erreur IA'}` }, { status: 500 })
  }
}

// GET ?mission_id=... → historique de la conversation (persistance jusqu'à clôture)
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, role').eq('email', u.email).maybeSingle()
  if (!canUseMatthieu(me?.role, me?.id)) return NextResponse.json({ error: 'Accès réservé' }, { status: 403 })
  const missionId = new URL(req.url).searchParams.get('mission_id')
  if (!missionId) return NextResponse.json({ messages: [] })
  const { data } = await sb.from('mecano_messages')
    .select('role, content, attachments, created_at')
    .eq('conversation_id', missionId).order('created_at')
  return NextResponse.json({ messages: (data || []).map(m => ({ role: m.role, content: m.content, attachments: m.attachments })) })
}
