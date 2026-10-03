// src/lib/courrier/plan.ts — l'agent traduit (lecture + corrections + consigne en clair
// + procédure retenue pour l'expéditeur) en GESTES concrets, chacun avec sa phrase
// lisible. Rien n'est fait ici : on montre « Ce que j'ai compris », l'humain dit
// « Faire ça ». Olivier 29/09/2026 : « quand je corrige, je veux pouvoir expliquer à
// l'agent ce que je veux pour qu'il fasse la bonne procédure ».

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODELS, createWithModelFallback } from '@/lib/anthropic-model'
import { DOC_TYPES, ENTITIES, type CourrierReading, type DocType, type EntityKey, type PlanStep } from './types'
import { aiClient } from '@/lib/ai/usage'

let client: Anthropic | null = null
const getClient = () => client || (client = aiClient('courrier/plan', { apiKey: process.env.ANTHROPIC_API_KEY! }))

const KINDS = `Gestes possibles (kind → params) :
- attach_mission { mission_id } : ranger le scan dans la fiche (documents) et le noter au journal de la fiche.
- requisitoire_received { mission_id } : réquisitoire ou levée de saisie reçu pour une fiche de saisie : ranger le scan et marquer le réquisitoire reçu (arrête les relances).
- task { assignee_id, title, due_days } : créer une tâche pour une personne (due_days = 0 pour aujourd'hui, 7 pour un rappel à une semaine).
- notify { user_id, message } : prévenir une personne par notification (message court).
- draft_reply { to_email, to_name, subject, body } : préparer un BROUILLON de réponse dans administration@ (jamais envoyé ; le scan est joint ; body en texte simple, poli, en français, signé « Verviers Dépannage », sans jamais dire que c'est automatisé).
- supplier_invoice { company } : facture fournisseur à encoder : transmettre le scan à l'encodage des achats de la société ("vd", "riga" ou "dgj").
- fine {} : contravention / amende (PV de police, perception immédiate, SPF Justice…) : transmettre le scan au module Amendes, qui le lit, retrouve le chauffeur du jour et suit sa procédure.
- file_only {} : classer dans le registre sans autre geste.`

const SYSTEM = `Tu es l'agent Courrier d'un groupe de dépannage belge. On te donne un courrier déjà lu, son classement (société, type), la fiche rattachée éventuelle, la procédure retenue pour cet expéditeur et parfois une consigne écrite par l'utilisateur.
Tu proposes les gestes concrets à faire, dans l'ordre.
${KINDS}
Règles :
- La consigne de l'utilisateur prime sur tout ; ensuite la procédure retenue pour l'expéditeur, à appliquer À LA LETTRE (ne rien ajouter qu'elle n'exclut implicitement : « juste créer l'achat » = uniquement supplier_invoice pour la société du courrier) ; sinon les usages : réquisitoire → requisitoire_received ; facture fournisseur → supplier_invoice ; courrier d'assureur, de client ou de justice lié à une fiche → attach_mission + task pour la bonne personne ; amende → fine (le module Amendes s'occupe de tout) ; publicité → file_only.
- N'utilise que les mission_id et les id de personnes fournis. Pas de fiche fournie = pas de attach_mission ni requisitoire_received.
- "label" : une phrase en français, concrète et courte, qui dit exactement ce qui sera fait (qui, quoi, quand), sans jargon technique.
Retourne UNIQUEMENT un JSON strict : { "understood": <1 phrase : ce que tu as compris de la demande>, "steps": [ { "kind": …, "label": …, "params": { … } } ] }`

export interface PlanInput {
  reading:      CourrierReading
  entity:       EntityKey | null
  docType:      DocType
  mission:      { id: string; label: string } | null
  candidates:   { id: string; label: string }[]
  rule:         string | null
  instruction:  string | null
  corrections:  string[]
  people:       { id: string; name: string; role: string }[]
  me?:          { id: string; name: string | null } | null
}

export async function planCourrier(p: PlanInput): Promise<{ understood: string; steps: PlanStep[] }> {
  const ctx = {
    courrier: { expediteur: p.reading.sender, email_expediteur: p.reading.sender_email, adresse_a: p.reading.addressed_to, resume: p.reading.summary,
      plaque: p.reading.plate, reference: p.reading.reference, montant_eur: p.reading.amount_eur, echeance: p.reading.due_date },
    classement: { societe: p.entity ? ENTITIES[p.entity].label : 'inconnue', type: DOC_TYPES[p.docType] },
    corrections_faites_par_l_utilisateur: p.corrections,
    fiche_rattachee: p.mission, autres_fiches_possibles: p.candidates,
    procedure_retenue_pour_cet_expediteur: p.rule,
    consigne_de_l_utilisateur: p.instruction,
    personnes: p.people,
    utilisateur_qui_parle: p.me || null,   // « moi », « me », « pour moi » = cette personne
  }
  const resp = await createWithModelFallback(getClient(), ANTHROPIC_MODELS, { max_tokens: 1500, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(ctx) }] })
  const text = (resp.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
  // Réponse parfois entourée de texte : on garde du premier « { » au dernier « } ».
  const cleaned = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  let j: any
  try { j = JSON.parse(cleaned) } catch { throw new Error('L’agent n’a pas su reformuler, réessayez ou précisez la consigne') }
  // Garde-fous : gestes connus, ids connus.
  const missionIds = new Set([p.mission?.id, ...p.candidates.map(c => c.id)].filter(Boolean) as string[])
  const peopleIds = new Set(p.people.map(x => x.id))
  const steps: PlanStep[] = (Array.isArray(j.steps) ? j.steps : []).filter((s: any) => {
    const pr = s?.params || {}
    switch (s?.kind) {
      case 'attach_mission': case 'requisitoire_received': return missionIds.has(pr.mission_id)
      case 'task': return peopleIds.has(pr.assignee_id) && !!pr.title
      case 'notify': return peopleIds.has(pr.user_id) && !!pr.message
      case 'draft_reply': return !!pr.subject && !!pr.body
      case 'supplier_invoice': return ['vd', 'riga', 'dgj'].includes(pr.company)
      case 'fine': return true
      case 'file_only': return true
      default: return false
    }
  }).map((s: any) => ({ kind: s.kind, label: String(s.label || ''), params: s.params || {} }))
  if (!steps.length) steps.push({ kind: 'file_only', label: 'Classer dans le registre, sans autre geste.', params: {} })
  return { understood: String(j.understood || ''), steps }
}
