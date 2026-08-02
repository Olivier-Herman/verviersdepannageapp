// ============================================================
// VERVIERS DÉPANNAGE — Appel d'offre (brique 4b) : rédaction du mail-devis
// ------------------------------------------------------------
// Claude rédige une DEMANDE DE DEVIS classique (rien qui sente la plateforme
// d'enchères). Le corps est générique ; le nom du destinataire + le lien de
// dépôt tokenisé sont injectés à l'envoi.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

let _client: Anthropic | null = null
const getClient = () => (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }))

export interface RfqEmail { subject: string; paragraphs: string[] }

// Boîte d'envoi/réception des appels d'offre — configurable en base (app_settings
// clé 'achats_rfq_mailbox') pour flipper vers achats@ dès qu'elle est autorisée
// dans l'ApplicationAccessPolicy, sans redéploiement. Défaut : administration@.
export async function getRfqMailbox(sb: any): Promise<string> {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'achats_rfq_mailbox').maybeSingle()
    if (data?.value) {
      const raw = typeof data.value === 'string' ? data.value : String(data.value)
      const v = raw.trim().startsWith('"') ? JSON.parse(raw) : raw
      if (typeof v === 'string' && v.includes('@')) return v.trim()
    }
  } catch { /* défaut ci-dessous */ }
  return 'administration@verviersdepannage.com'
}

export async function generateRfqEmail(label: string, spec?: string): Promise<RfqEmail> {
  const prompt = `Rédige une DEMANDE DE DEVIS professionnelle et NATURELLE (français de Belgique), de la part de la société "Verviers Dépannage" (dépannage/remorquage automobile), adressée à un fournisseur.
Besoin : « ${label} ».${spec ? `\nPrécisions : ${spec}` : ''}

Ton : courtois, direct, comme un vrai mail commercial classique. PAS de jargon « appel d'offre / plateforme / mise en concurrence » — c'est une demande de prix normale.
N'inclus PAS la formule d'appel (« Bonjour X ») ni la signature ni un lien : ils seront ajoutés automatiquement. Écris seulement le corps (2 à 4 courts paragraphes) : le besoin, ce qu'on attend (prix, délai, conditions), et une phrase de clôture invitant à répondre.

Réponds UNIQUEMENT par un objet JSON : { "subject": "<objet du mail>", "paragraphs": ["<par1>", "<par2>", ...] }`

  const response = await getClient().messages.create({ model: ANTHROPIC_MODEL, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Aucun texte retourné')
  const parsed = JSON.parse(block.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '').trim())
  return {
    subject: String(parsed.subject || `Demande de devis — ${label}`).slice(0, 160),
    paragraphs: (Array.isArray(parsed.paragraphs) ? parsed.paragraphs : []).slice(0, 6).map((p: any) => String(p).slice(0, 800)).filter(Boolean),
  }
}
