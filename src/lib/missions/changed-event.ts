// Événement navigateur « la fiche X a changé » (Olivier 08/09/2026, audit
// dispatch B8) : la fiche embarquée dans une ligne dépliée ou un dossier fait
// router.refresh(), ce qui ne rafraîchit pas l'état chargé par fetch de la
// ligne. Tout composant qui affiche une fiche par fetch écoute cet événement.
export const MISSION_CHANGED_EVENT = 'vd:mission-changed'

export function notifyMissionChanged(missionId: string) {
  if (typeof window === 'undefined') return
  try { window.dispatchEvent(new CustomEvent(MISSION_CHANGED_EVENT, { detail: { missionId } })) } catch {}
}

export function onMissionChanged(handler: (missionId: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const fn = (e: Event) => handler(String((e as CustomEvent).detail?.missionId || ''))
  window.addEventListener(MISSION_CHANGED_EVENT, fn)
  return () => window.removeEventListener(MISSION_CHANGED_EVENT, fn)
}
