'use client'

// Écran de validation de l'agent mail.
//
// Principe : l'agent n'agit jamais en silence. Chaque mail traité affiche ce
// qu'il a lu, ce qu'il compte faire, et ce que les garde-fous ont dit. Un item
// bloqué explique POURQUOI en clair — pas de statut technique, l'écran est lu
// par Jona et Momo, pas par un développeur.

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'

interface Item {
  id: string
  status: string
  subject: string | null
  from_email: string | null
  received_at: string | null
  blocked_reason: string | null
  extracted: any
  odoo_move_id: number | null
  odoo_move_name: string | null
  target_partner_name: string | null
  credit_note_name: string | null
  new_invoice_id: number | null
  new_invoice_name: string | null
  mail_moved: boolean
  error: string | null
}

const TABS: { key: string; label: string }[] = [
  { key: 'ready',     label: 'À valider' },
  { key: 'blocked',   label: 'Bloqués' },
  { key: 'to_verify', label: 'À vérifier' },
  { key: 'applied',   label: 'Traités' },
  { key: 'all',       label: 'Tous' },
]

const BADGE: Record<string, string> = {
  ready:     'bg-emerald-100 text-emerald-800',
  blocked:   'bg-amber-100 text-amber-800',
  to_verify: 'bg-sky-100 text-sky-800',
  applied:   'bg-slate-200 text-slate-800',
  ignored:   'bg-slate-100 text-slate-600',
  error:     'bg-red-100 text-red-800',
  pending:   'bg-slate-100 text-slate-600',
}

const LABEL: Record<string, string> = {
  ready: 'Prêt', blocked: 'Bloqué', to_verify: 'À vérifier',
  applied: 'Traité', ignored: 'Ignoré', error: 'Erreur', pending: 'En attente',
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

const eur = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

interface Props {
  isSuperadmin: boolean
  canApply:     boolean
  odooBase:     string
  userRole:     string
  userName:     string
  userEmail:    string
  userModules:  string[]
}

export default function MailAgentClient({
  isSuperadmin, canApply, odooBase, userRole, userName, userEmail, userModules,
}: Props) {
  const [tab, setTab]         = useState('ready')
  const [items, setItems]     = useState<Item[]>([])
  const [counts, setCounts]   = useState<Record<string, number>>({})
  const [mode, setMode]       = useState<'draft' | 'auto'>('draft')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)
  const [flash, setFlash]     = useState<string | null>(null)

  const load = async (t = tab) => {
    setLoading(true)
    const res = await fetch(`/api/mail-agent/items?status=${t}`, { cache: 'no-store' })
    const j   = await res.json()
    setItems(j.items || []); setCounts(j.counts || {}); setMode(j.mode || 'draft')
    setLoading(false)
  }
  useEffect(() => { load(tab) /* eslint-disable-next-line */ }, [tab])

  const scan = async () => {
    setBusy('scan'); setFlash(null)
    const r = await (await fetch('/api/mail-agent/scan', { method: 'POST' })).json()
    setBusy(null)
    setFlash(r.error ? `Erreur : ${r.error}`
      : `${r.scanned} mails lus · ${r.captured} pris en charge · ${r.ready} prêts · ${r.blocked} bloqués · ${r.toVerify} à vérifier`)
    load()
  }

  const apply = async (id: string) => {
    setBusy(id); setFlash(null)
    const r = await (await fetch(`/api/mail-agent/${id}/apply`, { method: 'POST' })).json()
    setBusy(null)
    setFlash(r.ok
      ? `Note de crédit ${r.creditNoteName || '?'} · nouvelle facture ${r.newInvoiceName || '?'} en brouillon`
        + (r.warnings?.length ? ` ⚠ ${r.warnings.join(' · ')}` : '')
      : `Non appliqué : ${r.error}`)
    load()
  }

  const ignore = async (id: string) => {
    setBusy(id)
    await fetch(`/api/mail-agent/${id}/ignore`, { method: 'POST' })
    setBusy(null); load()
  }

  const toggleMode = async () => {
    const next = mode === 'draft' ? 'auto' : 'draft'
    const r = await (await fetch('/api/mail-agent/mode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    })).json()
    if (r.ok) { setMode(next); setFlash(next === 'auto'
      ? "Mode automatique activé : l'agent appliquera seul les cas entièrement verts."
      : 'Mode brouillon rétabli : chaque cas attend une validation humaine.') }
  }

  const odooLink = (id: number | null) =>
    id && odooBase ? `${odooBase}/web#id=${id}&model=account.move&view_type=form` : null

  return (
    <AppShell title="Agent Mail" backHref="/admin"
      userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-5xl mx-auto p-4 space-y-4">

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-600">
              Rejets de facture reçus dans <strong>info@</strong> › « 0 - Jona et Mobi »
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSuperadmin && (
              <button onClick={toggleMode}
                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                  mode === 'auto'
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-slate-100 text-slate-700 border-slate-300'}`}>
                {mode === 'auto' ? 'Mode : automatique' : 'Mode : brouillon'}
              </button>
            )}
            <button onClick={scan} disabled={busy === 'scan'}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white disabled:opacity-50">
              {busy === 'scan' ? 'Analyse…' : 'Analyser les mails'}
            </button>
          </div>
        </div>

        {mode === 'draft' && (
          <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
            L'agent prépare, il ne valide pas. « Appliquer » lance dans Odoo la manip
            « Créditer et facturer » : la note de crédit est comptabilisée et lettrée
            avec la facture d'origine, et la <strong>nouvelle facture reste en brouillon</strong>,
            adressée à la bonne entité — à toi de la relire, de la comptabiliser et de l'envoyer.
          </p>
        )}

        {flash && (
          <div className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded-lg p-3">{flash}</div>
        )}

        <div className="flex gap-1 flex-wrap">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                tab === t.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>
              {t.label}{counts[t.key] != null && t.key !== 'all' ? ` (${counts[t.key]})` : ''}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-slate-500 py-8 text-center">Chargement…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">
            Rien dans cette file. Clique sur « Analyser les mails » pour relire le dossier.
          </p>
        ) : items.map(it => {
          const x = it.extracted || {}
          return (
            <div key={it.id} className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate">{it.subject || '(sans objet)'}</p>
                  <p className="text-xs text-slate-500">{it.from_email} · {fmt(it.received_at)}</p>
                </div>
                <span className={`shrink-0 px-2 py-1 rounded text-xs font-medium ${BADGE[it.status] || BADGE.pending}`}>
                  {LABEL[it.status] || it.status}
                </span>
              </div>

              {x.invoiceNumber && (
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <p><span className="text-slate-500">Facture rejetée</span> <strong className="text-slate-900">{x.invoiceNumber}</strong> — {eur(x.amount)}</p>
                  <p><span className="text-slate-500">À réadresser à</span> <strong className="text-slate-900">{it.target_partner_name || x.entityLabel}</strong></p>
                  <p><span className="text-slate-500">Référence client</span> <strong className="text-slate-900">{x.odooRef || x.mailReference || '—'}</strong></p>
                  <p><span className="text-slate-500">TVA</span> <strong className="text-slate-900">{x.zeroVat ? 'à retirer (autoliquidation)' : 'inchangée (21 %)'}</strong></p>
                  {x.reason && <p className="sm:col-span-2 text-slate-600 italic">« {x.reason} »</p>}
                </div>
              )}

              {it.blocked_reason && (
                <p className={`text-sm rounded-lg p-2 ${
                  it.status === 'applied'
                    ? 'bg-amber-50 border border-amber-200 text-amber-900'
                    : 'bg-amber-50 border border-amber-200 text-amber-900'}`}>
                  {it.status === 'applied' ? '⚠ ' : ''}{it.blocked_reason}
                </p>
              )}
              {it.error && (
                <p className="text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg p-2">{it.error}</p>
              )}

              {it.status === 'applied' && (
                <p className="text-sm text-slate-700">
                  Note de crédit <strong>{it.credit_note_name || '?'}</strong> ·
                  {' '}nouvelle facture{' '}
                  {odooLink(it.new_invoice_id)
                    ? <a className="underline font-medium" href={odooLink(it.new_invoice_id)!} target="_blank" rel="noreferrer">{it.new_invoice_name}</a>
                    : <strong>{it.new_invoice_name || '?'}</strong>}
                  {' '}en brouillon{it.mail_moved ? ' · mail classé' : ' · mail non déplacé'}
                </p>
              )}

              {(it.status === 'ready' || it.status === 'blocked' || it.status === 'to_verify') && (
                <div className="flex gap-2 pt-1">
                  {it.status === 'ready' && canApply && (
                    <button onClick={() => apply(it.id)} disabled={busy === it.id}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white disabled:opacity-50">
                      {busy === it.id ? 'Application…' : 'Appliquer'}
                    </button>
                  )}
                  {odooLink(it.odoo_move_id) && (
                    <a href={odooLink(it.odoo_move_id)!} target="_blank" rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-700">
                      Ouvrir dans Odoo
                    </a>
                  )}
                  <button onClick={() => ignore(it.id)} disabled={busy === it.id}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 disabled:opacity-50">
                    Ignorer
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </AppShell>
  )
}
