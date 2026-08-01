'use client'
// src/app/personnel/annonces/AnnoncesClient.tsx
//
// Console Annonces (superadmin) : éditer la nouveauté, l'envoyer en test (à moi,
// pour vérifier le push natif) ou la diffuser à tous les travailleurs, et suivre
// qui l'a lue.

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { Megaphone, Send, TestTube, Save, Check, Eye, Clock, Users } from 'lucide-react'

export default function AnnoncesClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [ann, setAnn]     = useState<any>(null)
  const [targets, setTargets] = useState<any[]>([])
  const [stat, setStat]   = useState<{ total: number; read: number }>({ total: 0, read: 0 })
  const [busy, setBusy]   = useState('')
  const [msg, setMsg]     = useState('')

  const load = () => fetch('/api/announcements?stats=1', { cache: 'no-store' }).then(r => r.json())
    .then(d => { setAnn(d.announcement); setTargets(d.targets || []); setStat({ total: d.total || 0, read: d.read || 0 }) })

  useEffect(() => { load() }, [])

  const set = (k: string, v: any) => setAnn((a: any) => ({ ...a, [k]: v }))

  const post = async (payload: any, label: string) => {
    setBusy(label); setMsg('')
    try {
      const r = await fetch('/api/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await r.json()
      if (!r.ok) { setMsg('❌ ' + (d.error || 'Erreur')); return }
      if (payload.action === 'test')      setMsg(`✅ Test envoyé à toi (${d.sent}/${d.targeted}). Regarde ton iPhone pour le push natif.`)
      if (payload.action === 'broadcast') setMsg(`✅ Diffusé à ${d.sent}/${d.targeted} travailleur(s).`)
      if (payload.action === 'save')      setMsg('✅ Annonce enregistrée.')
      await load()
    } catch { setMsg('❌ Erreur réseau') } finally { setBusy('') }
  }

  const save      = () => post({ action: 'save', key: ann.key, emoji: ann.emoji, title: ann.title, body: ann.body, action_url: ann.action_url, cta_label: ann.cta_label, active: ann.active }, 'save')
  const test      = () => post({ action: 'test', key: ann.key }, 'test')
  const broadcast = () => { if (confirm(`Diffuser « ${ann.title} » à TOUS les travailleurs liés (${stat.total}) ?\n\nIls recevront la notif (in-app + push) et le modal à l'ouverture.`)) post({ action: 'broadcast', key: ann.key }, 'broadcast') }

  const fmt = (s: string) => s ? new Date(s).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
  const pct = stat.total ? Math.round((stat.read / stat.total) * 100) : 0

  return (
    <AppShell title="Annonces" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-brand/10 text-brand flex items-center justify-center"><Megaphone size={22} /></div>
          <div>
            <h1 className="text-2xl font-bold text-ink leading-tight">Annonces</h1>
            <p className="text-ink-muted text-sm">Pousse une nouveauté aux travailleurs et suis qui l'a lue.</p>
          </div>
        </div>

        {!ann ? (
          <p className="text-ink-muted text-sm">Aucune annonce.</p>
        ) : (
          <div className="space-y-6">
            {/* Édition */}
            <div className="bg-surface border rounded-2xl p-5 space-y-3">
              <div className="flex gap-3">
                <label className="block w-20">
                  <span className="text-ink-muted text-xs">Emoji</span>
                  <input value={ann.emoji || ''} onChange={e => set('emoji', e.target.value)} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-center text-lg" />
                </label>
                <label className="block flex-1">
                  <span className="text-ink-muted text-xs">Titre</span>
                  <input value={ann.title || ''} onChange={e => set('title', e.target.value)} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink" />
                </label>
              </div>
              <label className="block">
                <span className="text-ink-muted text-xs">Message</span>
                <textarea value={ann.body || ''} onChange={e => set('body', e.target.value)} rows={4} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink resize-none" />
              </label>
              <div className="flex gap-3">
                <label className="block flex-1">
                  <span className="text-ink-muted text-xs">Lien du bouton</span>
                  <input value={ann.action_url || ''} onChange={e => set('action_url', e.target.value)} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink font-mono" />
                </label>
                <label className="block flex-1">
                  <span className="text-ink-muted text-xs">Texte du bouton</span>
                  <input value={ann.cta_label || ''} onChange={e => set('cta_label', e.target.value)} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink" />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink pt-1">
                <input type="checkbox" checked={ann.active !== false} onChange={e => set('active', e.target.checked)} />
                Active (le modal s'affiche aux travailleurs non-lecteurs)
              </label>

              <div className="flex flex-wrap gap-2 pt-2">
                <button onClick={save} disabled={!!busy} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border hover:bg-bg disabled:opacity-50">
                  <Save size={15} /> {busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}
                </button>
                <button onClick={test} disabled={!!busy} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border border-brand/40 text-brand hover:bg-brand/5 disabled:opacity-50">
                  <TestTube size={15} /> {busy === 'test' ? 'Envoi…' : 'M\'envoyer un test'}
                </button>
                <button onClick={broadcast} disabled={!!busy} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-50">
                  <Send size={15} /> {busy === 'broadcast' ? 'Diffusion…' : `Diffuser à tous (${stat.total})`}
                </button>
              </div>
              {msg && <p className="text-sm pt-1">{msg}</p>}
            </div>

            {/* Suivi de lecture */}
            <div className="bg-surface border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink flex items-center gap-2"><Eye size={17} /> Qui a lu ?</h2>
                <span className="text-sm text-ink-muted">{stat.read}/{stat.total} lu · {pct}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-bg overflow-hidden mb-4">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="divide-y">
                {targets.map((t, i) => (
                  <div key={i} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink flex items-center gap-2">
                      {t.seen_at ? <Check size={15} className="text-emerald-500" /> : <Clock size={15} className="text-ink-muted/50" />}
                      {t.name}
                    </span>
                    <span className={t.seen_at ? 'text-ink-muted text-xs' : 'text-ink-muted/50 text-xs'}>{t.seen_at ? fmt(t.seen_at) : 'pas encore'}</span>
                  </div>
                ))}
                {!targets.length && <p className="text-ink-muted text-sm py-2 flex items-center gap-2"><Users size={15} /> Aucun travailleur lié.</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
