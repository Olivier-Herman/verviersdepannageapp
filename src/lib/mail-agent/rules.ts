// src/lib/mail-agent/rules.ts
//
// RÈGLES FIXES DU TRI, SANS IA (lot 1, réponses d'Olivier du 06/10/2026 sur les 42 types).
//   - Supprimer = mettre à la corbeille : copies de nos factures (envoi de 22 h de l'ERP),
//     anomalies Circle K / fichier TID, annonces reKup.net, publicités et newsletters,
//     alertes carburant de Rent a Car.
//   - Classer seulement : Rent a Car → « RENT A CAR », copies des fiches VD Soft →
//     « Encaissements Chauffeur », relevé quotidien SumUp → « sumup » (le mensuel est lu
//     comme une facture), CODA Scrada → « Scrada - Livre de Caisse » (l'import du matin
//     cherche dans toute la boîte, le classement ne le gêne pas).
// On n'y touche pas : ordres de mission, eBox, banque, paie… (aucune règle ici).
// Une copie de notre facture RENVOYÉE avec un texte (« FW: », « RE: ») n'est pas une copie
// pure : elle n'est pas concernée (objet qui ne commence pas par le nom de la société).

import type { AgentMessage } from './graph'

export type FixedRule = { kind: 'trash'; why: string } | { kind: 'file'; folder: string; why: string }

const ERP_SENDER = /^notifications@verviers-depannage\.odoo\.com$/i
const OUR_INVOICE_COPY = /^Verviers D[ée]pannage Facture \(R[ée]f/i

export function fixedRule(msg: AgentMessage, mailbox: string): FixedRule | null {
  const from = (msg.fromEmail || '').toLowerCase(), subj = (msg.subject || '').trim()
  // Corbeille
  if (ERP_SENDER.test(from) && OUR_INVOICE_COPY.test(subj)) return { kind: 'trash', why: 'copie de notre facture envoyée par l’ERP' }
  if (/circlekeur/.test(from) || /^Anomalies FleetCards|Fichier de Facturation \(TID\)/i.test(subj)) return { kind: 'trash', why: 'anomalies de cartes carburant / fichier TID' }
  if (/@rekup\.net$/.test(from)) return { kind: 'trash', why: 'annonce reKup.net' }
  if (/^delphi@rentacar\.be$/.test(from) || /bas niveau de carburant/i.test(subj)) return { kind: 'trash', why: 'alerte carburant Rent a Car' }
  if (/^(newsletters?|marketing|news)@/.test(from) || /@(email\.)?sudinfo\.be$|@caralliance\.be$/.test(from)) return { kind: 'trash', why: 'publicité / newsletter' }
  // Classer
  if (/@rentacar\.be$/.test(from)) return { kind: 'file', folder: 'RENT A CAR', why: 'Rent a Car' }
  if (/@notification\.sumup\.com$/.test(from) && /relevé quotidien/i.test(subj)) return { kind: 'file', folder: 'sumup', why: 'relevé quotidien SumUp' }
  if (/@scrada\.be$/.test(from) && /CODA livre de caisse/i.test(subj)) return { kind: 'file', folder: 'Scrada - Livre de Caisse', why: 'CODA Scrada' }
  if (/^info@/i.test(mailbox) && /^administration@verviersdepannage\.com$/.test(from) && /^\S+\s+(Police Accident|Saisie|Mal Gar[ée]e|Siabis|AVP|Appel priv[ée])\s+—/i.test(subj)) {
    return { kind: 'file', folder: 'Encaissements Chauffeur', why: 'copie d’une fiche VD Soft' }
  }
  return null
}
