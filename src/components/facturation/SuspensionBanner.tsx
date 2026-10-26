// src/components/facturation/SuspensionBanner.tsx — « Facturation automatique suspendue », pour Olivier seul
// (« Le bandeau, juste pour moi », 26/10/2026) : rendu côté serveur, rien n'est envoyé aux autres comptes.
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { etatFacturationAuto, peutBasculer } from '@/lib/facturation/suspension'

export default async function SuspensionBanner() {
  const session = await getServerSession(authOptions)
  if (!(await peutBasculer((session?.user as any)?.id))) return null
  const e = await etatFacturationAuto(createAdminClient())
  if (e.enMarche) return null
  const quand = e.depuis ? new Date(e.depuis).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
  return (
    <div className="mx-4 lg:mx-6 mt-4 rounded-2xl border-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-900">
      <p className="font-bold">⏸️ Facturation automatique suspendue{quand ? ` depuis le ${quand}` : ''}{e.motif ? ` — ${e.motif}` : ''}</p>
      <Link href="/admin/facturation-auto" className="inline-flex min-h-[44px] items-center font-semibold underline">Relancer depuis Facturation automatique</Link>
    </div>
  )
}
