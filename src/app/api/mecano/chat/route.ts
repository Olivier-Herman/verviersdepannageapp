// src/app/api/mecano/chat/route.ts
//
// « La tête à Matthieu » — assistant mécano des dépanneurs.
// POST { mission_id? | brand, model, question | messages[] }
//   → sélectionne les fiches techniques Touring du véhicule (dépannage +
//     remorquage), les passe à Claude avec le persona « Matthieu », répond.
// Accès : tout utilisateur connecté (chauffeur en intervention).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { normVehicle }       from '@/lib/mecano/ingest'
import Anthropic             from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL }   from '@/lib/anthropic-model'

export const dynamic     = 'force-dynamic'
export const maxDuration  = 60

const MAX_DOCS = 4   // borne le nb de PDF envoyés à Claude (tokens)

// Priorité des types de fiche selon l'intention (par défaut : conseil panne).
const TYPE_PRIORITY = ['tips', 'ouverture', 'gestion_moteur', 'electricite', 'remorquage', 'hv_securite', 'emergency', 'identification', 'autre']

const SYSTEM = `Tu es « La tête à Matthieu », le mécano-dépanneur expert de Verviers Dépannage.
Matthieu est LA référence que tous les chauffeurs appellent sur le terrain : tu réponds comme lui — direct, concret, pratique, orienté terrain, la sécurité d'abord.
Tu t'appuies EN PRIORITÉ sur les fiches techniques Touring fournies (dépannage et remorquage du véhicule concerné). Cite ce qu'elles disent (ex. emplacement d'un fusible, point d'ancrage, mode transport, procédure d'ouverture, coupure haute tension pour les électriques/hybrides).
Si l'info n'est pas dans les fiches, dis-le clairement et donne ton meilleur conseil de mécano en le signalant (« pas dans la fiche, mais d'expérience… »).
Réponses courtes et actionnables (le chauffeur est en intervention, souvent au téléphone d'une main). Étapes numérotées quand c'est une procédure. Toujours rappeler les précautions de sécurité pertinentes (batterie, airbags non déployés, haute tension, boîte auto…).
Tu réponds en français, tutoiement, ton collègue.`

function pickDocs(all: any[], missionModel: string): any[] {
  const mNorm = normVehicle(missionModel)
  const coreTok = (missionModel || '').trim().split(/\s+/)[0] || ''
  const core = normVehicle(coreTok)
  const scored = all.map(d => {
    let score = 0
    if (core && (d.model_norm.startsWith(core) || d.model_norm.includes(core) || (mNorm && mNorm.includes(d.model_norm)))) score += 100
    if (mNorm && d.model_norm && (mNorm.includes(d.model_norm) || d.model_norm.includes(mNorm))) score += 50
    score += Math.max(0, 20 - TYPE_PRIORITY.indexOf(d.doc_type)) // type prioritaire
    return { d, score }
  }).sort((a, b) => b.score - a.score)
  // Diversité de types : on évite 4 fois le même type.
  const out: any[] = []; const typesSeen = new Set<string>()
  for (const { d } of scored) {
    if (out.length >= MAX_DOCS) break
    if (typesSeen.has(d.doc_type) && out.length >= 2) continue
    out.push(d); typesSeen.add(d.doc_type)
  }
  return out
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))

  // 1) Résoudre marque/modèle
  let brand = String(body.brand || '').trim()
  let model = String(body.model || '').trim()
  if (body.mission_id) {
    const { data: m } = await sb.from('incoming_missions').select('vehicle_brand, vehicle_model').eq('id', String(body.mission_id)).maybeSingle()
    if (m) { brand = brand || m.vehicle_brand || ''; model = model || m.vehicle_model || '' }
  }
  if (!brand) return NextResponse.json({ error: 'Véhicule inconnu (marque manquante)' }, { status: 400 })

  // 2) Fiches de la marque
  const { data: docs } = await sb.from('mecano_docs')
    .select('id, section, model, model_norm, doc_type, label, storage_path')
    .eq('brand_norm', normVehicle(brand))
    .not('storage_path', 'is', null)
  if (!docs || !docs.length) {
    return NextResponse.json({ ok: true, answer: `Je n'ai pas encore les fiches techniques pour ${brand} dans ma base. Préviens un superadmin pour lancer l'import de cette marque.`, docs: [] })
  }
  const chosen = pickDocs(docs, model)

  // 3) Télécharger les PDF choisis (base64)
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

  // 4) Messages (historique ou question simple)
  const history: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(body.messages)
    ? body.messages.filter((x: any) => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string')
    : []
  const question = String(body.question || '').trim()
  if (question) history.push({ role: 'user', content: question })
  if (!history.length) return NextResponse.json({ error: 'Question vide' }, { status: 400 })

  // 5) Appel Claude — les PDF + le contexte véhicule sur le 1er message user
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'IA indisponible (clé manquante)' }, { status: 503 })
  const client = new Anthropic({ apiKey })

  const msgs: any[] = history.map((h, i) => {
    if (i === 0 && h.role === 'user') {
      return { role: 'user', content: [
        ...pdfBlocks,
        { type: 'text', text: `Véhicule : ${brand} ${model || '(modèle non précisé)'}.\nFiches Touring jointes ci-dessus.\n\nQuestion du dépanneur : ${h.content}` },
      ] }
    }
    return { role: h.role, content: h.content }
  })

  try {
    const resp = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      messages: msgs,
    })
    const text = resp.content.find((b: any) => b.type === 'text') as any
    return NextResponse.json({ ok: true, answer: text?.text || '(pas de réponse)', brand, model, docs_used: used })
  } catch (e: any) {
    return NextResponse.json({ error: `Matthieu réfléchit mal là : ${e?.message || 'erreur IA'}` }, { status: 500 })
  }
}
