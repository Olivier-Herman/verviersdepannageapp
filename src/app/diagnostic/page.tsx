// /diagnostic — diagnostic OBD hors intervention (Olivier 05/11/2026, maquette validée) : le lecteur s'utilise seul,
// une fiche de diagnostic identifiée par le VIN. Préversion : drapeau obd_diagnostic (Mobi, Olivier, Franck).
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { isPreviewOn } from '@/lib/feature-flags'
import AppShell from '@/components/layout/AppShell'
import DiagnosticPanel from '@/components/obd/DiagnosticPanel'
import { T } from '@/lib/i18n/T'

export const dynamic = 'force-dynamic'

export default async function DiagnosticPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  if (!(await isPreviewOn('obd_diagnostic', u.role, u.id))) redirect('/dashboard')
  return (
    <AppShell title="Diagnostic" userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={u.role} userModules={u.modules || []}>
      <div className="max-w-md mx-auto p-3 pb-56 space-y-3">
        <h1 className="text-lg font-bold text-ink">🔧 <T k="obd.titre" /></h1>
        <DiagnosticPanel />
      </div>
    </AppShell>
  )
}
