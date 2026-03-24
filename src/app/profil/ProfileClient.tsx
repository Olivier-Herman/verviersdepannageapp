'use client'

import { useState, useEffect } from 'react'
import { signOut } from 'next-auth/react'
import AppShell from '@/components/layout/AppShell'

export default function ProfileClient({ user }: { user: any }) {
  const userRole = user?.role ?? 'driver'
  const userName = user?.name ?? ''
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [pinLoading, setPinLoading] = useState(false)
  const [pinSuccess, setPinSuccess] = useState('')
  const [pinError, setPinError] = useState('')

  const hasPin = !!user?.verify_pin_hash

  // Push notifications
  const [pushSupported,   setPushSupported]   = useState(false)
  const [pushSubscribed,  setPushSubscribed]  = useState(false)
  const [pushLoading,     setPushLoading]     = useState(false)
  const [pushStatus,      setPushStatus]      = useState('')

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setPushSupported(true)
      // Vérifier si déjà abonné via l'endpoint actif du navigateur
      navigator.serviceWorker.getRegistrations().then(regs => {
        const reg = regs.find((r: any) => r.active?.scriptURL?.includes('sw-custom'))
        if (!reg) return
        return (reg as ServiceWorkerRegistration).pushManager.getSubscription()
      }).then(sub => {
        if (sub) {
          setPushSubscribed(true)
        } else {
          // Vérifier côté serveur aussi
          fetch('/api/push').then(r => r.json()).then(data => {
            setPushSubscribed(data.subscribed ?? false)
          })
        }
      }).catch(() => {
        fetch('/api/push').then(r => r.json()).then(data => {
          setPushSubscribed(data.subscribed ?? false)
        })
      })
    }
  }, [])

  const handlePushToggle = async () => {
    setPushLoading(true); setPushStatus('')
    try {
      if (pushSubscribed) {
        // Désabonner
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await sub.unsubscribe()
          await fetch('/api/push', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          })
        }
        setPushSubscribed(false)
        setPushStatus('Notifications désactivées')
      } else {
        // Demander la permission
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          setPushStatus('Permission refusée — activez les notifications dans les réglages')
          return
        }
        // S'abonner
        // Convertir la clé publique VAPID en Uint8Array
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        const padding   = '='.repeat((4 - vapidKey.length % 4) % 4)
        const base64    = (vapidKey + padding).replace(/-/g, '+').replace(/_/g, '/')
        const rawKey    = Uint8Array.from(atob(base64), c => c.charCodeAt(0))

        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: rawKey,
        })

        // Convertir les clés ArrayBuffer en base64 url-safe
        const toBase64 = (buf: ArrayBuffer) => {
          const bytes = new Uint8Array(buf)
          let str = ''
          bytes.forEach(b => { str += String.fromCharCode(b) })
          return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        }

        await fetch('/api/push', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint:  sub.endpoint,
            keys: {
              p256dh: toBase64(sub.getKey('p256dh')!),
              auth:   toBase64(sub.getKey('auth')!),
            },
            userAgent: navigator.userAgent,
          }),
        })
        setPushSubscribed(true)
        setPushStatus('Notifications activées ✅')
      }
    } catch (err: unknown) {
      setPushStatus(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setPushLoading(false)
    }
  }

  const handleSetPin = async () => {
    if (!pin1 || !/^\d{4}$/.test(pin1)) { setPinError('Le PIN doit être 4 chiffres'); return }
    if (pin1 !== pin2) { setPinError('Les deux PIN ne correspondent pas'); return }
    setPinLoading(true); setPinError(''); setPinSuccess('')
    try {
      const res = await fetch('/api/admin/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin1 })
      })
      const data = await res.json()
      if (!res.ok) { setPinError(data.error); return }
      setPinSuccess('✅ PIN défini avec succès !')
      setPin1(''); setPin2('')
    } finally {
      setPinLoading(false)
    }
  }

  return (
    <AppShell title="Mon Profil" userRole={userRole} userName={userName}>
      <div className="px-4 lg:px-8 py-6 max-w-lg mx-auto lg:mx-0 flex flex-col gap-4">

        {/* Infos utilisateur */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
          <div className="w-16 h-16 rounded-full bg-brand flex items-center justify-center text-white text-2xl font-bold mb-4 mx-auto lg:mx-0">
            {user?.name?.[0]?.toUpperCase() || '?'}
          </div>
          <p className="text-white font-bold text-lg text-center lg:text-left">{user?.name}</p>
          <p className="text-zinc-500 text-sm text-center lg:text-left">{user?.email}</p>
          <div className="flex justify-center lg:justify-start mt-2">
            <span className="text-xs bg-brand/20 text-brand px-3 py-1 rounded-full font-medium capitalize">
              {user?.role}
            </span>
          </div>
        </div>

        {/* PIN de validation — visible seulement si can_verify */}
        {user?.can_verify && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
            <h2 className="text-white font-bold mb-1">PIN de validation caisse</h2>
            <p className="text-zinc-500 text-xs mb-4">
              {hasPin
                ? 'Ton PIN est défini. Tu peux le modifier ci-dessous.'
                : 'Aucun PIN défini. Crée-en un pour pouvoir valider les remises d\'espèces.'}
            </p>

            {pinSuccess && (
              <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3 mb-4">
                {pinSuccess}
              </div>
            )}
            {pinError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
                {pinError}
              </div>
            )}

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-zinc-400 text-xs mb-1.5 block">
                  {hasPin ? 'Nouveau PIN' : 'PIN (4 chiffres)'}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin1}
                  onChange={e => { setPin1(e.target.value.replace(/[^0-9]/g, '')); setPinError('') }}
                  placeholder="••••"
                  className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-2xl font-bold text-center outline-none tracking-widest"
                />
              </div>
              <div>
                <label className="text-zinc-400 text-xs mb-1.5 block">Confirmer le PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin2}
                  onChange={e => { setPin2(e.target.value.replace(/[^0-9]/g, '')); setPinError('') }}
                  placeholder="••••"
                  className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-2xl font-bold text-center outline-none tracking-widest"
                />
              </div>
              <button
                onClick={handleSetPin}
                disabled={pinLoading || pin1.length !== 4 || pin2.length !== 4}
                className="w-full bg-brand text-white font-bold rounded-xl py-3 disabled:opacity-40 active:scale-95 transition-all"
              >
                {pinLoading ? '…' : hasPin ? 'Modifier le PIN' : 'Définir le PIN'}
              </button>
            </div>
          </div>
        )}

        {/* Notifications push */}
        {pushSupported && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
            <h2 className="text-white font-bold mb-1">Notifications push</h2>
            <p className="text-zinc-500 text-xs mb-4">
              Recevez des alertes sur votre téléphone pour les documents expirants et les checks véhicules.
            </p>
            {pushStatus && (
              <p className="text-zinc-400 text-xs mb-3">{pushStatus}</p>
            )}
            <button onClick={handlePushToggle} disabled={pushLoading}
              className={`w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 ${
                pushSubscribed
                  ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                  : 'bg-brand text-white hover:bg-brand/90'
              }`}>
              {pushLoading
                ? '⏳ En cours…'
                : pushSubscribed
                  ? '🔕 Désactiver les notifications'
                  : '🔔 Activer les notifications'}
            </button>

          </div>
        )}

        {/* Déconnexion */}
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="w-full bg-[#1A1A1A] border border-[#333] text-red-400 font-medium rounded-2xl py-4 active:scale-95 transition-all"
        >
          Se déconnecter
        </button>

      </div>
    </AppShell>
  )
}
