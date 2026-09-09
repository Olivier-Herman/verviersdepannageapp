// Libellés français des statuts de fiche pour l'affichage (recherche,
// missions terminées…). Un statut brut « to_invoice » à l'écran n'aide
// personne (Olivier 09/09/2026).
export const STATUS_FR: Record<string, string> = {
  new: 'En commande', dispatching: 'En attente', assigned: 'Assignée', accepted: 'Acceptée',
  in_progress: 'En cours', delivering: 'En livraison', parked: 'Au parc', to_invoice: 'À facturer',
  completed: 'Terminée', invoiced: 'Facturée', cancelled: 'Annulée', ignored: 'Ignorée',
  parse_error: 'Erreur de lecture', gardiennage: 'Gardiennage', no_charge: 'Sans frais', unlocated: 'Non localisée',
}
export const statusFr = (s?: string | null) => (s ? STATUS_FR[s] || s : '')
