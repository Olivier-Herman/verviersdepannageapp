// src/app/api/vehicles/route.ts
// Proxy vers Odoo FSM pour les marques et modèles de véhicules.
// Avant : on lisait dans la table Supabase vehicle_brands/vehicle_models, ce qui créait
// des doublons côté Odoo quand findOrCreateFsmVehicle créait des modèles non présents là-bas.
// Maintenant : source de vérité unique = Odoo (fleet.vehicle.model.brand + fleet.vehicle.model).

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { rpcFsm } from '@/lib/odoo-fsm'

// Cache en mémoire par instance Vercel — les marques/modèles bougent rarement.
const CACHE_TTL_MS = 30 * 60 * 1000  // 30 minutes
type CacheEntry<T> = { data: T; expiresAt: number }

let brandsCache: CacheEntry<Array<{ id: number; name: string }>> | null = null
const modelsByBrand = new Map<number, CacheEntry<Array<{ id: number; name: string }>>>()

// GET /api/vehicles?type=brands
// GET /api/vehicles?type=models&brandId=1
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const type         = req.nextUrl.searchParams.get('type')
  const brandIdParam = req.nextUrl.searchParams.get('brandId')

  if (type === 'brands') {
    const now = Date.now()
    if (!brandsCache || now > brandsCache.expiresAt) {
      try {
        const data = await rpcFsm<Array<{ id: number; name: string }>>(
          'fleet.vehicle.model.brand',
          'search_read',
          [[]],
          { fields: ['id', 'name'], order: 'name asc', limit: 5000 }
        )
        brandsCache = { data, expiresAt: now + CACHE_TTL_MS }
      } catch (e: any) {
        console.error('[vehicles] Erreur fetch brands depuis Odoo:', e.message)
        // Si Odoo down et pas de cache, on retourne vide plutôt que 500
        return NextResponse.json(brandsCache?.data || [])
      }
    }
    return NextResponse.json(brandsCache.data)
  }

  if (type === 'models' && brandIdParam) {
    const brandId = parseInt(brandIdParam, 10)
    if (Number.isNaN(brandId)) {
      return NextResponse.json({ error: 'brandId invalide' }, { status: 400 })
    }

    const now = Date.now()
    const cached = modelsByBrand.get(brandId)
    if (!cached || now > cached.expiresAt) {
      try {
        const data = await rpcFsm<Array<{ id: number; name: string }>>(
          'fleet.vehicle.model',
          'search_read',
          [[['brand_id', '=', brandId]]],
          { fields: ['id', 'name'], order: 'name asc', limit: 5000 }
        )
        modelsByBrand.set(brandId, { data, expiresAt: now + CACHE_TTL_MS })
      } catch (e: any) {
        console.error(`[vehicles] Erreur fetch models brandId=${brandId} depuis Odoo:`, e.message)
        return NextResponse.json(cached?.data || [])
      }
    }
    return NextResponse.json(modelsByBrand.get(brandId)!.data)
  }

  return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })
}
