'use client'

import { useEffect, useRef, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { FOURRIERE_ZONES } from '@/lib/fourriere'
import { Loader2, CheckCircle2, AlertCircle, Printer, Plus, RefreshCw, Download, Settings, ScanLine } from 'lucide-react'

interface Props {
  userRole:    string
  userName:    string
  userEmail:   string
  userModules: string[]
}

interface ParsedQR {
  type:      'ours' | 'towsoft'
  ticketId?: string
  missionNum?: string
}

interface ResultItem {
  status:         'loading' | 'ok' | 'error'
  type?:          'reprint' | 'created' | 'updated' | 'error'
  label:          string
  sublabel?:      string
  msg?:           string
  zone?:          string
  printed?:       boolean
  vehicleCreated?: boolean
  // pour CSV
  missionNum?:    string
  refDossier?:    string
  dateMission?:   string
  marque?:        string
  modele?:        string
  plaque?:        string
  vin?:           string
  motif?:         string
  parc?:          string
}

interface Stats {
  total:     number
  created:   number
  updated:   number
  reprinted: number
  errors:    number
}

/** Tag mensuel format MMYYYY (ex: 052026). */
function currentTag(): string {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`
}

/** Parse une chaine scannee. Reconnait :
 *  - verviers-qr.vercel.app/v/X (legacy)
 *  - app.verviersdepannage.com/v/X (nouveau)
 *  - towsoft.ca/appel.php?num=X
 *  - Juste un numero (assume Towsoft) */
function parseQR(raw: string): ParsedQR | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const oursMatch = trimmed.match(/(?:verviers-qr\.vercel\.app|verviersapp-omega\.vercel\.app|app\.verviersdepannage\.com)\/v\/(\d+)/i)
  if (oursMatch) return { type: 'ours', ticketId: oursMatch[1] }

  const tsMatch = trimmed.match(/towsoft\.ca\/appel\.php\?num=(\d+)/i)
  if (tsMatch) return { type: 'towsoft', missionNum: tsMatch[1] }

  if (/^\d{4,7}$/.test(trimmed)) return { type: 'towsoft', missionNum: trimmed }

  return null
}

export default function InventaireClient({ userRole, userName, userEmail, userModules }: Props) {
  const [step, setStep]                 = useState<'setup' | 'scan'>('setup')
  const [selectedZone, setSelectedZone] = useState<{ stateId: number; code: string; label: string; fullName: string } | null>(null)
  const tagName                         = currentTag()
  const [scanInput, setScanInput]       = useState('')
  const [processing, setProcessing]     = useState(false)
  const [currentItem, setCurrentItem]   = useState<ResultItem | null>(null)
  const [items, setItems]               = useState<ResultItem[]>([])
  const [stats, setStats]               = useState<Stats>({ total: 0, created: 0, updated: 0, reprinted: 0, errors: 0 })
  const scanRef = useRef<HTMLInputElement>(null)

  // Auto-focus quand on entre en mode scan
  useEffect(() => {
    if (step === 'scan' && scanRef.current) {
      setTimeout(() => scanRef.current?.focus(), 100)
    }
  }, [step])

  async function processScan(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed || processing) return
    setScanInput('')

    const parsed = parseQR(trimmed)
    if (!parsed) {
      setCurrentItem({ status: 'error', type: 'error', label: trimmed, msg: 'QR non reconnu' })
      setItems(prev => [{ status: 'error', type: 'error', label: trimmed, msg: 'QR non reconnu', zone: selectedZone?.label }, ...prev])
      setStats(prev => ({ ...prev, total: prev.total + 1, errors: prev.errors + 1 }))
      setTimeout(() => scanRef.current?.focus(), 200)
      return
    }

    setProcessing(true)
    try {
      if (parsed.type === 'ours') {
        // Cas 1 : QR Verviers-QR / verviers-app → reprint + tag mensuel
        setCurrentItem({ status: 'loading', label: `Ticket #${parsed.ticketId} — réimpression…` })

        const res = await fetch('/api/inventaire/reprint', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            ticketId: parsed.ticketId,
            tagName,
            stateId:  selectedZone?.stateId,
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(data.error || 'Erreur réimpression')

        const result: ResultItem = {
          status:  'ok',
          type:    'reprint',
          label:   `Ticket #${parsed.ticketId}`,
          printed: data.printed,
          zone:    selectedZone?.label,
        }
        setCurrentItem(result)
        setItems(prev => [result, ...prev])
        setStats(prev => ({ ...prev, total: prev.total + 1, reprinted: prev.reprinted + 1 }))

      } else {
        // Cas 2 : QR Towsoft → scrape + create/update + tag mensuel + print
        setCurrentItem({ status: 'loading', label: `Mission #${parsed.missionNum} — scraping TowSoft…` })

        const scrapeRes = await fetch(`/api/inventaire/scrape?num=${encodeURIComponent(parsed.missionNum!)}`)
        const scrapeData = await scrapeRes.json()
        if (!scrapeRes.ok || !scrapeData.ok) throw new Error(scrapeData.error || 'Scraping échoué')

        const td = scrapeData.data
        setCurrentItem({ status: 'loading', label: `${td.plaque || td.missionNum} — traitement Odoo…` })

        const processRes = await fetch('/api/inventaire/process', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ towsoftData: td, stateId: selectedZone?.stateId, tagName }),
        })
        const processData = await processRes.json()
        if (!processRes.ok || !processData.ok) throw new Error(processData.error || 'Traitement échoué')

        const result: ResultItem = {
          status:         'ok',
          type:           processData.vehicleCreated ? 'created' : 'updated',
          label:          processData.plate || td.plaque || `Mission #${parsed.missionNum}`,
          sublabel:       `${td.marque || ''} ${td.modele || ''}`.trim(),
          vehicleCreated: processData.vehicleCreated,
          printed:        processData.printed,
          zone:           selectedZone?.label,
          missionNum:     td.missionNum,
          refDossier:     td.refDossier,
          dateMission:    td.dateMission,
          marque:         td.marque,
          modele:         td.modele,
          plaque:         processData.plate || td.plaque,
          vin:            td.vin,
          motif:          td.motif,
          parc:           td.parc,
        }
        setCurrentItem(result)
        setItems(prev => [result, ...prev])
        setStats(prev => ({
          ...prev,
          total: prev.total + 1,
          created: prev.created + (processData.vehicleCreated ? 1 : 0),
          updated: prev.updated + (!processData.vehicleCreated ? 1 : 0),
        }))
      }
    } catch (err: any) {
      const errorItem: ResultItem = {
        status: 'error',
        type:   'error',
        label:  parsed.missionNum || parsed.ticketId || '?',
        msg:    err.message || String(err),
        zone:   selectedZone?.label,
      }
      setCurrentItem(errorItem)
      setItems(prev => [errorItem, ...prev])
      setStats(prev => ({ ...prev, total: prev.total + 1, errors: prev.errors + 1 }))
    } finally {
      setProcessing(false)
      setTimeout(() => scanRef.current?.focus(), 300)
    }
  }

  async function exportCSV() {
    const exportItems = items.filter(i => i.status === 'ok' && i.type !== 'reprint')
    if (exportItems.length === 0) {
      alert('Aucun véhicule à exporter (les réimpressions ne sont pas incluses)')
      return
    }
    const res = await fetch('/api/inventaire/export', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ items: exportItems }),
    })
    if (!res.ok) { alert('Erreur export'); return }
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `inventaire-${tagName}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AppShell title="Inventaire fourrière" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-2xl mx-auto p-4 space-y-4">

        {step === 'setup' && (
          <div className="bg-surface border rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Settings size={18} className="text-brand" />
              <h2 className="font-display font-bold text-lg">Préparation de la session</h2>
            </div>

            <div className="bg-brand/5 border border-brand/20 rounded-lg p-3 text-xs text-ink-secondary">
              <p className="flex items-center gap-2">
                <span>🏷️</span>
                <span>Tag mensuel : <strong className="text-brand font-mono">{tagName}</strong> (ajouté à chaque véhicule scanné)</span>
              </p>
              <p className="mt-1 flex items-center gap-2">
                <span>📷</span>
                <span>Branche ton scanner Bluetooth (mode clavier), il tapera les QR scannés dans le champ</span>
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-ink-faint uppercase tracking-wider">Zone à inventorier</label>
              <p className="text-xs text-ink-muted mb-2">Les véhicules scannés seront mis dans cette zone (en plus du tag mensuel).</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {FOURRIERE_ZONES.map(z => (
                  <button
                    key={z.state_id}
                    onClick={() => setSelectedZone({
                      stateId:  z.state_id,
                      code:     z.code,
                      label:    z.label,
                      fullName: z.full_name,
                    })}
                    className={`p-3 rounded-xl border text-left transition ${
                      selectedZone?.stateId === z.state_id
                        ? 'bg-brand text-white border-brand shadow-md'
                        : 'bg-surface-2 hover:bg-surface-hover border-surface-hover'
                    }`}
                  >
                    <div className="font-display font-bold text-lg">{z.code}</div>
                    <div className="text-[10px] truncate opacity-80">{z.description || z.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setStep('scan')}
              disabled={!selectedZone}
              className="w-full py-3 bg-brand text-white rounded-xl font-medium disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <ScanLine size={18} />
              Démarrer le scan
            </button>
          </div>
        )}

        {step === 'scan' && selectedZone && (
          <>
            {/* Header session */}
            <div className="bg-surface border rounded-2xl p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-ink-faint">Zone cible</div>
                <div className="font-display font-bold flex items-center gap-2">
                  <span className="text-brand">{selectedZone.code}</span>
                  <span className="text-ink text-sm font-normal truncate">— {selectedZone.label}</span>
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className="text-xs text-ink-faint">Tag mensuel</div>
                <div className="font-mono font-bold text-brand">🏷️ {tagName}</div>
              </div>
              <button
                onClick={() => { setStep('setup'); setCurrentItem(null) }}
                className="p-2 text-ink-muted hover:text-ink"
                title="Changer de zone"
              >
                <Settings size={16} />
              </button>
            </div>

            {/* Input scan */}
            <div className="bg-surface border-2 border-brand rounded-2xl p-4">
              <input
                ref={scanRef}
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    processScan(scanInput)
                  }
                }}
                disabled={processing}
                placeholder="Scanner un QR code ou taper un numéro de mission Towsoft…"
                className="w-full bg-surface-2 border rounded-xl px-3 py-3 text-ink text-base focus:outline-none focus:border-brand placeholder:text-ink-faint disabled:opacity-50 font-mono"
              />
              <p className="text-[11px] text-ink-faint mt-2 flex items-center gap-1">
                {processing ? <><Loader2 className="animate-spin" size={11} /> En cours…</> : 'Le scanner tape automatiquement puis valide avec Entrée'}
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-5 gap-2">
              <Stat label="Total" value={stats.total} color="ink" />
              <Stat label="Créés" value={stats.created} color="brand" />
              <Stat label="MAJ" value={stats.updated} color="info" />
              <Stat label="Réimp." value={stats.reprinted} color="purple-500" />
              <Stat label="Erreurs" value={stats.errors} color="critical" />
            </div>

            {/* Item en cours */}
            {currentItem && <CurrentCard item={currentItem} />}

            {/* Boutons */}
            <div className="flex gap-2">
              <button
                onClick={exportCSV}
                disabled={items.filter(i => i.status === 'ok' && i.type !== 'reprint').length === 0}
                className="flex-1 py-2.5 bg-surface-hover hover:bg-surface text-ink-secondary hover:text-ink border rounded-xl text-sm font-medium transition disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Download size={14} />
                Exporter CSV
              </button>
              <button
                onClick={() => { if (confirm('Vider l\'historique de la session ?')) { setItems([]); setCurrentItem(null); setStats({ total: 0, created: 0, updated: 0, reprinted: 0, errors: 0 }) } }}
                className="px-4 py-2.5 bg-surface-hover hover:bg-critical-soft text-ink-secondary hover:text-critical border rounded-xl text-sm transition"
                title="Vider la session"
              >
                <RefreshCw size={14} />
              </button>
            </div>

            {/* Historique */}
            {items.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold text-ink-faint uppercase tracking-wider px-1">Historique ({items.length})</h3>
                {items.map((item, i) => <HistoryItem key={i} item={item} />)}
              </div>
            )}
          </>
        )}

      </div>
    </AppShell>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  const cls = {
    ink:        'text-ink',
    brand:      'text-brand',
    info:       'text-info',
    'purple-500': 'text-purple-500',
    critical:   'text-critical',
  }[color] || 'text-ink'
  return (
    <div className="bg-surface border rounded-xl p-2 text-center">
      <div className={`font-display font-bold text-xl ${cls}`}>{value}</div>
      <div className="text-[10px] text-ink-faint">{label}</div>
    </div>
  )
}

function CurrentCard({ item }: { item: ResultItem }) {
  const bg = item.status === 'loading' ? 'bg-brand/5 border-brand/30'
    : item.status === 'ok' ? 'bg-success-soft border-success/40'
    : 'bg-critical-soft border-critical/40'
  const icon = item.status === 'loading' ? <Loader2 className="animate-spin text-brand" size={18} />
    : item.status === 'ok' ? <CheckCircle2 className="text-success" size={18} />
    : <AlertCircle className="text-critical" size={18} />
  return (
    <div className={`border rounded-2xl p-4 ${bg}`}>
      <div className="flex items-start gap-2 mb-1">
        {icon}
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-sm">{item.label}</div>
          {item.sublabel && <div className="text-xs text-ink-secondary">{item.sublabel}</div>}
          {item.msg && <div className="text-xs text-critical mt-1">{item.msg}</div>}
        </div>
      </div>
      {item.status === 'ok' && (
        <div className="flex flex-wrap gap-1.5 mt-2 text-[10px]">
          {item.type === 'created'  && <Badge color="brand">🆕 Créé</Badge>}
          {item.type === 'updated'  && <Badge color="info">✏️ MAJ</Badge>}
          {item.type === 'reprint'  && <Badge color="purple">🔁 Réimprimé</Badge>}
          {item.printed && <Badge color="success"><Printer size={10} /> Étiquette OK</Badge>}
          {item.printed === false && <Badge color="warning">⚠️ Impression échouée</Badge>}
          {item.zone && <Badge color="ink">Zone : {item.zone}</Badge>}
        </div>
      )}
    </div>
  )
}

function HistoryItem({ item }: { item: ResultItem }) {
  const icon = item.status === 'ok' ? '✅' : item.status === 'error' ? '❌' : '⏳'
  const typeColor = item.type === 'created' ? 'text-brand' : item.type === 'reprint' ? 'text-purple-500' : item.type === 'updated' ? 'text-info' : 'text-ink-faint'
  return (
    <div className="bg-surface border rounded-xl px-3 py-2 flex items-center gap-3 text-sm">
      <span className="flex-shrink-0 text-base">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-ink font-medium truncate">{item.label}</div>
        {(item.sublabel || item.msg) && <div className="text-xs text-ink-faint truncate">{item.sublabel || item.msg}</div>}
      </div>
      {item.type && (
        <span className={`flex-shrink-0 text-[10px] font-semibold uppercase ${typeColor}`}>
          {item.type === 'created' ? 'NEW' : item.type === 'updated' ? 'MAJ' : item.type === 'reprint' ? 'REPR' : 'ERR'}
        </span>
      )}
      {item.printed === true && <Printer size={12} className="text-success flex-shrink-0" />}
    </div>
  )
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  const cls = {
    brand:    'bg-brand/15 text-brand',
    info:     'bg-info/15 text-info',
    purple:   'bg-purple-500/15 text-purple-500',
    success:  'bg-success/15 text-success',
    warning:  'bg-warning/15 text-warning',
    ink:      'bg-ink-faint/15 text-ink-secondary',
  }[color] || 'bg-ink-faint/15 text-ink-secondary'
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${cls} font-medium`}>
      {children}
    </span>
  )
}
