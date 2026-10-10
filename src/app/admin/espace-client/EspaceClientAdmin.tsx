'use client'
// Admin de l'espace client (Olivier 10/10/2026) : sociétés (client facturé, source, son d'appel),
// comptes (société, gestionnaire, collaborateur), invitations, test de l'appel au dépannage.
import { useCallback, useEffect, useState } from 'react'

interface Societe { id: string; nom: string; odoo_partner_id: number; source_key: string; appel_audio: string | null; couleur: string | null; active: boolean }
interface Compte { id: string; nom: string; emails: string[]; role: 'societe' | 'gestionnaire' | 'collaborateur'; societe_ids: string[]; peut_inviter: boolean; invite_par: string | null; active: boolean; derniere_connexion: string | null }
const ROLE: Record<Compte['role'], string> = { societe: 'Société : voit toutes les missions de ses sociétés', gestionnaire: 'Gestionnaire : voit tout et crée des collaborateurs', collaborateur: 'Collaborateur : une société, ses commandes seulement' }
const APPEL: Record<string, string> = { lance: 'Appel lancé', decroche: 'Décroché, message joué', termine: 'Message entendu', echec: 'Appel impossible', echec_message: 'Message non joué' }

export default function EspaceClientAdmin() {
  const [d, setD] = useState<{ societes: Societe[]; comptes: Compte[]; appels: any[]; sources: any[]; garages: { id: string; societe_id: string; nom: string; adresse: string }[] } | null>(null)
  const [gForm, setGForm] = useState<{ societe_id: string; nom: string; adresse: string } | null>(null)
  const [msg, setMsg] = useState('')
  const [form, setForm] = useState<Partial<Compte> & { emailsTxt?: string } | null>(null)
  const charger = useCallback(async () => { const r = await fetch('/api/admin/espace-client', { cache: 'no-store' }); if (r.ok) setD(await r.json()) }, [])
  useEffect(() => { charger() }, [charger])
  const act = async (body: any, ok: string) => {
    setMsg('')
    const r = await fetch('/api/admin/espace-client', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    setMsg(r.ok ? (j.to ? `${ok} (${j.to})` : ok) : `⚠ ${j.error || 'Erreur'}`)
    if (r.ok) charger()
    return r.ok
  }
  if (!d) return <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-ink-muted">Chargement…</div>
  const nomSoc = (ids: string[]) => ids.map(id => d.societes.find(s => s.id === id)?.nom || '?').join(', ')

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">Clients</div>
          <h1 className="text-2xl font-extrabold text-ink">Espace client</h1>
          <p className="text-sm text-ink-secondary">Les clients suivent leurs interventions, téléchargent rapports et factures, et commandent en ligne. Ce qu’ils voient dépend du client facturé.</p>
        </div>
        <a href="/espace/connexion" target="_blank" className="ml-auto min-h-[44px] rounded-xl border border-strong bg-surface px-4 py-2.5 text-sm font-bold text-ink">Ouvrir l’espace client ↗</a>
      </div>
      {msg && <div className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-ink-secondary">{msg}</div>}

      <section className="space-y-2">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink-muted">Sociétés</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {d.societes.map(s => (
            <div key={s.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: s.couleur || '#cc2222' }} /><span className="text-lg font-extrabold text-ink">{s.nom}</span>{!s.active && <span className="text-xs text-ink-muted">(inactive)</span>}</div>
              <div className="mt-1 text-sm text-ink-secondary">Client facturé n° {s.odoo_partner_id} · source {d.sources.find(x => x.key === s.source_key)?.label || s.source_key}</div>
              <div className="text-sm text-ink-secondary">Message d’appel : {s.appel_audio || 'message générique'}</div>
              <div className="mt-3 space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">Garages de livraison (boutons proposés au client)</div>
                {d.garages.filter(g => g.societe_id === s.id).map(g => (
                  <div key={g.id} className="flex items-center gap-2 text-sm text-ink"><span className="flex-1"><b>{g.nom}</b> — {g.adresse}</span><button onClick={() => act({ action: 'garage-suppr', id: g.id }, 'Garage retiré')} className="min-h-[36px] rounded-lg px-2 text-ink-muted">Retirer</button></div>
                ))}
                {gForm?.societe_id === s.id ? (
                  <div className="flex flex-wrap gap-2">
                    <input className="min-h-[40px] flex-1 rounded-lg border border-border bg-surface px-2 text-sm text-ink" placeholder="Nom (ex. Centracar Aubel)" value={gForm.nom} onChange={e => setGForm({ ...gForm, nom: e.target.value })} />
                    <input className="min-h-[40px] flex-[2] rounded-lg border border-border bg-surface px-2 text-sm text-ink" placeholder="Adresse complète" value={gForm.adresse} onChange={e => setGForm({ ...gForm, adresse: e.target.value })} />
                    <button onClick={async () => { if (await act({ action: 'garage', ...gForm }, 'Garage ajouté')) setGForm(null) }} className="min-h-[40px] rounded-lg bg-brand px-3 text-sm font-bold text-white">Ajouter</button>
                  </div>
                ) : <button onClick={() => setGForm({ societe_id: s.id, nom: '', adresse: '' })} className="min-h-[36px] text-sm font-semibold text-brand">+ Ajouter un garage</button>}
              </div>
              <button onClick={() => act({ action: 'tester-appel', id: s.id }, `Appel de test lancé pour ${s.nom} : le téléphone du dépannage va sonner.`)} className="mt-3 min-h-[44px] rounded-xl border border-strong bg-surface px-3 text-sm font-bold text-ink">📞 Tester l’appel</button>
            </div>
          ))}
          {!d.societes.length && <p className="text-sm text-ink-muted">Aucune société.</p>}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink-muted">Comptes</h2>
          <button onClick={() => setForm({ role: 'societe', societe_ids: [], emailsTxt: '' })} className="ml-auto min-h-[44px] rounded-xl bg-brand px-4 text-sm font-extrabold text-white">+ Nouveau compte</button>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wider text-ink-muted"><th className="p-3">Nom</th><th className="p-3">Adresses</th><th className="p-3">Rôle</th><th className="p-3">Société(s)</th><th className="p-3">Dernière connexion</th><th className="p-3" /></tr></thead>
            <tbody>
              {d.comptes.map(c => (
                <tr key={c.id} className={`border-t border-border ${c.active ? '' : 'opacity-50'}`}>
                  <td className="p-3 font-bold text-ink">{c.nom}{c.invite_par && <div className="text-xs font-normal text-ink-muted">ajouté par {d.comptes.find(x => x.id === c.invite_par)?.nom || '?'}</div>}</td>
                  <td className="p-3 text-ink-secondary">{c.emails.map(e => <div key={e}>{e}</div>)}</td>
                  <td className="p-3 text-ink-secondary">{c.role === 'societe' ? 'Société' : c.role === 'gestionnaire' ? 'Gestionnaire' : `Collaborateur${c.peut_inviter ? ' (peut inviter)' : ''}`}</td>
                  <td className="p-3 text-ink-secondary">{nomSoc(c.societe_ids)}</td>
                  <td className="p-3 text-ink-secondary">{c.derniere_connexion ? new Date(c.derniere_connexion).toLocaleString('fr-BE') : 'jamais'}</td>
                  <td className="whitespace-nowrap p-3 text-right">
                    {c.active && <button onClick={() => act({ action: 'inviter', id: c.id }, `Invitation envoyée à ${c.nom}`)} className="min-h-[40px] rounded-lg px-2 font-semibold text-brand">Envoyer l’invitation</button>}
                    <button onClick={() => setForm({ ...c, emailsTxt: c.emails.join(', ') })} className="min-h-[40px] rounded-lg px-2 font-semibold text-ink">Modifier</button>
                    <button onClick={() => act({ action: 'actif', id: c.id, actif: !c.active }, c.active ? 'Accès coupé' : 'Accès rétabli')} className="min-h-[40px] rounded-lg px-2 font-semibold text-ink-muted">{c.active ? 'Couper' : 'Rétablir'}</button>
                  </td>
                </tr>
              ))}
              {!d.comptes.length && <tr><td colSpan={6} className="p-4 text-ink-muted">Aucun compte.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink-muted">Derniers appels au dépannage</h2>
        <div className="rounded-2xl border border-border bg-surface p-3 text-sm">
          {d.appels.length ? d.appels.map(a => (
            <div key={a.id} className="flex gap-3 border-b border-border py-2 last:border-0">
              <span className="w-36 shrink-0 text-ink-muted">{new Date(a.created_at).toLocaleString('fr-BE')}</span>
              <span className={`font-semibold ${/echec/.test(a.status) ? 'text-red-700' : 'text-ink'}`}>{APPEL[a.status] || a.status}</span>
              {a.detail && <span className="text-ink-muted">{a.detail}</span>}
            </div>
          )) : <span className="text-ink-muted">Aucun appel pour l’instant.</span>}
        </div>
      </section>

      {form && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-start justify-between"><h3 className="text-lg font-extrabold text-ink">{form.id ? 'Modifier le compte' : 'Nouveau compte'}</h3><button onClick={() => setForm(null)} className="grid h-11 w-11 place-items-center rounded-xl text-ink-muted">✕</button></div>
            <input className="min-h-[44px] w-full rounded-xl border border-border bg-surface px-3 text-ink" placeholder="Nom affiché (ex. EBAC ou Justin Emontspool)" value={form.nom || ''} onChange={e => setForm({ ...form, nom: e.target.value })} />
            <input className="min-h-[44px] w-full rounded-xl border border-border bg-surface px-3 text-ink" placeholder="Adresse(s) de connexion, séparées par une virgule" value={form.emailsTxt || ''} onChange={e => setForm({ ...form, emailsTxt: e.target.value })} />
            <div className="space-y-1">
              {(Object.keys(ROLE) as Compte['role'][]).map(r => (
                <label key={r} className="flex min-h-[40px] items-center gap-2 text-sm text-ink"><input type="radio" checked={form.role === r} onChange={() => setForm({ ...form, role: r, societe_ids: r !== 'collaborateur' ? form.societe_ids : (form.societe_ids || []).slice(0, 1) })} />{ROLE[r]}</label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {d.societes.map(s => {
                const on = (form.societe_ids || []).includes(s.id)
                return <button key={s.id} type="button" onClick={() => setForm({ ...form, societe_ids: form.role !== 'collaborateur' ? (on ? form.societe_ids!.filter(x => x !== s.id) : [...(form.societe_ids || []), s.id]) : [s.id] })} className={`min-h-[44px] rounded-xl border px-3 text-sm font-bold ${on ? 'border-brand bg-brand text-white' : 'border-border text-ink'}`}>{s.nom}</button>
              })}
            </div>
            {form.role === 'collaborateur' && <label className="flex min-h-[40px] items-center gap-2 text-sm text-ink"><input type="checkbox" checked={!!form.peut_inviter} onChange={e => setForm({ ...form, peut_inviter: e.target.checked })} />Peut ajouter d’autres collaborateurs de sa société</label>}
            <button onClick={async () => { if (await act({ action: 'compte', id: form.id, nom: form.nom, emails: form.emailsTxt, role: form.role, societe_ids: form.societe_ids, peut_inviter: form.peut_inviter }, form.id ? 'Compte modifié' : 'Compte créé (pas encore d’invitation envoyée)')) setForm(null) }} className="min-h-[44px] w-full rounded-xl bg-brand font-extrabold text-white">Enregistrer</button>
            <p className="text-xs text-ink-muted">L’invitation ne part pas toute seule : bouton « Envoyer l’invitation » dans la liste.</p>
          </div>
        </div>
      )}
    </div>
  )
}
