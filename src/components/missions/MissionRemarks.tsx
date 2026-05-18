'use client'

import { useEffect, useState, useRef } from 'react'

interface Attachment {
  id:          string
  file_name:   string
  file_size:   number
  mime_type:   string | null
  uploaded_at: string
}

interface RemarkUser {
  id:    string | null
  name:  string | null
  email: string | null
}

interface Remark {
  id:           string
  text:         string
  created_at:   string
  updated_at:   string | null
  edit_history: Array<{ at: string; by: string | null; old_text: string }>
  author:       RemarkUser | null
  editor:       RemarkUser | null
  attachments:  Attachment[]
}

interface Props {
  missionId: string
}

const fmtDate = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const fmtSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

const fileIcon = (mime: string | null) => {
  if (!mime) return '📎'
  if (mime.startsWith('image/')) return '🖼️'
  if (mime === 'application/pdf') return '📄'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.includes('zip') || mime.includes('compressed')) return '🗜️'
  return '📎'
}

export default function MissionRemarks({ missionId }: Props) {
  const [remarks, setRemarks] = useState<Remark[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    fetch(`/api/missions/${missionId}/remarks`)
      .then(r => r.json())
      .then(j => setRemarks(j.remarks || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [missionId])

  const handleDelete = async (remarkId: string) => {
    if (!confirm('Supprimer cette remarque et tous ses fichiers ?')) return
    const res = await fetch(`/api/missions/remarks/${remarkId}`, { method: 'DELETE' })
    if (res.ok) load()
    else alert((await res.json()).error || 'Erreur')
  }

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!confirm('Supprimer cette pièce jointe ?')) return
    const res = await fetch(`/api/missions/remarks/attachments/${attachmentId}`, { method: 'DELETE' })
    if (res.ok) load()
    else alert((await res.json()).error || 'Erreur')
  }

  return (
    <div className="bg-surface border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-ink font-semibold text-sm flex items-center gap-2">
          <span>💬</span>
          Remarques
          {remarks.length > 0 && <span className="text-ink-faint text-xs font-normal">({remarks.length})</span>}
        </h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-medium transition"
        >
          + Ajouter une remarque
        </button>
      </div>

      {loading && <div className="text-ink-faint text-sm">Chargement…</div>}

      {!loading && remarks.length === 0 && (
        <div className="text-ink-faint text-sm italic text-center py-4">
          Aucune remarque pour cette mission.
        </div>
      )}

      <div className="space-y-3">
        {remarks.map(r => (
          <RemarkCard
            key={r.id}
            remark={r}
            isEditing={editingId === r.id}
            onStartEdit={() => setEditingId(r.id)}
            onStopEdit={() => setEditingId(null)}
            onSaved={load}
            onDelete={() => handleDelete(r.id)}
            onDeleteAttachment={handleDeleteAttachment}
          />
        ))}
      </div>

      {showAddModal && (
        <AddRemarkModal
          missionId={missionId}
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); load() }}
        />
      )}
    </div>
  )
}

function RemarkCard({
  remark, isEditing, onStartEdit, onStopEdit, onSaved, onDelete, onDeleteAttachment,
}: {
  remark: Remark
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  onSaved: () => void
  onDelete: () => void
  onDeleteAttachment: (attId: string) => void
}) {
  const [text, setText] = useState(remark.text)
  const [saving, setSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { setText(remark.text) }, [remark.text])

  const save = async () => {
    if (!text.trim() || text === remark.text) { onStopEdit(); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/missions/remarks/${remark.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: text.trim() }),
      })
      if (!res.ok) { alert((await res.json()).error || 'Erreur'); return }
      onStopEdit()
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const fd = new FormData()
      for (const f of Array.from(files)) fd.append('files', f)
      const res = await fetch(`/api/missions/remarks/${remark.id}/attachments`, {
        method: 'POST',
        body:   fd,
      })
      if (!res.ok) { alert((await res.json()).error || 'Erreur upload'); return }
      onSaved()
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const authorName = remark.author?.name || remark.author?.email || 'Inconnu'
  const editorName = remark.editor?.name || remark.editor?.email || null

  return (
    <div className="bg-surface-2 border rounded-xl p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-xs text-ink-muted">
          <span className="font-medium text-ink">{authorName}</span>
          <span className="text-ink-faint"> · {fmtDate(remark.created_at)}</span>
          {remark.updated_at && editorName && (
            <button
              onClick={() => setShowHistory(s => !s)}
              className="ml-2 text-ink-faint hover:text-ink italic underline"
              title="Voir l'historique"
            >
              modifié par {editorName} le {fmtDate(remark.updated_at)}
            </button>
          )}
        </div>
        <div className="flex gap-1">
          {!isEditing && (
            <button onClick={onStartEdit} title="Modifier" className="text-ink-faint hover:text-brand text-xs">
              ✏️
            </button>
          )}
          <button onClick={onDelete} title="Supprimer" className="text-ink-faint hover:text-critical text-xs">
            🗑️
          </button>
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            className="w-full bg-surface border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand resize-y"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setText(remark.text); onStopEdit() }}
              disabled={saving}
              className="px-3 py-1 bg-surface-hover text-ink-secondary rounded text-xs"
            >
              Annuler
            </button>
            <button
              onClick={save}
              disabled={saving || !text.trim()}
              className="px-3 py-1 bg-brand text-white rounded text-xs font-medium disabled:opacity-50"
            >
              {saving ? '⏳' : 'Enregistrer'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-ink text-sm whitespace-pre-wrap break-words">{remark.text}</p>
      )}

      {showHistory && remark.edit_history.length > 0 && (
        <div className="mt-2 pt-2 border-t border-surface-hover text-xs space-y-1.5">
          <div className="text-ink-faint italic">Historique :</div>
          {remark.edit_history.slice().reverse().map((h, i) => (
            <div key={i} className="text-ink-faint pl-2 border-l-2 border-surface-hover">
              <span className="text-[10px]">{fmtDate(h.at)}</span>
              <div className="italic whitespace-pre-wrap break-words">"{h.old_text}"</div>
            </div>
          ))}
        </div>
      )}

      {remark.attachments.length > 0 && (
        <div className="mt-2 pt-2 border-t border-surface-hover space-y-1">
          {remark.attachments.map(a => (
            <div key={a.id} className="flex items-center justify-between gap-2 text-xs">
              <a
                href={`/api/missions/remarks/attachments/${a.id}`}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-2 text-brand hover:underline flex-1 min-w-0"
              >
                <span>{fileIcon(a.mime_type)}</span>
                <span className="truncate">{a.file_name}</span>
                <span className="text-ink-faint flex-shrink-0">{fmtSize(a.file_size)}</span>
              </a>
              <button
                onClick={() => onDeleteAttachment(a.id)}
                className="text-ink-faint hover:text-critical"
                title="Supprimer la pièce jointe"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-surface-hover">
        <input
          ref={fileInput}
          type="file"
          multiple
          onChange={e => handleFiles(e.target.files)}
          className="hidden"
        />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="text-xs text-ink-faint hover:text-brand disabled:opacity-50"
        >
          {uploading ? '⏳ Upload…' : '+ Ajouter une pièce jointe'}
        </button>
      </div>
    </div>
  )
}

function AddRemarkModal({
  missionId, onClose, onSaved,
}: {
  missionId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (!text.trim()) { setError('Texte requis'); return }
    setSaving(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('text', text.trim())
      for (const f of files) fd.append('files', f)
      const res = await fetch(`/api/missions/${missionId}/remarks`, { method: 'POST', body: fd })
      if (!res.ok) { setError((await res.json()).error || 'Erreur'); return }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={!saving ? onClose : undefined}>
      <div className="bg-surface rounded-2xl p-5 max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <h3 className="text-ink font-semibold mb-3">💬 Ajouter une remarque</h3>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={5}
          placeholder="Tape ta remarque ici…"
          className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand resize-y"
        />

        <div className="mt-3">
          <input
            ref={fileInput}
            type="file"
            multiple
            onChange={e => setFiles(Array.from(e.target.files || []))}
            className="hidden"
          />
          <button
            onClick={() => fileInput.current?.click()}
            className="text-xs text-ink-faint hover:text-brand"
          >
            📎 Ajouter des pièces jointes (max 10 MB chacune)
          </button>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-ink-secondary">
                  <span className="truncate flex items-center gap-1.5">
                    <span>{fileIcon(f.type)}</span>
                    <span className="truncate">{f.name}</span>
                  </span>
                  <span className="text-ink-faint flex-shrink-0">{fmtSize(f.size)}</span>
                  <button
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    className="text-ink-faint hover:text-critical"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <div className="mt-3 text-critical text-xs">{error}</div>}

        <div className="flex gap-2 mt-4 justify-end">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 bg-surface-hover text-ink-secondary rounded-lg text-sm">
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={saving || !text.trim()}
            className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? '⏳ Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
