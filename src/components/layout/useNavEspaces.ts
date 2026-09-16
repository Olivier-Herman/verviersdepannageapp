'use client'

// Lecture côté client du flag `nav_espaces` (menu « Espaces », pilotes Olivier +
// Jona — 16/09/2026). Même patron que useNavV2 : valeur mémorisée dans
// localStorage et réappliquée avant le premier paint, puis recalée par l'API.

import { useEffect, useLayoutEffect, useState } from 'react'

const STORAGE_KEY = 'vd_nav_espaces'
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function useNavEspaces(fetched: boolean | undefined): boolean {
  const [enabled, setEnabled] = useState(false)
  useIsoLayoutEffect(() => {
    try { if (window.localStorage.getItem(STORAGE_KEY) === '1') setEnabled(true) } catch {}
  }, [])
  useEffect(() => {
    if (fetched === undefined) return
    setEnabled(fetched)
    try { window.localStorage.setItem(STORAGE_KEY, fetched ? '1' : '0') } catch {}
  }, [fetched])
  return enabled
}
