// Fiche faite hors ligne (Olivier 12/11/2026, après la panne Orange du 11/11).
// Le téléphone garde la fiche et l'envoie au retour du réseau avec :
//   offlineId        identifiant unique donné par le téléphone (jamais deux fiches pour lui)
//   offlineCreatedAt moment où le chauffeur l'a enregistrée
export function readOffline(body: any): { id: string; createdAt: string | null } | null {
  const id = typeof body?.offlineId === 'string' ? body.offlineId.trim().slice(0, 80) : ''
  if (!id) return null
  const raw = typeof body?.offlineCreatedAt === 'string' ? body.offlineCreatedAt : ''
  const t = raw ? Date.parse(raw) : NaN
  return { id, createdAt: Number.isFinite(t) ? new Date(t).toISOString() : null }
}
