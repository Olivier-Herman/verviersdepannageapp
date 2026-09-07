'use client'

// Un bouton par outil de diagnostic, le résultat brut (JSON) affiché dessous.
// Les outils qui AGISSENT (reprocess, flush, impression, appel, notif) demandent
// une confirmation ; les autres sont en lecture seule.

import { useState } from 'react'
import { Loader2, Play, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'

type Param = { name: string; label: string; placeholder?: string; required?: boolean }
type Tool = {
  id:      string
  label:   string
  desc:    string
  method:  'GET' | 'POST'
  path:    string
  params?: Param[]
  action?: string          // libellé de confirmation si l'outil modifie quelque chose
  slow?:   boolean
}
type Group = { title: string; tools: Tool[] }

const GROUPS: Group[] = [
  { title: 'Mails & fiches', tools: [
    { id: 'recent', label: 'Dernières fiches reçues', desc: '20 dernières fiches toutes sources, avec les Touring et les erreurs de lecture repérées. Pour voir ce qu’un mail vient de produire.', method: 'GET', path: '/api/touring/recent' },
    { id: 'stuck', label: 'Relancer les mails bloqués', desc: 'Retraite directement les fiches « PROCESSING_ » restées bloquées (traitement de mail planté en cours).', method: 'GET', path: '/api/touring/reprocess-stuck', action: 'Relancer le traitement des mails bloqués ?' },
    { id: 'graph', label: 'Accès Graph fourriere@', desc: 'Jeton Microsoft + lecture des dossiers de la boîte fourriere@ (réquisitoires).', method: 'GET', path: '/api/requisitoires/graph-check' },
    { id: 'tgr', label: 'Planning TGR : erreur brute', desc: 'Tente de créer la mission planning d’une demande TGR et renvoie l’erreur Supabase brute si l’insertion échoue.', method: 'GET', path: '/api/tgr/debug-planning', params: [{ name: 'tgr', label: 'ID demande TGR', required: true }] },
  ]},
  { title: 'Touring COMEX', tools: [
    { id: 'comex', label: 'Connexion COMEX', desc: 'Login → liste des missions → détail de la première. Vérifie que la lecture COMEX fonctionne en prod.', method: 'GET', path: '/api/touring/comex-debug', slow: true },
    { id: 'comex-accept', label: 'État réel d’une mission sur COMEX', desc: 'Statut actuel, camion assigné et champs du détail côté COMEX, sans rien modifier.', method: 'GET', path: '/api/touring/comex-accept-debug', params: [{ name: 'mission', label: 'ID mission VD Soft', required: true }] },
    { id: 'bko', label: 'Colonnes brutes BKO d’un dossier', desc: 'Dump des colonnes COMEX BKO d’un dossier, pour retrouver l’index d’une valeur.', method: 'GET', path: '/api/touring/comex-bko/debug', params: [{ name: 'dossier', label: 'N° dossier Touring', placeholder: '2026BE301474', required: true }] },
  ]},
  { title: 'VAB', tools: [
    { id: 'vab-actions', label: 'Missions VAB disponibles', desc: 'Cartographie des missions VAB visibles et des boutons disponibles. Lecture seule, aucune action envoyée.', method: 'GET', path: '/api/admin/debug/vab-actions', slow: true },
    { id: 'vab-detail', label: 'Détail VAB', desc: 'Lecture du détail d’un dossier VAB tel que le connecteur le voit.', method: 'GET', path: '/api/vab/debug-detail', slow: true },
    { id: 'vab-scrape', label: 'Lecture complète VAB', desc: 'Lance le lecteur VAB synchrone et renvoie tout ce qu’il trouve. Long (30 s et plus).', method: 'GET', path: '/api/admin/debug/vab-scrape', slow: true },
  ]},
  { title: 'Odoo & facturation', tools: [
    { id: 'helpdesk', label: 'Champs d’un ticket helpdesk', desc: 'Tous les champs d’un ticket Odoo, pour vérifier un mapping.', method: 'GET', path: '/api/admin/odoo-helpdesk-debug', params: [{ name: 'id', label: 'ID ticket', placeholder: '2033', required: true }] },
    { id: 'delay', label: 'Délai moyen à facturer', desc: 'Moyenne, médiane et tranches du délai clôture → facture, sur la même fenêtre que le tableau de bord.', method: 'GET', path: '/api/admin/facturation-delay' },
  ]},
  { title: 'Parc & trajets', tools: [
    { id: 'zone', label: 'Diagnostic d’une zone de parc', desc: 'Places, occupants et incohérences d’une zone.', method: 'GET', path: '/api/admin/parc/diag-zone', params: [{ name: 'zone_key', label: 'Clé de zone', placeholder: 'K', required: true }] },
    { id: 'depot', label: 'Dépôt le plus proche (SNC)', desc: 'Quel dépôt le calcul retient pour un point donné, et pourquoi.', method: 'GET', path: '/api/admin/debug/snc-nearest-depot', params: [{ name: 'lat', label: 'Latitude', placeholder: '50.59', required: true }, { name: 'lng', label: 'Longitude', placeholder: '5.86', required: true }] },
  ]},
  { title: 'Canaux', tools: [
    { id: 'notif', label: 'Notification in-app de test', desc: 'Envoie une notification à ton compte : bandeau + son. Vérifie le canal temps réel.', method: 'POST', path: '/api/notifications/test', action: 'T’envoyer une notification de test ?' },
    { id: 'push', label: 'Push de test', desc: 'Envoie un push à tes appareils enregistrés (web, iOS, Android).', method: 'POST', path: '/api/push/test', action: 'Envoyer un push de test à tes appareils ?' },
    { id: 'teams', label: 'Appel Teams de test', desc: 'Déclenche un appel Teams. Sans numéro, appelle le dispatcher de garde.', method: 'POST', path: '/api/teams/test-call', params: [{ name: 'to', label: 'Numéro (optionnel)', placeholder: '+32…' }], action: 'Lancer un appel Teams de test ?' },
    { id: 'print', label: 'Impression d’étiquette de test', desc: 'Compose le ZPL côté VD Soft et l’envoie au PC d’impression.', method: 'GET', path: '/api/admin/labels/test-print', params: [{ name: 'ticket_id', label: 'ID ticket (optionnel)' }], action: 'Imprimer une étiquette de test sur la Zebra ?' },
  ]},
  { title: 'Session', tools: [
    { id: 'flush', label: 'Rafraîchir ma session', desc: 'Force l’expiration de ton jeton et en signe un nouveau (après un changement de rôle ou de modules).', method: 'POST', path: '/api/admin/flush-session', action: 'Rafraîchir ta session maintenant ?' },
  ]},
]

type Result = { status: number; ms: number; body: string; ok: boolean }

export default function DiagnosticsClient() {
  const [values,  setValues]  = useState<Record<string, Record<string, string>>>({})
  const [running, setRunning] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, Result>>({})
  const [open,    setOpen]    = useState<Record<string, boolean>>({})

  const run = async (t: Tool) => {
    const v = values[t.id] || {}
    for (const p of t.params || []) if (p.required && !String(v[p.name] || '').trim()) { alert(`${p.label} est requis.`); return }
    if (t.action && !confirm(t.action)) return
    setRunning(t.id)
    const t0 = Date.now()
    try {
      let url = t.path
      let init: RequestInit = { method: t.method }
      if (t.method === 'GET') {
        const qs = new URLSearchParams(Object.entries(v).filter(([, x]) => String(x).trim()).map(([k, x]) => [k, String(x).trim()]))
        if ([...qs.keys()].length) url += `?${qs}`
      } else {
        init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(Object.entries(v).filter(([, x]) => String(x).trim()))) }
      }
      const r = await fetch(url, init)
      const txt = await r.text()
      let body = txt
      try { body = JSON.stringify(JSON.parse(txt), null, 2) } catch {}
      setResults(prev => ({ ...prev, [t.id]: { status: r.status, ms: Date.now() - t0, body, ok: r.ok } }))
    } catch (e: any) {
      setResults(prev => ({ ...prev, [t.id]: { status: 0, ms: Date.now() - t0, body: e?.message || 'Erreur réseau', ok: false } }))
    } finally {
      setRunning(null); setOpen(prev => ({ ...prev, [t.id]: true }))
    }
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <header>
        <h1 className="text-ink font-bold text-2xl">Diagnostics</h1>
        <p className="text-ink-muted text-sm mt-1">Un bouton par vérification. Le résultat brut s’affiche sous l’outil. Les outils qui agissent demandent confirmation.</p>
      </header>

      {GROUPS.map(g => (
        <section key={g.title}>
          <h2 className="text-ink-muted text-xs uppercase tracking-wider font-semibold mb-3 px-1">{g.title}</h2>
          <div className="space-y-3">
            {g.tools.map(t => {
              const res = results[t.id]
              const busy = running === t.id
              return (
                <div key={t.id} className="bg-surface border rounded-2xl p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-ink font-semibold flex items-center gap-2">
                        {t.label}
                        {t.action && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-500/15 border border-amber-500/40 rounded-md px-1.5 py-0.5"><AlertTriangle size={11} /> agit</span>}
                        {t.slow && <span className="text-[11px] font-medium text-ink-muted bg-surface-2 border rounded-md px-1.5 py-0.5">lent</span>}
                      </p>
                      <p className="text-ink-muted text-sm mt-0.5">{t.desc}</p>
                      {t.params && t.params.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {t.params.map(p => (
                            <label key={p.name} className="text-xs text-ink-secondary flex flex-col gap-1">
                              {p.label}{p.required ? ' *' : ''}
                              <input value={values[t.id]?.[p.name] || ''} placeholder={p.placeholder}
                                onChange={e => setValues(prev => ({ ...prev, [t.id]: { ...(prev[t.id] || {}), [p.name]: e.target.value } }))}
                                className="border rounded-lg px-2 py-1.5 text-sm bg-surface text-ink w-44" />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => run(t)} disabled={busy || running !== null}
                      className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-brand text-white hover:opacity-90 disabled:opacity-40 transition">
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                      {busy ? 'En cours…' : 'Lancer'}
                    </button>
                  </div>
                  {res && (
                    <div className="mt-3 border-t pt-3">
                      <button onClick={() => setOpen(prev => ({ ...prev, [t.id]: !prev[t.id] }))} className="flex items-center gap-2 text-xs font-semibold">
                        {open[t.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className={res.ok ? 'text-emerald-700' : 'text-red-700'}>{res.status === 0 ? 'Erreur réseau' : `HTTP ${res.status}`}</span>
                        <span className="text-ink-muted font-normal">· {(res.ms / 1000).toFixed(1)} s</span>
                      </button>
                      {open[t.id] && (
                        <pre className="mt-2 text-xs bg-surface-2 border rounded-xl p-3 overflow-x-auto max-h-[28rem] whitespace-pre-wrap break-words text-ink">{res.body}</pre>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
