// Référence courte d'une erreur affichée au chauffeur (Olivier 26/10/2026) : lue au téléphone et retrouvée dans
// /admin/logs par le début de l'identifiant.
export const refErreur = (id: string | null | undefined) => id ? `VDS-${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}` : ''
