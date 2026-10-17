'use client'

// Olivier 17/10/2026 : l'Administration prend le menu commun de l'app (AppShell) — plus d'ancien menu à part.
import AppShell from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'

export default function AdminLayoutClient({
  children,
  userName,
  userRole,
  userEmail,
  userId,
  userModules = [],
}: {
  children:     React.ReactNode
  userName:     string
  userRole:     string
  userEmail?:   string
  userId?:      string
  userModules?: string[]
}) {
  return (
    <AppShell title="Administration" userName={userName} userRole={userRole} userEmail={userEmail} userId={userId} userModules={userModules}>
      {/* AdminNav + contenu — chaque client gère son propre padding.
          AmbientBackground variant=light pose un fond discret sur toute la zone admin. */}
      <div className="min-w-0 overflow-x-hidden lg:px-8 lg:py-6">
        <AmbientBackground variant="light">
          {children}
        </AmbientBackground>
      </div>
    </AppShell>
  )
}
