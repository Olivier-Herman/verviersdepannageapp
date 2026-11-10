// src/lib/site/garde-fous.ts — protections des formulaires publics du site.
// Même principe que /api/site/contact : limitation par IP en mémoire (par
// instance) et nettoyage des champs. Le champ piège reste dans chaque route.

const hits = new Map<string, number[]>()

/** true si cette IP a déjà fait plus de `max` envois sur la fenêtre (10 min par défaut). */
export function limite(cle: string, max = 5, fenetreMs = 10 * 60 * 1000): boolean {
  const now = Date.now()
  const seen = (hits.get(cle) || []).filter(t => now - t < fenetreMs)
  seen.push(now); hits.set(cle, seen)
  if (hits.size > 5000) hits.clear()
  return seen.length > max
}

export const ipDe = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
export const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
/** Numéro exploitable : au moins 9 chiffres. */
export const gsmValide = (s: string) => s.replace(/\D/g, '').length >= 9
