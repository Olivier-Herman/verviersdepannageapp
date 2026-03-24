'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2, XCircle, MinusCircle, Camera,
  ChevronLeft, Loader2, User, Calendar, ClipboardList
} from 'lucide-react'
import type { Session } from 'next-auth'
import type { VehicleCheck, CheckTemplateItem, CheckItemResult } from '@/types'

const CATEGORIES = ['Documents', 'Matériel', 'Carrosserie', 'Mécanique'] as const

export default function CheckDetailClient({
  checkId,
  session,
}: {
  checkId: string
  session: Session
}) {
  const router = useRouter()
  const currentUserId = (session.user as any).id as string

  const [check, setCheck]               = useState<VehicleCheck | null>(null)
  const [templateItems, setTemplateItems] = useState<CheckTemplateItem[]>([])
  const [results, setResults]           = useState<CheckItemResult[]>([])
  const [generalPhotos, setGeneralPhotos] = useState<string[]>([])
  const [notes, setNotes]               = useState('')
  const [loading, setLoading]           = useState(true)
  const [claiming, setClaiming]         = useState(false)
  const [submitting, setSubmitting]     = useState(false)
  const [uploadingId, setUploadingId]   = useState<string | null>(null)
  const [error, setError]               = useState('')

  useEffect(() => {
    fetch(`/api/check-vehicule/${checkId}`)
      .then(r => r.json())
      .then(data => {
        const c: VehicleCheck = data.check
        setCheck(c)
        setTemplateItems(data.templateItems || [])

        if (c.status === 'completed' && c.results) {
          setResults(c.results)
          setNotes(c.notes || '')
          setGeneralPhotos(c.photos || [])
        } else {
          setResults(
            (data.templateItems || []).map((item: CheckTemplateItem) => ({
              item_id:   item.id,
              label:     item.label,
              category:  item.category,
              ok:        null,
              comment:   '',
              photo_url: '',
            }))
          )
        }
      })
      .finally(() => setLoading(false))
  }, [checkId])

  const isClaimedByMe = check?.claimed_by === currentUserId
  const canClaim      = check?.status === 'pending_claim'
  const canFill       = check?.status === 'in_progress' && isClaimedByMe
  const isReadOnly    = check?.status === 'completed' ||
    (check?.status === 'in_progress' && !isClaimedByMe)

  const handleClaim = async () => {
    setClaiming(true)
    setError('')
    const res  = await fetch(`/api/check-vehicule/${checkId}/claim`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Erreur'); setClaiming(false); return }
    setCheck(data.check)
    setResults(
      templateItems.map(item => ({
        item_id:   item.id,
        label:     item.label,
        category:  item.category,
        ok:        null,
        comment:   '',
        photo_url: '',
      }))
    )
    setClaiming(false)
  }

  const setItemValue = (itemId: string, ok: boolean | null) =>
    setResults(prev => prev.map(r => r.item_id === itemId
      ? { ...r, ok, comment: ok !== false ? '' : r.comment }
      : r
    ))

  const setItemComment = (itemId: string, comment: string) =>
    setResults(prev => prev.map(r => r.item_id === itemId ? { ...r, comment } : r))

  const compressImage = (file: File): Promise<File> =>
    new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = e => {
        const img = new Image()
        img.onload = () => {
          const MAX = 1200
          let { width, height } = img
          if (width > MAX) { height = Math.round((height * MAX) / width); width = MAX }
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
          canvas.toBlob(blob => {
            resolve(new File([blob!], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
          }, 'image/jpeg', 0.82)
        }
        img.src = e.target!.result as string
      }
      reader.readAsDataURL(file)
    })

  const uploadPhoto = async (file: File, itemId: string | 'general') => {
    setUploadingId(itemId)
    const compressed = await compressImage(file)
    const fd = new FormData()
    fd.append('file', compressed)
    fd.append('checkId', checkId)
    const res  = await fetch('/api/check-vehicule/upload', { method: 'POST', body: fd })
    const data = await res.json()
    if (res.ok) {
      if (itemId === 'general') {
        setGeneralPhotos(prev => [...prev, data.url])
      } else {
        setResults(prev => prev.map(r => r.item_id === itemId ? { ...r, photo_url: data.url } : r))
      }
    }
    setUploadingId(null)
  }

  const handleSubmit = async () => {
    const unanswered = results.filter(r => r.ok === null)
    if (unanswered.length > 0) {
      setError(`${unanswered.length} point(s) sans réponse. Veuillez cocher OK, Non-conforme ou N/A pour chaque item.`)
      return
    }
    setSubmitting(true)
    setError('')
    const res  = await fetch(`/api/check-vehicule/${checkId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ results, photos: generalPhotos, notes }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Erreur'); setSubmitting(false); return }
    router.push('/check-vehicule')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-brand" size={32} />
      </div>
    )
  }

  if (!check) return <div className="p-4 text-red-400">Contrôle introuvable.</div>

  const nonConformeCount = results.filter(r => r.ok === false).length
  const okCount          = results.filter(r => r.ok === true).length

  return (
    <div className="max-w-2xl mx-auto p-4 pb-28">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-zinc-400 hover:text-white transition">
          <ChevronLeft size={24} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-white">
            {check.vehicle?.name} — {check.vehicle?.plate}
          </h1>
          <p className="text-zinc-400 text-sm capitalize">
            {check.status === 'completed' ? 'Terminé' :
             check.status === 'in_progress' ? 'En cours' :
             check.status === 'pending_claim' ? 'En attente de prise en charge' : 'Planifié'}
          </p>
        </div>
      </div>

      {/* Infos */}
      <div className="bg-surface border border-border rounded-xl p-4 mb-6 space-y-2">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Calendar size={14} />
          <span>
            Planifié le {new Date(check.scheduled_date).toLocaleDateString('fr-BE', {
              weekday: 'long', day: 'numeric', month: 'long'
            })}
          </span>
        </div>
        {check.claimed_by_user && (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <User size={14} />
            <span>Responsable : <span className="text-white">{check.claimed_by_user.name}</span></span>
          </div>
        )}
        {check.triggered_by_user && (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <ClipboardList size={14} />
            <span>Déclenché par : {check.triggered_by_user.name}</span>
          </div>
        )}
        {check.status === 'completed' && (
          <div className="flex items-center gap-4 pt-2 border-t border-border mt-1">
            <span className="text-green-400 text-sm font-medium">✅ {okCount} OK</span>
            {nonConformeCount > 0 && (
              <span className="text-red-400 text-sm font-medium">❌ {nonConformeCount} Non-conforme(s)</span>
            )}
          </div>
        )}
      </div>

      {/* Prise en charge */}
      {canClaim && (
        <div className="bg-yellow-900/20 border border-yellow-600 rounded-xl p-6 text-center mb-6">
          <p className="text-4xl mb-3">🔍</p>
          <p className="text-white font-semibold mb-1">Contrôle disponible</p>
          <p className="text-zinc-400 text-sm mb-4">
            Prenez en charge ce contrôle pour commencer la vérification du véhicule.
          </p>
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          <button onClick={handleClaim} disabled={claiming}
            className="bg-brand hover:bg-brand-dark text-white font-semibold px-8 py-3 rounded-xl transition disabled:opacity-50 flex items-center gap-2 mx-auto"
          >
            {claiming && <Loader2 className="animate-spin" size={18} />}
            Je prends en charge ce contrôle
          </button>
        </div>
      )}

      {/* En cours mais pas le sien */}
      {check.status === 'in_progress' && !isClaimedByMe && (
        <div className="bg-blue-900/20 border border-blue-700 rounded-xl p-4 mb-6 text-center">
          <p className="text-blue-300 text-sm">
            Ce contrôle est pris en charge par <strong>{check.claimed_by_user?.name}</strong>.
          </p>
        </div>
      )}

      {/* Checklist */}
      {(canFill || isReadOnly) && results.length > 0 && (
        <div className="space-y-6">

          {/* Photos générales */}
          <div>
            <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
              <Camera size={18} className="text-brand" /> Photos du véhicule
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {generalPhotos.map((url, i) => (
                <img key={i} src={url} alt={`Photo ${i + 1}`}
                  className="w-full h-24 object-cover rounded-lg border border-border" />
              ))}
              {!isReadOnly && generalPhotos.length < 6 && (
                <label className={`h-24 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-zinc-500 transition ${uploadingId === 'general' ? 'opacity-50' : ''}`}>
                  {uploadingId === 'general'
                    ? <Loader2 className="animate-spin text-zinc-400" size={20} />
                    : <Camera className="text-zinc-500" size={20} />
                  }
                  <span className="text-zinc-500 text-xs mt-1">Ajouter</span>
                  <input type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={e => { if (e.target.files?.[0]) uploadPhoto(e.target.files[0], 'general') }} />
                </label>
              )}
            </div>
          </div>

          {/* Items par catégorie */}
          {CATEGORIES.map(cat => {
            const items = results.filter(r => r.category === cat)
            if (items.length === 0) return null
            return (
              <div key={cat}>
                <h2 className="text-brand font-semibold text-xs uppercase tracking-wider mb-3">{cat}</h2>
                <div className="space-y-2">
                  {items.map(item => (
                    <div key={item.item_id} className="bg-surface border border-border rounded-xl p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white text-sm font-medium flex-1">{item.label}</span>

                        {!isReadOnly ? (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button onClick={() => setItemValue(item.item_id, true)}
                              title="OK"
                              className={`p-1.5 rounded-lg transition ${item.ok === true ? 'bg-green-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-green-400'}`}>
                              <CheckCircle2 size={18} />
                            </button>
                            <button onClick={() => setItemValue(item.item_id, false)}
                              title="Non-conforme"
                              className={`p-1.5 rounded-lg transition ${item.ok === false ? 'bg-red-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-red-400'}`}>
                              <XCircle size={18} />
                            </button>
                            <button onClick={() => setItemValue(item.item_id, null)}
                              title="N/A"
                              className={`p-1.5 rounded-lg transition ${item.ok === null ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-300'}`}>
                              <MinusCircle size={18} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex-shrink-0">
                            {item.ok === true  && <CheckCircle2 className="text-green-400" size={18} />}
                            {item.ok === false && <XCircle      className="text-red-400"   size={18} />}
                            {item.ok === null  && <MinusCircle  className="text-zinc-500"  size={18} />}
                          </div>
                        )}
                      </div>

                      {item.ok === false && (
                        <div className="mt-2 space-y-2 pt-2 border-t border-border">
                          {!isReadOnly ? (
                            <textarea value={item.comment}
                              onChange={e => setItemComment(item.item_id, e.target.value)}
                              placeholder="Décrivez le problème…" rows={2}
                              className="w-full bg-zinc-800 text-white text-sm rounded-lg px-3 py-2 border border-border focus:outline-none focus:border-brand resize-none"
                            />
                          ) : (
                            item.comment && <p className="text-zinc-400 text-sm italic">{item.comment}</p>
                          )}
                          {!isReadOnly && !item.photo_url && (
                            <label className={`flex items-center gap-2 text-xs text-zinc-400 cursor-pointer hover:text-white transition ${uploadingId === item.item_id ? 'opacity-50' : ''}`}>
                              {uploadingId === item.item_id
                                ? <Loader2 className="animate-spin" size={14} />
                                : <Camera size={14} />
                              }
                              <span>Ajouter une photo</span>
                              <input type="file" accept="image/*" capture="environment" className="hidden"
                                onChange={e => { if (e.target.files?.[0]) uploadPhoto(e.target.files[0], item.item_id) }} />
                            </label>
                          )}
                          {item.photo_url && (
                            <img src={item.photo_url} alt="Preuve"
                              className="w-full max-h-48 object-cover rounded-lg border border-border" />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Notes */}
          <div>
            <h2 className="text-white font-semibold mb-2">Notes générales</h2>
            {!isReadOnly ? (
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Observations supplémentaires…" rows={3}
                className="w-full bg-surface border border-border text-white rounded-xl px-4 py-3 focus:outline-none focus:border-brand resize-none"
              />
            ) : (
              notes && (
                <p className="text-zinc-300 bg-surface border border-border rounded-xl p-4 text-sm">{notes}</p>
              )
            )}
          </div>

          {/* Bouton soumettre */}
          {canFill && (
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-black/90 border-t border-border backdrop-blur-sm">
              {error && <p className="text-red-400 text-sm text-center mb-3">{error}</p>}
              <button onClick={handleSubmit} disabled={submitting}
                className="w-full bg-brand hover:bg-brand-dark text-white font-bold py-4 rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting
                  ? <Loader2 className="animate-spin" size={20} />
                  : <CheckCircle2 size={20} />
                }
                Soumettre le contrôle
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
