// src/lib/garage-closures.ts
//
// Alertes temporaires « garage fermé » : quand une adresse de destination /
// relivraison correspond à un garage en fermeture sur une période donnée, on
// affiche un message (dispatch + chauffeur) pour rediriger vers le repreneur.
// Config simple et datée → s'éteint toute seule après la période. Olivier 2026-07-14.

interface GarageClosure {
  match:   (normalizedLowerAddress: string) => boolean
  from:    string   // YYYY-MM-DD inclus
  to:      string   // YYYY-MM-DD inclus
  message: string
}

const CLOSURES: GarageClosure[] = [
  {
    // Car Avenue Verviers (Mercedes), Rue de Limbourg 2 à Verviers.
    match:   a => a.includes('car avenue') && a.includes('verviers'),
    from:    '2026-07-18',
    to:      '2026-08-02',
    message: 'Garage fermé du 18/07/2026 au 02/08/2026 inclus, dépannage et remorquage repris par Car Avenue Eupen',
  },
]

/** Date locale au format YYYY-MM-DD (côté client = fuseau de l'utilisateur). */
function localDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Retourne le message d'alerte si l'adresse correspond à un garage fermé ET que
 * la date du jour est dans la période. Sinon null.
 */
export function garageClosureNotice(address: string | null | undefined, now: Date = new Date()): string | null {
  const a = (address || '').toLowerCase().trim()
  if (!a) return null
  const today = localDate(now)
  for (const c of CLOSURES) {
    if (today >= c.from && today <= c.to && c.match(a)) return c.message
  }
  return null
}
