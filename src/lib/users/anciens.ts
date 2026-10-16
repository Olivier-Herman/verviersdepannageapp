// Membres partis (users.active = false, ex. Tayson le 16/10/2026) : plus d'accès ni
// d'attribution de mission, mais toujours là pour l'historique — amendes à leur
// attribuer, statistiques de ce qu'ils ont roulé, solde de caisse à régulariser.
// Les listes de choix les gardent, après l'équipe en place, marqués « (ancien) ».
export function equipeEtAnciens<T extends { name: string | null; active?: boolean | null }>(rows: T[] | null | undefined): T[] {
  const list = rows || []
  return [
    ...list.filter(r => r.active !== false),
    ...list.filter(r => r.active === false).map(r => ({ ...r, name: `${r.name || ''} (ancien)` })),
  ]
}
