// src/lib/espace/tgr-clos.ts — serveur seulement (lit les réglages métier).
import { getBusinessText } from '@/lib/settings/business'

/** Fin du service TGR (Olivier 18/11/2026, décision d'Axel) : date « AAAA-MM-JJ » du réglage, ou null si le service est ouvert. */
export async function tgrClosLe(): Promise<string | null> {
  try {
    const d = (await getBusinessText('espace_tgr_clos_le')).trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }) ? d : null
  } catch { return null }
}
