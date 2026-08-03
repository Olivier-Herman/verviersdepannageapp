'use client'
// src/app/verifier-code/VerifyCodeClient.tsx
//
// Écran « Te souviens-tu de ton code ? » — landing de la notif pin_recall_check.
// L'utilisateur tape son code pour confirmer qu'il s'en souvient, ou choisit de
// redéfinir un nouveau code s'il l'a oublié.

import { useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { KeyRound, Check, X, ShieldCheck } from 'lucide-react'

export default function VerifyCodeClient({
  userName, userRole, userModules, hasPin,
}: { userName: string; userRole: string; userModules: string[]; hasPin: boolean }) {
  const [pin, setPin]         = useState('')
  const [busy, setBusy]       = useState(false)
  const [state, setState]     = useState<'idle' | 'ok' | 'ko'>('idle')

  const verify = async () => {
    if (pin.length !== 4) return
    setBusy(true); setState('idle')
    try {
      const r = await fetch('/api/profil/verify-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const j = await r.json()
      setState(j.ok ? 'ok' : 'ko')
      if (!j.ok) setPin('')
    } catch { setState('ko'); setPin('') } finally { setBusy(false) }
  }

  return (
    <AppShell title="Mon code" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="bg-surface border rounded-3xl p-6 text-center">

          {/* Crest */}
          <div className="w-[74px] h-[74px] mx-auto rounded-[22px] bg-gradient-to-br from-brand to-brand-hover flex items-center justify-center shadow-lg shadow-brand/25 relative">
            <KeyRound size={34} className="text-white" />
          </div>

          {!hasPin ? (
            <>
              <h1 className="text-xl font-extrabold text-ink mt-4 mb-1.5">Tu n'as pas encore de code</h1>
              <p className="text-ink-secondary text-sm mb-5">Crée ton code personnel à 4 chiffres pour valider tes encaissements.</p>
              <a href="/definir-code" className="block w-full py-3.5 rounded-2xl bg-brand text-white font-bold">Créer mon code →</a>
            </>
          ) : state === 'ok' ? (
            <>
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center mt-4"><Check size={30} /></div>
              <h1 className="text-xl font-extrabold text-ink mt-3 mb-1.5">Parfait, tu t'en souviens 👍</h1>
              <p className="text-ink-secondary text-sm">Ton code est le bon. Rien d'autre à faire.</p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-extrabold text-ink mt-4 mb-1.5">Tu te souviens de ton code ?</h1>
              <p className="text-ink-secondary text-sm mb-1">Tu ne l'as sûrement pas utilisé depuis longtemps. Tape-le pour confirmer.</p>
              <p className="text-ink-muted text-xs mb-5 inline-flex items-center gap-1"><ShieldCheck size={13} /> Personne d'autre ne le connaît.</p>

              {/* Dots */}
              <div className="flex justify-center gap-3.5 mb-4">
                {[0, 1, 2, 3].map(i => (
                  <span key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${i < pin.length ? 'bg-brand border-brand shadow-[0_0_0_4px] shadow-brand/20' : 'border-default'}`} />
                ))}
              </div>

              <input
                type="password" inputMode="numeric" pattern="\d*" maxLength={4} autoFocus
                value={pin}
                onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setState('idle') }}
                placeholder="••••"
                className="w-full bg-surface-hover border border-strong focus:border-brand rounded-2xl px-4 py-3.5 text-ink text-2xl font-bold text-center tracking-[0.6em] outline-none"
                disabled={busy}
              />

              {state === 'ko' && (
                <p className="text-red-500 text-sm mt-3 inline-flex items-center gap-1"><X size={15} /> Ce n'est pas ton code. Réessaie, ou redéfinis-en un.</p>
              )}

              <button onClick={verify} disabled={busy || pin.length !== 4}
                className="block w-full mt-5 py-3.5 rounded-2xl bg-brand text-white font-bold disabled:opacity-40">
                {busy ? '⏳…' : 'Oui, je m\'en souviens'}
              </button>
              <a href="/definir-code" className="block w-full mt-2.5 py-3 text-ink-secondary text-sm font-medium">
                Je l'ai oublié → définir un nouveau code
              </a>
            </>
          )}
        </div>
      </div>
    </AppShell>
  )
}
