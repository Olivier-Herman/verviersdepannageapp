import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
/** Fourrière : admin/superadmin ou module fourriere — même règle que la Sortie AVP. */
export async function fourriereUser(): Promise<{ id: string; name: string; role: string } | null> {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return null
  const roles: string[] = [u.role, ...(u.roles || [])].filter(Boolean)
  const ok = roles.some(r => ['admin', 'superadmin'].includes(r)) || (u.modules || []).includes('fourriere')
  return ok ? { id: u.id, name: u.name || '', role: u.role || '' } : null
}
