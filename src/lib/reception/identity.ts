// src/lib/reception/identity.ts
//
// Normalisation des identifiants de contact (téléphone / e-mail) pour le module
// Réception + le matching des appels. Le matching se fait sur les 9 derniers
// chiffres (robuste quel que soit le format : +32…, 0032…, 0…, espaces, etc.).

/** Chiffres significatifs d'un numéro (9 derniers) → clé de rapprochement. */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/\D+/g, '')
  if (digits.length < 6) return null           // trop court → non exploitable
  return digits.slice(-9)
}

/** Affichage propre d'un numéro (espaces retirés, garde un éventuel +). */
export function phoneDisplay(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  const plus = s.trimStart().startsWith('+')
  const digits = s.replace(/\D+/g, '')
  if (!digits) return null
  return (plus ? '+' : '') + digits
}

/** E-mail normalisé (minuscule, trim) ou null si invalide. */
export function emailKey(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null
}

/** Au moins un identifiant exploitable (e-mail OU GSM) — règle borne visiteur. */
export function hasIdentity(phone?: string | null, email?: string | null): boolean {
  return !!phoneKey(phone) || !!emailKey(email)
}
