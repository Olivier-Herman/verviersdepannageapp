'use client'
// src/app/definir-code/DefineCodeClient.tsx
//
// Écran dédié « Crée ton code » — landing de la notif pin_setup_reminder.
// Saisie en 2 temps (choisir → confirmer), style maquette. Ne passe plus par
// le profil. Olivier 2026-08-03.

import { useState, useEffect } from 'react'
import AppShell from '@/components/layout/AppShell'
import { KeyRound, Check, ShieldCheck } from 'lucide-react'

export default function DefineCodeClient({
  userName, userRole, userModules, hasPin,
}: { userName: string; userRole: string; userModules: string[]; hasPin: boolean }) {
  const [step, setStep]   = useState<'choose' | 'confirm' | 'done'>('choose')
  const [pin, setPin]     = useState('')
  const [first, setFirst] = useState('')
  const [err, setErr]     = useState('')
  const [busy, setBusy]   = useState(false)

  const submit = async (code: string) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/admin/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: code }),
      })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || 'Erreur'); setStep('choose'); setFirst(''); setPin(''); return }
      setStep('done')
    } catch { setErr('Erreur réseau'); setStep('choose'); setFirst(''); setPin('') }
    finally { setBusy(false) }
  }

  // Avance automatiquement dès que 4 chiffres sont saisis.
  useEffect(() => {
    if (pin.length !== 4 || busy) return
    if (step === 'choose') { setFirst(pin); setStep('confirm'); setPin(''); setErr('') }
    else if (step === 'confirm') {
      if (pin === first) submit(pin)
      else { setErr('Les deux codes ne correspondent pas. Recommence.'); setStep('choose'); setFirst(''); setPin('') }
    }
  }, [pin]) // eslint-disable-line react-hooks/exhaustive-deps

  const title = step === 'confirm' ? 'Confirme ton code' : (hasPin ? 'Change ton code' : 'Crée ton code')

  return (
    <AppShell title="Mon code" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="bg-surface border rounded-3xl p-6 text-center">

          <div className="w-[74px] h-[74px] mx-auto rounded-[22px] bg-gradient-to-br from-brand to-brand-hover flex items-center justify-center shadow-lg shadow-brand/25">
            {step === 'done' ? <Check size={34} className="text-white" /> : <KeyRound size={34} className="text-white" />}
          </div>

          {step === 'done' ? (
            <>
              <h1 className="text-xl font-extrabold text-ink mt-4 mb-1.5">Ton code est prêt 👍</h1>
              <p className="text-ink-secondary text-sm">C'est enregistré. Tu pourras l'utiliser pour confirmer un encaissement.</p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-extrabold text-ink mt-4 mb-1">{title}</h1>
              <p className="text-ink-secondary text-sm mb-1">4 chiffres, connus de toi seul.</p>
              <p className="text-ink-muted text-xs mb-5 inline-flex items-center gap-1"><ShieldCheck size={13} /> Ne le partage jamais.</p>

              <div className="flex justify-center gap-3.5 mb-4">
                {[0, 1, 2, 3].map(i => (
                  <span key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${i < pin.length ? 'bg-brand border-brand shadow-[0_0_0_4px] shadow-brand/20' : 'border-default'}`} />
                ))}
              </div>

              <input
                type="password" inputMode="numeric" pattern="\d*" maxLength={4} autoFocus
                value={pin}
                onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr('') }}
                placeholder="••••"
                className="w-full bg-surface-hover border border-strong focus:border-brand rounded-2xl px-4 py-3.5 text-ink text-2xl font-bold text-center tracking-[0.6em] outline-none"
                disabled={busy}
              />
              {busy && <p className="text-ink-muted text-xs mt-3">⏳ Enregistrement…</p>}
              {err && <p className="text-red-500 text-sm mt-3">⚠️ {err}</p>}

              {/* À quoi sert ce code */}
              <div className="mt-6 text-left rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-3">
                <p className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-sm font-semibold mb-2">💡 À quoi me sert ce code ?</p>
                <p className="text-ink-secondary text-xs leading-relaxed">
                  Il te sert à <strong className="text-ink">confirmer un encaissement dont le montant est inférieur au montant de la mission</strong> (par ex. un arrangement sur place avec le client), ainsi qu'à valider une <strong className="text-ink">remise d'espèces</strong>. C'est ta signature personnelle.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  )
}
