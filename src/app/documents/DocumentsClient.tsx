// src/app/documents/DocumentsClient.tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import AppShell from '@/components/layout/AppShell'

// ── Config ─────────────────────────────────────────────────
export const DOC_TYPES = [
  { value: 'id_card',         label: "Carte d'identité",    icon: '🪪' },
  { value: 'driving_license', label: 'Permis de conduire',  icon: '🚗' },
  { value: 'driver_card',     label: 'Carte chauffeur',     icon: '💳' },
  { value: 'medical',         label: 'Sélection médicale',  icon: '🏥' },
]

interface DriverDocument {
  id:            string
  doc_type:      string
  expires_at:    string
  file_url:      string
  notes?:        string
  updated_at:    string
}

// ── Utilitaires expiration ─────────────────────────────────
function daysUntilExpiry(expiresAt: string): number {
  const exp  = new Date(expiresAt)
  const now  = new Date()
  exp.setHours(0, 0, 0, 0)
  now.setHours(0, 0, 0, 0)
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function expiryStatus(days: number): 'expired' | 'critical' | 'warning' | 'caution' | 'ok' {
  if (days < 0)   return 'expired'
  if (days <= 30) return 'critical'
  if (days <= 90) return 'warning'
  if (days <= 180) return 'caution'
  return 'ok'
}

const STATUS_CONFIG = {
  expired:  { color: 'text-red-500',    bg: 'bg-red-500/10 border-red-500/30',    label: 'Expiré' },
  critical: { color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30',    label: '< 1 mois' },
  warning:  { color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30', label: '< 3 mois' },
  caution:  { color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30', label: '< 6 mois' },
  ok:       { color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30',   label: 'Valide' },
}

// ── Composant principal ────────────────────────────────────
export default function DocumentsClient({ user }: { user: any }) {
  const userRole = user?.role ?? 'driver'
  const userName = user?.name ?? ''

  const [documents,  setDocuments]  = useState<DriverDocument[]>([])
  const [loading,    setLoading]    = useState(true)
  const [editDoc,    setEditDoc]    = useState<string | null>(null) // doc_type en cours d'édition
  const [viewDoc,    setViewDoc]    = useState<DriverDocument | null>(null)
  const [uploading,  setUploading]  = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [success,    setSuccess]    = useState<string | null>(null)

  // Form
  const [formExpiry, setFormExpiry] = useState('')
  const [formNotes,  setFormNotes]  = useState('')
  const [formFile,   setFormFile]   = useState<File | null>(null)
  const [formPreview,setFormPreview]= useState<string | null>(null)

  const fileRef   = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const loadDocuments = () => {
    setLoading(true)
    fetch('/api/documents')
      .then(r => r.json())
      .then(data => { setDocuments(data || []); setLoading(false) })
  }

  useEffect(() => { loadDocuments() }, [])

  const getDoc = (type: string) => documents.find(d => d.doc_type === type)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFormFile(file)
    setFormPreview(URL.createObjectURL(file))
  }

  const uploadFile = async (file: File, docType: string): Promise<string> => {
    // Tente la conversion canvas (HEIC→JPEG), fallback FileReader si canvas taint (documents officiels iOS)
    const jpegBase64 = await new Promise<string>((resolve, reject) => {
      const img = new window.Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        try {
          const canvas = document.createElement('canvas')
          canvas.width  = img.naturalWidth
          canvas.height = img.naturalHeight
          canvas.getContext('2d')!.drawImage(img, 0, 0)
          const b64 = canvas.toDataURL('image/jpeg', 0.88).split(',')[1]
          if (!b64 || b64.length < 100) throw new Error('canvas taint')
          resolve(b64)
        } catch {
          // Canvas taint (document officiel iOS) → FileReader brut
          const reader = new FileReader()
          reader.onload  = () => resolve((reader.result as string).split(',')[1])
          reader.onerror = reject
          reader.readAsDataURL(file)
        }
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        // Fichier non lisible comme image → FileReader brut
        const reader = new FileReader()
        reader.onload  = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      }
      img.src = url
    })

    const mimeType = file.type || 'image/jpeg'
    const res = await fetch(`/api/documents/upload?docType=${docType}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ base64: jpegBase64, mimeType: 'image/jpeg', filename: 'doc.jpg' }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Upload échoué')
    return data.url
  }

  const handleSave = async () => {
    if (!editDoc)      return
    if (!formExpiry)   { setError("Veuillez saisir la date d'expiration"); return }
    if (!formFile && !getDoc(editDoc)?.file_url) {
      setError('Veuillez fournir une photo du document'); return
    }

    setUploading(true); setError(null)
    try {
      let fileUrl = getDoc(editDoc)?.file_url ?? ''
      if (formFile) fileUrl = await uploadFile(formFile, editDoc)

      const res = await fetch('/api/documents', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType:   editDoc,
          expiresAt: formExpiry,
          fileUrl,
          notes:     formNotes || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setSuccess('Document enregistré ✅')
      setEditDoc(null); setFormFile(null); setFormPreview(null); setFormExpiry(''); setFormNotes('')
      loadDocuments()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setUploading(false)
    }
  }

  const openEdit = (type: string) => {
    const existing = getDoc(type)
    setFormExpiry(existing?.expires_at?.split('T')[0] ?? '')
    setFormNotes(existing?.notes ?? '')
    setFormFile(null)
    setFormPreview(null)
    setError(null)
    setEditDoc(type)
  }

  return (
    <AppShell title="Mes Documents" userRole={userRole} userName={userName}>
      <div className="px-4 lg:px-8 py-6 max-w-2xl">

        {success && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-400
                          rounded-xl px-4 py-3 mb-4 text-sm">
            {success}
          </div>
        )}

        {/* Grille des 4 documents */}
        {loading ? (
          <p className="text-zinc-500 text-sm text-center py-8">Chargement…</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {DOC_TYPES.map(dt => {
              const doc    = getDoc(dt.value)
              const days   = doc ? daysUntilExpiry(doc.expires_at) : null
              const status = days !== null ? expiryStatus(days) : null
              const cfg    = status ? STATUS_CONFIG[status] : null

              return (
                <div key={dt.value}
                  className={`bg-[#1A1A1A] border rounded-2xl p-4 ${
                    cfg ? cfg.bg : 'border-[#2a2a2a]'
                  }`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{dt.icon}</span>
                      <p className="text-white font-semibold text-sm">{dt.label}</p>
                    </div>
                    {cfg && (
                      <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                    )}
                  </div>

                  {doc ? (
                    <>
                      <div className="space-y-1 mb-3">
                        <p className="text-zinc-400 text-xs">
                          Expire le{' '}
                          <span className={`font-semibold ${cfg?.color ?? 'text-white'}`}>
                            {new Date(doc.expires_at).toLocaleDateString('fr-BE', {
                              day: '2-digit', month: 'long', year: 'numeric'
                            })}
                          </span>
                        </p>
                        {days !== null && days >= 0 && (
                          <p className="text-zinc-600 text-xs">
                            Dans {days} jour{days > 1 ? 's' : ''}
                          </p>
                        )}
                        {days !== null && days < 0 && (
                          <p className="text-red-400 text-xs font-semibold">
                            Expiré depuis {Math.abs(days)} jour{Math.abs(days) > 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setViewDoc(doc)}
                          className="flex-1 py-2 bg-[#2a2a2a] text-zinc-300 rounded-xl text-xs font-medium
                                     hover:bg-[#333] transition-colors">
                          👁 Voir
                        </button>
                        <button onClick={() => openEdit(dt.value)}
                          className="flex-1 py-2 bg-brand/20 text-brand rounded-xl text-xs font-medium
                                     hover:bg-brand/30 transition-colors">
                          ✏️ Modifier
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-zinc-600 text-xs mb-3">Aucun document enregistré</p>
                      <button onClick={() => openEdit(dt.value)}
                        className="w-full py-2 bg-brand text-white rounded-xl text-xs font-semibold
                                   hover:bg-brand/90 transition-colors">
                        + Ajouter
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Modal : voir document */}
        {viewDoc && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            onClick={() => setViewDoc(null)}>
            <div className="bg-[#1A1A1A] rounded-2xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-bold">
                  {DOC_TYPES.find(d => d.value === viewDoc.doc_type)?.label}
                </h2>
                <button onClick={() => setViewDoc(null)} className="text-zinc-500 text-2xl">×</button>
              </div>
              <img src={viewDoc.file_url} alt="Document"
                className="w-full rounded-xl border border-[#2a2a2a] mb-4 object-contain max-h-96 bg-[#0F0F0F]" />
              <div className="space-y-2">
                <div className="flex justify-between py-2 border-b border-[#2a2a2a]">
                  <span className="text-zinc-500 text-sm">Expiration</span>
                  <span className="text-white text-sm">
                    {new Date(viewDoc.expires_at).toLocaleDateString('fr-BE', {
                      day: '2-digit', month: 'long', year: 'numeric'
                    })}
                  </span>
                </div>
                {viewDoc.notes && (
                  <div className="flex justify-between py-2 border-b border-[#2a2a2a]">
                    <span className="text-zinc-500 text-sm">Notes</span>
                    <span className="text-white text-sm text-right max-w-[60%]">{viewDoc.notes}</span>
                  </div>
                )}
                <div className="flex justify-between py-2">
                  <span className="text-zinc-500 text-sm">Mis à jour</span>
                  <span className="text-zinc-400 text-sm">
                    {new Date(viewDoc.updated_at).toLocaleDateString('fr-BE')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal : éditer document */}
        {editDoc && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-end lg:items-center lg:justify-center"
            onClick={() => setEditDoc(null)}>
            <div className="bg-[#1A1A1A] w-full lg:max-w-lg rounded-t-3xl lg:rounded-2xl p-6
                            max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-white font-bold text-lg">
                  {getDoc(editDoc) ? 'Modifier' : 'Ajouter'} —{' '}
                  {DOC_TYPES.find(d => d.value === editDoc)?.label}
                </h2>
                <button onClick={() => setEditDoc(null)} className="text-zinc-500 text-2xl">×</button>
              </div>

              {/* Photo */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-zinc-400 mb-2">
                  Photo du document {!getDoc(editDoc) && '*'}
                </label>
                {formPreview ? (
                  <div className="rounded-xl overflow-hidden border border-[#2a2a2a] mb-2">
                    <img src={formPreview} alt="Aperçu" className="w-full max-h-48 object-contain bg-[#0F0F0F]" />
                  </div>
                ) : getDoc(editDoc)?.file_url ? (
                  <div className="rounded-xl overflow-hidden border border-[#2a2a2a] mb-2">
                    <img src={getDoc(editDoc)!.file_url} alt="Document actuel"
                      className="w-full max-h-48 object-contain bg-[#0F0F0F]" />
                    <p className="text-zinc-600 text-xs text-center py-1">Document actuel</p>
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <button onClick={() => cameraRef.current?.click()}
                    className="flex-1 py-3 bg-[#2a2a2a] text-zinc-300 rounded-xl text-sm font-medium
                               hover:bg-[#333] transition-colors">
                    📷 Photo
                  </button>
                  <button onClick={() => fileRef.current?.click()}
                    className="flex-1 py-3 bg-[#2a2a2a] text-zinc-300 rounded-xl text-sm font-medium
                               hover:bg-[#333] transition-colors">
                    🗂️ Galerie
                  </button>
                </div>
                <input ref={cameraRef} type="file" accept="image/*" capture="environment"
                  className="hidden" onChange={handleFile} />
                <input ref={fileRef} type="file" accept="image/*,application/pdf"
                  className="hidden" onChange={handleFile} />
              </div>

              {/* Date d'expiration */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                  Date d'expiration *
                </label>
                <input type="date" value={formExpiry}
                  onChange={e => setFormExpiry(e.target.value)}
                  className="w-full bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-4 py-3
                             text-white focus:outline-none focus:border-brand" />
              </div>

              {/* Notes */}
              <div className="mb-5">
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                  Notes <span className="text-zinc-600">(optionnel)</span>
                </label>
                <input type="text" placeholder="Numéro de document, remarques…"
                  value={formNotes} onChange={e => setFormNotes(e.target.value)}
                  className="w-full bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-4 py-3
                             text-white placeholder-zinc-600 focus:outline-none focus:border-brand" />
              </div>

              {error && (
                <div className="bg-red-950/50 border border-red-900 text-red-300 rounded-xl p-3 text-sm mb-4">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setEditDoc(null)}
                  className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-xl font-medium">
                  Annuler
                </button>
                <button onClick={handleSave} disabled={uploading}
                  className="flex-1 py-3 bg-brand text-white rounded-xl font-bold disabled:opacity-50">
                  {uploading ? '⏳ Enregistrement…' : '✅ Enregistrer'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
