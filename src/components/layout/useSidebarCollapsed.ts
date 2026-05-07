'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'sidebar-collapsed'
const BREAKPOINT_PX = 1280

/**
 * Sidebar collapsed state with breakpoint awareness.
 *
 * - Width > 1280px : persist via localStorage, default open.
 * - Width ≤ 1280px : force collapsed at mount, manual toggle = temporary
 *   override (NOT persisted), revert on resize back above 1280px.
 * - Resize listener debounced 150ms.
 *
 * SSR safe : returns `[false, noop, false]` until client hydration finishes.
 */
export function useSidebarCollapsed(): [boolean, () => void, boolean] {
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Distinguish forced-narrow state from explicit user toggle.
  // When user manually toggles on a narrow screen, we stop syncing with
  // localStorage until the screen widens again.
  const userOverrideRef = useRef(false)

  const readDesired = (): boolean => {
    if (window.innerWidth <= BREAKPOINT_PX) return true
    return localStorage.getItem(STORAGE_KEY) === 'true'
  }

  useEffect(() => {
    setCollapsed(readDesired())
    setMounted(true)

    let timer: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        // Resize re-establishes the canonical state and clears any override.
        userOverrideRef.current = false
        setCollapsed(readDesired())
      }, 150)
    }

    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (timer) clearTimeout(timer)
    }
  }, [])

  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      const isWide = window.innerWidth > BREAKPOINT_PX
      if (isWide) {
        localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false')
      } else {
        userOverrideRef.current = true
      }
      return next
    })
  }, [])

  return [collapsed, toggle, mounted]
}
