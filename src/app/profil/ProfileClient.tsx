'use client'

import { useState, useEffect, useRef } from 'react'
import { signOut }   from 'next-auth/react'
import AppShell      from '@/components/layout/AppShell'

// ── Types documents ────────────────────────────────────────
const DOC_TYPES = [
  { value: 'id_card',         label: "Carte d'identité",   icon: '🪪' },
  { value: 'driving_license', label: 'Permis de conduire', icon: '🚗' },
  { value: 'driver_card',     label: 'Carte chauffeur',    icon: '💳' },
  { value: 'medical',         label: 'Sélection médicale', icon: '🏥' },
]

interface DriverDocument {
  id:         string
  doc_type:   string
  expires_at: string
  file_url:   string
  notes?:     string
  updated_at: string
}

function daysUntilExpiry(expiresAt: string): number {
  const exp = new Date(expiresAt); const now = new Date()
  exp.setHours(0,0,0,0); now.setHours(0,0,0,0)
  return Math.ceil((exp.getTime() - now.getTime()) / 86400000)
}

function expiryStatus(days: number) {
  if (days < 0)    return { color: 'text-red-500',    bg: 'bg-red-500/10 border-red-500/30',       label: 'Expiré'   }
  if (days <= 30)  return { color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30',       label: '< 1 mois' }
  if (days <= 90)  return { color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30', label: '< 3 mois' }
  if (days <= 180) return { color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30', label: '< 6 mois' }
  return              { color: 'text-green-400',   bg: 'bg-green-500/10 border-green-500/30',   label: 'Valide'   }
}

export default function ProfileClient({ user }: { user: any }) {
  const userRole = user?.role ?? 'driver'
  const userName = user?.name ?? ''

  // ── PIN ──────────────────────────────────────────────────
  const [pin1,       setPin1]       = useState('')
  const [pin2,       setPin2]       = useState('')
  const [pinLoading, setPinLoading] = useState(false)
  const [pinSuccess, setPinSuccess] = useState('')
  const [pinError,   setPinError]   = useState('')
  const hasPin = !!user?.verify_pin_hash

  // ── Push ─────────────────────────────────────────────────
  const [pushSupported,  setPushSupported]  = useState(false)
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushLoading,    setPushLoading]    = useState(false)
  const [pushStatus,     setPushStatus]     = useState('')

  // ── Documents ────────────────────────────────────────────
  const [documents,   setDocuments]   = useState<DriverDocument[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [editDoc,     setEditDoc]     = useState<string | null>(null)
  const [viewDoc,     setViewDoc]     = useState<DriverDocument | null>(null)
  const [uploading,   setUploading]   = useState(false)
  const [docError,    setDocError]    = useState<string | null>(null)
  const [docSuccess,  setDocSuccess]  = useState<string | null>(null)
  const [formExpiry,  setFormExpiry]  = useState('')
  const [formNotes,   setFormNotes]   = useState('')
  const [formFile,    setFormFile]    = useState<File | null>(null)
  const [formPreview, setFormPreview] = useState<string | null>(null)
  const fileRef   = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  // ── Init push ────────────────────────────────────────────
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    setPushSupported(true)
    navigator.serviceWorker.getRegistrations().then(regs => {
      const reg = regs.find((r: any) => r.active?.scriptURL?.includes('sw-custom'))
      if (!reg) return Promise.resolve(null)
      return (reg as ServiceWorkerRegistration).pushManager.getSubscription()
    }).then(sub => {
      setPushSubscribed(!!sub)
    }).catch(() => {
      fetch('/api/push').then(r => r.json()).then(d => setPushSubscribed(d.subscribed ?? false))
    })
  }, [])

  // ── Init documents ───────────────────────────────────────
  const loadDocuments = () => {
    setDocsLoading(true)
    fetch('/api/documents')
      .then(r => r.json())
      .then(data => { setDocuments(data || []); setDocsLoading(false) })
  }
  useEffect(() => { loadDocuments() }, [])

  const getDoc = (type: string) => documents.find(d => d.doc_type === type)

  const openEdit = (type: string) => {
    const existing = getDoc(type)
    setFormExpiry(existing?.expires_at?.split('T')[0] ?? '')
    setFormNotes(existing?.notes ?? '')
    setFormFile(null); setFormPreview(null); setDocError(null)
    setEditDoc(type)
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFormFile(file)
    setFormPreview(URL.createObjectURL(file))
  }

  const uploadFile = async (file: File, docType: string): Promise<string> => {
    const jpegBase64 = await new Promise<string>((resolve, reject) => {
      const img = new window.Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
        canvas.getContext('2d')!.drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/jpeg', 0.88).split(',')[1])
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        const reader = new FileReader()
        reader.onload  = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      }
      img.src = url
    })
    const res  = await fetch(`/api/documents/upload?docType=${docType}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: jpegBase64, mimeType: 'image/jpeg', filename: 'doc.jpg' }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Upload échoué')
    return data.url
  }

  // Normalise n'importe quel format de date vers YYYY-MM-DD
  const normalizeDate = (raw: string): string => {
    if (!raw) return ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
    try {
      const d = new Date(raw)
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${y}-${m}-${day}`
      }
    } catch {}
    return raw
  }

  const handleSave = async () => {
    if (!editDoc)    return
    if (!formExpiry) { setDocError("Veuillez saisir la date d'expiration"); return }
    if (!formFile && !getDoc(editDoc)?.file_url) { setDocError('Veuillez fournir une photo du document'); return }
    setUploading(true); setDocError(null)
    try {
      let fileUrl = getDoc(editDoc)?.file_url ?? ''
      if (formFile) fileUrl = await uploadFile(formFile, editDoc)
      const res = await fetch('/api/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType: editDoc, expiresAt: normalizeDate(formExpiry), fileUrl, notes: formNotes || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDocSuccess('Document enregistré ✅')
      setEditDoc(null); setFormFile(null); setFormPreview(null); setFormExpiry(''); setFormNotes('')
      loadDocuments()
      setTimeout(() => setDocSuccess(null), 3000)
    } catch (err: unknown) {
      setDocError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setUploading(false)
    }
  }

  // ── Push helpers ─────────────────────────────────────────
  const getSWReg = async (): Promise<ServiceWorkerRegistration> => {
    const regs = await navigator.serviceWorker.getRegistrations()
    let reg = regs.find((r: any) => r.active?.scriptURL?.includes('sw-custom')) as ServiceWorkerRegistration | undefined
    if (!reg) {
      reg = await navigator.serviceWorker.register('/sw-custom.js', { scope: '/' })
      await new Promise<void>((resolve, reject) => {
        if (reg!.active) { resolve(); return }
        const sw = reg!.installing || reg!.waiting
        if (sw) {
          sw.addEventListener('statechange', (e: any) => {
            if (e.target.state === 'activated') resolve()
            if (e.target.state === 'redundant')  reject(new Error('SW redundant'))
          })
        }
        setTimeout(() => reject(new Error('SW activation timeout')), 10000)
      })
    }
    return reg!
  }

  const handlePushToggle = async () => {
    setPushLoading(true); setPushStatus('')
    try {
      if (pushSubscribed) {
        const regs = await navigator.serviceWorker.getRegistrations()
        const reg  = regs.find((r: any) => r.active?.scriptURL?.includes('sw-custom')) as ServiceWorkerRegistration | undefined
        if (reg) {
          const sub = await reg.pushManager.getSubscription()
          if (sub) {
            await sub.unsubscribe()
            await fetch('/api/push', {
              method: 'DELETE', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint: sub.endpoint }),
            })
          }
        }
        setPushSubscribed(false); setPushStatus('Notifications désactivées')
      } else {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') { setPushStatus('Permission refusée — activez les notifications dans les réglages'); return }
        setPushStatus('Connexion au service worker…')
        const reg = await getSWReg()
        setPushStatus('Abonnement push en cours…')
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        const padding  = '='.repeat((4 - vapidKey.length % 4) % 4)
        const rawKey   = Uint8Array.from(atob((vapidKey + padding).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: rawKey })
        setPushStatus('Enregistrement…')
        const toBase64 = (buf: ArrayBuffer) => {
          const bytes = new Uint8Array(buf); let str = ''
          bytes.forEach(b => { str += String.fromCharCode(b) })
          return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        }
        const res = await fetch('/api/push', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: toBase64(sub.getKey('p256dh')!), auth: toBase64(sub.getKey('auth')!) }, userAgent: navigator.userAgent }),
        })
        if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? 'Erreur serveur') }
        setPushSubscribed(true); setPushStatus('Notifications activées ✅')
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
      const res  = await fetch('/api/admin/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin1 }),
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

        {/* Infos */}
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

        {/* PIN */}
        {user?.can_verify && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
            <h2 className="text-white font-bold mb-1">PIN de validation caisse</h2>
            <p className="text-zinc-500 text-xs mb-4">
              {hasPin ? 'Ton PIN est défini. Tu peux le modifier ci-dessous.'
                      : "Aucun PIN défini. Crée-en un pour valider les remises d'espèces."}
            </p>
            {pinSuccess && <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3 mb-4">{pinSuccess}</div>}
            {pinError   && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">{pinError}</div>}
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-zinc-400 text-xs mb-1.5 block">{hasPin ? 'Nouveau PIN' : 'PIN (4 chiffres)'}</label>
                <input type="password" inputMode="numeric" maxLength={4} value={pin1}
                  onChange={e => { setPin1(e.target.value.replace(/[^0-9]/g, '')); setPinError('') }}
                  placeholder="••••"
                  className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-2xl font-bold text-center outline-none tracking-widest" />
              </div>
              <div>
                <label className="text-zinc-400 text-xs mb-1.5 block">Confirmer le PIN</label>
                <input type="password" inputMode="numeric" maxLength={4} value={pin2}
                  onChange={e => { setPin2(e.target.value.replace(/[^0-9]/g, '')); setPinError('') }}
                  placeholder="••••"
                  className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-2xl font-bold text-center outline-none tracking-widest" />
              </div>
              <button onClick={handleSetPin} disabled={pinLoading || pin1.length !== 4 || pin2.length !== 4}
                className="w-full bg-brand text-white font-bold rounded-xl py-3 disabled:opacity-40 transition-all">
                {pinLoading ? '…' : hasPin ? 'Modifier le PIN' : 'Définir le PIN'}
              </button>
            </div>
          </div>
        )}

        {/* Push */}
        {pushSupported && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
            <h2 className="text-white font-bold mb-1">Notifications push</h2>
            <p className="text-zinc-500 text-xs mb-4">
              Recevez des alertes pour les documents expirants et les checks véhicules.
            </p>
            {pushStatus && <p className="text-zinc-400 text-xs mb-3">{pushStatus}</p>}
            <button onClick={handlePushToggle} disabled={pushLoading}
              className={`w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 ${
                pushSubscribed ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600' : 'bg-brand text-white hover:bg-brand/90'
              }`}>
              {pushLoading ? '⏳ En cours…' : pushSubscribed ? '🔕 Désactiver les notifications' : '🔔 Activer les notifications'}
            </button>
          </div>
        )}

        {/* Documents */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
          <h2 className="text-white font-bold mb-1">Mes Documents</h2>
          <p className="text-zinc-500 text-xs mb-4">Carte d'identité, permis, carte chauffeur, sélection médicale.</p>

          {docSuccess && (
            <div className="bg-green-500/10 border border-green-500/30 text-green-400 rounded-xl px-4 py-3 mb-4 text-sm">
              {docSuccess}
            </div>
          )}

          {docsLoading ? (
            <p className="text-zinc-500 text-sm text-center py-4">Chargement…</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {DOC_TYPES.map(dt => {
                const doc  = getDoc(dt.value)
                const days = doc ? daysUntilExpiry(doc.expires_at) : null
                const cfg  = days !== null ? expiryStatus(days) : null

                return (
                  <div key={dt.value}
                    className={`rounded-xl border p-3 flex flex-col gap-2 ${
                      cfg ? cfg.bg : 'bg-[#0F0F0F] border-[#2a2a2a]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{dt.icon}</span>
                      <p className="text-white text-xs font-semibold leading-tight">{dt.label}</p>
                    </div>

                    {doc ? (
                      <>
                        <p className={`text-xs font-medium ${cfg?.color}`}>
                          {cfg?.label} · {new Date(doc.expires_at).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </p>
                        <div className="flex gap-1.5 mt-auto">
                          <button onClick={() => setViewDoc(doc)}
                            className="flex-1 py-1.5 bg-[#2a2a2a] text-zinc-300 rounded-lg text-xs font-medium hover:bg-[#333] transition-colors">
                            👁 Voir
                          </button>
                          <button onClick={() => openEdit(dt.value)}
                            className="flex-1 py-1.5 bg-brand/20 text-brand rounded-lg text-xs font-medium hover:bg-brand/30 transition-colors">
                            ✏️ Modifier
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-zinc-600 text-xs">Non enregistré</p>
                        <button onClick={() => openEdit(dt.value)}
                          className="w-full py-1.5 bg-brand text-white rounded-lg text-xs font-semibold hover:bg-brand/90 transition-colors mt-auto">
                          + Ajouter
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Déconnexion */}
        <button onClick={() => signOut({ callbackUrl: '/login' })}
          className="w-full bg-[#1A1A1A] border border-[#333] text-red-400 font-medium rounded-2xl py-4 transition-all">
          Se déconnecter
        </button>

      </div>

      {/* Modal voir document */}
      {viewDoc && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setViewDoc(null)}>
          <div className="bg-[#1A1A1A] rounded-2xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-bold">{DOC_TYPES.find(d => d.value === viewDoc.doc_type)?.label}</h2>
              <button onClick={() => setViewDoc(null)} className="text-zinc-500 text-2xl">×</button>
            </div>
            <img src={viewDoc.file_url} alt="Document" className="w-full rounded-xl border border-[#2a2a2a] mb-4 object-contain max-h-96 bg-[#0F0F0F]" />
            <div className="space-y-2">
              <div className="flex justify-between py-2 border-b border-[#2a2a2a]">
                <span className="text-zinc-500 text-sm">Expiration</span>
                <span className="text-white text-sm">{new Date(viewDoc.expires_at).toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
              </div>
              {viewDoc.notes && (
                <div className="flex justify-between py-2 border-b border-[#2a2a2a]">
                  <span className="text-zinc-500 text-sm">Notes</span>
                  <span className="text-white text-sm text-right max-w-[60%]">{viewDoc.notes}</span>
                </div>
              )}
              <div className="flex justify-between py-2">
                <span className="text-zinc-500 text-sm">Mis à jour</span>
                <span className="text-zinc-400 text-sm">{new Date(viewDoc.updated_at).toLocaleDateString('fr-BE')}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal éditer document */}
      {editDoc && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end lg:items-center lg:justify-center" onClick={() => setEditDoc(null)}>
          <div className="bg-[#1A1A1A] w-full lg:max-w-lg rounded-t-3xl lg:rounded-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-bold text-lg">
                {getDoc(editDoc) ? 'Modifier' : 'Ajouter'} — {DOC_TYPES.find(d => d.value === editDoc)?.label}
              </h2>
              <button onClick={() => setEditDoc(null)} className="text-zinc-500 text-2xl">×</button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-400 mb-2">Photo du document {!getDoc(editDoc) && '*'}</label>
              {formPreview ? (
                <div className="rounded-xl overflow-hidden border border-[#2a2a2a] mb-2">
                  <img src={formPreview} alt="Aperçu" className="w-full max-h-48 object-contain bg-[#0F0F0F]" />
                </div>
              ) : getDoc(editDoc)?.file_url ? (
                <div className="rounded-xl overflow-hidden border border-[#2a2a2a] mb-2">
                  <img src={getDoc(editDoc)!.file_url} alt="Document actuel" className="w-full max-h-48 object-contain bg-[#0F0F0F]" />
                  <p className="text-zinc-600 text-xs text-center py-1">Document actuel</p>
                </div>
              ) : null}
              <div className="flex gap-2">
                <button onClick={() => cameraRef.current?.click()} className="flex-1 py-3 bg-[#2a2a2a] text-zinc-300 rounded-xl text-sm font-medium hover:bg-[#333] transition-colors">📷 Photo</button>
                <button onClick={() => fileRef.current?.click()}   className="flex-1 py-3 bg-[#2a2a2a] text-zinc-300 rounded-xl text-sm font-medium hover:bg-[#333] transition-colors">🗂️ Galerie</button>
              </div>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
              <input ref={fileRef}   type="file" accept="image/*,application/pdf"       className="hidden" onChange={handleFile} />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">Date d'expiration *</label>
              <input type="date" value={formExpiry} onChange={e => setFormExpiry(normalizeDate(e.target.value))}
                className="w-full bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand" />
            </div>

            <div className="mb-5">
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">Notes <span className="text-zinc-600">(optionnel)</span></label>
              <input type="text" placeholder="Numéro de document, remarques…" value={formNotes} onChange={e => setFormNotes(e.target.value)}
                className="w-full bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-brand" />
            </div>

            {docError && <div className="bg-red-950/50 border border-red-900 text-red-300 rounded-xl p-3 text-sm mb-4">{docError}</div>}

            <div className="flex gap-2">
              <button onClick={() => setEditDoc(null)} className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-xl font-medium">Annuler</button>
              <button onClick={handleSave} disabled={uploading} className="flex-1 py-3 bg-brand text-white rounded-xl font-bold disabled:opacity-50">
                {uploading ? '⏳ Enregistrement…' : '✅ Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
