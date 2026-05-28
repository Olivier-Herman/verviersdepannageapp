'use client'

import { useState, useEffect, useMemo } from 'react'
import { TEST_CATALOG, TOTAL_TESTS, type TestFunction } from '@/lib/evaluations/test-catalog'
import { Send, CheckCircle2, AlertTriangle, XCircle, SkipForward, Loader2, ChevronDown, ChevronRight } from 'lucide-react'

type Status = 'success' | 'partial' | 'failed' | 'skipped'

interface Evaluation {
  function_id: string
  function_label: string
  status: Status
  ux_rating: number | null
  ui_rating: number | null
  comment: string
  suggestion: string
}

export default function EvaluationClient({ userName, userEmail }: { userName: string; userEmail: string }) {
  const [evaluations, setEvaluations] = useState<Record<string, Evaluation>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendStatus, setSendStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  // Charge les evaluations existantes au mount
  useEffect(() => {
    fetch('/api/evaluation/list').then(r => r.json()).then(j => {
      if (Array.isArray(j.evaluations)) {
        const map: Record<string, Evaluation> = {}
        for (const e of j.evaluations) {
          map[e.function_id] = {
            function_id:    e.function_id,
            function_label: e.function_label,
            status:         e.status,
            ux_rating:      e.ux_rating,
            ui_rating:      e.ui_rating,
            comment:        e.comment || '',
            suggestion:     e.suggestion || '',
          }
        }
        setEvaluations(map)
      }
    }).catch(() => {})
  }, [])

  const completedCount = Object.keys(evaluations).length

  function updateEval(fn: TestFunction, patch: Partial<Evaluation>) {
    setEvaluations(prev => {
      const base: Evaluation = prev[fn.id] || {
        function_id:    fn.id,
        function_label: fn.label,
        status:         'success',
        ux_rating:      null,
        ui_rating:      null,
        comment:        '',
        suggestion:     '',
      }
      return { ...prev, [fn.id]: { ...base, ...patch } }
    })
  }

  async function saveEval(fn: TestFunction) {
    const ev = evaluations[fn.id]
    if (!ev || !ev.status) return
    setSaving(fn.id)
    try {
      const r = await fetch('/api/evaluation/save', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(ev),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      // Affiche message succès quelques secondes
      setSendStatus({ kind: 'ok', msg: `✅ Évaluation #${fn.id} sauvegardée` })
      setTimeout(() => setSendStatus(null), 2500)
    } catch (e: any) {
      setSendStatus({ kind: 'err', msg: `⚠ ${e.message}` })
      setTimeout(() => setSendStatus(null), 5000)
    } finally {
      setSaving(null)
    }
  }

  async function sendReport() {
    if (completedCount === 0) {
      setSendStatus({ kind: 'err', msg: 'Aucune évaluation à envoyer.' })
      setTimeout(() => setSendStatus(null), 4000)
      return
    }
    if (!confirm(`Envoyer le rapport de ${completedCount} évaluations à mobi@verviersdepannage.be ?`)) return
    setSending(true); setSendStatus(null)
    try {
      const r = await fetch('/api/evaluation/send-report', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setSendStatus({ kind: 'ok', msg: `📧 Rapport envoyé à mobi@verviersdepannage.be (${j.count} fonctions)` })
    } catch (e: any) {
      setSendStatus({ kind: 'err', msg: `⚠ ${e.message}` })
    } finally { setSending(false) }
  }

  function toggleExpand(fnId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(fnId)) next.delete(fnId)
      else next.add(fnId)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header sticky avec compteur + bouton envoyer */}
      <header className="sticky top-0 z-40 bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-gray-900">📋 Évaluation VD Soft</h1>
            <p className="text-xs text-gray-500">
              Testeur : <strong>{userName}</strong> · {userEmail}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm">
              <span className="text-gray-500">Progression : </span>
              <span className="font-bold text-gray-900">{completedCount}</span>
              <span className="text-gray-500"> / {TOTAL_TESTS}</span>
            </div>
            <button
              onClick={sendReport}
              disabled={sending || completedCount === 0}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              Envoyer le rapport
            </button>
          </div>
        </div>
        {sendStatus && (
          <div className={`px-4 py-2 text-sm font-medium border-t ${
            sendStatus.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
          }`}>
            {sendStatus.msg}
          </div>
        )}
      </header>

      {/* Introduction */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="bg-blue-50 border-l-4 border-blue-500 rounded-r-lg p-4 mb-6">
          <h2 className="font-bold text-blue-900 mb-2">👋 Bienvenue {userName}</h2>
          <p className="text-sm text-blue-800 mb-2">
            Cette page liste toutes les fonctions à tester. Pour chacune :
          </p>
          <ol className="list-decimal ml-5 text-sm text-blue-800 space-y-1">
            <li>Lis la <strong>description</strong> et la <strong>procédure</strong></li>
            <li>Reproduis le test dans l'app (ouvre l'app dans un autre onglet)</li>
            <li>Évalue : statut, note UX, note UI, commentaire, suggestion</li>
            <li>Clique <strong>Sauvegarder</strong> — tu peux y revenir plus tard</li>
            <li>Quand tu as terminé (ou en cours de route), clique <strong>Envoyer le rapport</strong> en haut à droite</li>
          </ol>
          <div className="mt-3 p-3 bg-white rounded border border-blue-200 text-xs text-gray-700">
            <p><strong>📐 UX (Expérience Utilisateur) :</strong> facilité d'utilisation, fluidité du workflow, intuitivité. C'est l'impression « est-ce que ça marche bien et facilement ? »</p>
            <p className="mt-1"><strong>🎨 UI (Interface Utilisateur) :</strong> design visuel, lisibilité, esthétique. C'est l'impression « est-ce que c'est joli et bien organisé visuellement ? »</p>
          </div>
        </div>

        {/* Liste des fonctions groupées par section */}
        {TEST_CATALOG.map(section => (
          <section key={section.id} className="mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-2">
              <span>{section.emoji}</span>
              <span>{section.title}</span>
              <span className="text-sm font-normal text-gray-500">
                ({section.functions.filter(f => evaluations[f.id]).length} / {section.functions.length})
              </span>
            </h2>

            <div className="space-y-2">
              {section.functions.map(fn => {
                const ev = evaluations[fn.id]
                const isExpanded = expanded.has(fn.id)
                const statusInfo = ev ? STATUS_INFO[ev.status] : null
                return (
                  <div key={fn.id} className={`bg-white border rounded-lg overflow-hidden ${
                    ev ? `border-l-4 ${statusInfo?.borderClass}` : 'border-gray-200'
                  }`}>
                    {/* Header cliquable */}
                    <button
                      onClick={() => toggleExpand(fn.id)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-bold flex-shrink-0">
                          #{fn.id}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate">{fn.label}</p>
                          <p className="text-xs text-gray-500 truncate">{fn.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {ev && statusInfo && (
                          <span className={`text-xs font-bold ${statusInfo.textClass}`}>
                            {statusInfo.label}
                          </span>
                        )}
                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </div>
                    </button>

                    {/* Détails + formulaire */}
                    {isExpanded && (
                      <div className="px-4 py-4 border-t bg-gray-50 space-y-4">
                        {/* Procédure */}
                        <div>
                          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">Procédure de test</p>
                          <ol className="list-decimal ml-5 text-sm text-gray-700 space-y-1">
                            {fn.procedure.map((step, i) => <li key={i}>{step}</li>)}
                          </ol>
                          {fn.tip && (
                            <div className="mt-2 p-2 bg-emerald-50 border-l-3 border-emerald-500 text-xs text-emerald-800 rounded">
                              💡 {fn.tip}
                            </div>
                          )}
                          <p className="text-xs text-gray-500 mt-2">
                            <strong>Permissions :</strong> {fn.permissions}
                          </p>
                        </div>

                        {/* Form évaluation */}
                        <div className="bg-white p-4 rounded border space-y-3">
                          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Ton évaluation</p>

                          {/* Statut */}
                          <div>
                            <p className="text-xs font-medium text-gray-700 mb-1">Statut du test *</p>
                            <div className="grid grid-cols-4 gap-1">
                              {(['success', 'partial', 'failed', 'skipped'] as Status[]).map(s => (
                                <button
                                  key={s}
                                  onClick={() => updateEval(fn, { status: s })}
                                  className={`px-2 py-2 text-xs font-bold rounded border transition ${
                                    ev?.status === s
                                      ? `${STATUS_INFO[s].bgActive} text-white border-transparent`
                                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                  }`}
                                >
                                  {STATUS_INFO[s].label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* UX rating */}
                          <div>
                            <p className="text-xs font-medium text-gray-700 mb-1">
                              UX (facilité d'utilisation, fluidité)
                            </p>
                            <StarRating
                              value={ev?.ux_rating ?? null}
                              onChange={v => updateEval(fn, { ux_rating: v })}
                            />
                          </div>

                          {/* UI rating */}
                          <div>
                            <p className="text-xs font-medium text-gray-700 mb-1">
                              UI (design visuel, lisibilité)
                            </p>
                            <StarRating
                              value={ev?.ui_rating ?? null}
                              onChange={v => updateEval(fn, { ui_rating: v })}
                            />
                          </div>

                          {/* Commentaire */}
                          <div>
                            <p className="text-xs font-medium text-gray-700 mb-1">Commentaire</p>
                            <textarea
                              value={ev?.comment || ''}
                              onChange={e => updateEval(fn, { comment: e.target.value })}
                              rows={2}
                              placeholder="Décris ce qui marche bien ou mal..."
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                            />
                          </div>

                          {/* Suggestion */}
                          <div>
                            <p className="text-xs font-medium text-gray-700 mb-1">
                              💡 Évolution / suggestion d'amélioration
                            </p>
                            <textarea
                              value={ev?.suggestion || ''}
                              onChange={e => updateEval(fn, { suggestion: e.target.value })}
                              rows={2}
                              placeholder="Propose une amélioration concrète..."
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-emerald-500"
                            />
                          </div>

                          {/* Sauvegarder */}
                          <button
                            onClick={() => saveEval(fn)}
                            disabled={!ev?.status || saving === fn.id}
                            className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2"
                          >
                            {saving === fn.id ? <><Loader2 size={14} className="animate-spin" /> Sauvegarde...</> : '💾 Sauvegarder cette évaluation'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}

        {/* Footer recap */}
        <div className="mt-12 p-4 bg-gray-100 rounded-lg text-center text-sm text-gray-600">
          <p>Tu peux fermer cette page et y revenir quand tu veux — tes évaluations sont sauvegardées dans la base.</p>
          <p className="mt-1">Quand tu as terminé : clique « Envoyer le rapport » en haut.</p>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────
const STATUS_INFO: Record<Status, { label: string; textClass: string; borderClass: string; bgActive: string }> = {
  success: { label: '✅ Réussi',  textClass: 'text-emerald-700', borderClass: 'border-l-emerald-500', bgActive: 'bg-emerald-600' },
  partial: { label: '⚠️ Partiel', textClass: 'text-amber-700',   borderClass: 'border-l-amber-500',   bgActive: 'bg-amber-600' },
  failed:  { label: '❌ Échoué',  textClass: 'text-red-700',     borderClass: 'border-l-red-500',     bgActive: 'bg-red-600' },
  skipped: { label: '⏭️ Passé',   textClass: 'text-gray-700',    borderClass: 'border-l-gray-400',    bgActive: 'bg-gray-500' },
}

function StarRating({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          onClick={() => onChange(n)}
          type="button"
          className={`text-2xl transition ${
            value != null && n <= value ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'
          }`}
        >
          ★
        </button>
      ))}
      {value != null && (
        <span className="ml-2 text-sm text-gray-600">{value} / 5</span>
      )}
    </div>
  )
}
