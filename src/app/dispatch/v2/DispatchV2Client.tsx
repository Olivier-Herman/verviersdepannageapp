'use client'
// Nouveau Dispatch « tour de contrôle » — préversion dispatch_v2 (Olivier seul).
// Maquette : https://claude.ai/artifact/TASSRqcM1hGBU74DuTfjmt
// Plan : https://claude.ai/artifact/9M8jDp6cwHGDN6hB4CfD9b
// Étape 0 (socle) : écran vide, bascule et secours. Le contenu arrive à l'étape 1.

import AppShell from '@/components/layout/AppShell'

interface Props { userName: string; userEmail?: string; userId?: string; userRole: string; userModules: string[] }

export default function DispatchV2Client({ userName, userEmail, userId, userRole, userModules }: Props) {
  return (
    <AppShell title="Dispatch" userName={userName} userEmail={userEmail} userId={userId} userRole={userRole} userModules={userModules}>
      <div className="p-4 lg:p-8">
        <div className="rounded-2xl border bg-surface p-6 max-w-2xl">
          <p className="text-lg font-bold text-ink">Nouveau Dispatch · en construction</p>
          <p className="mt-2 text-ink-muted">
            Visible par vous seul. Trois appuis rapides sur le titre « Dispatch » ramènent l'ancien affichage, et inversement.
          </p>
          <p className="mt-2 text-ink-muted">En secours : l'adresse /dispatch?ancien=1 ouvre toujours l'ancien affichage.</p>
        </div>
      </div>
    </AppShell>
  )
}
