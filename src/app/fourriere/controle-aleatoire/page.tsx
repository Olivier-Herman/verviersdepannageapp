// src/app/fourriere/controle-aleatoire/page.tsx — liste des contrôles aléatoires du parc (Olivier 17/11/2026) :
// mardi et jeudi 10 h–15 h, samedi 10 h–11 h, 15 véhicules ; les véhicules pas trouvés restent à rechercher.
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import AppShell             from '@/components/layout/AppShell'

export const dynamic = 'force-dynamic'
const fr = (iso?: string | null) => iso ? new Date(iso).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const ETAT: Record<string, string> = { prevu: 'prévu', demande: 'à faire', en_cours: 'en cours', termine: 'terminé' }

export default async function ControlesAleatoiresPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/controle-aleatoire')
  const a = sessionAccess(session, { roles: ['admin', 'superadmin', 'dispatcher'], modules: ['fourriere'] })
  if (!a.ok) redirect('/dashboard?error=fourriere_required')
  const u = session.user as any
  const sb = createAdminClient()
  const { data: cs } = await sb.from('parc_controles_aleatoires').select('*').order('jour', { ascending: false }).limit(30)
  const ids = (cs || []).map((c: any) => c.id)
  const { data: its } = ids.length ? await sb.from('parc_aleatoire_items').select('controle_id, resultat, resolu_at').in('controle_id', ids) : { data: [] as any[] }
  const stats = (id: string) => { const l = (its || []).filter((i: any) => i.controle_id === id); return { n: l.length, ok: l.filter((i: any) => i.resultat === 'present' || i.resultat === 'autre_zone').length, abs: l.filter((i: any) => i.resultat === 'absent').length, ouverts: l.filter((i: any) => i.resultat === 'absent' && !i.resolu_at).length } }
  return (
    <AppShell title="Contrôle aléatoire du parc" userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userId={u.id} userModules={u.modules || []}>
      <div className="p-4 max-w-3xl mx-auto space-y-3">
        <p className="text-sm text-ink-secondary">Mardi et jeudi entre 10 h et 15 h, samedi entre 10 h et 11 h : 15 véhicules tirés au sort à scanner. Les véhicules pas trouvés restent ici jusqu’à ce qu’on sache ce qui s’est passé.</p>
        {!(cs || []).length && <p className="rounded-xl border p-4 text-ink-secondary">Aucun contrôle pour l’instant. Le premier sera proposé mardi, jeudi ou samedi.</p>}
        {(cs || []).map((c: any) => { const s = stats(c.id); return (
          <a key={c.id} href={`/fourriere/controle-aleatoire/${c.id}`} className={`block rounded-xl border p-4 bg-surface ${s.ouverts ? 'border-red-300' : ''}`}>
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-bold text-ink">{fr(c.prevu_at)}</span>
              <span className="text-sm text-ink-secondary">{ETAT[c.status] || c.status}{c.started_by_name ? ` · ${c.started_by_name}` : ''}</span>
            </div>
            {s.n > 0 && <p className="text-sm text-ink-secondary">{s.ok} présent(s) · {s.abs} pas trouvé(s){s.ouverts ? <b className="text-red-700"> · {s.ouverts} à rechercher</b> : ''}</p>}
          </a>) })}
      </div>
    </AppShell>
  )
}
