'use client'
// src/components/reception/FicheContactsPanel.tsx
//
// Onglet « Contacts & interactions » d'une fiche véhicule (dispatch).
// - Répertoire de contacts (fiche_contacts) : ajout / édition / suppression.
// - Journal des interactions (fiche_interactions) : visites/appels/notes, avec
//   ajout rapide de note.
// Composant autonome (fetch via /api/missions/[id]/contacts). Olivier 2026-07-31.

import { useEffect, useState, useCallback } from 'react'
import {
  User, Phone, PhoneIncoming, PhoneOutgoing, Mail, StickyNote, MapPin,
  Plus, Pencil, Trash2, X, Check,
} from 'lucide-react'

interface Contact {
  id: string; name: string | null; role: string
  phone: string | null; email: string | null; source: string
}
interface Interaction {
  id: string; type: string; motif_label: string | null; note: string | null
  status: string; phone: string | null; email: string | null
  visitor_name: string | null; handler: string | null; created_at: string
}

const ROLES = ['client', 'assistance', 'courtier', 'ami', 'visiteur', 'autre']
const ROLE_COLOR: Record<string, string> = {
  client: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  assistance: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  courtier: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  ami: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  visiteur: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  autre: 'bg-white/10 text-ink-secondary border-white/20',
}

function interactionIcon(type: string) {
  switch (type) {
    case 'visit':    return <MapPin size={15} className="text-pink-300" />
    case 'call_in':  return <PhoneIncoming size={15} className="text-sky-300" />
    case 'call_out': return <PhoneOutgoing size={15} className="text-emerald-300" />
    case 'email':    return <Mail size={15} className="text-violet-300" />
    default:         return <StickyNote size={15} className="text-amber-300" />
  }
}
const TYPE_LABEL: Record<string, string> = {
  visit: 'Visite', call_in: 'Appel entrant', call_out: 'Appel sortant', email: 'E-mail', note: 'Note',
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

export default function FicheContactsPanel({
  missionId, onCountChange,
}: {
  missionId: string
  onCountChange?: (n: number) => void
}) {
  const [contacts, setContacts]         = useState<Contact[]>([])
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [loading, setLoading]           = useState(true)
  const [editing, setEditing]           = useState<string | null>(null)   // contact id ou 'new'
  const [form, setForm]                 = useState({ name: '', role: 'autre', phone: '', email: '' })
  const [note, setNote]                 = useState('')
  const [busy, setBusy]                 = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/missions/${missionId}/contacts`, { cache: 'no-store' })
      const j = await r.json()
      setContacts(j.contacts || [])
      setInteractions(j.interactions || [])
      onCountChange?.((j.contacts?.length || 0) + (j.interactions?.length || 0))
    } catch {} finally { setLoading(false) }
  }, [missionId, onCountChange])

  useEffect(() => { load() }, [load])

  const post = async (payload: any) => {
    setBusy(true)
    try {
      const r = await fetch(`/api/missions/${missionId}/contacts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || 'Erreur'); return false }
      await load()
      return true
    } finally { setBusy(false) }
  }

  const openNew  = () => { setForm({ name: '', role: 'autre', phone: '', email: '' }); setEditing('new') }
  const openEdit = (c: Contact) => { setForm({ name: c.name || '', role: c.role, phone: c.phone || '', email: c.email || '' }); setEditing(c.id) }
  const saveContact = async () => {
    const ok = await post(editing === 'new'
      ? { action: 'add_contact', ...form }
      : { action: 'update_contact', contact_id: editing, ...form })
    if (ok) setEditing(null)
  }
  const delContact = async (id: string) => { if (confirm('Supprimer ce contact ?')) await post({ action: 'delete_contact', contact_id: id }) }
  const addNote = async () => { if (!note.trim()) return; if (await post({ action: 'add_note', note })) setNote('') }

  return (
    <div className="bg-surface border rounded-2xl p-5 md-card-enter">
      <div className="flex items-center justify-between mb-3">
        <p className="text-ink-muted text-xs font-semibold uppercase tracking-wide">📇 Contacts &amp; interactions</p>
        {editing !== 'new' && (
          <button onClick={openNew} className="inline-flex items-center gap-1 text-brand text-xs font-medium hover:underline">
            <Plus size={14} /> Ajouter un contact
          </button>
        )}
      </div>

      {/* Formulaire d'ajout / édition */}
      {editing && (
        <div className="mb-4 rounded-xl border border-brand/30 bg-brand/5 p-3 flex flex-col gap-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Nom" className="bg-surface border rounded-lg px-2.5 py-1.5 text-sm text-ink" />
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
              className="bg-surface border rounded-lg px-2.5 py-1.5 text-sm text-ink">
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
              placeholder="Téléphone" className="bg-surface border rounded-lg px-2.5 py-1.5 text-sm text-ink" />
            <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="E-mail" className="bg-surface border rounded-lg px-2.5 py-1.5 text-sm text-ink" />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1 text-ink-muted text-xs px-2 py-1 hover:text-ink">
              <X size={14} /> Annuler
            </button>
            <button onClick={saveContact} disabled={busy}
              className="inline-flex items-center gap-1 bg-brand text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50">
              <Check size={14} /> Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* Répertoire */}
      {loading ? (
        <p className="text-ink-muted text-sm">Chargement…</p>
      ) : contacts.length === 0 && editing !== 'new' ? (
        <p className="text-ink-muted text-sm italic">Aucun contact enregistré.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {contacts.map(c => (
            <div key={c.id} className="group flex items-center gap-2.5 rounded-xl border bg-surface px-3 py-2">
              <User size={16} className="text-ink-muted flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-ink text-sm font-medium truncate">{c.name || '—'}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${ROLE_COLOR[c.role] || ROLE_COLOR.autre}`}>{c.role}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-ink-secondary mt-0.5">
                  {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-brand"><Phone size={12} />{c.phone}</a>}
                  {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-brand truncate"><Mail size={12} />{c.email}</a>}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <button onClick={() => openEdit(c)} className="p-1 text-ink-muted hover:text-brand"><Pencil size={14} /></button>
                <button onClick={() => delContact(c.id)} className="p-1 text-ink-muted hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Journal des interactions */}
      <div className="mt-4 pt-4 border-t">
        <div className="flex items-center gap-2 mb-2">
          <input value={note} onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addNote() }}
            placeholder="Ajouter une note…" className="flex-1 bg-surface border rounded-lg px-2.5 py-1.5 text-sm text-ink" />
          <button onClick={addNote} disabled={busy || !note.trim()}
            className="inline-flex items-center gap-1 bg-white/10 text-ink text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-white/15">
            <Plus size={14} /> Note
          </button>
        </div>

        {interactions.length === 0 ? (
          <p className="text-ink-muted text-xs italic">Aucune interaction.</p>
        ) : (
          <ul className="flex flex-col gap-2 mt-1">
            {interactions.map(i => (
              <li key={i.id} className="flex items-start gap-2.5">
                <div className="mt-0.5 flex-shrink-0">{interactionIcon(i.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-ink font-medium">{TYPE_LABEL[i.type] || i.type}</span>
                    {i.motif_label && <span className="text-ink-secondary">· {i.motif_label}</span>}
                    {i.status === 'waiting' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">en attente</span>}
                    <span className="text-ink-muted ml-auto">{fmtDate(i.created_at)}</span>
                  </div>
                  {(i.visitor_name || i.phone || i.email) && (
                    <div className="text-xs text-ink-secondary mt-0.5">
                      {[i.visitor_name, i.phone, i.email].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {i.note && <p className="text-xs text-ink-secondary mt-0.5 whitespace-pre-wrap">{i.note}</p>}
                  {i.handler && <p className="text-[11px] text-ink-muted mt-0.5">par {i.handler}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
