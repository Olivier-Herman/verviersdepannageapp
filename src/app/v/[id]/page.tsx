// /v/{helpdesk_ticket_id} — ANCIENNE fiche parc par ticket Odoo (Verviers-QR).
// Les étiquettes imprimées avant la bascule portent encore cette adresse : on
// retrouve la fiche VD Soft liée au ticket et on renvoie vers la fiche QR
// actuelle. Plus aucune lecture d'état Odoo (Olivier 09/09/2026).
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export default async function LegacyVehiclePage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(`/v/${params.id}`)}`)
  const ticketId = Number(params.id)
  const sb = createAdminClient()
  const { data } = Number.isFinite(ticketId)
    ? await sb.from('incoming_missions').select('id').eq('odoo_helpdesk_id', ticketId).eq('dossier_leg', false).order('received_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null }
  if (data?.id) redirect(`/qr/mission/${data.id}`)
  return (
    <main className="min-h-screen flex items-center justify-center p-6 text-center">
      <div className="max-w-sm space-y-3">
        <p className="text-2xl">🏷️</p>
        <p className="text-ink font-semibold">Ancienne étiquette</p>
        <p className="text-ink-secondary text-sm">Aucune fiche VD Soft n’est reliée au ticket Odoo n° {params.id}. Cherche la plaque dans la recherche, puis réimprime l’étiquette depuis la fiche.</p>
        <a href="/recherche" className="inline-block px-4 py-2 rounded-xl bg-brand text-white text-sm font-semibold">Ouvrir la recherche</a>
      </div>
    </main>
  )
}
