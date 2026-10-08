'use client'
// Écran « Propositions des agents » (maquette validée par Olivier le 05/10/2026).

import { useCallback, useEffect, useState } from 'react'

const COMPANY: Record<number, string> = { 1: 'Verviers Dépannage', 2: 'Dépannage Riga', 3: 'DGJ VHU' }
const KIND: Record<string, string> = { lot_paiement: 'Lot de paiement', facture_achat: 'Facture d’achat', note_credit: 'Note de crédit / refacturation', envoi_comptable: 'Envoi au comptable', question_olivier: 'Question à Mobi' }
const ANSWERS: Record<string, { key: string; label: string }[]> = { facture_nom_prive: [{ key: 'encoder', label: 'Encoder chez VD' }, { key: 'prive', label: 'Privé, ne pas encoder' }] }
/** Question libre : réponses proposées par l'agent + « Déjà réglé » (Olivier 08/10/2026). */
const answersFor = (payload: any): { key: string; label: string }[] =>
  payload?.sujet === 'libre' ? [...(Array.isArray(payload.choix) ? payload.choix : []), { key: 'deja_regle', label: 'Déjà réglé' }] : (ANSWERS[payload?.sujet] || [])
const STATUS: Record<string, { label: string; cls: string }> = {
  to_validate: { label: 'À valider', cls: 'bg-amber-100 text-amber-900' },
  executing:   { label: 'En cours', cls: 'bg-sky-100 text-sky-900' },
  executed:    { label: 'Exécutée', cls: 'bg-emerald-100 text-emerald-900' },
  refused:     { label: 'Refusée', cls: 'bg-slate-200 text-slate-800' },
  returned:    { label: 'Renvoyée à l’agent', cls: 'bg-violet-100 text-violet-900' },
  failed:      { label: 'Échec', cls: 'bg-red-100 text-red-800' },
  answered:    { label: 'Répondue', cls: 'bg-emerald-100 text-emerald-900' },
}
const FILTERS = [
  { key: 'to_validate', label: 'À valider' }, { key: 'direct', label: 'Envois directs' }, { key: 'executed', label: 'Exécutées' },
  { key: 'questions', label: 'Questions' }, { key: 'refused', label: 'Refusées' }, { key: 'failed', label: 'En échec' }, { key: 'all', label: 'Toutes' },
]
const eur = (n: any) => n == null ? '' : Number(n).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' })
const fmt = (s?: string | null) => s ? new Date(s).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
const initial = (n: string) => (n || '?').slice(0, 1).toUpperCase()

export default function AgentsClient() {
  const [view, setView] = useState<'props' | 'agents' | 'journal'>('props')
  const [filter, setFilter] = useState('to_validate')
  const [company, setCompany] = useState('')
  const [agentF, setAgentF] = useState('')
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, 'refuser' | 'corriger' | undefined>>({})
  const [text, setText] = useState<Record<string, string>>({})
  const [newKey, setNewKey] = useState<{ agent: string; key: string } | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/agents?statut=${filter}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Chargement impossible')
      setData(j); setErr(null)
    } catch (e: any) { setErr(e.message) }
  }, [filter])
  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id) }, [load])

  const post = async (body: any, id: string) => {
    setBusy(id)
    try {
      const r = await fetch('/api/admin/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Action refusée')
      if (j.status === 'failed' && j.error) setErr(`Exécution refusée : ${j.error}`)
      else setErr(null)
      await load()
      return j
    } catch (e: any) { setErr(e.message); return null } finally { setBusy(null) }
  }

  const props: any[] = (data?.proposals || []).filter((p: any) => (!company || String(p.company_id) === company) && (!agentF || p.agent_name === agentF))
  const me = data?.me
  const canDecide = (p: any) => me?.isSuperadmin || (p.validator_user_id && p.validator_user_id === me?.id)
  const validatorName = (id: string | null) => id ? (data?.validators || []).find((v: any) => v.id === id)?.name || 'désigné' : 'Mobi'

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Propositions des agents</h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">Les agents préparent, vous validez, VD Soft exécute. Chaque proposition garde qui l’a préparée, qui l’a validée et ce qui a été fait.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {([['props', 'Propositions'], ['agents', 'Agents et droits'], ['journal', 'Journal']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setView(k)} className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold ${view === k ? 'bg-slate-900 text-white' : 'bg-white border border-slate-300 text-slate-800'}`}>{l}</button>
          ))}
        </div>
      </div>

      {err && <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      {!data && !err && <p className="text-sm text-slate-600">Chargement…</p>}

      {data && view === 'props' && (
        <section className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="À valider" value={data.counts.to_validate} cls={data.counts.to_validate ? 'border-amber-300 text-amber-800' : 'border-slate-200 text-slate-900'} />
            <Stat label="Exécutées (24 h)" value={data.counts.executed_24h} cls="border-slate-200 text-emerald-800" />
            <Stat label="Envois directs (24 h)" value={data.counts.direct_24h} cls="border-slate-200 text-slate-900" />
            <Stat label="En échec" value={data.counts.failed} cls={data.counts.failed ? 'border-red-200 text-red-700' : 'border-slate-200 text-slate-900'} />
          </div>

          <div className="flex flex-wrap gap-2 items-center text-sm">
            <span className="text-slate-600">Afficher :</span>
            {FILTERS.map(f => (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={`px-3 min-h-[36px] rounded-full ${filter === f.key ? 'bg-amber-100 text-amber-900 font-semibold' : 'bg-white border border-slate-300 text-slate-700'}`}>
                {f.label}{f.key === 'to_validate' && data.counts.to_validate ? ` (${data.counts.to_validate})` : ''}
              </button>
            ))}
            <span className="ml-auto" />
            <select aria-label="Société" value={company} onChange={e => setCompany(e.target.value)} className="border rounded-lg px-2 min-h-[36px] bg-white text-slate-800">
              <option value="">Toutes les sociétés</option>{Object.entries(COMPANY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select aria-label="Agent" value={agentF} onChange={e => setAgentF(e.target.value)} className="border rounded-lg px-2 min-h-[36px] bg-white text-slate-800">
              <option value="">Tous les agents</option>{(data.agents || []).map((a: any) => <option key={a.id} value={a.name}>{a.name}</option>)}
            </select>
          </div>

          {props.length === 0 && <p className="text-sm text-slate-600 bg-white border border-slate-200 rounded-xl px-4 py-6 text-center">{filter === 'to_validate' ? 'Rien à valider pour l’instant.' : 'Aucune proposition dans ce filtre.'}</p>}

          {props.map(p => {
            const st = STATUS[p.status] || { label: p.status, cls: 'bg-slate-100 text-slate-800' }
            const decidable = (p.status === 'to_validate' || p.status === 'failed') && canDecide(p)
            const facts: any[] = p.payload?.factures || []
            return (
              <article key={p.id} className={`rounded-xl bg-white border p-4 space-y-3 ${p.status === 'failed' ? 'border-red-300' : 'border-slate-200'}`}>
                <div className="flex items-start gap-3">
                  <span className="w-10 h-10 shrink-0 rounded-full bg-slate-800 text-white font-bold flex items-center justify-center" aria-hidden>{initial(p.agent_name)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-slate-900">{p.title}</b>
                      <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200">{COMPANY[p.company_id] || p.company_id}</span>
                      <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${st.cls}`}>{p.direct ? `Envoi direct · ${st.label.toLowerCase()}` : st.label}</span>
                    </div>
                    <p className="text-xs text-slate-600">Préparé par <b>{p.agent_name}</b> · {fmt(p.created_at)}{p.status === 'to_validate' ? <> · à valider par <b>{validatorName(p.validator_user_id)}</b></> : null}{p.validated_by ? <> · {p.status === 'refused' ? 'refusé' : p.status === 'returned' ? 'renvoyé' : 'validé'} par <b>{p.validated_by}</b> {fmt(p.validated_at)}</> : null}</p>
                  </div>
                  {p.amount != null && <p className="text-right text-xl font-bold text-slate-900 tabular-nums shrink-0">{eur(p.amount)}</p>}
                </div>
                {p.why && <p className="text-sm text-slate-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 whitespace-pre-line"><b>Pourquoi :</b> {p.why}</p>}
                {p.kind === 'envoi_comptable' && <p className="text-sm text-slate-800">À <b>{p.payload?.a}</b> · « {p.payload?.objet} » · pièces : {(p.payload?.pieces || []).join(', ')}</p>}
                {p.kind === 'note_credit' && <p className="text-sm text-slate-800">Motif : {p.payload?.motif}</p>}
                {p.kind === 'rapprochement_banque' && (p.payload?.ventilation || []).length > 0 && (
                  <div className="text-sm text-slate-800"><p className="font-medium">Ventilation proposée :</p><ul className="list-disc pl-5">{p.payload.ventilation.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul></div>
                )}
                {p.kind === 'question_olivier' && p.payload?.sujet === 'libre' && (
                  <div className="text-sm text-slate-800 space-y-2">
                    {p.payload?.question && p.payload.question.length > 160 && <p className="font-medium text-slate-900 whitespace-pre-line">{p.payload.question}</p>}
                    {p.payload?.contexte && <p className="text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 whitespace-pre-line">{p.payload.contexte}</p>}
                    {p.payload?.lien && <a href={p.payload.lien} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center text-sky-800 underline">Ouvrir le document lié</a>}
                    {p.status === 'answered' && <p className="text-emerald-800 font-semibold whitespace-pre-line">Réponse : {p.result?.label} · {p.validated_by} · {fmt(p.validated_at)}{p.result?.canal === 'telegram' ? ' (Telegram)' : ''}</p>}
                  </div>
                )}
                {p.kind === 'question_olivier' && p.payload?.sujet !== 'libre' && (
                  <div className="text-sm text-slate-800 space-y-0.5">
                    <p><b>Destinataire :</b> {p.payload?.destinataire}</p>
                    <p>{p.payload?.fournisseur} · {p.payload?.reference || 'sans référence'} · {p.payload?.date || 'sans date'} · {eur(p.payload?.htva)} HTVA / {eur(p.payload?.tvac)} TVAC</p>
                    {(p.payload?.lignes || []).length > 0 && <ul className="list-disc pl-5 text-slate-700">{p.payload.lignes.slice(0, 5).map((l: string, i: number) => <li key={i}>{l}</li>)}</ul>}
                    <p className="text-slate-600">{p.payload?.mail ? `Mail d’origine : ${p.payload.mail.de} · « ${p.payload.mail.objet || ''} » · ${String(p.payload.mail.date || '').slice(0, 10)}` : 'Pas de mail d’origine.'}</p>
                    {p.status === 'answered' && <p className="text-emerald-800 font-semibold">Réponse : {p.result?.label} · {p.validated_by} · {fmt(p.validated_at)}{p.result?.canal === 'telegram' ? ' (Telegram)' : ''}</p>}
                  </div>
                )}
                {facts.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-slate-800 font-medium min-h-[36px] flex items-center underline decoration-slate-400">▸ Voir les {facts.length} factures</summary>
                    <div className="overflow-x-auto mt-2">
                      <table className="min-w-full text-sm">
                        <thead><tr className="text-left text-slate-600 border-b"><th className="py-1 pr-3">Fournisseur</th><th className="pr-3">Facture</th><th className="pr-3">Échéance</th><th className="text-right">Reste à payer</th></tr></thead>
                        <tbody className="text-slate-800">{facts.map((f: any) => <tr key={f.id} className="border-b"><td className="py-1 pr-3">{f.fournisseur}</td><td className="pr-3">{f.nom}{f.ref ? ` · ${f.ref}` : ''}</td><td className="pr-3">{f.echeance || ''}</td><td className="text-right tabular-nums">{eur(f.reste)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </details>
                )}
                {p.result?.note && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">✓ {p.result.note}{(p.result.avertissements || []).map((w: string, i: number) => <span key={i} className="block text-amber-800">⚠ {w}</span>)}</p>}
                {p.error && <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">L’exécution a échoué : {p.error}</p>}
                {p.refused_reason && <p className="text-sm text-slate-700">Motif du refus : {p.refused_reason}</p>}
                {p.correction && <p className="text-sm text-violet-800">Demandé à l’agent : {p.correction}</p>}

                {p.kind === 'question_olivier' && p.status === 'to_validate' && canDecide(p) && (
                  <div className="space-y-2 pt-1">
                    <div className="flex flex-wrap gap-2">
                      {answersFor(p.payload).map(a => (
                        <button key={a.key} type="button" disabled={busy === p.id} onClick={() => post({ op: 'answer', id: p.id, choix: a.key }, p.id)}
                          className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold disabled:opacity-50 ${a.key === 'encoder' || a.key === 'c1' ? 'bg-emerald-600 text-white' : a.key === 'deja_regle' ? 'bg-slate-100 border border-slate-300 text-slate-800' : 'bg-white border border-slate-300 text-slate-800'}`}>{busy === p.id ? '…' : a.label}</button>
                      ))}
                    </div>
                    {p.payload?.sujet === 'libre' && (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <textarea value={text[p.id] || ''} onChange={e => setText(t => ({ ...t, [p.id]: e.target.value }))} rows={2} placeholder="Ou réponds avec tes mots…"
                          className="flex-1 min-h-[44px] rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white" />
                        <button type="button" disabled={busy === p.id || !(text[p.id] || '').trim()} onClick={() => post({ op: 'answer', id: p.id, choix: 'libre', texte: text[p.id] }, p.id)}
                          className="min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-sky-700 text-white disabled:opacity-50">{busy === p.id ? '…' : 'Envoyer ma réponse'}</button>
                      </div>
                    )}
                  </div>
                )}
                {decidable && p.kind !== 'question_olivier' && !open[p.id] && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button type="button" disabled={busy === p.id} onClick={() => post({ op: 'decide', id: p.id, action: 'valider' }, p.id)} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-emerald-600 text-white disabled:opacity-50">{busy === p.id ? 'Exécution…' : p.status === 'failed' ? 'Réessayer' : ACTION_LABEL[p.kind] || 'Valider'}</button>
                    {p.status === 'to_validate' && <button type="button" onClick={() => setOpen(o => ({ ...o, [p.id]: 'corriger' }))} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-white border border-slate-300 text-slate-800">Corriger…</button>}
                    <button type="button" onClick={() => setOpen(o => ({ ...o, [p.id]: 'refuser' }))} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-white border border-red-300 text-red-700">Refuser…</button>
                  </div>
                )}
                {decidable && p.kind !== 'question_olivier' && open[p.id] && (
                  <div className="space-y-2">
                    <label className="block text-sm text-slate-800">{open[p.id] === 'refuser' ? 'Motif du refus (l’agent le lit pour la prochaine fois)' : 'Ce qu’il faut changer (l’agent refait sa proposition)'}
                      <textarea rows={2} value={text[p.id] || ''} onChange={e => setText(t => ({ ...t, [p.id]: e.target.value }))} className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm text-slate-900" />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy === p.id || !(text[p.id] || '').trim()} onClick={async () => { const ok = await post({ op: 'decide', id: p.id, action: open[p.id], text: text[p.id] }, p.id); if (ok) setOpen(o => ({ ...o, [p.id]: undefined })) }}
                        className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold text-white disabled:opacity-40 ${open[p.id] === 'refuser' ? 'bg-red-600' : 'bg-slate-900'}`}>{open[p.id] === 'refuser' ? 'Refuser' : 'Renvoyer à l’agent'}</button>
                      <button type="button" onClick={() => setOpen(o => ({ ...o, [p.id]: undefined }))} className="min-h-[44px] px-3 text-sm text-slate-700">Annuler</button>
                    </div>
                  </div>
                )}
                {(p.status === 'to_validate' || p.status === 'failed') && !canDecide(p) && <p className="text-xs text-slate-600">Validation réservée à {validatorName(p.validator_user_id)}.</p>}
              </article>
            )
          })}
        </section>
      )}

      {data && view === 'agents' && (
        <section className="space-y-3">
          <p className="text-sm text-slate-700 max-w-3xl">Chaque agent a sa propre clé d’accès, ses sociétés et ses types de propositions. Tout appel hors de ses droits est refusé et noté dans le journal. <b>Aucun agent n’a plus de droits qu’une personne du même poste.</b></p>
          {newKey && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
              <p>Nouvelle clé de <b>{newKey.agent}</b>, affichée <b>une seule fois</b> : copiez-la dans le bureau des agents. L’ancienne ne marche plus.</p>
              <code className="block break-all bg-white border border-amber-200 rounded-lg px-2 py-1.5 text-slate-900 select-all">{newKey.key}</code>
              <div className="flex gap-2">
                <button type="button" onClick={() => navigator.clipboard?.writeText(newKey.key).catch(() => {})} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-slate-900 text-white">Copier</button>
                <button type="button" onClick={() => setNewKey(null)} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-white border border-slate-300 text-slate-800">J’ai copié la clé</button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-3 py-2">Agent</th><th className="px-3">Sociétés</th><th className="px-3">Peut proposer</th><th className="px-3">Envoi direct</th><th className="px-3">Validé par</th><th className="px-3">Actif</th><th className="px-3">Clé</th></tr></thead>
              <tbody className="text-slate-800">
                {(data.agents || []).map((a: any) => (
                  <tr key={a.id} className="border-t align-top">
                    <td className="px-3 py-2"><b>{a.name}</b><span className="block text-xs text-slate-600">{a.role_label}</span></td>
                    <td className="px-3 py-2">{a.companies.map((c: number) => COMPANY[c]).join(' · ') || '—'}</td>
                    <td className="px-3 py-2">{a.kinds.map((k: string) => KIND[k] || k).join(', ') || 'Lecture seule'}</td>
                    <td className="px-3 py-2">{a.direct_kinds.length ? a.direct_kinds.map((k: string) => DIRECT_RULE[k] || KIND[k]).join(' ; ') : '—'}</td>
                    <td className="px-3 py-2">
                      <select aria-label={`Validateur de ${a.name}`} disabled={!me?.isSuperadmin || busy === a.id} value={a.validator_user_id || ''} onChange={e => post({ op: 'agent', id: a.id, validator_user_id: e.target.value || null }, a.id)} className="border rounded-lg px-2 min-h-[36px] bg-white text-slate-800">
                        <option value="">Mobi</option>{(data.validators || []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2"><input type="checkbox" aria-label={`${a.name} actif`} disabled={!me?.isSuperadmin || busy === a.id} checked={a.active} onChange={e => post({ op: 'agent', id: a.id, active: e.target.checked }, a.id)} className="w-5 h-5" /></td>
                    <td className="px-3 py-2">
                      <span className="block text-xs text-slate-600 mb-1">{a.key_prefix ? `${a.key_prefix}…${a.key_created_at ? ` (${fmt(a.key_created_at)})` : ''}` : 'aucune clé'}</span>
                      {me?.isSuperadmin && (confirmKey === a.id
                        ? <span className="flex gap-1"><button type="button" onClick={async () => { setConfirmKey(null); const j = await post({ op: 'key', id: a.id }, a.id); if (j?.key) setNewKey({ agent: a.name, key: j.key }) }} className="min-h-[36px] px-3 rounded-lg bg-amber-600 text-white text-xs font-semibold">{a.key_prefix ? 'Remplacer la clé' : 'Créer la clé'}</button><button type="button" onClick={() => setConfirmKey(null)} className="min-h-[36px] px-2 text-xs text-slate-700">Annuler</button></span>
                        : <button type="button" onClick={() => setConfirmKey(a.id)} className="min-h-[36px] px-3 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold">Nouvelle clé</button>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-600">Garde-fous dans le code, non modifiables ici : la nuit (18 h–6 h) rien ne part, sauf les notes de crédit et refacturations qu’Élodie déclare certaines ; aucun mail ne part sans validation, sauf les envois directs ci-dessus ; jamais de suppression de ligne d’un bon de commande confirmé.</p>
        </section>
      )}

      {data && view === 'journal' && (
        <section className="space-y-3">
          <p className="text-sm text-slate-700">Toutes les lectures, propositions, validations et refus, avec l’agent, la société et l’heure. Les 200 plus récents.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-3 py-2">Heure</th><th className="px-3">Agent</th><th className="px-3">Société</th><th className="px-3">Quoi</th><th className="px-3">Par</th></tr></thead>
              <tbody className="text-slate-800">
                {(data.journal || []).length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-600">Rien pour l’instant.</td></tr>}
                {(data.journal || []).map((j: any) => (
                  <tr key={j.id} className={`border-t ${j.ok ? '' : 'bg-red-50'}`}>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{fmt(j.created_at)}</td>
                    <td className="px-3 py-2">{j.agent_name || '—'}</td>
                    <td className="px-3 py-2">{j.company_id ? COMPANY[j.company_id] : '—'}</td>
                    <td className={`px-3 py-2 ${j.ok ? '' : 'text-red-800'}`}><b>{j.action}</b>{j.detail ? ` · ${j.detail}` : ''}</td>
                    <td className="px-3 py-2">{j.actor || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

const ACTION_LABEL: Record<string, string> = { lot_paiement: 'Valider et créer le lot', facture_achat: 'Valider la facture', note_credit: 'Valider la note de crédit', envoi_comptable: 'Valider et envoyer', rapprochement_bouton: 'Valider et rapprocher', rapprochement_banque: 'Valider et rapprocher', plaque_achat: 'Valider et relier', annulation_doublon: 'Valider et annuler', ticket_achat: 'Valider le ticket', refacturation_avance: 'Valider et refacturer' }
const DIRECT_RULE: Record<string, string> = {
  note_credit: 'Note de crédit / refacturation si certaine (nuit comprise)',
  envoi_comptable: 'Pièces au comptable, depuis la boîte de Mobi (le jour)',
  facture_achat: 'Achat Riga validé quand l’agent est certain de sa lecture, tout canal (le jour)',
  rapprochement_bouton: 'Rapprochements au bouton prêts (Paynovate, SumUp, assureurs) (le jour)',
  rapprochement_banque: 'Rapprochement d’une ligne de banque (le jour)',
  plaque_achat: 'Plaque sur facture d’achat, véhicule retrouvé par VD Soft (le jour)',
  annulation_doublon: 'Brouillon en double mail + Peppol : on garde Peppol (le jour)',
  ticket_achat: 'Ticket de caisse encodé en « Ticket » au nom du commerçant (le jour)',
  refacturation_avance: 'Refacturation d’une avance de fonds (le jour)',
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return <div className={`rounded-xl bg-white border p-3 ${cls}`}><p className="text-xs text-slate-600">{label}</p><p className="text-2xl font-bold">{value}</p></div>
}
