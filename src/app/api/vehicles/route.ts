import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { createAdminClient } from '@/lib/supabase'

// GET /api/vehicles?type=brands
// GET /api/vehicles?type=models&brandId=1
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const type = req.nextUrl.searchParams.get('type')
  const brandId = req.nextUrl.searchParams.get('brandId')
  const supabase = createAdminClient()

  if (type === 'brands') {
    const { data } = await supabase
      .from('vehicle_brands')
      .select('id, name, country')
      .eq('active', true)
      .order('name')
    return NextResponse.json(data || [])
  }

  if (type === 'models' && brandId) {
    const { data } = await supabase
      .from('vehicle_models')
      .select('id, name, category')
      .eq('brand_id', parseInt(brandId))
      .eq('active', true)
      .order('name')
    return NextResponse.json(data || [])
  }

  return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })
}
