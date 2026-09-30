// Niveaux d'une anomalie de check camion (Olivier 30/09/2026). Aucun ne bloque le camion.
export const CHECK_LEVELS = [
  { level: 1, key: 'remark',  emoji: '🔵', color: 'info' },     // Remarque — non bloquant (propreté, rangement)
  { level: 2, key: 'watch',   emoji: '🟢', color: 'success' },  // À surveiller
  { level: 3, key: 'repair',  emoji: '🟡', color: 'warning' },  // À réparer
  { level: 4, key: 'urgent',  emoji: '🟠', color: 'orange' },   // Urgent — rouler avec prudence
  { level: 5, key: 'danger',  emoji: '🔴', color: 'critical' }, // Dangereux — ne pas rouler
] as const
export const LEVEL_LABEL_FR: Record<number, string> = { 1: 'Remarque', 2: 'À surveiller', 3: 'À réparer', 4: 'Urgent', 5: 'Dangereux' }
export const levelEmoji = (l: number) => CHECK_LEVELS.find(x => x.level === l)?.emoji || '⚪'
