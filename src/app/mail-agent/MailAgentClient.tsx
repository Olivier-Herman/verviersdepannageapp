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
  handler?: string
  mailbox?: string
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
  { key: 'to_decide', label: 'À décider' },
  { key: 'ready',     label: 'À valider' },
  { key: 'blocked',   label: 'Bloqués' },
  { key: 'to_verify', label: 'À vérifier' },
  { key: 'applied',   label: 'Traités' },
  { key: 'decided',   label: 'Décidés' },
  { key: 'all',       label: 'Tous' },
]

const BADGE: Record<string, string> = {
  to_decide: 'bg-violet-100 text-violet-800',
  decided:   'bg-slate-200 text-slate-800',
  ready:     'bg-emerald-100 text-emerald-800',
  blocked:   'bg-amber-100 text-amber-800',
  to_verify: 'bg-sky-100 text-sky-800',
  applied:   'bg-slate-200 text-slate-800',
  ignored:   'bg-slate-100 text-slate-600',
  error:     'bg-red-100 text-red-800',
  pending:   'bg-slate-100 text-slate-600',
}

const LABEL: Record<string, string> = {
  to_decide: 'À décider', decided: 'Décidé', ready: 'Prêt', blocked: 'Bloqué', to_verify: 'À vérifier',
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
  const [tab, setTab]         = useState('to_decide')
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
      : `${r.scanned} mails lus · ${r.captured} pris en charge · ${r.toDecide || 0} à décider · ${r.ready} prêts · ${r.blocked} bloqués · ${r.toVerify} à vérifier`)
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

  const FAMILY_LABEL: Record<string, string> = { demande_avoir: 'Demande de note de crédit', demande_document: 'Demande de facture ou de document', double_paiement: 'Double paiement / remboursement', rappel_paiement: 'Rappel de paiement reçu', question_compta: 'Question comptable', reclamation: 'Réclamation client', contestation: 'Contestation de facture', info: 'Information', autre: 'Autre' }
  const FILE_FOLDERS = ['0 - Jona et Mobi', 'Fournisseur Divers', 'Mail auto-géré', 'clients divers', 'comptable thg']
  const [folderFor, setFolderFor] = useState<string | null>(null)
  const [invFor, setInvFor] = useState<Record<string, string>>({})
  const [coFor, setCoFor] = useState<Record<string, string>>({})
  const decide = async (id: string, action: string, folder?: string) => {
    setBusy(id); setFlash(null)
    const r = await (await fetch(`/api/mail-agent/${id}/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, folder, invoice: invFor[id] || null, company: coFor[id] || null }) })).json()
    setBusy(null); setFolderFor(null)
    setFlash(r.ok ? (action === 'classer' ? `Mail classé dans « ${folder} »` : action === 'laisser' ? 'Laissé' : action === 'fait_ailleurs' ? 'Marqué fait ailleurs' : `✓ ${r.note}`) : `Refusé : ${r.error}`)
    load()
  }
  const [auto, setAuto] = useState<{ auto: Record<string, string | null>; stats: Record<string, { action: string; count: number }[]>; families: Record<string, string>; proposals: Record<string, { key: string; label: string }[]> } | null>(null)
  const [autoOpen, setAutoOpen] = useState(false)
  const loadAuto = async () => { try { const j = await (await fetch('/api/mail-agent/auto', { cache: 'no-store' })).json(); if (!j.error) setAuto(j) } catch {} }
  useEffect(() => { loadAuto() }, [])
  const setAutoFamily = async (family: string, action: string | null) => {
    const r = await (await fetch('/api/mail-agent/auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ family, action }) })).json()
    if (r.error) setFlash(`Refusé : ${r.error}`); else { setFlash(action ? `${auto?.families[family]} : automatique (${action})` : `${auto?.families[family]} : manuel`); loadAuto() }
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
    <AppShell title="Agent Mail" backHref="/dashboard"
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

        {auto && (
          <div className="border border-slate-200 rounded-xl bg-white">
            <button onClick={() => setAutoOpen(o => !o)} className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-800 flex justify-between items-center">
              <span>Automatisation par famille {Object.values(auto.auto).filter(Boolean).length ? `· ${Object.values(auto.auto).filter(Boolean).length} en automatique` : '· tout en manuel'}</span><span className="text-slate-400">{autoOpen ? '▾' : '▸'}</span>
            </button>
            {autoOpen && (
              <div className="px-4 pb-3 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {Object.entries(auto.families).filter(([k]) => k !== 'info').map(([k, label]) => {
                  const st = auto.stats[k] || []; const top = st[0]; const cur = auto.auto[k] || ''
                  const opts = [...(auto.proposals[k] || []), { key: 'classer', label: 'Classer (Mail auto-géré)' }]
                  return (
                    <div key={k} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5">
                      <div className="min-w-0"><p className="text-slate-800">{label}</p><p className="text-xs text-slate-500">{top ? `${top.count} décision${top.count > 1 ? 's' : ''} « ${opts.find(o => o.key === top.action)?.label || top.action} »${top.count >= 10 && !cur ? ' · prêt pour l\'automatique' : ''}` : 'aucune décision encore'}</p></div>
                      <select value={cur} disabled={!isSuperadmin} onChange={e => setAutoFamily(k, e.target.value || null)} className="border rounded-lg px-2 py-1 text-xs bg-white disabled:opacity-60">
                        <option value="">Manuel</option>
                        {opts.map(o => <option key={o.key} value={o.key}>Auto : {o.label}</option>)}
                      </select>
                    </div>
                  )
                })}
                <p className="sm:col-span-2 text-xs text-slate-500">En automatique, l'action part au triage avec le mode courant ({mode === 'auto' ? 'envoi direct' : 'brouillons'}). Les réponses rédigées restent toujours des brouillons.</p>
              </div>
            )}
          </div>
        )}
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

              {it.handler === 'triage' && (
                <div className="space-y-2 text-sm">
                  <p><span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-violet-50 text-violet-800 border border-violet-200">{FAMILY_LABEL[x.family] || x.family}</span>{x.urgent && <span className="ml-2 px-2 py-0.5 rounded-md text-xs font-semibold bg-red-50 text-red-700 border border-red-200">urgent</span>}{it.mailbox && <span className="ml-2 text-xs text-slate-500">{it.mailbox.split('@')[0]}@</span>}</p>
                  <p className="text-slate-800">{x.summary}</p>
                  {x.asked && <p className="text-slate-600">Attendu : <strong className="text-slate-900">{x.asked}</strong></p>}
                  {(x.facts?.invoices || []).length > 0 && (
                    <ul className="text-slate-700 list-disc pl-5">
                      {x.facts.invoices.map((i: any, k: number) => <li key={k}>{i.missing ? <>Facture <strong>{i.name}</strong> : introuvable dans Odoo</> : <>Facture <strong>{i.name}</strong> · {i.partner} · {eur(i.amount_total)} · {i.state === 'posted' ? (i.payment_state === 'paid' ? 'payée' : i.payment_state === 'reversed' ? 'annulée par avoir' : 'impayée') : i.state}{i.has_credit_note ? ' · avoir existant' : ''}{i.plate ? ` · ${i.plate}` : ''}{odooLink(i.id) ? <> · <a className="underline" href={odooLink(i.id)!} target="_blank" rel="noreferrer">Odoo</a></> : null}</>}</li>)}
                    </ul>
                  )}
                  {(x.facts?.fiches || []).length > 0 && (
                    <ul className="text-slate-700 list-disc pl-5">
                      {x.facts.fiches.map((f: any, k: number) => <li key={k}>{f.plate} · <a className="underline" href={`/dispatch/${f.id}`} target="_blank" rel="noreferrer">fiche {f.number}</a> · {f.source} · {f.status}{f.invoice ? ` · facture ${f.invoice}` : ''}{f.client ? ` · ${f.client}` : ''}</li>)}
                    </ul>
                  )}
                  {(x.facts?.invoices || []).length === 0 && (x.facts?.fiches || []).length === 0 && <p className="text-xs text-slate-500">Aucune facture ni fiche reconnue dans ce mail.</p>}
                  {it.status === 'to_decide' && (x.facts?.invoices || []).filter((i: any) => !i.missing).length > 1 && (
                    <label className="text-xs text-slate-600 flex items-center gap-2">Facture concernée
                      <select value={invFor[it.id] || ''} onChange={e => setInvFor(p => ({ ...p, [it.id]: e.target.value }))} className="border rounded-lg px-2 py-1 text-xs bg-white">
                        <option value="">— choisir —</option>
                        {x.facts.invoices.filter((i: any) => !i.missing).map((i: any) => <option key={i.name} value={i.name}>{i.name} · {eur(i.amount_total)}</option>)}
                      </select>
                    </label>
                  )}
                  {it.status === 'to_decide' && (x.proposals || []).some((p: any) => p.key === 'encoder') && (
                    <label className="text-xs text-slate-600 flex items-center gap-2">Société
                      <select value={coFor[it.id] || 'vd'} onChange={e => setCoFor(p => ({ ...p, [it.id]: e.target.value }))} className="border rounded-lg px-2 py-1 text-xs bg-white">
                        <option value="vd">Verviers Dépannage</option><option value="riga">Dépannage Riga</option><option value="dgj">DGJ VHU</option>
                      </select>
                    </label>
                  )}
                  {it.status === 'to_decide' && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {(x.proposals || []).map((p: any) => p.key === 'classer' ? (
                        folderFor === it.id ? (
                          <span key="classer" className="flex flex-wrap gap-1 items-center">
                            {FILE_FOLDERS.map(f => <button key={f} onClick={() => decide(it.id, 'classer', f)} disabled={busy === it.id} className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-white disabled:opacity-50">→ {f}</button>)}
                            <button onClick={() => setFolderFor(null)} className="px-2 py-1.5 text-xs text-slate-500">annuler</button>
                          </span>
                        ) : <button key="classer" onClick={() => setFolderFor(it.id)} disabled={busy === it.id} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 disabled:opacity-50">Classer…</button>
                      ) : (
                        <button key={p.key} onClick={() => decide(it.id, p.key)} disabled={busy === it.id} title={mode === 'auto' ? 'Mode automatique : envoi direct' : 'Mode brouillon : rien ne part sans relecture'}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 ${p.key === 'laisser' || p.key === 'fait_ailleurs' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-600 text-white'}`}>{busy === it.id ? '…' : p.label}</button>
                      ))}
                    </div>
                  )}
                  {it.status === 'decided' && x.decision && (
                    <p className="text-xs text-slate-600">Décision : <strong>{x.decision.action}</strong>{x.decision.folder ? ` → ${x.decision.folder}` : ''} · {x.decision.by} · {fmt(x.decision.at)}
                      {x.decision.result && <span className="block text-slate-800 mt-0.5">{x.decision.result}</span>}
                      {(x.decision.links || []).map((l: any, k: number) => l.url ? <a key={k} className="underline mr-2" href={l.url} target="_blank" rel="noreferrer">{l.label}</a> : null)}
                    </p>
                  )}
                </div>
              )}

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
