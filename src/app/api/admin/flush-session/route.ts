// src/app/api/admin/flush-session/route.ts
// Force l'expiration du JWT en signant un nouveau token
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }         from 'next-auth'
import { authOptions }              from '@/lib/auth'
import { createAdminClient }        from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // Recharger les données fraîches depuis la DB pour l'utilisateur actuel
  const supabase = createAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('id, role, roles, active')
    .eq('email', session.user.email!)
    .single()

  if (!user) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  // On retourne les données fraîches — le client devra se déconnecter/reconnecter
  // car NextAuth ne permet pas de forcer un refresh JWT côté serveur sans re-login
  return NextResponse.json({
    success: true,
    message: 'Pour appliquer les changements, déconnectez-vous et reconnectez-vous.',
    freshData: { role: user.role, roles: user.roles }
  })
}
