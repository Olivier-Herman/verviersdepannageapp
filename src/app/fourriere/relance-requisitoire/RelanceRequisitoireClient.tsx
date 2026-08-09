'use client'

// Tableau de suivi des réquisitoires manquants + relance (fourrière).
// Indicateur email policier (Odoo) : ✅ connu / ⚠️ à compléter. Boutons :
// Envoyer relance · Copier le lien de dépôt · Stop rappel · Voir la fiche.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import OfficerAutocomplete from '@/components/missions/OfficerAutocomplete'

interface Item {
  id: string; ref: string | null; plate: string | null; vehicle: string | null
  location: string | null; saisie_at: string | null; zone: string | null
  zone_company_id: number | null
  officer_name: string | null; officer_email: string | null; officer_linked: boolean
  token: string | null; stop: boolean; reminder_count: number; last_reminder_at: string | null
}

const fmt = (iso?: string | null) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit' }) } catch { return '—' }
}
const daysSince = (iso?: string | null) => {
  if (!iso) return null
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return isNaN(d) ? null : d
}
const fmtDT = (iso?: string | null) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '—' }
}

type Send = { at: string; email: string | null }

export default function RelanceRequisitoireClient({ initialItems, appUrl }: { initialItems: Item[]; appUrl: string }) {
  const [items, setItems]     = useState<Item[]>(initialItems)
  const [showStop, setShowStop] = useState(false)
  const [busy, setBusy]       = useState<string | null>(null)
  const [flash, setFlash]     = useState<{ id: string; msg: string; ok: boolean } | null>(null)
  // Édition du policier depuis la carte (lier un contact existant ou en créer un).
  const [editing, setEditing]     = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm]           = useState<{ name: string; email: string; phone: string }>({ name: '', email: '', phone: '' })
  // Historique des envois par dossier (déplié à la demande, source = logs).
  const [histOpen, setHistOpen]   = useState<string | null>(null)
  const [hist, setHist]           = useState<Record<string, Send[] | 'loading'>>({})

  const visible = useMemo(() => items.filter(i => showStop || !i.stop), [items, showStop])
  const stats = useMemo(() => ({
    total: items.filter(i => !i.stop).length,
    sansEmail: items.filter(i => !i.stop && !i.officer_email).length,
  }), [items])

  const note = (id: string, msg: string, ok: boolean) => { setFlash({ id, msg, ok }); setTimeout(() => setFlash(f => f?.id === id ? null : f), 4000) }

  const loadHistory = async (id: string) => {
    setHist(h => ({ ...h, [id]: 'loading' }))
    try {
      const r = await fetch(`/api/missions/${id}/requisitoire-history`)
      const j = await r.json()
      setHist(h => ({ ...h, [id]: Array.isArray(j.history) ? j.history : [] }))
    } catch { setHist(h => ({ ...h, [id]: [] })) }
  }
  const toggleHistory = (it: Item) => {
    if (histOpen === it.id) { setHistOpen(null); return }
    setHistOpen(it.id)
    if (hist[it.id] === undefined) loadHistory(it.id)
  }

  const sendRelance = async (it: Item) => {
    setBusy(it.id)
    try {
      const r = await fetch(`/api/missions/${it.id}/requisitoire-relance`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Erreur')
      setItems(prev => prev.map(x => x.id === it.id ? { ...x, reminder_count: x.reminder_count + 1, last_reminder_at: new Date().toISOString() } : x))
      note(it.id, `Relance envoyée à ${j.email}`, true)
      // La carte s'alimente de l'historique réel : on recharge si ouvert, sinon on
      // invalide le cache pour un rechargement au prochain déploiement.
      if (histOpen === it.id) loadHistory(it.id)
      else setHist(h => { const n = { ...h }; delete n[it.id]; return n })
    } catch (e: any) { note(it.id, e?.message || 'Échec', false) } finally { setBusy(null) }
  }

  const toggleStop = async (it: Item) => {
    setBusy(it.id)
    try {
      const r = await fetch(`/api/missions/${it.id}/requisitoire-relance`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stop: !it.stop }),
      })
      if (!r.ok) throw new Error()
      setItems(prev => prev.map(x => x.id === it.id ? { ...x, stop: !x.stop } : x))
    } catch { note(it.id, 'Échec', false) } finally { setBusy(null) }
  }

  // Copie robuste : clipboard API, sinon execCommand (fonctionne après un await),
  // sinon prompt manuel. navigator.clipboard échoue souvent après un fetch (le
  // « geste utilisateur » est consommé) → d'où le fallback.
  const doCopy = async (text: string): Promise<boolean> => {
    try { await navigator.clipboard.writeText(text); return true } catch { /* fallback */ }
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.focus(); ta.select()
      const ok = document.execCommand('copy'); document.body.removeChild(ta)
      return ok
    } catch { return false }
  }

  const copyLink = async (it: Item) => {
    try {
      let link = it.token ? `${appUrl}/requisitoire/${it.token}` : ''
      if (!link) {
        const r = await fetch(`/api/missions/${it.id}/requisitoire-relance`, { method: 'GET' })
        const j = await r.json()
        if (!r.ok || !j.link) throw new Error('link')
        link = j.link
        setItems(prev => prev.map(x => x.id === it.id ? { ...x, token: j.token } : x))
      }
      const ok = await doCopy(link)
      if (ok) note(it.id, 'Lien copié', true)
      else { window.prompt('Copiez le lien de dépôt :', link); note(it.id, 'Lien affiché', true) }
    } catch { note(it.id, 'Lien indisponible', false) }
  }

  const openEditor = (it: Item) => {
    setEditing(it.id); setDraftName(''); setShowCreate(false)
    setForm({ name: it.officer_name || '', email: '', phone: '' })
  }
  const applyOfficer = (id: string, patch: Partial<Item>) =>
    setItems(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x))

  // Lie un contact Odoo existant (l'endpoint relit nom + email côté Odoo).
  const linkOfficer = async (it: Item, partnerId: number) => {
    setBusy(it.id)
    try {
      const r = await fetch(`/api/missions/${it.id}/officer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_id: partnerId }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Erreur')
      applyOfficer(it.id, { officer_name: j.officer_name, officer_email: j.email, officer_linked: true })
      note(it.id, j.email ? 'Policier lié — email connu' : 'Policier lié (contact sans email)', !!j.email)
      setEditing(null)
    } catch (e: any) { note(it.id, e?.message || 'Échec', false) } finally { setBusy(null) }
  }

  // Crée le contact policier (sous la société = zone) puis le lie.
  const createOfficer = async (it: Item) => {
    if (!form.name.trim()) { note(it.id, 'Nom du policier requis', false); return }
    setBusy(it.id)
    try {
      const r = await fetch(`/api/missions/${it.id}/officer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ create: true, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), company_id: it.zone_company_id }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Erreur')
      applyOfficer(it.id, { officer_name: j.officer_name, officer_email: j.email, officer_linked: true })
      note(it.id, j.email ? 'Policier créé — email connu' : 'Policier créé (sans email)', true)
      setEditing(null)
    } catch (e: any) { note(it.id, e?.message || 'Échec', false) } finally { setBusy(null) }
  }

  const inputCls = 'w-full bg-surface-2 border border-app rounded-lg px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand'

  return (
    <div className="min-h-screen bg-surface max-w-5xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border-app px-5 pt-12 pb-4">
        <div className="flex items-center gap-3">
          <Link href="/fourriere" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">📨 Relance réquisitoires</h1>
            <p className="text-ink-muted text-xs">Saisies sans réquisitoire reçu. Relance par mail au policier (depuis fourriere@) + lien de dépôt.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 py-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-ink-secondary">
            <span className="font-semibold text-ink">{stats.total}</span> en attente
            {stats.sansEmail > 0 && <span className="text-amber-600"> · {stats.sansEmail} sans email policier</span>}
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-secondary">
            <input type="checkbox" checked={showStop} onChange={e => setShowStop(e.target.checked)} />
            Afficher les stoppés
          </label>
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-ink-muted italic py-8 text-center">Aucune saisie en attente de réquisitoire. 🎉</p>
        ) : (
          <div className="space-y-2">
            {visible.map(it => {
              const d = daysSince(it.saisie_at)
              const lastD = daysSince(it.last_reminder_at)
              return (
                <div key={it.id} className={`bg-surface-2 border border-app rounded-2xl p-3 ${it.stop ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-ink bg-surface border border-app rounded-lg px-2 py-0.5 text-sm">{it.plate || '—'}</span>
                        {it.ref && <span className="text-xs text-ink-muted">{it.ref}</span>}
                        {d != null && <span className={`text-xs px-1.5 py-0.5 rounded ${d >= 3 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>saisie il y a {d} j</span>}
                        {it.stop && <span className="text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">⏸ stoppé</span>}
                      </div>
                      <div className="text-sm text-ink mt-1">{it.vehicle || '—'}{it.location ? <span className="text-ink-muted"> · {it.location}</span> : ''}</div>
                      <div className="text-xs mt-1 flex items-center gap-2 flex-wrap">
                        <span className="text-ink-muted">👮 {it.officer_name || '—'}{it.zone ? ` (${it.zone})` : ''}</span>
                        {it.officer_email
                          ? <span className="text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5" title={it.officer_email}>✅ email connu</span>
                          : it.officer_linked
                            ? <span className="text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">⚠️ contact Odoo sans email</span>
                            : <span className="text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">⚠️ policier non lié à Odoo</span>}
                        <button onClick={() => editing === it.id ? setEditing(null) : openEditor(it)}
                          className="text-brand hover:underline">{editing === it.id ? 'Fermer' : '✏️ Modifier'}</button>
                      </div>

                      {editing === it.id && (
                        <div className="mt-2 p-2.5 bg-surface border border-app rounded-xl space-y-2 max-w-md">
                          <OfficerAutocomplete
                            label="Rechercher et lier un policier existant"
                            value={draftName}
                            onChange={setDraftName}
                            onPickPartner={(pid) => { if (pid != null) linkOfficer(it, pid) }}
                            companyId={it.zone_company_id} />
                          {!it.zone_company_id && (
                            <p className="text-[11px] text-amber-600">Zone sans société Odoo liée — la recherche ne renverra rien, mais tu peux créer le contact ci-dessous.</p>
                          )}
                          <button onClick={() => { setShowCreate(s => !s); setForm(f => ({ ...f, name: draftName || f.name })) }}
                            className="text-xs text-brand hover:underline">＋ Ajouter un nouveau policier</button>
                          {showCreate && (
                            <div className="space-y-1.5 pt-1">
                              <input className={inputCls} placeholder="Nom du policier *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                              <input className={inputCls} placeholder="Email (pour recevoir la relance)" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                              <input className={inputCls} placeholder="Téléphone (optionnel)" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                              <div className="flex gap-1.5 pt-0.5">
                                <button onClick={() => createOfficer(it)} disabled={busy === it.id || !form.name.trim()}
                                  className="px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-semibold disabled:opacity-40">
                                  {busy === it.id ? '…' : 'Ajouter & lier'}
                                </button>
                                <button onClick={() => setEditing(null)} className="px-3 py-1.5 bg-surface-2 border border-app rounded-lg text-xs text-ink-muted">Annuler</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {it.reminder_count > 0 && (
                        <div className="mt-1">
                          <button onClick={() => toggleHistory(it)} className="text-xs text-ink-muted hover:text-ink flex items-center gap-1">
                            <span className="text-[10px]">{histOpen === it.id ? '▾' : '▸'}</span>
                            {it.reminder_count} relance(s){lastD != null ? ` · dernière il y a ${lastD} j` : ''}
                          </button>
                          {histOpen === it.id && (
                            <div className="mt-1 ml-2 pl-2.5 border-l-2 border-app space-y-0.5">
                              {hist[it.id] === 'loading' || hist[it.id] === undefined
                                ? <div className="text-[11px] text-ink-muted italic">Chargement…</div>
                                : (hist[it.id] as Send[]).length === 0
                                  ? <div className="text-[11px] text-ink-muted italic">Aucun envoi enregistré.</div>
                                  : (hist[it.id] as Send[]).map((s, i) => (
                                      <div key={i} className="text-[11px] text-ink-muted flex items-center gap-1.5">
                                        <span className="font-medium text-ink-secondary tabular-nums">{fmtDT(s.at)}</span>
                                        {s.email ? <span className="text-ink-muted">→ {s.email}</span> : <span className="text-amber-600">→ (email inconnu)</span>}
                                      </div>
                                    ))}
                            </div>
                          )}
                        </div>
                      )}
                      {flash?.id === it.id && <div className={`text-xs mt-1 ${flash.ok ? 'text-emerald-600' : 'text-critical'}`}>{flash.ok ? '✓' : '⚠'} {flash.msg}</div>}
                    </div>

                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button onClick={() => sendRelance(it)} disabled={busy === it.id || !it.officer_email || it.stop}
                        className="px-3 py-1.5 bg-brand text-white rounded-xl text-xs font-semibold disabled:opacity-40"
                        title={!it.officer_email ? 'Email policier inconnu (compléter le contact Odoo)' : 'Envoyer une relance au policier'}>
                        {busy === it.id ? '…' : it.reminder_count > 0 ? '↻ Relancer' : '✉ Envoyer relance'}
                      </button>
                      <button onClick={() => copyLink(it)} className="px-3 py-1.5 bg-surface border border-app rounded-xl text-xs text-ink-secondary">🔗 Copier le lien</button>
                      <div className="flex gap-1.5">
                        <button onClick={() => toggleStop(it)} disabled={busy === it.id}
                          className="flex-1 px-2 py-1.5 bg-surface border border-app rounded-xl text-xs text-ink-muted">{it.stop ? 'Réactiver' : 'Stop'}</button>
                        <Link href={`/dispatch/${it.id}`} className="flex-1 px-2 py-1.5 bg-surface border border-app rounded-xl text-xs text-ink-secondary text-center">Fiche</Link>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
