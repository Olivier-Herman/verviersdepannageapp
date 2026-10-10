'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useContext, useState } from 'react'

export interface CompteEspace { id: string; nom: string; email: string; role: 'societe' | 'gestionnaire' | 'collaborateur'; peutInviter: boolean; aMotDePasse: boolean }
export interface SocieteEspace { id: string; nom: string; couleur: string | null }
const Ctx = createContext<{ compte: CompteEspace; societes: SocieteEspace[] } | null>(null)
export const useEspace = () => useContext(Ctx)!

export default function EspaceShell({ compte, societes, children }: { compte: CompteEspace; societes: SocieteEspace[]; children: React.ReactNode }) {
  const path = usePathname()
  const [menu, setMenu] = useState(false)
  const [mdp, setMdp] = useState(false)
  const onglets = [
    { href: '/espace', label: 'Mes interventions', actif: path === '/espace' },
    { href: '/espace/nouvelle', label: 'Nouvelle demande', actif: path === '/espace/nouvelle' },
    ...(compte.peutInviter ? [{ href: '/espace/equipe', label: 'Mon équipe', actif: path === '/espace/equipe' }] : []),
  ]
  const initiales = compte.nom.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase()
  return (
    <Ctx.Provider value={{ compte, societes }}>
      <header className="sticky top-0 z-30 border-b border-[#ece6df] bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link href="/espace" className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-[#e02626] to-[#7f1d1d] text-white shadow-lg shadow-rose-900/20">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17h2m12 0h4v-4l-3-4h-5v8M3 17V7h10v10" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></svg>
            </span>
            <span className="leading-tight">
              <span className="font-display block text-[15px] font-extrabold tracking-tight text-slate-900">Verviers Dépannage</span>
              <span className="block text-[11px] font-semibold uppercase tracking-[.18em] text-rose-700">Espace client</span>
            </span>
          </Link>
          <nav className="ml-6 hidden gap-1 md:flex">
            {onglets.map(o => (
              <Link key={o.href} href={o.href} className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition ${o.actif ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>{o.label}</Link>
            ))}
          </nav>
          <div className="relative ml-auto">
            <button onClick={() => setMenu(v => !v)} className="flex min-h-[44px] items-center gap-2 rounded-2xl px-2 py-1 hover:bg-slate-100">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{initiales}</span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-bold text-slate-900">{compte.nom}</span>
                <span className="block text-xs text-slate-500">{societes.map(s => s.nom).join(' · ')}</span>
              </span>
            </button>
            {menu && (
              <div className="esp-pop absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-[#ece6df] bg-white shadow-2xl">
                <div className="border-b border-[#f3eee8] px-4 py-3 text-xs text-slate-500">Connecté avec <b className="text-slate-800">{compte.email}</b></div>
                <button onClick={() => { setMenu(false); setMdp(true) }} className="block w-full px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50">{compte.aMotDePasse ? 'Changer mon mot de passe' : 'Choisir un mot de passe'}</button>
                <button onClick={async () => { await fetch('/api/espace/connexion', { method: 'DELETE' }); location.href = '/espace/connexion' }} className="block w-full px-4 py-3 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50">Se déconnecter</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="pb-28 md:pb-12">{children}</main>

      {/* Barre d'onglets sur téléphone */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#ece6df] bg-white/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around">
          {onglets.map(o => (
            <Link key={o.href} href={o.href} className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${o.actif ? 'text-rose-700' : 'text-slate-500'}`}>
              <IconeOnglet href={o.href} actif={o.actif} />
              {o.label.replace('Mes interventions', 'Suivi').replace('Nouvelle demande', 'Commander').replace('Mon équipe', 'Équipe')}
            </Link>
          ))}
        </div>
      </nav>

      {mdp && <MotDePasse onClose={() => setMdp(false)} />}
    </Ctx.Provider>
  )
}

function IconeOnglet({ href, actif }: { href: string; actif: boolean }) {
  const c = `h-6 w-6 ${actif ? 'text-rose-600' : 'text-slate-400'}`
  if (href === '/espace/nouvelle') return <span className={`grid h-9 w-9 -mt-5 place-items-center rounded-2xl bg-gradient-to-br from-[#e02626] to-[#b51d1d] text-white shadow-lg shadow-rose-900/30`}><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></span>
  if (href === '/espace/equipe') return <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6M16 11.5a2.8 2.8 0 1 0-1-5.4M17.5 14.6c1.6.5 2.6 1.9 3 4.4" /></svg>
  return <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16M4 12h10M4 19h7" /><circle cx="18" cy="16" r="3" /></svg>
}

function MotDePasse({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState(''), [v2, setV2] = useState(''), [err, setErr] = useState(''), [ok, setOk] = useState(false), [busy, setBusy] = useState(false)
  const router = useRouter()
  const go = async () => {
    setErr('')
    if (v.length < 8) return setErr('Au moins 8 caractères.')
    if (v !== v2) return setErr('Les deux mots de passe ne sont pas identiques.')
    setBusy(true)
    const r = await fetch('/api/espace/moi', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motDePasse: v }) })
    setBusy(false)
    if (!r.ok) return setErr((await r.json().catch(() => ({}))).error || 'Erreur')
    setOk(true); router.refresh()
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="esp-pop esp-card w-full max-w-sm p-6">
        <div className="flex items-start justify-between">
          <h2 className="font-display text-lg font-extrabold">Mot de passe</h2>
          <button onClick={onClose} aria-label="Fermer" className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100">✕</button>
        </div>
        {ok ? (
          <div className="mt-4 space-y-4"><p className="text-sm text-slate-700">C’est enregistré. Vous pourrez vous connecter avec ce mot de passe ou recevoir un code par mail.</p><button onClick={onClose} className="esp-btn esp-btn-red w-full">Fermer</button></div>
        ) : (
          <div className="mt-4 space-y-3">
            <input type="password" className="esp-input" placeholder="Nouveau mot de passe" value={v} onChange={e => setV(e.target.value)} autoComplete="new-password" />
            <input type="password" className="esp-input" placeholder="Confirmer" value={v2} onChange={e => setV2(e.target.value)} autoComplete="new-password" />
            {err && <p className="text-sm font-semibold text-rose-700">{err}</p>}
            <button onClick={go} disabled={busy} className="esp-btn esp-btn-red w-full disabled:opacity-60">{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        )}
      </div>
    </div>
  )
}
