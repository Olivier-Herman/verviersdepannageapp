'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { FOURRIERE_ZONES } from '@/lib/fourriere'
import { Loader2, CheckCircle2, AlertCircle, Printer, Plus, RefreshCw, Download, Settings, ScanLine, Camera, Mail, MapPin, ArrowRight, X, FileSpreadsheet, Car } from 'lucide-react'
import { playWinSound, playLoseSound } from '@/lib/sounds'
import dynamic from 'next/dynamic'

const QRScanner = dynamic(() => import('@/components/fourriere/QRScanner'), { ssr: false })

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
  ticketId?:      number   // pour bouton "imprimer cette etiquette" a la demande
  // pour CSV / XLSX
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

interface ParcZone {
  key:              string
  label:            string
  sort_order:       number
  strict_capacity?: boolean
}

interface ParcRow {
  id:         number
  zone_key:   string
  row_number: number
  capacity:   number
  sort_order: number
}

interface MissingVehicle {
  id:               string
  external_id:      string
  vehicle_plate:    string | null
  vehicle_brand:    string | null
  vehicle_model:    string | null
  client_name:      string | null
  status:           string
  parc_zone_key:    string | null
  parc_row_number:  number | null
  parc_slot_index:  number | null
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
  const [cameraOpen, setCameraOpen]     = useState(false)
  const [autoPrint, setAutoPrint]       = useState(false)
  // Session DB pour synchro cross-device (iPhone scan ↔ Mac telecharge)
  const [sessionId, setSessionId]       = useState<string | null>(null)
  const [restoring, setRestoring]       = useState(true)
  // Nouveau : positionnement spatial (rangee + slot)
  const [parcZones, setParcZones]       = useState<ParcZone[]>([])
  const [parcRows, setParcRows]         = useState<ParcRow[]>([])
  const [parcRowNumber, setParcRowNumber] = useState<number | null>(null)
  const [nextSlot, setNextSlot]         = useState<number>(1)
  // Dialog de fin d inventaire (vehicules manquants)
  const [completing, setCompleting]     = useState(false)
  const [missing, setMissing]           = useState<MissingVehicle[] | null>(null)
  const [finishingZone, setFinishingZone] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)

  // Mapping FOURRIERE_ZONES.code -> parc_zones.key (case insensitive)
  const parcZoneKey = useMemo(() => {
    if (!selectedZone) return null
    const code = selectedZone.code.toLowerCase()
    return parcZones.find(z => z.key.toLowerCase() === code)?.key || null
  }, [selectedZone, parcZones])

  // Rangees disponibles pour la zone selectionnee, triees par sort_order
  const availableRows = useMemo<ParcRow[]>(() => {
    if (!parcZoneKey) return []
    return parcRows
      .filter(r => r.zone_key === parcZoneKey)
      .sort((a, b) => (a.sort_order || a.row_number) - (b.sort_order || b.row_number))
  }, [parcZoneKey, parcRows])

  // Mode strict de la zone courante : si non-strict, l affichage de la capacite
  // ajoute "+1" pour signaler l overflow tolere.
  const currentZoneStrict = useMemo<boolean>(() => {
    if (!parcZoneKey) return true
    return parcZones.find(z => z.key === parcZoneKey)?.strict_capacity ?? false
  }, [parcZoneKey, parcZones])

  const currentRow = useMemo<ParcRow | null>(() => {
    if (parcRowNumber == null || !parcZoneKey) return null
    return parcRows.find(r => r.zone_key === parcZoneKey && r.row_number === parcRowNumber) || null
  }, [parcRowNumber, parcZoneKey, parcRows])

  // Suggere la rangee suivante (apres validation) selon sort_order
  function suggestNextRow(): ParcRow | null {
    if (!currentRow) return availableRows[0] || null
    const idx = availableRows.findIndex(r => r.row_number === currentRow.row_number)
    if (idx < 0 || idx + 1 >= availableRows.length) return null
    return availableRows[idx + 1]
  }

  // Charge zones+rows du parc (une fois au mount)
  useEffect(() => {
    let canceled = false
    fetch('/api/parc/state')
      .then(r => r.json())
      .then(j => {
        if (canceled) return
        if (Array.isArray(j.zones)) setParcZones(j.zones)
        if (Array.isArray(j.rows))  setParcRows(j.rows)
      })
      .catch(() => {})
    return () => { canceled = true }
  }, [])

  // Restore session active au mount (synchro cross-device)
  useEffect(() => {
    let canceled = false
    fetch('/api/inventaire/sessions/current')
      .then(r => r.json())
      .then(j => {
        if (canceled) return
        if (j.ok && j.session) {
          setSessionId(j.session.id)
          setAutoPrint(Boolean(j.session.auto_print))
          if (j.session.zone_state_id) {
            setSelectedZone({
              stateId:  j.session.zone_state_id,
              code:     j.session.zone_code || '',
              label:    j.session.zone_label || '',
              fullName: j.session.zone_full_name || '',
            })
          }
          if (j.session.parc_row_number != null) setParcRowNumber(j.session.parc_row_number)
          if (j.session.next_slot_index != null) setNextSlot(j.session.next_slot_index)
          // Restaure items depuis DB (deja tries desc par created_at)
          const restoredItems: ResultItem[] = (j.items || []).map((it: any) => ({
            status:         it.status,
            type:           it.item_type,
            label:          it.label || '',
            sublabel:       it.sublabel || undefined,
            msg:            it.msg || undefined,
            zone:           it.zone || undefined,
            printed:        it.printed === null ? undefined : it.printed,
            ticketId:       it.ticket_id || undefined,
            missionNum:     it.mission_num || undefined,
            refDossier:     it.ref_dossier || undefined,
            dateMission:    it.date_mission || undefined,
            marque:         it.marque || undefined,
            modele:         it.modele || undefined,
            plaque:         it.plaque || undefined,
            vin:            it.vin || undefined,
            motif:          it.motif || undefined,
            parc:           it.parc || undefined,
          }))
          setItems(restoredItems)
          // Re-calcul stats
          setStats({
            total:     restoredItems.length,
            created:   restoredItems.filter(i => i.type === 'created').length,
            updated:   restoredItems.filter(i => i.type === 'updated').length,
            reprinted: restoredItems.filter(i => i.type === 'reprint').length,
            errors:    restoredItems.filter(i => i.status === 'error').length,
          })
          // Si zone definie : on saute direct au mode scan
          if (j.session.zone_state_id) setStep('scan')
        }
      })
      .catch(() => {})
      .finally(() => { if (!canceled) setRestoring(false) })
    return () => { canceled = true }
  }, [])

  // Auto-focus quand on entre en mode scan
  useEffect(() => {
    if (step === 'scan' && scanRef.current) {
      setTimeout(() => scanRef.current?.focus(), 100)
    }
  }, [step])

  /** Persiste un item dans la session DB (async, ne bloque pas l UI). */
  function persistItem(item: ResultItem, extras: Record<string, any> = {}) {
    if (!sessionId) return
    fetch(`/api/inventaire/sessions/${sessionId}/items`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...item, ...extras }),
    }).catch(e => console.warn('[inventaire] persist item fail:', e))
  }

  interface PlaceScanResult {
    ok:           boolean
    placed:       boolean
    mission_id?:  string
    was_at?:      { zone_key: string; row_number: number; slot_index: number } | null
    transferred?: boolean
    reason?:      string
  }

  /** Appelle place-scan : positionne la voiture sur le plan au slot courant.
   *  Retourne null si offline / pas de rangee / erreur (loguee dans la console). */
  async function placeOnPlan(payload: { plaque?: string; ticket_id?: number; mission_num?: string }): Promise<PlaceScanResult | null> {
    if (!parcZoneKey || parcRowNumber == null) return null
    try {
      const res = await fetch('/api/inventaire/place-scan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ...payload,
          zone_key:   parcZoneKey,
          row_number: parcRowNumber,
          slot_index: nextSlot,
        }),
      })
      const j = await res.json()
      if (!res.ok) {
        console.warn('[place-scan]', j.error)
        return null
      }
      return j as PlaceScanResult
    } catch (e) {
      console.warn('[place-scan] reseau', e)
      return null
    }
  }

  /** Met a jour next_slot_index cote DB. */
  function persistNextSlot(value: number) {
    if (!sessionId) return
    fetch(`/api/inventaire/sessions/${sessionId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ next_slot_index: value }),
    }).catch(() => {})
  }

  async function processScan(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed || processing) return
    setScanInput('')

    const parsed = parseQR(trimmed)
    if (!parsed) {
      playLoseSound()
      const errItem: ResultItem = { status: 'error', type: 'error', label: trimmed, msg: 'QR non reconnu', zone: selectedZone?.label }
      setCurrentItem(errItem)
      setItems(prev => [errItem, ...prev])
      setStats(prev => ({ ...prev, total: prev.total + 1, errors: prev.errors + 1 }))
      persistItem(errItem)
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
            print:    autoPrint,
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(data.error || 'Erreur')

        playWinSound()
        // Positionnement sur le plan visuel (silencieux si pas de rangee selectionnee)
        const place = await placeOnPlan({
          plaque:      data.plate || undefined,
          ticket_id:   parseInt(String(parsed.ticketId), 10),
          mission_num: data.missionNum || undefined,
        })
        const placedHere = place?.placed ? `${parcZoneKey}${parcRowNumber}-${nextSlot}` : undefined
        const transferFrom = place?.transferred && place.was_at
          ? `${place.was_at.zone_key}${place.was_at.row_number}-${place.was_at.slot_index}`
          : undefined
        const result: ResultItem = {
          status:      'ok',
          type:        'reprint',
          // Si on a la plaque, on l affiche en titre. Sinon fallback ticket #.
          label:       data.plate || `Ticket #${parsed.ticketId}`,
          sublabel:    [data.brand, data.model].filter(Boolean).join(' ') || undefined,
          printed:     data.printed,
          zone:        placedHere || selectedZone?.label,
          ticketId:    parseInt(String(parsed.ticketId), 10),
          plaque:      data.plate || undefined,
          marque:      data.brand || undefined,
          modele:      data.model || undefined,
          vin:         data.vin || undefined,
          motif:       data.motif || undefined,
          missionNum:  data.missionNum || undefined,
          dateMission: data.dateEntree || undefined,
          msg:         transferFrom ? `↔ Transféré de ${transferFrom}` : undefined,
        }
        setCurrentItem(result)
        setItems(prev => [result, ...prev])
        setStats(prev => ({ ...prev, total: prev.total + 1, reprinted: prev.reprinted + 1 }))
        persistItem(result, {
          parc_zone_key:         place?.placed ? parcZoneKey : null,
          parc_row_number:       place?.placed ? parcRowNumber : null,
          parc_slot_index:       place?.placed ? nextSlot : null,
          incoming_mission_id:   place?.mission_id || null,
          transferred_from_zone: place?.was_at?.zone_key || null,
          transferred_from_row:  place?.was_at?.row_number ?? null,
          transferred_from_slot: place?.was_at?.slot_index ?? null,
        })
        if (place?.placed) {
          const newSlot = nextSlot + 1
          setNextSlot(newSlot)
          persistNextSlot(newSlot)
        }

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
          body:    JSON.stringify({
            towsoftData: td,
            stateId:     selectedZone?.stateId,
            tagName,
            print:       autoPrint,
          }),
        })
        const processData = await processRes.json()
        if (!processRes.ok || !processData.ok) throw new Error(processData.error || 'Traitement échoué')

        playWinSound()
        const plate = processData.plate || td.plaque
        const place = await placeOnPlan({
          plaque:      plate || undefined,
          ticket_id:   processData.ticketId,
          mission_num: td.missionNum || parsed.missionNum,
        })
        const placedHere = place?.placed ? `${parcZoneKey}${parcRowNumber}-${nextSlot}` : undefined
        const transferFrom = place?.transferred && place.was_at
          ? `${place.was_at.zone_key}${place.was_at.row_number}-${place.was_at.slot_index}`
          : undefined
        const result: ResultItem = {
          status:         'ok',
          type:           processData.vehicleCreated ? 'created' : 'updated',
          label:          plate || `Mission #${parsed.missionNum}`,
          sublabel:       `${td.marque || ''} ${td.modele || ''}`.trim(),
          vehicleCreated: processData.vehicleCreated,
          printed:        processData.printed,
          zone:           placedHere || selectedZone?.label,
          ticketId:       processData.ticketId,
          missionNum:     td.missionNum,
          refDossier:     td.refDossier,
          dateMission:    td.dateMission,
          marque:         td.marque,
          modele:         td.modele,
          plaque:         plate,
          vin:            td.vin,
          motif:          td.motif,
          parc:           td.parc,
          msg:            transferFrom ? `↔ Transféré de ${transferFrom}` : undefined,
        }
        setCurrentItem(result)
        setItems(prev => [result, ...prev])
        setStats(prev => ({
          ...prev,
          total: prev.total + 1,
          created: prev.created + (processData.vehicleCreated ? 1 : 0),
          updated: prev.updated + (!processData.vehicleCreated ? 1 : 0),
        }))
        persistItem(result, {
          parc_zone_key:         place?.placed ? parcZoneKey : null,
          parc_row_number:       place?.placed ? parcRowNumber : null,
          parc_slot_index:       place?.placed ? nextSlot : null,
          incoming_mission_id:   place?.mission_id || null,
          transferred_from_zone: place?.was_at?.zone_key || null,
          transferred_from_row:  place?.was_at?.row_number ?? null,
          transferred_from_slot: place?.was_at?.slot_index ?? null,
        })
        if (place?.placed) {
          const newSlot = nextSlot + 1
          setNextSlot(newSlot)
          persistNextSlot(newSlot)
        }
      }
    } catch (err: any) {
      playLoseSound()
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
      persistItem(errorItem)
    } finally {
      setProcessing(false)
      setTimeout(() => scanRef.current?.focus(), 300)
    }
  }

  /** Imprime a la demande l etiquette d un ticket donne (bouton sur la carte du
   *  vehicule en cours). Reutilise l endpoint existant de Phase 1B. */
  async function printOnDemand(ticketId: number) {
    try {
      const res = await fetch(`/api/helpdesk/${ticketId}/print`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok || !j.ok) {
        alert(`Erreur impression : ${j.error || 'inconnu'}`)
        return
      }
      // Mise a jour visuelle : l item courant et l historique passent en printed=true
      setCurrentItem(prev => prev && prev.ticketId === ticketId ? { ...prev, printed: true } : prev)
      setItems(prev => prev.map(it => it.ticketId === ticketId ? { ...it, printed: true } : it))
    } catch (e: any) {
      alert(`Erreur impression : ${e.message || e}`)
    }
  }

  /** Cree (ou reprend) une session en DB et passe en mode scan. */
  async function startScanSession() {
    if (!selectedZone) return
    // Si la zone a des rangees parc mais aucune selectionnee, force le choix
    if (availableRows.length > 0 && parcRowNumber == null) {
      alert('Sélectionne d\'abord la rangée à inventorier.')
      return
    }
    try {
      const res = await fetch('/api/inventaire/sessions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tag_name:       tagName,
          zone_state_id:  selectedZone.stateId,
          zone_code:      selectedZone.code,
          zone_label:     selectedZone.label,
          zone_full_name: selectedZone.fullName,
          auto_print:     autoPrint,
        }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) { alert(j.error || 'Erreur creation session'); return }
      setSessionId(j.session.id)
      // Persiste tout de suite parc_zone_key/parc_row_number/next_slot (si rangee choisie)
      if (parcZoneKey && parcRowNumber != null) {
        fetch(`/api/inventaire/sessions/${j.session.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            parc_zone_key:   parcZoneKey,
            parc_row_number: parcRowNumber,
            next_slot_index: nextSlot,
          }),
        }).catch(() => {})
      }
      setStep('scan')
    } catch (e: any) {
      alert(`Erreur : ${e.message || e}`)
    }
  }

  /** Selectionne une rangee et persiste sur la session. */
  function selectRow(row: ParcRow) {
    setParcRowNumber(row.row_number)
    setNextSlot(1)
    if (sessionId) {
      fetch(`/api/inventaire/sessions/${sessionId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          parc_zone_key:   parcZoneKey,
          parc_row_number: row.row_number,
          next_slot_index: 1,
        }),
      }).catch(() => {})
    }
  }

  /** Valide la rangee courante et propose la suivante (sort_order). */
  function validateCurrentRow() {
    if (!currentRow) return
    const next = suggestNextRow()
    if (!next) {
      if (confirm(`Rangée ${parcZoneKey}${currentRow.row_number} validée. Plus de rangée suivante dans cette zone — termine l'inventaire ou change de zone.`)) {
        // rien a faire, l utilisateur va terminer
      }
      return
    }
    if (confirm(`Rangée ${parcZoneKey}${currentRow.row_number} validée.\nPasser à la rangée ${parcZoneKey}${next.row_number} (slot 1) ?`)) {
      selectRow(next)
    }
  }

  /** Termine la session et recupere la liste des vehicules manquants. */
  async function completeSession() {
    if (!sessionId) return
    if (!confirm("Terminer l'inventaire ?\nLes véhicules attendus dans les zones balayées mais non scannés seront listés pour vérification.")) return
    setCompleting(true)
    try {
      const res = await fetch(`/api/inventaire/sessions/${sessionId}/complete`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setMissing(j.missing || [])
    } catch (e: any) {
      alert(`Erreur fin d'inventaire : ${e.message || e}`)
    } finally {
      setCompleting(false)
    }
  }

  /** Termine le scan de la zone courante : les vehicules attendus dans cette
   *  zone mais non scannes passent en status='unlocated' (avec rapport CSV
   *  telechargeable). Permet d enchainer sur une autre zone sans terminer
   *  toute la session. */
  async function finishCurrentZone() {
    if (!sessionId || !parcZoneKey || !selectedZone) return
    if (!confirm(`Terminer le scan de la zone ${selectedZone.code} ?\n\nLes véhicules attendus dans cette zone mais non scannés passeront en statut "non localisé". Tu pourras ensuite scanner une autre zone, ou les retrouver via la liste dédiée.`)) return
    setFinishingZone(true)
    try {
      const res = await fetch(`/api/inventaire/sessions/${sessionId}/finish-zone`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ zone_key: parcZoneKey }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)

      // Download CSV
      if (j.csv && j.unlocated_count > 0) {
        const blob = new Blob([j.csv], { type: 'text/csv;charset=utf-8;' })
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = `inventaire-non-localises-${selectedZone.code}-${new Date().toISOString().slice(0,10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
      }

      alert(`Zone ${selectedZone.code} terminée.\n${j.unlocated_count} véhicule(s) passé(s) en "non localisé"${j.unlocated_count > 0 ? '.\nLe CSV a été téléchargé.' : '.'}\n\nTu peux maintenant scanner une autre zone.`)
    } catch (e: any) {
      alert(`Erreur fin de zone : ${e.message || e}`)
    } finally {
      setFinishingZone(false)
    }
  }

  /** Action sur un vehicule manquant : sortir du parc (parc_zone_key = null). */
  async function actionSortirDuParc(missionId: string) {
    try {
      const res = await fetch('/api/parc/place', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: missionId, zone_key: null }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setMissing(prev => prev ? prev.filter(m => m.id !== missionId) : prev)
    } catch (e: any) {
      alert(`Erreur : ${e.message || e}`)
    }
  }

  /** Ferme le dialog "manquants" et reset la session locale. */
  function closeMissingDialog() {
    setMissing(null)
    setSessionId(null)
    setItems([])
    setCurrentItem(null)
    setStats({ total: 0, created: 0, updated: 0, reprinted: 0, errors: 0 })
    setParcRowNumber(null)
    setNextSlot(1)
    setStep('setup')
  }

  /** Met a jour auto_print cote DB quand on toggle le checkbox. */
  async function updateAutoPrint(value: boolean) {
    setAutoPrint(value)
    if (!sessionId) return
    fetch(`/api/inventaire/sessions/${sessionId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ auto_print: value }),
    }).catch(() => {})
  }

  /** Met a jour la zone cote DB quand on revient au setup pour la changer. */
  async function updateZone(z: { stateId: number; code: string; label: string; fullName: string }) {
    setSelectedZone(z)
    if (!sessionId) return
    fetch(`/api/inventaire/sessions/${sessionId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        zone_state_id:  z.stateId,
        zone_code:      z.code,
        zone_label:     z.label,
        zone_full_name: z.fullName,
      }),
    }).catch(() => {})
  }

  /** Ferme la session active en DB et reset l etat local. */
  async function clearSession() {
    if (!confirm('Terminer cette session ? Tu pourras toujours consulter le rapport ensuite.')) return
    if (sessionId) {
      await fetch(`/api/inventaire/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {})
    }
    setSessionId(null)
    setItems([])
    setCurrentItem(null)
    setStats({ total: 0, created: 0, updated: 0, reprinted: 0, errors: 0 })
    setStep('setup')
  }

  async function sendMailReport() {
    if (items.length === 0) {
      alert('Aucun véhicule scanné pour cette session')
      return
    }
    const ok = confirm('Envoyer le rapport à fourriere@verviersdepannage.be ?')
    if (!ok) return
    const res = await fetch('/api/inventaire/send-report', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        items,
        zoneLabel: selectedZone?.fullName || selectedZone?.label,
        tagName,
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(`Erreur envoi : ${j.error || 'inconnu'}`)
      return
    }
    alert(`✅ Rapport envoyé à ${j.to}`)
  }

  async function exportXLSX() {
    // Inclut TOUS les items (y compris reprints + erreurs) pour un rapport complet
    if (items.length === 0) {
      alert('Aucun véhicule scanné pour cette session')
      return
    }
    const res = await fetch('/api/inventaire/export', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        items,
        zoneLabel: selectedZone?.fullName || selectedZone?.label,
        tagName,
      }),
    })
    if (!res.ok) { alert('Erreur export'); return }
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `inventaire-${tagName}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AppShell title="Inventaire fourrière" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-2xl mx-auto p-4 space-y-4">

        {restoring && (
          <div className="bg-surface border rounded-2xl p-4 text-center text-ink-faint text-sm flex items-center justify-center gap-2">
            <Loader2 className="animate-spin" size={14} />
            Restauration de la session…
          </div>
        )}

        {!restoring && step === 'setup' && (
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
                    onClick={() => {
                      updateZone({
                        stateId:  z.state_id,
                        code:     z.code,
                        label:    z.label,
                        fullName: z.full_name,
                      })
                      // Changer de zone reset la rangee
                      setParcRowNumber(null)
                      setNextSlot(1)
                    }}
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

            {/* Row picker : visible si la zone a des rangees parc */}
            {selectedZone && availableRows.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-ink-faint uppercase tracking-wider flex items-center gap-1.5">
                  <MapPin size={12} /> Rangée à scanner
                </label>
                <p className="text-xs text-ink-muted mb-2">
                  Tu vas scanner les véhicules dans l'ordre, en commençant au slot 1.
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {availableRows.map(r => (
                    <button
                      key={r.id}
                      onClick={() => selectRow(r)}
                      className={`p-2.5 rounded-lg border text-center transition ${
                        parcRowNumber === r.row_number
                          ? 'bg-brand text-white border-brand shadow-md'
                          : 'bg-surface-2 hover:bg-surface-hover border-surface-hover'
                      }`}
                    >
                      <div className="font-mono font-bold text-base">{parcZoneKey}{r.row_number}</div>
                      <div className="text-[10px] opacity-80">cap. {r.capacity}{!currentZoneStrict ? '+1' : ''}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {selectedZone && parcZoneKey === null && (
              <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-xs text-ink-secondary">
                ℹ Zone <strong>{selectedZone.code}</strong> sans plan visuel — l'inventaire se fera sans positionnement précis (tag mensuel + zone Odoo uniquement).
              </div>
            )}
            {selectedZone && parcZoneKey != null && availableRows.length === 0 && (
              <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-xs text-ink-secondary">
                ⚠ Zone <strong>{selectedZone.code}</strong> visible sur le plan mais aucune rangée configurée. Va sur <a href="/admin/parc" className="underline font-medium">/admin/parc</a> pour ajouter des rangées avant d'inventorier.
              </div>
            )}

            <div className="bg-surface-2 border rounded-xl p-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPrint}
                  onChange={e => updateAutoPrint(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-brand"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink flex items-center gap-1.5">
                    <Printer size={14} />
                    Imprimer une étiquette à chaque scan
                  </div>
                  <p className="text-xs text-ink-faint mt-0.5">
                    Par défaut désactivé : l'inventaire sert à mettre à jour le parc, pas à ré-étiqueter.
                    Active si tu veux réimprimer toutes les étiquettes. Tu pourras aussi imprimer cas par cas après chaque scan.
                  </p>
                </div>
              </label>
            </div>

            <button
              onClick={startScanSession}
              disabled={!selectedZone || (availableRows.length > 0 && parcRowNumber == null)}
              className="w-full py-3 bg-brand text-white rounded-xl font-medium disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <ScanLine size={18} />
              {sessionId ? 'Reprendre la session' : 'Démarrer le scan'}
            </button>
          </div>
        )}

        {!restoring && step === 'scan' && selectedZone && (
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
              {currentRow && (
                <div className="flex-shrink-0 text-center px-2 border-l">
                  <div className="text-xs text-ink-faint">Rangée</div>
                  <div className="font-display font-bold text-brand">{parcZoneKey}{currentRow.row_number}</div>
                  <div className="text-[10px] text-ink-muted">slot {nextSlot}</div>
                </div>
              )}
              <div className="flex-shrink-0 text-right">
                <div className="text-xs text-ink-faint">Tag</div>
                <div className="font-mono font-bold text-brand text-sm">🏷️ {tagName}</div>
              </div>
              <button
                onClick={() => { setStep('setup'); setCurrentItem(null) }}
                className="p-2 text-ink-muted hover:text-ink"
                title="Changer de zone/rangée"
              >
                <Settings size={16} />
              </button>
            </div>

            {/* Bouton "Valider la rangée" : visible si on a une rangee active */}
            {currentRow && (
              <button
                onClick={validateCurrentRow}
                className="w-full py-2.5 bg-success/10 hover:bg-success/20 text-success border border-success/30 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition"
              >
                <CheckCircle2 size={16} />
                Valider la rangée {parcZoneKey}{currentRow.row_number}
                {suggestNextRow() && <ArrowRight size={14} className="opacity-60" />}
                {suggestNextRow() && <span className="opacity-70 text-xs">{parcZoneKey}{suggestNextRow()!.row_number}</span>}
              </button>
            )}

            {/* Boutons scan */}
            <button
              onClick={() => setCameraOpen(true)}
              className="w-full py-3 bg-brand hover:bg-brand-hover text-white rounded-2xl font-medium flex items-center justify-center gap-2 shadow-md"
            >
              <Camera size={18} />
              Scanner avec la caméra
            </button>

            {/* Input scan (fallback : saisie manuelle d un n° mission Towsoft) */}
            <div className="bg-surface border rounded-2xl p-3">
              <p className="text-[10px] text-ink-faint uppercase tracking-wider mb-1.5">Ou saisie manuelle</p>
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
                placeholder="N° mission Towsoft (puis Entrée)…"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint disabled:opacity-50 font-mono"
              />
              {processing && (
                <p className="text-[11px] text-ink-faint mt-1.5 flex items-center gap-1">
                  <Loader2 className="animate-spin" size={11} /> Traitement en cours…
                </p>
              )}
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
            {currentItem && <CurrentCard item={currentItem} onPrint={printOnDemand} />}

            {/* Boutons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={sendMailReport}
                disabled={items.length === 0}
                className="py-2.5 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-medium transition disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Mail size={14} />
                Envoyer par email
              </button>
              <button
                onClick={exportXLSX}
                disabled={items.length === 0}
                className="py-2.5 bg-success hover:bg-success/90 text-white rounded-xl text-sm font-medium transition disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Download size={14} />
                Télécharger Excel
              </button>
            </div>
            {/* Bouton clôture de la zone courante : marque les manquants de
                cette zone comme 'unlocated' et permet de continuer la session
                sur une autre zone. */}
            {selectedZone && (
              <button
                onClick={finishCurrentZone}
                disabled={finishingZone}
                className="w-full py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl text-xs transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                title={`Terminer le scan de la zone ${selectedZone.label} : les véhicules attendus dans cette zone mais non scannés passeront en "non localisé" (avec rapport CSV téléchargeable). Vous pourrez ensuite scanner une autre zone.`}
              >
                {finishingZone ? <Loader2 className="animate-spin" size={12} /> : <CheckCircle2 size={12} />}
                Terminer la zone {selectedZone.code} (manquants → non localisés)
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={completeSession}
                disabled={completing}
                className="w-full py-2 bg-warning/10 hover:bg-warning/20 text-warning border border-warning/30 rounded-xl text-xs transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                title="Terminer l'inventaire complet et lister les véhicules manquants (toutes zones balayées confondues)"
              >
                {completing ? <Loader2 className="animate-spin" size={12} /> : <CheckCircle2 size={12} />}
                Terminer toute la session
              </button>
              <button
                onClick={clearSession}
                className="w-full py-2 bg-surface-hover hover:bg-critical-soft text-ink-secondary hover:text-critical border rounded-xl text-xs transition flex items-center justify-center gap-1.5"
                title="Abandonner la session sans calculer les manquants"
              >
                <X size={12} />
                Abandonner
              </button>
            </div>

            {/* Historique */}
            {items.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold text-ink-faint uppercase tracking-wider px-1">Historique ({items.length})</h3>
                {items.map((item, i) => <HistoryItem key={i} item={item} onPrint={printOnDemand} />)}
              </div>
            )}
          </>
        )}

      </div>

      {cameraOpen && (
        <QRScanner
          paused={processing}
          onScan={(text) => processScan(text)}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* Modal de fin d inventaire : vehicules attendus mais non scannes */}
      {missing && (
        <div className="fixed inset-0 z-50 bg-ink/50 flex items-center justify-center p-4">
          <div className="bg-surface border rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="font-display font-bold text-lg flex items-center gap-2">
                  <AlertCircle className="text-warning" size={18} />
                  Inventaire terminé
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  {missing.length === 0
                    ? 'Aucun véhicule manquant — bravo, tout est concordant.'
                    : `${missing.length} véhicule${missing.length > 1 ? 's' : ''} attendu${missing.length > 1 ? 's' : ''} dans les zones balayées mais non scanné${missing.length > 1 ? 's' : ''}.`}
                </p>
              </div>
              <button onClick={closeMissingDialog} className="p-1.5 text-ink-faint hover:text-ink" title="Fermer">
                <X size={16} />
              </button>
            </div>

            {missing.length > 0 && (
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {missing.map(m => (
                  <div key={m.id} className="bg-surface-2 border rounded-xl p-3 flex items-center gap-3">
                    <Car size={18} className="text-ink-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-ink">{m.vehicle_plate || '—'}</span>
                        <span className="text-[10px] text-ink-faint">#{m.external_id}</span>
                      </div>
                      <div className="text-xs text-ink-muted truncate">
                        {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || m.client_name || '—'}
                      </div>
                      <div className="text-[10px] text-ink-faint mt-0.5">
                        Attendu en {m.parc_zone_key}{m.parc_row_number}-{m.parc_slot_index}
                      </div>
                    </div>
                    <button
                      onClick={() => actionSortirDuParc(m.id)}
                      className="flex-shrink-0 px-2.5 py-1.5 bg-critical/10 hover:bg-critical/20 text-critical border border-critical/30 rounded-lg text-xs font-medium transition"
                      title="Le retirer du plan (parc_zone_key = null)"
                    >
                      Sortir du parc
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="p-4 border-t flex items-center justify-between gap-2 flex-shrink-0">
              <button
                onClick={exportXLSX}
                className="px-3 py-2 bg-success/10 hover:bg-success/20 text-success border border-success/30 rounded-lg text-xs font-medium transition flex items-center gap-1.5"
              >
                <FileSpreadsheet size={14} /> Exporter le rapport
              </button>
              <button
                onClick={closeMissingDialog}
                className="px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-medium transition"
              >
                Clôturer
              </button>
            </div>
          </div>
        </div>
      )}
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

function CurrentCard({ item, onPrint }: { item: ResultItem; onPrint: (ticketId: number) => void }) {
  const bg = item.status === 'loading' ? 'bg-brand/5 border-brand/30'
    : item.status === 'ok' ? 'bg-success-soft border-success/40'
    : 'bg-critical-soft border-critical/40'
  const icon = item.status === 'loading' ? <Loader2 className="animate-spin text-brand" size={18} />
    : item.status === 'ok' ? <CheckCircle2 className="text-success" size={18} />
    : <AlertCircle className="text-critical" size={18} />

  const detailLine = [
    item.marque && item.modele ? `${item.marque} ${item.modele}` : item.marque,
    item.vin ? `VIN ${item.vin}` : '',
    item.ticketId ? `Ticket #${item.ticketId}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div className={`border rounded-2xl p-4 ${bg}`}>
      <div className="flex items-start gap-2 mb-1">
        {icon}
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-sm">{item.label}</div>
          {(detailLine || item.sublabel) && <div className="text-xs text-ink-secondary">{detailLine || item.sublabel}</div>}
          {item.msg && <div className="text-xs text-critical mt-1">{item.msg}</div>}
        </div>
      </div>
      {item.status === 'ok' && (
        <>
          <div className="flex flex-wrap gap-1.5 mt-2 text-[10px]">
            {item.type === 'created'  && <Badge color="brand">🆕 Créé</Badge>}
            {item.type === 'updated'  && <Badge color="info">✏️ MAJ</Badge>}
            {item.type === 'reprint'  && <Badge color="purple">🔁 Marqué présent</Badge>}
            {item.printed && <Badge color="success"><Printer size={10} /> Étiquette imprimée</Badge>}
            {item.zone && <Badge color="ink">Zone : {item.zone}</Badge>}
          </div>
          {item.ticketId && (
            <button
              onClick={() => onPrint(item.ticketId!)}
              className="mt-3 w-full py-2 bg-surface hover:bg-surface-hover border rounded-lg text-xs font-medium text-ink-secondary hover:text-brand flex items-center justify-center gap-1.5 transition"
            >
              <Printer size={14} />
              Imprimer une étiquette pour ce véhicule
            </button>
          )}
        </>
      )}
    </div>
  )
}

function HistoryItem({ item, onPrint }: { item: ResultItem; onPrint: (ticketId: number) => void }) {
  const icon = item.status === 'ok' ? '✅' : item.status === 'error' ? '❌' : '⏳'
  const typeColor = item.type === 'created' ? 'text-brand' : item.type === 'reprint' ? 'text-purple-500' : item.type === 'updated' ? 'text-info' : 'text-ink-faint'

  // Plaque (titre), marque/modele, VIN, ticket #
  const hasMarque = !!item.marque
  const detailLine = [
    item.marque && item.modele ? `${item.marque} ${item.modele}` : (item.marque || ''),
    item.vin ? `VIN ${item.vin}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div className="bg-surface border rounded-xl px-3 py-2 flex items-center gap-3 text-sm">
      <span className="flex-shrink-0 text-base">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-ink font-medium truncate flex-1 min-w-0">{item.label}</div>
          {item.ticketId && (
            <span className="text-[10px] text-ink-faint font-mono flex-shrink-0">#{item.ticketId}</span>
          )}
        </div>
        {(detailLine || item.sublabel || item.msg) && (
          <div className="text-xs text-ink-faint truncate">
            {detailLine || item.sublabel || item.msg}
          </div>
        )}
      </div>
      {item.type && (
        <span className={`flex-shrink-0 text-[10px] font-semibold uppercase ${typeColor}`}>
          {item.type === 'created' ? 'NEW' : item.type === 'updated' ? 'MAJ' : item.type === 'reprint' ? 'REPR' : 'ERR'}
        </span>
      )}
      {item.printed === true && <Printer size={12} className="text-success flex-shrink-0" />}
      {item.ticketId && (
        <button
          onClick={() => onPrint(item.ticketId!)}
          title="Imprimer une étiquette pour ce véhicule"
          className="flex-shrink-0 p-1.5 text-ink-faint hover:text-brand hover:bg-brand/10 rounded transition"
        >
          <Printer size={14} />
        </button>
      )}
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
