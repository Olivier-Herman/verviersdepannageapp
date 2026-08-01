'use client'
// src/app/personnel/annonces/AnnoncesClient.tsx
//
// Console Annonces (superadmin) : créer / éditer / activer / tester / diffuser
// des annonces — avec choix des destinataires et diffusion programmée — et suivre
// qui les a lues.

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { Megaphone, Send, TestTube, Save, Check, Eye, Clock, Plus, Pencil, Trash2, X, Power, Users, CalendarClock } from 'lucide-react'

type Ann = { id: string; emoji: string; title: string; body: string; action_url: string; cta_label: string; active: boolean; read: number; audience: string; target_user_ids: string[]; scheduled_at: string | null; broadcast_at: string | null }
type Worker = { user_id: string; name: string; kind: string }
const BLANK = { emoji: '✨', title: '', body: '', action_url: '/ma-paie', cta_label: 'Découvrir', active: true, audience: 'all', target_user_ids: [] as string[], scheduled_at: '' }

const toLocalInput = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function AnnoncesClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [list, setList]   = useState<Ann[]>([])
  const [total, setTotal] = useState(0)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [editing, setEditing] = useState<any>(null)
  const [statsFor, setStatsFor] = useState<string | null>(null)
  const [targets, setTargets] = useState<any[]>([])
  const [busy, setBusy]   = useState('')
  const [msg, setMsg]     = useState('')

  const load = () => fetch('/api/announcements?manage=1', { cache: 'no-store' }).then(r => r.json())
    .then(d => { setList(d.announcements || []); setTotal(d.total || 0) })

  useEffect(() => {
    load()
    fetch('/api/announcements?workers=1', { cache: 'no-store' }).then(r => r.json()).then(d => setWorkers(d.workers || [])).catch(() => {})
  }, [])

  const post = async (payload: any, label: string, okMsg?: string) => {
    setBusy(label); setMsg('')
    try {
      const r = await fetch('/api/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await r.json()
      if (!r.ok) { setMsg('❌ ' + (d.error || 'Erreur')); return null }
      if (okMsg) setMsg(okMsg)
      await load()
      return d
    } catch { setMsg('❌ Erreur réseau'); return null } finally { setBusy('') }
  }

  const saveEditing = async () => {
    if (!editing.title?.trim() || !editing.body?.trim()) { setMsg('❌ Titre et message requis'); return }
    if (editing.audience === 'custom' && !editing.target_user_ids.length) { setMsg('❌ Sélectionne au moins un destinataire'); return }
    const d = await post({ action: editing.id ? 'save' : 'create', ...editing }, 'save', editing.id ? '✅ Annonce enregistrée.' : (editing.scheduled_at ? '✅ Annonce programmée.' : '✅ Annonce créée.'))
    if (d) setEditing(null)
  }
  const test = (a: Ann) => post({ action: 'test', id: a.id }, 'test:' + a.id).then(d => d && setMsg(`✅ Test envoyé à toi (${d.sent}/${d.targeted}). Regarde ton téléphone.`))
  const broadcast = (a: Ann) => {
    const n = a.audience === 'custom' ? a.target_user_ids.length : total
    if (confirm(`Diffuser « ${a.title} » maintenant à ${n} destinataire(s) ?\nIls reçoivent la notif (in-app + push) et le modal à l'ouverture.`))
      post({ action: 'broadcast', id: a.id }, 'bc:' + a.id).then(d => d && setMsg(`✅ Diffusé à ${d.sent}/${d.targeted} destinataire(s).`))
  }
  const toggle = (a: Ann) => post({ action: 'toggle', id: a.id, active: !a.active }, 'tg:' + a.id)
  const del = (a: Ann) => { if (confirm(`Supprimer l'annonce « ${a.title} » ? (le suivi de lecture est perdu)`)) post({ action: 'delete', id: a.id }, 'del:' + a.id) }
  const showStats = async (a: Ann) => {
    if (statsFor === a.id) { setStatsFor(null); return }
    setStatsFor(a.id); setTargets([])
    const d = await fetch(`/api/announcements?stats=${a.id}`, { cache: 'no-store' }).then(r => r.json())
    setTargets(d.targets || [])
  }

  const fmt = (s?: string | null) => s ? new Date(s).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
  const toggleTarget = (uid: string) => setEditing((e: any) => ({ ...e, target_user_ids: e.target_user_ids.includes(uid) ? e.target_user_ids.filter((x: string) => x !== uid) : [...e.target_user_ids, uid] }))
  const audienceLabel = (a: Ann) => a.audience === 'custom' ? `${a.target_user_ids.length} destinataire(s)` : 'Tous'

  return (
    <AppShell title="Annonces" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-brand/10 text-brand flex items-center justify-center"><Megaphone size={22} /></div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-ink leading-tight">Annonces</h1>
            <p className="text-ink-muted text-sm">Crée une notif, choisis les destinataires, diffuse maintenant ou programme — et vois qui l'a lue.</p>
          </div>
          {!editing && <button onClick={() => setEditing({ ...BLANK, target_user_ids: [] })} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-brand text-white hover:opacity-90"><Plus size={16} /> Nouvelle annonce</button>}
        </div>

        {/* Éditeur (création / édition) */}
        {editing && (
          <div className="bg-surface border rounded-2xl p-5 space-y-3 mb-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-ink text-sm">{editing.id ? 'Modifier l\'annonce' : 'Nouvelle annonce'}</h2>
              <button onClick={() => { setEditing(null); setMsg('') }} className="p-1 text-ink-muted hover:text-ink"><X size={17} /></button>
            </div>
            <div className="flex gap-3">
              <label className="block w-20"><span className="text-ink-muted text-xs">Emoji</span>
                <input value={editing.emoji} onChange={e => setEditing({ ...editing, emoji: e.target.value })} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-center text-lg" /></label>
              <label className="block flex-1"><span className="text-ink-muted text-xs">Titre</span>
                <input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Ex. Nouvelle fonctionnalité !" className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink" /></label>
            </div>
            <label className="block"><span className="text-ink-muted text-xs">Message</span>
              <textarea value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} rows={4} placeholder="Ce que tu veux annoncer aux travailleurs…" className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink resize-none" /></label>
            <div className="flex gap-3">
              <label className="block flex-1"><span className="text-ink-muted text-xs">Lien du bouton</span>
                <input value={editing.action_url} onChange={e => setEditing({ ...editing, action_url: e.target.value })} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink font-mono" /></label>
              <label className="block flex-1"><span className="text-ink-muted text-xs">Texte du bouton</span>
                <input value={editing.cta_label} onChange={e => setEditing({ ...editing, cta_label: e.target.value })} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink" /></label>
            </div>

            {/* Destinataires */}
            <div className="pt-1">
              <span className="text-ink-muted text-xs flex items-center gap-1"><Users size={13} /> Destinataires</span>
              <div className="flex gap-2 mt-1.5">
                <button onClick={() => setEditing({ ...editing, audience: 'all' })} className={`text-xs px-3 py-1.5 rounded-lg border ${editing.audience !== 'custom' ? 'bg-brand text-white border-brand' : 'hover:bg-bg'}`}>Tous les travailleurs ({total})</button>
                <button onClick={() => setEditing({ ...editing, audience: 'custom' })} className={`text-xs px-3 py-1.5 rounded-lg border ${editing.audience === 'custom' ? 'bg-brand text-white border-brand' : 'hover:bg-bg'}`}>Sélection…</button>
              </div>
              {editing.audience === 'custom' && (
                <div className="mt-2 border rounded-lg p-2 max-h-52 overflow-auto">
                  <div className="flex items-center justify-between px-1 pb-1.5 mb-1.5 border-b">
                    <span className="text-[11px] text-ink-muted">{editing.target_user_ids.length} sélectionné(s)</span>
                    <div className="flex gap-2 text-[11px]">
                      <button onClick={() => setEditing({ ...editing, target_user_ids: workers.map(w => w.user_id) })} className="text-brand hover:underline">Tout</button>
                      <button onClick={() => setEditing({ ...editing, target_user_ids: [] })} className="text-ink-muted hover:underline">Aucun</button>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-x-3">
                    {workers.map(w => (
                      <label key={w.user_id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                        <input type="checkbox" checked={editing.target_user_ids.includes(w.user_id)} onChange={() => toggleTarget(w.user_id)} />
                        <span className="text-ink truncate">{w.name}</span>
                        {w.kind === 'independant' && <span className="text-[9px] px-1 rounded bg-sky-500/10 text-sky-500">indép.</span>}
                      </label>
                    ))}
                    {!workers.length && <span className="text-ink-muted text-xs py-1">Aucun travailleur lié.</span>}
                  </div>
                </div>
              )}
            </div>

            {/* Programmation */}
            <div className="flex flex-wrap items-end gap-3 pt-1">
              <label className="block"><span className="text-ink-muted text-xs flex items-center gap-1"><CalendarClock size={13} /> Programmer la diffusion (optionnel)</span>
                <input type="datetime-local" value={editing.scheduled_at || ''} onChange={e => setEditing({ ...editing, scheduled_at: e.target.value })} className="mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink" /></label>
              {editing.scheduled_at && <button onClick={() => setEditing({ ...editing, scheduled_at: '' })} className="text-xs text-ink-muted hover:text-red-500 pb-2.5">retirer</button>}
            </div>
            {editing.scheduled_at
              ? <p className="text-[11px] text-ink-muted/80">📅 Sera diffusée automatiquement le <b>{fmt(new Date(editing.scheduled_at).toISOString())}</b> (à ±5 min). Masquée jusque-là.</p>
              : <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={editing.active !== false} onChange={e => setEditing({ ...editing, active: e.target.checked })} /> Active (le modal s'affiche aux destinataires non-lecteurs)</label>}

            <div className="flex gap-2 pt-1">
              <button onClick={saveEditing} disabled={busy === 'save'} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-50"><Save size={15} /> {busy === 'save' ? 'Enregistrement…' : (editing.id ? 'Enregistrer' : (editing.scheduled_at ? 'Programmer' : 'Créer'))}</button>
              <button onClick={() => { setEditing(null); setMsg('') }} className="text-sm px-3.5 py-2 rounded-lg border hover:bg-bg">Annuler</button>
            </div>
          </div>
        )}

        {msg && <p className="text-sm mb-4">{msg}</p>}

        {!list.length && !editing && <p className="text-ink-muted text-sm">Aucune annonce. Clique « Nouvelle annonce » pour en créer une.</p>}
        <div className="space-y-3">
          {list.map(a => {
            const scope = a.audience === 'custom' ? a.target_user_ids.length : total
            const pct = scope ? Math.round((a.read / scope) * 100) : 0
            const pending = a.scheduled_at && !a.broadcast_at
            return (
              <div key={a.id} className="bg-surface border rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <div className="text-2xl leading-none mt-0.5">{a.emoji}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink text-sm truncate">{a.title}</span>
                      {pending
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 flex-shrink-0 inline-flex items-center gap-1"><CalendarClock size={10} /> {fmt(a.scheduled_at)}</span>
                        : a.active
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 flex-shrink-0">Active</span>
                          : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink-muted/10 text-ink-muted flex-shrink-0">Inactive</span>}
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink-muted/10 text-ink-muted flex-shrink-0 inline-flex items-center gap-1"><Users size={10} /> {audienceLabel(a)}</span>
                      {a.broadcast_at && <span className="text-[10px] text-ink-muted/70 flex-shrink-0">diffusée {fmt(a.broadcast_at)}</span>}
                    </div>
                    <p className="text-ink-muted text-xs mt-0.5 line-clamp-2">{a.body}</p>
                  </div>
                  <button onClick={() => showStats(a)} className="text-xs text-ink-muted hover:text-brand flex items-center gap-1 flex-shrink-0" title="Qui a lu">
                    <Eye size={14} /> {a.read}/{scope}
                  </button>
                </div>

                <div className="w-full h-1.5 rounded-full bg-bg overflow-hidden my-3">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setEditing({ id: a.id, emoji: a.emoji, title: a.title, body: a.body, action_url: a.action_url, cta_label: a.cta_label, active: a.active, audience: a.audience, target_user_ids: a.target_user_ids || [], scheduled_at: toLocalInput(a.scheduled_at) })}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border hover:bg-bg"><Pencil size={13} /> Éditer</button>
                  <button onClick={() => toggle(a)} disabled={busy === 'tg:' + a.id}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border hover:bg-bg disabled:opacity-50"><Power size={13} /> {a.active ? 'Désactiver' : 'Activer'}</button>
                  <button onClick={() => test(a)} disabled={busy === 'test:' + a.id}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-brand/40 text-brand hover:bg-brand/5 disabled:opacity-50"><TestTube size={13} /> {busy === 'test:' + a.id ? '…' : 'Test à moi'}</button>
                  <button onClick={() => broadcast(a)} disabled={busy === 'bc:' + a.id}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-50"><Send size={13} /> {busy === 'bc:' + a.id ? '…' : (pending ? 'Diffuser maintenant' : `Diffuser (${scope})`)}</button>
                  <button onClick={() => del(a)} disabled={busy === 'del:' + a.id}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border text-ink-muted hover:text-red-500 hover:border-red-300 ml-auto disabled:opacity-50"><Trash2 size={13} /></button>
                </div>

                {statsFor === a.id && (
                  <div className="mt-3 border-t pt-3">
                    <div className="divide-y">
                      {targets.map((t, i) => (
                        <div key={i} className="flex items-center justify-between py-1.5 text-sm">
                          <span className="text-ink flex items-center gap-2">
                            {t.seen_at ? <Check size={14} className="text-emerald-500" /> : <Clock size={14} className="text-ink-muted/50" />}{t.name}
                          </span>
                          <span className="text-ink-muted/70 text-xs">{t.seen_at ? fmt(t.seen_at) : 'pas encore'}</span>
                        </div>
                      ))}
                      {!targets.length && <p className="text-ink-muted text-xs py-2">Chargement…</p>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </AppShell>
  )
}
