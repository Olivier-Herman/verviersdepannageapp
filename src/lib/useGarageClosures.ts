'use client'
// src/lib/useGarageClosures.ts
// Hook client : charge (une fois, en cache) les règles de fermeture garage ACTIVES
// AUJOURD'HUI et fournit un helper de match. Olivier 2026-07-15.

import { useEffect, useState } from 'react'
import { matchGarageClosure, type GarageClosureRule } from '@/lib/garage-closures'

let cache: GarageClosureRule[] | null = null
let inflight: Promise<GarageClosureRule[]> | null = null

async function fetchRules(): Promise<GarageClosureRule[]> {
  if (cache) return cache
  if (!inflight) {
    inflight = fetch('/api/garage-closures')
      .then(r => r.json())
      .then(j => { cache = (j.rules || []) as GarageClosureRule[]; return cache })
      .catch(() => { return [] as GarageClosureRule[] })
  }
  return inflight
}

/** Retourne un matcher : (address) => message | null, alimenté par la base. */
export function useGarageClosure(): (address: string | null | undefined) => string | null {
  const [rules, setRules] = useState<GarageClosureRule[]>(cache || [])
  useEffect(() => { if (!cache) fetchRules().then(setRules) }, [])
  return (address: string | null | undefined) => matchGarageClosure(address, rules)
}
