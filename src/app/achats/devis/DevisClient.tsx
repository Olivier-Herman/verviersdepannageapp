'use client'
// src/app/achats/devis/DevisClient.tsx
//
// Comparateur de devis (brique 3 Achat IA) : un besoin regroupe plusieurs devis
// fournisseurs (PDF) extraits par Claude, comparés côte à côte + reco IA.

import { useEffect, useRef, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { ShoppingCart, ArrowLeft, Plus, Upload, Loader2, Trash2, Sparkles, FileText, Trophy, X, Mail, Send } from 'lucide-react'

const eur = (n: number | null) => n == null ? '—' : n.toLocaleString('fr-BE', { maximumFractionDigits: 0 }) + ' €'

export default function DevisClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [data, setData] = useState<any>({ requests: [], quotes: [] })
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  // Appel d'offre
  const [rfqOpen, setRfqOpen] = useState(false)
  const [cands, setCands] = useState<{ market: any[]; ours: any[] }>({ market: [], ours: [] })
  const [picked, setPicked] = useState<Record<string, any>>({})   // email -> recipient
  const [spec, setSpec] = useState('')
  const [draft, setDraft] = useState<any>(null)
  const [rfqBusy, setRfqBusy] = useState('')

  const load = () => fetch('/api/admin/achats/devis', { cache: 'no-store' }).then(r => r.json()).then(d => { setData(d); }).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const post = (payload: any) => fetch('/api/admin/achats/devis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json())

  const createRequest = async () => {
    const label = newLabel.trim(); if (!label) return
    const j = await post({ action: 'create_request', label })
    if (j.id) { setNewLabel(''); await load(); setOpenId(j.id) }
  }

  const addQuote = async (file: File) => {
    if (!openId) return
    setUploading(true); setMsg('')
    try {
      const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file) })
      const j = await post({ action: 'add_quote', request_id: openId, file_b64: b64, filename: file.name, mimetype: file.type || 'application/pdf' })
      if (j.error) setMsg('❌ ' + j.error); else { setMsg('✅ Devis ajouté'); await load() }
    } catch { setMsg('❌ Lecture du fichier impossible') } finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const deleteQuote = async (id: string) => { if (confirm('Supprimer ce devis ?')) { await post({ action: 'delete_quote', id }); await load() } }
  const deleteRequest = async (id: string) => { if (confirm('Supprimer ce besoin et tous ses devis ?')) { await post({ action: 'delete_request', id }); if (openId === id) setOpenId(null); await load() } }
  const compare = async (id: string) => {
    setComparing(true); setMsg('')
    try { const j = await post({ action: 'compare', request_id: id }); if (j.error) setMsg('❌ ' + j.error); else await load() } finally { setComparing(false) }
  }

  const quotesFor = (rid: string) => data.quotes.filter((q: any) => q.request_id === rid)
  const recipientsFor = (rid: string) => (data.recipients || []).filter((r: any) => r.request_id === rid)

  const openRfq = async () => {
    setRfqOpen(true); setDraft(null); setPicked({}); setSpec('')
    const j = await post({ action: 'rfq_candidates', request_id: openId })
    setCands({ market: j.market || [], ours: j.ours || [] })
  }
  const togglePick = (email: string, r: any) => setPicked(p => { const n = { ...p }; if (n[email]) delete n[email]; else n[email] = r; return n })
  const genDraft = async () => {
    setRfqBusy('draft')
    try { const j = await post({ action: 'rfq_draft', request_id: openId, spec }); if (j.error) setMsg('❌ ' + j.error); else setDraft({ subject: j.subject, paragraphs: (j.paragraphs || []).join('\n\n') }) }
    finally { setRfqBusy('') }
  }
  const sendRfq = async () => {
    const recipients = Object.values(picked)
    if (!recipients.length || !draft) return
    if (!confirm(`Envoyer l'appel d'offre à ${recipients.length} fournisseur(s) ?`)) return
    setRfqBusy('send')
    try {
      const j = await post({ action: 'rfq_send', request_id: openId, subject: draft.subject, paragraphs: draft.paragraphs.split(/\n\n+/).map((s: string) => s.trim()).filter(Boolean), recipients })
      if (j.error) setMsg('❌ ' + j.error); else { setMsg(`✅ Envoyé à ${j.sent}${j.failed ? ` (${j.failed} échec)` : ''}`); setRfqOpen(false); await load() }
    } finally { setRfqBusy('') }
  }
  const STATUS: Record<string, string> = { sent: 'Envoyé', opened: 'Ouvert', responded: 'A répondu', failed: 'Échec' }
  const STATUS_CLS: Record<string, string> = { sent: 'bg-ink-muted/10 text-ink-muted', opened: 'bg-amber-500/10 text-amber-600', responded: 'bg-emerald-500/10 text-emerald-600', failed: 'bg-red-500/10 text-red-500' }

  return (
    <AppShell title="Comparateur de devis" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-5">
          <a href="/achats" className="p-2 rounded-lg border text-ink-muted hover:text-brand" title="Retour"><ArrowLeft size={16} /></a>
          <div className="w-10 h-10 rounded-2xl bg-brand/10 text-brand flex items-center justify-center"><FileText size={20} /></div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-ink leading-tight">Comparateur de devis</h1>
            <p className="text-ink-muted text-xs">Dépose plusieurs devis d'un même besoin — l'IA les extrait, compare et te recommande le meilleur.</p>
          </div>
        </div>

        {/* Nouveau besoin */}
        <div className="flex gap-2 mb-5">
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') createRequest() }}
            placeholder="Nouveau besoin — ex. « 4 pneus 225/65R16 camion Iveco »" className="flex-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink" />
          <button onClick={createRequest} disabled={!newLabel.trim()} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-50"><Plus size={16} /> Créer</button>
        </div>

        {msg && <p className="text-sm mb-3">{msg}</p>}
        {loading && <p className="text-ink-muted text-sm">Chargement…</p>}
        {!loading && !data.requests.length && <p className="text-ink-muted text-sm">Aucun besoin. Crée-en un pour commencer à comparer des devis.</p>}

        <div className="space-y-3">
          {data.requests.map((r: any) => {
            const qs = quotesFor(r.id)
            const isOpen = openId === r.id
            const minTotal = Math.min(...qs.filter((q: any) => q.total_htva != null).map((q: any) => q.total_htva))
            return (
              <div key={r.id} className="bg-surface border rounded-2xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => setOpenId(isOpen ? null : r.id)} className="flex-1 text-left min-w-0">
                    <div className="font-semibold text-ink text-sm truncate">{r.label}</div>
                    <div className="text-ink-muted text-xs">{qs.length} devis{qs.length > 1 ? '' : ''}</div>
                  </button>
                  <button onClick={() => deleteRequest(r.id)} className="p-1.5 text-ink-muted/60 hover:text-red-500" title="Supprimer le besoin"><Trash2 size={15} /></button>
                </div>

                {isOpen && (
                  <div className="px-4 pb-4 border-t pt-3">
                    {/* Comparatif */}
                    {qs.length > 0 && (
                      <div className="overflow-x-auto -mx-1 px-1">
                        <table className="w-full text-sm border-separate border-spacing-0">
                          <thead>
                            <tr className="text-ink-muted text-xs">
                              <th className="text-left font-medium py-1 pr-3">Critère</th>
                              {qs.map((q: any) => (
                                <th key={q.id} className="text-left font-medium py-1 px-3 min-w-[140px]">
                                  <div className="flex items-center gap-1 text-ink">{q.supplier_name}
                                    {q.total_htva != null && q.total_htva === minTotal && qs.length > 1 && <Trophy size={12} className="text-amber-500" />}
                                    <button onClick={() => deleteQuote(q.id)} className="ml-auto text-ink-muted/50 hover:text-red-400"><X size={12} /></button>
                                  </div>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="text-ink">
                            <tr><td className="text-ink-muted text-xs py-1.5 pr-3">Total HTVA</td>{qs.map((q: any) => <td key={q.id} className={`py-1.5 px-3 font-semibold ${q.total_htva === minTotal && qs.length > 1 ? 'text-emerald-600' : ''}`}>{eur(q.total_htva)}</td>)}</tr>
                            <tr><td className="text-ink-muted text-xs py-1.5 pr-3">Délai</td>{qs.map((q: any) => <td key={q.id} className="py-1.5 px-3">{q.delivery_days != null ? `${q.delivery_days} j` : '—'}</td>)}</tr>
                            <tr><td className="text-ink-muted text-xs py-1.5 pr-3">Paiement</td>{qs.map((q: any) => <td key={q.id} className="py-1.5 px-3 text-xs">{q.payment_terms || '—'}</td>)}</tr>
                            <tr><td className="text-ink-muted text-xs py-1.5 pr-3">Validité</td>{qs.map((q: any) => <td key={q.id} className="py-1.5 px-3 text-xs">{q.validity || '—'}</td>)}</tr>
                            <tr><td className="text-ink-muted text-xs py-1.5 pr-3">Lignes</td>{qs.map((q: any) => <td key={q.id} className="py-1.5 px-3 text-xs">{(q.items || []).length} · {q.summary}</td>)}</tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Ajout + comparaison */}
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) addQuote(f) }} />
                      <button onClick={() => fileRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border hover:bg-bg disabled:opacity-50">
                        {uploading ? <><Loader2 size={15} className="animate-spin" /> Lecture…</> : <><Upload size={15} /> Ajouter un devis (PDF)</>}
                      </button>
                      {qs.length >= 2 && (
                        <button onClick={() => compare(r.id)} disabled={comparing} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-50">
                          {comparing ? <><Loader2 size={15} className="animate-spin" /> Analyse…</> : <><Sparkles size={15} /> Comparer avec l'IA</>}
                        </button>
                      )}
                      <button onClick={openRfq} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-brand/40 text-brand hover:bg-brand/5 ml-auto"><Mail size={15} /> Appel d'offre</button>
                    </div>

                    {/* Statuts des destinataires */}
                    {recipientsFor(r.id).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {recipientsFor(r.id).map((rc: any) => (
                          <span key={rc.id} className={`text-[11px] px-2 py-1 rounded-full ${STATUS_CLS[rc.status] || 'bg-ink-muted/10 text-ink-muted'}`} title={rc.email}>{rc.name || rc.email} · {STATUS[rc.status] || rc.status}</span>
                        ))}
                      </div>
                    )}

                    {/* Panneau appel d'offre */}
                    {rfqOpen && openId === r.id && (
                      <div className="mt-3 border rounded-xl p-3 bg-surface-2/50 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-ink flex items-center gap-1.5"><Mail size={15} className="text-brand" /> Appel d'offre</span>
                          <button onClick={() => setRfqOpen(false)} className="text-ink-muted hover:text-ink"><X size={16} /></button>
                        </div>
                        <textarea value={spec} onChange={e => setSpec(e.target.value)} rows={2} placeholder="Précisions techniques (référence, quantité, contraintes…) — optionnel" className="w-full bg-bg border rounded-lg px-3 py-2 text-sm text-ink resize-none" />
                        {/* Destinataires */}
                        <div>
                          <div className="text-ink-muted text-xs mb-1">Destinataires ({Object.keys(picked).length} sélectionné(s))</div>
                          <div className="max-h-40 overflow-auto border rounded-lg p-2 space-y-1">
                            {[...cands.market.map((m: any) => ({ ...m, kind: 'marché', email: m.email, market_id: m.id })), ...cands.ours.map((o: any) => ({ ...o, kind: 'nôtre', partner_id: o.partner_id }))]
                              .filter((c: any) => c.email).map((c: any, i: number) => (
                              <label key={c.email + i} className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={!!picked[c.email]} onChange={() => togglePick(c.email, { name: c.name, email: c.email, market_id: c.market_id || null, partner_id: c.partner_id || null })} />
                                <span className="text-ink truncate">{c.name}</span>
                                <span className="text-[10px] px-1 rounded bg-ink-muted/10 text-ink-muted">{c.kind}</span>
                                <span className="text-ink-muted text-xs truncate">{c.email}</span>
                              </label>
                            ))}
                            {!cands.market.length && !cands.ours.length && <p className="text-ink-muted text-xs">Aucun destinataire avec email. Renseigne des emails (Répertoire / Base marché).</p>}
                          </div>
                        </div>
                        <button onClick={genDraft} disabled={rfqBusy === 'draft'} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border hover:bg-bg disabled:opacity-50">
                          {rfqBusy === 'draft' ? <><Loader2 size={14} className="animate-spin" /> Rédaction…</> : <><Sparkles size={14} /> Générer le mail (IA)</>}
                        </button>
                        {draft && (
                          <div className="space-y-2">
                            <input value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} className="w-full bg-bg border rounded-lg px-3 py-2 text-sm text-ink font-medium" />
                            <textarea value={draft.paragraphs} onChange={e => setDraft({ ...draft, paragraphs: e.target.value })} rows={6} className="w-full bg-bg border rounded-lg px-3 py-2 text-sm text-ink resize-none" />
                            <p className="text-[11px] text-ink-muted">« Bonjour {'{nom}'} », le lien de dépôt et la signature sont ajoutés automatiquement.</p>
                            <button onClick={sendRfq} disabled={rfqBusy === 'send' || !Object.keys(picked).length} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-50">
                              {rfqBusy === 'send' ? <><Loader2 size={15} className="animate-spin" /> Envoi…</> : <><Send size={15} /> Envoyer à {Object.keys(picked).length}</>}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {r.reco && (
                      <div className="mt-3 rounded-xl border border-brand/20 bg-brand/5 p-3">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-brand mb-1"><Sparkles size={13} /> Recommandation</div>
                        <p className="text-ink-secondary text-sm whitespace-pre-wrap">{r.reco}</p>
                      </div>
                    )}
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
