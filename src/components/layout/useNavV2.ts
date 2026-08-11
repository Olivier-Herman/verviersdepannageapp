'use client'

// Lecture côté client du flag `nav_menu_v2` (menu navigable à 2 niveaux).
//
// Le flag vit dans la table feature_flags (serveur only). Il est résolu côté
// serveur pour le rôle du user et renvoyé par /api/nav-badges — la route que
// l'AppShell appelle déjà au montage de chaque page (zéro requête en plus).
//
// L'AppShell fait ce fetch : ce hook ne fait QUE mémoriser la dernière valeur
// connue dans localStorage et la réappliquer AVANT le premier paint (useLayoutEffect),
// pour éviter un flash « menu plat → menu navigable » à chaque navigation.
// L'état initial reste `false` pour ne pas casser l'hydratation (le HTML rendu
// côté serveur ne connaît pas le localStorage).

import { useEffect, useLayoutEffect, useState } from 'react'

const STORAGE_KEY = 'vd_nav_v2'

// useLayoutEffect n'existe pas au rendu serveur → fallback silencieux.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * @param fetched valeur renvoyée par l'API (undefined tant que le fetch n'a pas répondu)
 */
export function useNavV2(fetched: boolean | undefined): boolean {
  const [enabled, setEnabled] = useState(false)

  // 1) Valeur en cache, appliquée avant le paint qui suit l'hydratation.
  useIsoLayoutEffect(() => {
    try { if (window.localStorage.getItem(STORAGE_KEY) === '1') setEnabled(true) } catch {}
  }, [])

  // 2) Valeur faisant autorité (API) — recale l'affichage et le cache.
  useEffect(() => {
    if (fetched === undefined) return
    setEnabled(fetched)
    try { window.localStorage.setItem(STORAGE_KEY, fetched ? '1' : '0') } catch {}
  }, [fetched])

  return enabled
}
