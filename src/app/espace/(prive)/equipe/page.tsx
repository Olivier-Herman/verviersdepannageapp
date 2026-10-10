'use client'
import { useCallback, useEffect, useState } from 'react'
import { useEspace } from '../EspaceShell'

interface Membre { id: string; nom: string; email: string; societe: string; peutInviter: boolean; actif: boolean; derniereConnexion: string | null; creeLe: string }

export default function Equipe() {
  const { compte, societes } = useEspace()
  const gestionnaire = compte.role === 'gestionnaire'
  const [membres, setMembres] = useState<Membre[] | null>(null)
  const [ajout, setAjout] = useState(false)
  const [confirme, setConfirme] = useState<Membre | null>(null)
  const charger = useCallback(async () => {
    const r = await fetch('/api/espace/equipe', { cache: 'no-store' })
    if (r.status === 401) { location.href = '/espace/connexion'; return }
    setMembres((await r.json()).membres || [])
  }, [])
  useEffect(() => { charger() }, [charger])

  const patch = async (id: string, body: any) => {
    await fetch('/api/espace/equipe', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
    charger()
  }

  if (!compte.peutInviter) return <div className="mx-auto max-w-3xl px-4 pt-10 text-slate-600">Cette page est réservée aux personnes qui gèrent les accès.</div>

  return (
    <div className="mx-auto max-w-4xl px-4 pt-8">
      <div className="esp-rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Mon équipe</h1>
          <p className="mt-1 max-w-xl text-slate-600">Donnez un accès à vos collaborateurs. Chacun commande pour sa société et ne voit que ses propres demandes.</p>
        </div>
        <button onClick={() => setAjout(true)} className="esp-btn esp-btn-red">+ Ajouter un collaborateur</button>
      </div>

      <div className="mt-6 space-y-3">
        {membres === null && [0, 1].map(i => <div key={i} className="esp-card esp-shimmer h-20" />)}
        {membres?.length === 0 && (
          <div className="esp-card esp-rise p-8 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-rose-50 text-3xl">👥</div>
            <h3 className="font-display mt-4 text-lg font-extrabold">Pas encore de collaborateur</h3>
            <p className="mt-1 text-sm text-slate-500">Ajoutez la première personne : elle reçoit un mail avec son accès.</p>
          </div>
        )}
        {membres?.map((m, k) => (
          <div key={m.id} className={`esp-card esp-rise flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${m.actif ? '' : 'opacity-60'}`} style={{ animationDelay: `${k * 50}ms` }}>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-slate-800 to-slate-600 font-bold text-white">{m.nom.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-slate-900">{m.nom} {!m.actif && <span className="ml-1 rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-600">accès coupé</span>}</div>
              <div className="truncate text-sm text-slate-500">{m.email} · {m.societe}</div>
              <div className="text-xs text-slate-400">{m.derniereConnexion ? `Dernière connexion le ${new Date(m.derniereConnexion).toLocaleDateString('fr-BE')}` : 'Pas encore connecté'}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {gestionnaire && m.actif && (
                <button onClick={() => patch(m.id, { peutInviter: !m.peutInviter })} className={`min-h-[44px] rounded-xl border px-3 text-sm font-semibold ${m.peutInviter ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-[#e5ddd4] bg-white text-slate-600'}`}>
                  {m.peutInviter ? '✓ Peut ajouter des collègues' : 'Ne peut pas ajouter de collègues'}
                </button>
              )}
              {m.actif
                ? <button onClick={() => setConfirme(m)} className="min-h-[44px] rounded-xl px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50">Couper l’accès</button>
                : <button onClick={() => patch(m.id, { actif: true })} className="min-h-[44px] rounded-xl px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">Rétablir</button>}
            </div>
          </div>
        ))}
      </div>

      {ajout && <Ajout societes={societes} gestionnaire={gestionnaire} onClose={() => setAjout(false)} onDone={() => { setAjout(false); charger() }} />}
      {confirme && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="esp-card esp-pop w-full max-w-sm p-6">
            <h2 className="font-display text-lg font-extrabold">Couper l’accès de {confirme.nom} ?</h2>
            <p className="mt-2 text-sm text-slate-600">Cette personne est déconnectée tout de suite. Ses demandes passées restent dans l’historique.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={() => setConfirme(null)} className="esp-btn esp-btn-ghost">Annuler</button>
              <button onClick={async () => { await patch(confirme.id, { actif: false }); setConfirme(null) }} className="esp-btn esp-btn-red">Couper</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Ajout({ societes, gestionnaire, onClose, onDone }: { societes: { id: string; nom: string; couleur: string | null }[]; gestionnaire: boolean; onClose: () => void; onDone: () => void }) {
  const [nom, setNom] = useState(''), [email, setEmail] = useState(''), [societeId, setSocieteId] = useState(societes.length === 1 ? societes[0].id : '')
  const [peutInviter, setPeutInviter] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [ok, setOk] = useState<null | boolean>(null)
  const go = async () => {
    setErr('')
    if (!nom.trim() || !email.trim() || !societeId) return setErr('Nom, adresse mail et société sont obligatoires.')
    setBusy(true)
    const r = await fetch('/api/espace/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nom, email, societeId, peutInviter }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) return setErr(j.error || 'Erreur')
    setOk(j.invite !== false)
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="esp-card esp-pop w-full max-w-md p-6">
        <div className="flex items-start justify-between">
          <h2 className="font-display text-lg font-extrabold">Ajouter un collaborateur</h2>
          <button onClick={ok === null ? onClose : onDone} aria-label="Fermer" className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100">✕</button>
        </div>
        {ok !== null ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-slate-700">{ok ? `C’est fait : ${nom} a reçu un mail avec son accès.` : `L’accès est créé, mais le mail n’a pas pu partir. ${nom} peut se connecter avec son adresse sur la page de connexion.`}</p>
            <button onClick={onDone} className="esp-btn esp-btn-red w-full">Fermer</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <input className="esp-input" placeholder="Prénom et nom" value={nom} onChange={e => setNom(e.target.value)} />
            <input className="esp-input" type="email" placeholder="Adresse mail" value={email} onChange={e => setEmail(e.target.value)} />
            {societes.length > 1 && (
              <div className="grid grid-cols-2 gap-2">
                {societes.map(s => <button key={s.id} type="button" onClick={() => setSocieteId(s.id)} className={`min-h-[48px] rounded-xl border-2 text-sm font-bold ${societeId === s.id ? 'border-rose-600 bg-rose-50/60' : 'border-[#ece6df]'}`}>{s.nom}</button>)}
              </div>
            )}
            {gestionnaire && (
              <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-[#ece6df] px-3 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={peutInviter} onChange={e => setPeutInviter(e.target.checked)} className="h-5 w-5 accent-rose-600" />
                Peut ajouter d’autres collaborateurs de sa société
              </label>
            )}
            {err && <p className="text-sm font-semibold text-rose-700">{err}</p>}
            <button onClick={go} disabled={busy} className="esp-btn esp-btn-red w-full disabled:opacity-60">{busy ? 'Création…' : 'Créer l’accès et envoyer l’invitation'}</button>
          </div>
        )}
      </div>
    </div>
  )
}
