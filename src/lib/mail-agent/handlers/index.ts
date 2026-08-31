// Registre des handlers. Ajouter un assisteur = ajouter une ligne ici.
import type { MailHandler } from './types'
import { imaHandler } from './ima-rejet'
import { awpHandler } from './awp-rejet'

export const HANDLERS: MailHandler[] = [imaHandler, awpHandler]

export function handlerFor(fromEmail: string, subject: string): MailHandler | null {
  return HANDLERS.find(h => h.detect(fromEmail, subject)) || null
}

export function handlerById(id: string): MailHandler | null {
  return HANDLERS.find(h => h.id === id) || null
}

export type { MailHandler, RejectEntity, RejectExtraction } from './types'
