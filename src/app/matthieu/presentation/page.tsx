import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import { canUseMatthieu } from '@/lib/mecano/access'
import AppShell from '@/components/layout/AppShell'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const FEATURES = [
  ['💬', 'Demande-lui n\'importe quoi', 'Panne, voyant allumé, démarrage impossible… Il connaît chaque modèle et te répond direct, comme Matthieu au téléphone.'],
  ['📄', 'Il te montre la fiche', 'Besoin d\'un schéma d\'ouverture ou des points d\'ancrage ? Il sort la bonne fiche — pas 40 pages, juste ce qui te concerne.'],
  ['📷', 'Un doute sur le modèle ?', 'Envoie une photo (compartiment moteur, tableau de bord, plaque) : il l\'analyse et identifie le véhicule.'],
  ['🔧', 'Dépannage ET remorquage', 'De la panne sur place au véhicule délicat à atteler (4×4, électrique, boîte auto bloquée) — il couvre les deux.'],
]
const STEPS = [
  'Ouvre ta fiche d\'intervention (ta mission en cours).',
  'Appuie sur la tuile 🔧 La tête à Matthieu.',
  'Pose ta question, ou tape un raccourci (« Comment l\'ouvrir ? », « Points d\'ancrage »).',
  'Pas sûr du modèle ? Appuie sur 📷 et envoie une photo.',
  'S\'il te sort une fiche, appuie sur la carte 📄 pour voir le schéma.',
]

export default async function MatthieuPresentationPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const sb = createAdminClient()
  const uid = (session.user as any).id
  const { data: user } = uid
    ? await sb.from('users').select('id, role, name').eq('id', uid).single()
    : await sb.from('users').select('id, role, name').ilike('email', session.user!.email!).single()
  if (!canUseMatthieu(user?.role, user?.id)) redirect('/login')
  const modules = (session.user as any).modules ?? []

  return (
    <AppShell title="La tête à Matthieu" userRole={user?.role || ''} userName={user?.name || ''} userModules={modules}>
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="text-center">
          <div className="w-[92px] h-[92px] mx-auto rounded-[27px] flex items-center justify-center text-[44px]"
            style={{ background: 'linear-gradient(150deg,#8b83ff,#4b40e0)', boxShadow: '0 20px 46px -12px rgba(124,116,255,.55)' }}>🔧</div>
          <span className="inline-block mt-4 text-[11px] font-extrabold tracking-widest uppercase px-3 py-1 rounded-full text-amber-600 dark:text-amber-400 bg-amber-500/12 border border-amber-500/30">✦ Nouveau dans VD Soft</span>
          <h1 className="text-ink text-3xl sm:text-4xl font-black leading-none mt-3 tracking-tight">La tête à Matthieu</h1>
          <p className="text-ink-secondary text-sm sm:text-base mt-3 max-w-lg mx-auto">Le mécano que tout le monde appelle sur le terrain — désormais dans ta poche, <b className="text-ink">24/7</b>, sur chaque intervention.</p>
        </div>

        {/* Features */}
        <div className="grid sm:grid-cols-2 gap-3 mt-8">
          {FEATURES.map(([ic, t, d]) => (
            <div key={t} className="bg-surface border rounded-2xl p-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/12 flex items-center justify-center text-xl mb-2">{ic}</div>
              <h3 className="text-ink font-bold text-sm">{t}</h3>
              <p className="text-ink-secondary text-xs mt-1 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>

        {/* How to */}
        <div className="bg-surface border rounded-2xl p-5 mt-6">
          <h2 className="text-ink font-extrabold text-base mb-3">👉 Comment y accéder</h2>
          <ol className="space-y-2.5">
            {STEPS.map((s, i) => (
              <li key={i} className="flex gap-3 items-start">
                <span className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-extrabold text-white" style={{ background: 'linear-gradient(135deg,#7c74ff,#4b40e0)' }}>{i + 1}</span>
                <span className="text-ink text-sm leading-snug">{s}</span>
              </li>
            ))}
          </ol>
        </div>

        <Link href="/matthieu" className="block text-center mt-6 py-3.5 rounded-2xl text-white font-extrabold"
          style={{ background: 'linear-gradient(135deg,#7c74ff,#e23b2e)', boxShadow: '0 16px 32px -12px rgba(226,59,46,.5)' }}>
          Essayer maintenant (choisis un véhicule) →
        </Link>
        <p className="text-ink-muted text-xs text-center mt-3">Ou retrouve-le directement sur ta fiche d'intervention.</p>
      </div>
    </AppShell>
  )
}
