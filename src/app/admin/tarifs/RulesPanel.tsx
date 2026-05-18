'use client'

import { useEffect, useState } from 'react'

interface Rule {
  id:                  string
  description:         string
  reason:              string | null
  filter_source:       string | null
  filter_mission_type: string | null
  filter_date_from:    string | null
  filter_date_to:      string | null
  filter_client_name:  string | null
  operation_type:      'add_fixed' | 'add_pct' | 'set_fixed'
  operation_value:     number
  active:              boolean
  priority:            number
  created_at:          string
}

interface ExtractedRule {
  description:         string
  reason:              string
  filter_source:       string | null
  filter_mission_type: string | null
  filter_date_from:    string | null
  filter_date_to:      string | null
  filter_client_name:  string | null
  operation_type:      'add_fixed' | 'add_pct' | 'set_fixed'
  operation_value:     number
  raw_quote:           string
}

const OP_LABELS: Record<string, string> = {
  add_fixed: 'Ajouter € fixe',
  add_pct:   'Ajouter %',
  set_fixed: 'Remplacer par € fixe',
}

const PLACEHOLDER = `Exemples :

• "Pour toutes les missions VAB de mai 2026, ajouter 2.50€ pour participation surcharge carburant"

• "Du 1er juin au 31 août 2026, majorer de 5% les remorquages Touring"

• "Pour le client AXA, remplacer le forfait par 75€ jusqu'au 31 décembre 2026"

Écris en français naturel, l'IA structure le reste.`

export default function RulesPanel() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)

  const [showValidation, setShowValidation] = useState(false)
  const [extracted, setExtracted] = useState<(ExtractedRule & { _include: boolean })[]>([])
  const [saving, setSaving] = useState(false)

  const loadRules = () => {
    setLoading(true)
    fetch('/api/admin/tarifs/rules')
      .then(r => r.json())
      .then(j => setRules(j.rules || []))
      .finally(() => setLoading(false))
  }
  useEffect(loadRules, [])

  const handleExtract = async () => {
    if (!text.trim()) return
    setExtracting(true)
    setExtractError(null)
    try {
      const res = await fetch('/api/admin/tarifs/rules/extract', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      })
      const data = await res.json()
      if (!res.ok) { setExtractError(data.error || 'Erreur'); return }
      if (!data.extracted || data.extracted.length === 0) {
        setExtractError('Aucune règle identifiée. Reformule ou sois plus précis.')
        return
      }
      setExtracted((data.extracted as ExtractedRule[]).map(r => ({ ...r, _include: true })))
      setShowValidation(true)
    } finally {
      setExtracting(false)
    }
  }

  const handleSaveExtracted = async () => {
    const toSave = extracted.filter(r => r._include).map(({ _include, ...rest }) => rest)
    if (toSave.length === 0) { alert('Aucune règle cochée'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/tarifs/rules', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rules: toSave }),
      })
      if (!res.ok) { alert((await res.json()).error); return }
      setShowValidation(false)
      setExtracted([])
      setText('')
      loadRules()
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (rule: Rule) => {
    await fetch(`/api/admin/tarifs/rules/${rule.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ active: !rule.active }),
    })
    loadRules()
  }

  const handleDelete = async (rule: Rule) => {
    if (!confirm(`Supprimer cette règle ?\n"${rule.description}"`)) return
    await fetch(`/api/admin/tarifs/rules/${rule.id}`, { method: 'DELETE' })
    loadRules()
  }

  const formatOp = (r: { operation_type: string; operation_value: number }) => {
    if (r.operation_type === 'add_fixed') return `+${r.operation_value.toFixed(2)} €`
    if (r.operation_type === 'add_pct')   return `+${r.operation_value}%`
    if (r.operation_type === 'set_fixed') return `= ${r.operation_value.toFixed(2)} €`
    return r.operation_value.toString()
  }

  return (
    <div className="space-y-4">
      {/* ── Chat input ─────────────────────────────────────────── */}
      <div className="bg-surface p-4 rounded-lg">
        <h3 className="font-display font-semibold text-sm mb-2 flex items-center gap-2">
          🤖 <span>Décris une règle tarifaire en français</span>
        </h3>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={6}
          placeholder={PLACEHOLDER}
          className="w-full px-3 py-2 bg-surface-hover rounded text-sm font-mono"
        />
        {extractError && <p className="text-red-500 text-xs mt-2">{extractError}</p>}
        <div className="flex justify-end mt-2">
          <button
            onClick={handleExtract}
            disabled={!text.trim() || extracting}
            className="px-4 py-2 bg-brand text-surface rounded font-medium text-sm disabled:opacity-50"
          >
            {extracting ? '⏳ Analyse IA…' : '🤖 Interpréter avec IA'}
          </button>
        </div>
      </div>

      {/* ── Liste règles existantes ───────────────────────────── */}
      <div className="bg-surface rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-surface-hover text-xs uppercase tracking-wider text-ink-faint">
          Règles actives ({rules.filter(r => r.active).length}/{rules.length})
        </div>

        {loading && <div className="p-4 text-ink-faint text-sm">Chargement…</div>}
        {!loading && rules.length === 0 && (
          <div className="p-6 text-center text-ink-faint text-sm">
            Aucune règle. Écris ta première règle en français en haut, puis clique "Interpréter avec IA".
          </div>
        )}

        {!loading && rules.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-faint uppercase tracking-wider">
              <tr className="border-b border-surface-hover">
                <th className="text-left p-2"></th>
                <th className="text-left p-2">Description</th>
                <th className="text-center p-2">Source</th>
                <th className="text-center p-2">Type</th>
                <th className="text-center p-2">Période</th>
                <th className="text-center p-2">Effet</th>
                <th className="text-center p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} className={`border-b border-surface-hover ${!r.active ? 'opacity-40' : ''}`}>
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={r.active}
                      onChange={() => handleToggleActive(r)}
                      title={r.active ? 'Désactiver' : 'Activer'}
                    />
                  </td>
                  <td className="p-2">
                    <div className="font-medium text-sm">{r.reason || '—'}</div>
                    <div className="text-xs text-ink-faint italic mt-0.5">"{r.description.slice(0, 100)}"</div>
                  </td>
                  <td className="p-2 text-center text-xs">{r.filter_source?.toUpperCase() || 'TOUS'}</td>
                  <td className="p-2 text-center text-xs">{r.filter_mission_type || 'TOUS'}</td>
                  <td className="p-2 text-center text-xs">
                    {r.filter_date_from || r.filter_date_to ? (
                      <>{r.filter_date_from || '∞'} → {r.filter_date_to || '∞'}</>
                    ) : '—'}
                  </td>
                  <td className="p-2 text-center font-mono text-sm font-bold">{formatOp(r)}</td>
                  <td className="p-2 text-center">
                    <button onClick={() => handleDelete(r)} title="Supprimer" className="text-red-500">🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Validation modal ──────────────────────────────────── */}
      {showValidation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-display font-bold mb-2">✅ Validation extraction IA</h2>
            <p className="text-sm text-ink-faint mb-4">
              {extracted.length} règle(s) extraite(s). Décoche celles qui sont incorrectes, ajuste si besoin.
            </p>

            <div className="space-y-3">
              {extracted.map((r, idx) => (
                <div key={idx} className={`p-3 rounded border ${r._include ? 'border-brand bg-brand/5' : 'border-surface-hover opacity-50'}`}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={r._include}
                      onChange={e => {
                        const next = [...extracted]
                        next[idx]._include = e.target.checked
                        setExtracted(next)
                      }}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm">{r.reason || '(sans raison)'}</div>
                      <div className="text-xs text-ink-faint italic mb-2">"{r.raw_quote}"</div>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                        <Tag label="Source" value={r.filter_source?.toUpperCase() || 'TOUS'} />
                        <Tag label="Type" value={r.filter_mission_type || 'TOUS'} />
                        <Tag label="Du" value={r.filter_date_from || '—'} />
                        <Tag label="Au" value={r.filter_date_to || '—'} />
                        <Tag label="Client" value={r.filter_client_name || '—'} />
                        <Tag label="Opération" value={OP_LABELS[r.operation_type] || r.operation_type} />
                        <Tag label="Valeur" value={r.operation_value.toString()} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-6 sticky bottom-0 bg-surface pt-3 border-t border-surface-hover">
              <button onClick={() => setShowValidation(false)} disabled={saving} className="px-4 py-2 bg-surface-hover rounded text-sm">
                Annuler
              </button>
              <div className="flex-1 text-center text-sm text-ink-faint self-center">
                {extracted.filter(x => x._include).length} règle(s) à enregistrer
              </div>
              <button onClick={handleSaveExtracted} disabled={saving} className="px-4 py-2 bg-brand text-surface rounded font-medium text-sm disabled:opacity-50">
                {saving ? '⏳' : '✅ Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Tag({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] text-ink-faint uppercase tracking-wider">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
