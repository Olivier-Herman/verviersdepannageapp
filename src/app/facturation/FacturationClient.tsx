'use client'

import { useMemo, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'
import FacturerModal from '@/components/facturation/FacturerModal'

// Client browser (anon) pour le realtime de la liste facturation.
const sbRealtime = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

interface MissionRow {
  id: string
  mission_number: number | null
  external_id: string | null
  dossier_number: string | null
  source: string | null
  status: string
  mission_type: string | null
  incident_type: string | null
  parent_mission_id: string | null
  client_name: string | null
  client_phone: string | null
  vehicle_plate: string | null
  vehicle_brand: string | null
  vehicle_model: string | null
  vehicle_vin: string | null
  incident_address: string | null
  destination_address: string | null
  received_at: string
  intervention_date: string | null
  completed_at: string | null
  amount_to_collect: number | null
  amount_collected: number | null
  payment_method: string | null
  special_tarif_htva: number | null
  assigned_to: string | null
  odoo_quote_id: number | null
  invoice_odoo_id: number | null
  invoice_method: string | null
  invoice_number: string | null
  invoice_url: string | null
  no_charge_at:     string | null
  no_charge_reason: string | null
  billed_to_id?:    number | null
  billed_to_name?:  string | null
}

interface SiblingRow {
  id: string
  mission_number: number | null
  external_id: string | null
  source: string | null
  status: string
  mission_type: string | null
  incident_type: string | null
  parent_mission_id: string | null
  client_name: string | null
  vehicle_plate: string | null
  received_at: string
  completed_at: string | null
  invoice_method: string | null
  invoice_number: string | null
  no_charge_at:     string | null
  no_charge_reason: string | null
}

interface PaymentRow {
  id: string
  mission_id: string | null
  amount: number
  payment_mode: string
  client_name: string | null
  created_at: string
  driver_id: string | null
}

interface DriverRow { id: string; name: string | null }

interface AdvanceRow {
  id:          string
  mission_id:  string | null
  amount_htva: number
  plate:       string | null
  invoice_url: string | null
}

interface Props {
  missions:    MissionRow[]
  siblings:    SiblingRow[]
  payments:    PaymentRow[]
  drivers:     DriverRow[]
  advances?:   AdvanceRow[]
  sourceLabels?: Record<string, string>
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
  variant?:    'general' | 'touring'
}

const SOURCE_LABEL: Record<string, string> = {
  touring: 'Touring', allianz: 'Allianz', vab: 'VAB',
  axa: 'AXA', ethias: 'Ethias', police: 'Police',
}
function fmtSource(s: string | null): string {
  if (!s) return '—'
  return SOURCE_LABEL[s.toLowerCase()] || s
}

// Groupes de sources pour la facturation semi-automatique (Olivier 2026-07-25).
// Étape 1 : isoler les missions par groupe assureur. Les clés correspondent aux
// valeurs `source` stockées sur incoming_missions (catalog).
// NB : « Mondial (hors Hexalite) » = les missions source 'mondial' de la liste
// générale ; les clôtures Hexalite/Allianz ont leur page dédiée /facturation/allianz.
interface SourceGroup { key: string; label: string; sources: string[] | null }
const SOURCE_GROUPS: SourceGroup[] = [
  { key: 'all',     label: 'Toutes',                    sources: null },
  { key: 'vab',     label: 'VAB',                       sources: ['vab'] },
  { key: 'kaze',    label: 'Kaze · Ethias · P&V · IMA', sources: ['kaze', 'ethias', 'pv', 'pv_assistance', 'ima'] },
  { key: 'mondial', label: 'Mondial (hors Hexalite)',   sources: ['mondial'] },
  { key: 'axa',     label: 'AXA',                       sources: ['axa'] },
]
const missionInGroup = (source: string | null, g: SourceGroup): boolean =>
  g.sources === null ? true : !!source && g.sources.includes(source.toLowerCase())

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const date = new Date(d)
  return date.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtDateTime(d: string | null): string {
  if (!d) return '—'
  const date = new Date(d)
  return date.toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function missionKind(m: { mission_type: string | null; incident_type: string | null; parent_mission_id: string | null }): 'REL' | 'REM' | 'DSP' | 'DPR' | 'AUTRE' {
  const it = (m.incident_type || '').toLowerCase()
  const mt = (m.mission_type   || '').toLowerCase()
  // Idem MissionsTermineesClient : REL aussi via mission_type direct
  if (mt === 'relivraison' || mt === 'rel'
      || it === 'relivraison' || m.parent_mission_id) return 'REL'
  if (it === 'dpr')                                 return 'DPR'
  if (mt === 'remorquage')                          return 'REM'
  if (['depannage', 'reparation_place', 'trajet_vide'].includes(mt)) return 'DSP'
  return 'AUTRE'
}

const KIND_COLOR: Record<string, string> = {
  REM: 'bg-amber-500',
  DSP: 'bg-info',
  REL: 'bg-purple-600',
  DPR: 'bg-critical',
  AUTRE: 'bg-ink-faint',
}

export default function FacturationClient({
  missions, siblings, payments, drivers, advances = [], sourceLabels = {},
  userRole, userName, userEmail, userModules, variant = 'general',
}: Props) {
  const isTouring = variant === 'touring'

  // Dénomination de source : catalog (ex. garage_14528a → « Centracar ») en
  // priorité, puis libellés connus, puis la clé brute en dernier recours.
  const fmtSource = (s: string | null): string =>
    !s ? '—' : (sourceLabels[s] || SOURCE_LABEL[s.toLowerCase()] || s)

  // Olivier 2026-06-01 : map mission_id -> avances liees, pour highlight des
  // cartes "A facturer" qui contiennent une avance de fonds (attention requise).
  const advancesByMission = useMemo(() => {
    const map = new Map<string, AdvanceRow[]>()
    for (const a of advances) {
      if (!a.mission_id) continue
      const list = map.get(a.mission_id) || []
      list.push(a)
      map.set(a.mission_id, list)
    }
    return map
  }, [advances])
  const hasAdvances = (mid: string) => (advancesByMission.get(mid)?.length || 0) > 0
  const totalAdvanceFor = (mid: string) =>
    (advancesByMission.get(mid) || []).reduce((s, a) => s + Number(a.amount_htva || 0), 0)
  // Olivier 2026-06-04 : pre-filtre via ?q= (utilise par bouton 'Restituer
  // et facturer' de la fiche vehicule fourriere pour pointer directement
  // sur un numero de mission specifique).
  const searchParams = useSearchParams()
  const initialQ = searchParams?.get('q') || ''
  const [search, setSearch]     = useState(initialQ)
  const [sourceFilter, setSrc]  = useState<string>('all')
  const [groupFilter, setGroup] = useState<string>('all')   // groupe assureur (VAB / Kaze… / Mondial / AXA)
  const activeGroup = SOURCE_GROUPS.find(g => g.key === groupFilter) || SOURCE_GROUPS[0]

  // Persiste le filtre choisi (groupe + source) : il reste sélectionné après une
  // validation « Facturation OK » ou un rechargement, au lieu de repasser à
  // « Tous » à chaque fois. Olivier 2026-07-26.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const g = localStorage.getItem('fact_group_filter');  if (g) setGroup(g)
    const s = localStorage.getItem('fact_source_filter'); if (s) setSrc(s)
  }, [])
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('fact_group_filter', groupFilter)
  }, [groupFilter])
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('fact_source_filter', sourceFilter)
  }, [sourceFilter])
  const [selected, setSelected] = useState<MissionRow | null>(null)
  const [data, setData]         = useState(missions)

  // ── Facturation par lot + vérification Odoo (Olivier 2026-07-26) ──────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchBusy, setBatchBusy]     = useState<null | 'facturer' | 'verify'>(null)
  const [batchReport, setBatchReport] = useState<string | null>(null)
  const toggleSel = (id: string) => setSelectedIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  // Facturer le lot : crée un brouillon de facture Odoo pour chaque fiche cochée
  // et ouvre chacune dans son propre onglet.
  async function batchFacturer() {
    const ids = [...selectedIds]
    if (!ids.length) return
    // IMPORTANT : on pré-ouvre un onglet par fiche MAINTENANT (dans le geste du
    // clic) — un window.open après un await serait bloqué par le navigateur. On
    // y charge l'URL de la facture dès qu'elle est créée ; on ferme si échec.
    const tabs = ids.map(() => window.open('', '_blank'))
    setBatchBusy('facturer'); setBatchReport('🧾 Création des brouillons…')
    let ok = 0, fail = 0
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]; const tab = tabs[i]
      try {
        const r = await fetch(`/api/missions/${id}/quote`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'invoice' }),
        })
        const j = await r.json().catch(() => ({}))
        const url = j?.invoice?.url
        if (r.ok && j.ok && url) { ok++; if (tab) tab.location.href = url }
        else { fail++; if (tab) try { tab.close() } catch { /* ignore */ } }
      } catch { fail++; if (tab) try { tab.close() } catch { /* ignore */ } }
      setBatchReport(`🧾 ${ok + fail}/${ids.length} traité(s)…`)
    }
    setBatchBusy(null)
    setBatchReport(`🧾 ${ok} brouillon(s) créé(s) et ouvert(s)${fail ? ` · ⚠ ${fail} échec(s)` : ''}. Poste-les dans Odoo, puis clique « Vérification facturation Odoo ».`)
  }

  // Vérification Odoo : complète les fiches dont la facture liée est postée.
  async function verifyInvoices() {
    setBatchBusy('verify'); setBatchReport('🔎 Vérification dans Odoo…')
    try {
      const ids = selectedIds.size ? [...selectedIds] : undefined
      const r = await fetch('/api/facturation/verify-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { mission_ids: ids } : {}),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setBatchReport(`⚠ ${j.error || 'Échec'}`); return }
      if (j.completed?.length) {
        const done = new Set<string>(j.completed.map((c: any) => c.id))
        setData(d => d.filter(m => !done.has(m.id)))
        setSelectedIds(prev => { const n = new Set(prev); done.forEach(id => n.delete(id)); return n })
      }
      const plaques = (arr: any[]) => arr.map(x => x.plate || x.ref || '?').join(', ')
      let rep = `✅ ${j.summary.completed} facturée(s)`
      if (j.summary.draft) rep += ` · ⏳ ${j.summary.draft} en brouillon à confirmer dans Odoo (${plaques(j.draft)})`
      if (j.summary.none)  rep += ` · 📄 ${j.summary.none} sans facture émise — devis non facturé ou annulé (${plaques(j.none)})`
      setBatchReport(rep)
    } catch { setBatchReport('⚠ Erreur réseau') } finally { setBatchBusy(null) }
  }

  // ── Realtime : la liste se met à jour en direct (sans refresh) ───────────
  // Quand une fiche est facturée/validée ou annulée (status ≠ to_invoice), elle
  // disparaît de l'écran ; quand une nouvelle passe en to_invoice, elle apparaît.
  // Olivier 2026-06-30. La variante (général/touring) filtre par source.
  useEffect(() => {
    const inScope = (m: any) => isTouring ? m.source === 'touring' : m.source !== 'touring'
    const channel = sbRealtime.channel('facturation-list')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'incoming_missions' },
        (payload: any) => {
          const row = payload.new || payload.old
          if (!row?.id) return
          const isToInvoice = payload.eventType !== 'DELETE'
            && payload.new?.status === 'to_invoice'
            && inScope(payload.new)
          setData(prev => {
            const exists = prev.some(m => m.id === row.id)
            if (isToInvoice) {
              // Nouvelle fiche à facturer → on l'ajoute si absente.
              return exists ? prev.map(m => m.id === row.id ? { ...m, ...payload.new } : m)
                            : [payload.new as MissionRow, ...prev]
            }
            // Plus à facturer (facturée/annulée/autre) → on la retire.
            return exists ? prev.filter(m => m.id !== row.id) : prev
          })
        })
      .subscribe()
    return () => { sbRealtime.removeChannel(channel) }
  }, [isTouring])

  // ── Recherche avancée VD Soft + TowSoft (Olivier 2026-06-12) ──────────
  const [advType, setAdvType]       = useState<'immatriculation' | 'niv' | 'num_dossier' | 'id_appel' | 'num_facture'>('immatriculation')
  const [advKey, setAdvKey]         = useState('')
  const [advBusy, setAdvBusy]       = useState(false)
  const [advResults, setAdvResults] = useState<any[]>([])
  const [advErr, setAdvErr]         = useState<string | null>(null)
  const [advDone, setAdvDone]       = useState(false)
  const [rowBusy, setRowBusy]       = useState<string | null>(null)
  const [advMsg, setAdvMsg]         = useState<string | null>(null)
  const [advShowCancelled, setAdvShowCancelled] = useState(false)
  // Si on facture une fiche issue de TowSoft, on garde son num pour proposer
  // l'annulation de la fiche TowSoft une fois la facturation validée.
  const [pendingTowsoftNum, setPendingTowsoftNum] = useState<string | null>(null)

  async function runAdvSearch() {
    if (advKey.trim().length < 2) { setAdvErr('Saisis au moins 2 caractères'); return }
    setAdvBusy(true); setAdvErr(null); setAdvDone(false); setAdvMsg(null)
    try {
      const r = await fetch('/api/facturation/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchType: advType, key: advKey.trim(), showCancelled: advShowCancelled }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur de recherche')
      setAdvResults(j.results || [])
      if (j.errors?.length) setAdvErr(j.errors.join(' · '))
      setAdvDone(true)
    } catch (e: any) { setAdvErr(e.message) } finally { setAdvBusy(false) }
  }

  async function openFacture(missionId: string, towsoftNum: string | null) {
    setRowBusy(missionId); setAdvMsg(null)
    try {
      const r = await fetch(`/api/facturation/mission?id=${encodeURIComponent(missionId)}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Chargement mission KO')
      setPendingTowsoftNum(towsoftNum)
      setSelected(j.mission as MissionRow)
    } catch (e: any) { setAdvMsg('⚠ ' + e.message) } finally { setRowBusy(null) }
  }

  async function importAndFacture(towsoftNum: string) {
    setRowBusy('tw-' + towsoftNum); setAdvMsg(null)
    try {
      const r = await fetch('/api/facturation/import-towsoft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ towsoft_num: towsoftNum }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Import KO')
      if (j.action === 'existing') setAdvMsg(`ℹ️ Fiche déjà présente dans VD Soft — ouverture de la facturation.`)
      await openFacture(j.mission_id, towsoftNum)
    } catch (e: any) { setAdvMsg('⚠ Import : ' + e.message) } finally { setRowBusy(null) }
  }

  async function cancelTowsoftFiche(towsoftNum: string) {
    if (!confirm(`Annuler la fiche TowSoft #${towsoftNum} avec le motif « Facturation via OK VDS » ?`)) return
    setRowBusy('cancel-' + towsoftNum); setAdvMsg(null)
    try {
      const r = await fetch('/api/facturation/cancel-towsoft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ towsoft_num: towsoftNum }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Annulation KO')
      setAdvMsg(`✅ Fiche TowSoft #${towsoftNum} annulée${j.verified ? ` (statut : ${j.status_towsoft || 'Annulée'})` : ''}.`)
      setAdvResults(rs => rs.filter(x => x.towsoft_num !== towsoftNum))
    } catch (e: any) { setAdvMsg('⚠ Annulation : ' + e.message) } finally { setRowBusy(null) }
  }
  // Si le ?q change apres le mount initial (navigation interne), met a jour
  useEffect(() => {
    const q = searchParams?.get('q') || ''
    if (q) setSearch(q)
  }, [searchParams])

  const driverName = useMemo(() => {
    const map = new Map<string, string>()
    drivers.forEach(d => map.set(d.id, d.name || 'Sans nom'))
    return (id: string | null) => id ? (map.get(id) || '—') : '—'
  }, [drivers])

  const paymentsByMission = useMemo(() => {
    const map = new Map<string, PaymentRow[]>()
    payments.forEach(p => {
      if (!p.mission_id) return
      const list = map.get(p.mission_id) || []
      list.push(p)
      map.set(p.mission_id, list)
    })
    return map
  }, [payments])

  const siblingsByMission = useMemo(() => {
    const byId       = new Map<string, SiblingRow>()
    const byParentId = new Map<string, SiblingRow[]>()
    siblings.forEach(s => {
      byId.set(s.id, s)
      if (s.parent_mission_id) {
        const list = byParentId.get(s.parent_mission_id) || []
        list.push(s)
        byParentId.set(s.parent_mission_id, list)
      }
    })
    return { byId, byParentId }
  }, [siblings])

  const sources = useMemo(() => {
    const set = new Set<string>()
    data.forEach(m => { if (m.source && missionInGroup(m.source, activeGroup)) set.add(m.source) })
    return [...set].sort()
  }, [data, activeGroup])

  // Compteurs par groupe (sur toutes les missions chargées) pour les pastilles.
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const g of SOURCE_GROUPS) counts[g.key] = data.filter(m => missionInGroup(m.source, g)).length
    return counts
  }, [data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter(m => {
      if (!missionInGroup(m.source, activeGroup)) return false
      if (sourceFilter !== 'all' && m.source !== sourceFilter) return false
      if (!q) return true
      const hay = [
        m.mission_number?.toString(), m.external_id, m.dossier_number, m.client_name,
        m.vehicle_plate, m.vehicle_brand, m.vehicle_model,
        m.incident_address, m.destination_address,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [data, search, sourceFilter, activeGroup])

  // Olivier 2026-06-29 : missions liées (chaîne REM+REL) affichées l'une à la
  // suite de l'autre et encadrées ensemble. On regroupe les fiches visibles par
  // racine de chaîne (parent = sa propre id, enfant = parent_mission_id). On
  // préserve l'ordre d'apparition des groupes ; dans un groupe, le parent (REM)
  // passe avant ses enfants (REL).
  const grouped = useMemo(() => {
    const groups: { root: string; items: MissionRow[] }[] = []
    const byRoot = new Map<string, { root: string; items: MissionRow[] }>()
    for (const m of filtered) {
      const root = m.parent_mission_id || m.id
      let g = byRoot.get(root)
      if (!g) { g = { root, items: [] }; byRoot.set(root, g); groups.push(g) }
      g.items.push(m)
    }
    // Tri intra-groupe : le parent (id === root) en tête, puis les enfants.
    for (const g of groups) {
      g.items.sort((a, b) =>
        (a.id === g.root ? 0 : 1) - (b.id === g.root ? 0 : 1)
        || (a.parent_mission_id ? 1 : 0) - (b.parent_mission_id ? 1 : 0))
    }
    return groups
  }, [filtered])

  function handleInvoiceUpdated(updated: { id: string; status: string; invoice_method?: string | null; invoice_number?: string | null; invoice_url?: string | null }[]) {
    // Retirer les fiches passees a 'completed' (= facturees)
    const completedIds = new Set(updated.filter(u => u.status === 'completed').map(u => u.id))
    setData(d => d.filter(m => !completedIds.has(m.id)))
    // Si on facturait une fiche issue de TowSoft -> proposer d'annuler la fiche
    // TowSoft (motif "Facturation via OK VDS") une fois la facturation validee.
    if (pendingTowsoftNum && selected && completedIds.has(selected.id)) {
      const tn = pendingTowsoftNum
      setPendingTowsoftNum(null)
      setSelected(null)
      // Laisse le modal se fermer puis propose l'annulation TowSoft
      setTimeout(() => cancelTowsoftFiche(tn), 200)
      return
    }
    // Si le modal etait ouvert sur une fiche maintenant completed, le fermer
    if (selected && completedIds.has(selected.id)) setSelected(null)
  }

  return (
    <AppShell title={isTouring ? 'Facturation Touring' : 'Facturation'} userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <AmbientBackground>
      <div className="p-4 lg:p-6 space-y-4">

        {/* Hero header */}
        <div className="ambient-fade-up flex items-start gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-success/20 via-brand/15 to-purple-500/15 flex items-center justify-center text-2xl shadow-lg shadow-brand/10 flex-shrink-0">
            <span>{isTouring ? '🚗' : '🧾'}</span>
          </div>
          <div className="flex-1">
            <h1 className="text-ink text-2xl lg:text-3xl font-bold leading-tight">{isTouring ? 'Facturation Touring' : 'Facturation'}</h1>
            <p className="text-ink-muted text-sm mt-1">{filtered.length} mission{filtered.length > 1 ? 's' : ''} à facturer{isTouring ? ' (Touring)' : ''}.</p>
          </div>
          {isTouring ? (
            <Link href="/facturation"
              className="flex items-center gap-2 px-4 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm font-semibold transition self-start">
              ← Facturation
            </Link>
          ) : (
            <div className="flex items-center gap-2 self-start">
              <Link href="/facturation/touring"
                className="flex items-center gap-2 px-4 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm font-semibold transition">
                🚗 Touring
              </Link>
              <Link href="/facturation/allianz"
                className="flex items-center gap-2 px-4 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm font-semibold transition">
                🟦 Clôture Allianz
              </Link>
            </div>
          )}
        </div>

        {/* Filtres */}
        <div className="bg-surface border rounded-2xl p-4 space-y-3 ambient-fade-up ambient-stagger-1">
          {/* Groupes de sources (isolation par assureur — facturation semi-auto) */}
          {!isTouring && (
            <div className="flex flex-wrap gap-2">
              {SOURCE_GROUPS.map(g => (
                <button key={g.key} type="button"
                  onClick={() => { setGroup(g.key); setSrc('all') }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    groupFilter === g.key ? 'bg-brand text-white border-brand' : 'bg-surface-2 text-ink-secondary border hover:text-ink'
                  }`}>
                  {g.label}
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                    groupFilter === g.key ? 'bg-white/25' : 'bg-black/10 text-ink-muted'
                  }`}>{groupCounts[g.key] ?? 0}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Recherche (plaque, client, dossier...)"
              className="sm:col-span-2 bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint"
            />
            <select
              value={sourceFilter}
              onChange={e => setSrc(e.target.value)}
              className="bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
            >
              <option value="all">Toutes sources</option>
              {sources.map(s => (
                <option key={s} value={s}>{fmtSource(s)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Recherche avancée VD Soft + TowSoft (Olivier 2026-06-12) */}
        <div className="bg-surface border rounded-2xl p-4 space-y-3 ambient-fade-up ambient-stagger-1">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔎</span>
            <h2 className="text-ink font-semibold text-sm">Facturer une autre mission (recherche VD Soft + TowSoft)</h2>
          </div>
          <p className="text-ink-muted text-xs">
            Cherche par plaque, VIN, dossier, n° de mission ou n° de facture — dans VD Soft <strong>et</strong> dans TowSoft.
          </p>

          {/* Type de recherche */}
          <div className="flex flex-wrap gap-2">
            {([
              ['immatriculation', 'Plaque'],
              ['niv',             'VIN'],
              ['num_dossier',     'Dossier'],
              ['id_appel',        'N° mission'],
              ['num_facture',     'N° facture'],
            ] as const).map(([val, label]) => (
              <button key={val} type="button" onClick={() => setAdvType(val)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                  advType === val ? 'bg-brand text-white border-brand' : 'bg-surface-2 text-ink-secondary border hover:text-ink'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {/* Champ + bouton */}
          <div className="flex gap-2">
            <input
              value={advKey}
              onChange={e => setAdvKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runAdvSearch() }}
              placeholder="Saisis la valeur à rechercher…"
              className="flex-1 bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint"
            />
            <button onClick={runAdvSearch} disabled={advBusy || advKey.trim().length < 2}
              className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
              {advBusy ? '⏳…' : 'Rechercher'}
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer w-fit">
            <input type="checkbox" checked={advShowCancelled}
              onChange={e => { setAdvShowCancelled(e.target.checked); if (advDone) setTimeout(runAdvSearch, 0) }}
              className="w-3.5 h-3.5 accent-brand" />
            Afficher également les missions annulées
          </label>

          {advErr && <div className="text-critical text-xs">⚠ {advErr}</div>}
          {advMsg && <div className="text-ink-secondary text-xs bg-surface-2 border rounded-lg px-3 py-2">{advMsg}</div>}

          {/* Résultats */}
          {advDone && advResults.length === 0 && !advErr && (
            <div className="text-ink-muted text-xs">Aucun résultat dans VD Soft ni TowSoft.</div>
          )}
          {advResults.length > 0 && (
            <div className="space-y-2">
              {advResults.map((r, i) => {
                const isVd = r.source === 'vdsoft'
                const veh  = [r.brand, r.model].filter(Boolean).join(' ')
                return (
                  <div key={`${r.source}-${r.id}-${i}`} className="border rounded-xl p-3 bg-surface-2 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isVd ? 'bg-success/15 text-success' : 'bg-amber-500/15 text-amber-700'}`}>
                          {isVd ? 'VD SOFT' : 'TOWSOFT'}
                        </span>
                        <span className="font-mono font-bold text-ink text-sm">{r.plate || '—'}</span>
                        <span className="text-ink-secondary text-xs">{veh || '—'}</span>
                        {r.ticket && <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/15 text-purple-700">{r.ticket}</span>}
                      </div>
                      <div className="text-ink-muted text-[11px] mt-0.5 truncate">
                        {r.ref} · {r.client || '—'} · {r.dossier || '—'}
                        {r.status ? ` · ${r.status}` : ''}
                        {r.montant_ttc != null ? ` · ${Number(r.montant_ttc).toFixed(2)} € TTC` : ''}
                        {r.date_iso ? ` · ${fmtDate(r.date_iso)}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isVd ? (
                        <button onClick={() => openFacture(r.vdsoft_id, null)} disabled={rowBusy === r.vdsoft_id}
                          className="px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-lg text-xs font-semibold">
                          {rowBusy === r.vdsoft_id ? '⏳…' : 'Facturer'}
                        </button>
                      ) : (
                        <>
                          <button onClick={() => importAndFacture(r.towsoft_num)} disabled={rowBusy === 'tw-' + r.towsoft_num}
                            className="px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-lg text-xs font-semibold">
                            {rowBusy === 'tw-' + r.towsoft_num ? '⏳…' : 'Importer + facturer'}
                          </button>
                          <button onClick={() => cancelTowsoftFiche(r.towsoft_num)} disabled={rowBusy === 'cancel-' + r.towsoft_num}
                            className="px-3 py-1.5 bg-surface hover:bg-surface-hover border text-ink-secondary hover:text-ink rounded-lg text-xs font-semibold">
                            {rowBusy === 'cancel-' + r.towsoft_num ? '⏳…' : 'Annuler fiche'}
                          </button>
                          {r.fiche_url && (
                            <a href={r.fiche_url} target="_blank" rel="noopener" className="text-brand text-xs underline px-1">TowSoft ↗</a>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Barre facturation par lot + vérification Odoo */}
        <div className="bg-surface border rounded-2xl p-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={verifyInvoices}
            disabled={batchBusy !== null}
            title="Vérifie dans Odoo quelles fiches ont une facture postée et les complète automatiquement"
            className="py-2 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition"
          >
            {batchBusy === 'verify' ? '🔎 Vérification…' : '🔎 Vérification facturation Odoo'}
          </button>

          {selectedIds.size > 0 ? (
            <>
              <span className="text-ink-secondary text-sm font-medium">{selectedIds.size} sélectionnée{selectedIds.size > 1 ? 's' : ''}</span>
              <button
                type="button"
                onClick={batchFacturer}
                disabled={batchBusy !== null}
                className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition"
              >
                {batchBusy === 'facturer' ? '🧾 Création…' : `🧾 Facturer le lot (${selectedIds.size})`}
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                disabled={batchBusy !== null}
                className="py-2 px-3 bg-surface-2 border text-ink-secondary hover:text-ink rounded-lg text-sm transition"
              >
                Désélectionner
              </button>
            </>
          ) : (
            <span className="text-ink-faint text-xs">Coche des fiches pour les facturer en lot, puis « Vérification » une fois postées dans Odoo.</span>
          )}

          {batchReport && (
            <p className="w-full text-ink-secondary text-xs mt-1 border-t pt-2">{batchReport}</p>
          )}

          {/* Légende code couleur état Odoo */}
          <div className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted border-t pt-2">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-500 inline-block" /> Devis créé (pas encore facturé)</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500 inline-block" /> Facture créée (à confirmer dans Odoo)</span>
          </div>
        </div>

        {/* Liste */}
        {filtered.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center">
            <p className="text-ink-muted text-sm">Aucune mission à facturer.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {grouped.map(group => {
              const renderCard = (m: MissionRow) => {
              const kind         = missionKind(m)
              const childRels    = siblingsByMission.byParentId.get(m.id) || []
              const parentRow    = m.parent_mission_id ? siblingsByMission.byId.get(m.parent_mission_id) : null
              const hasChain     = childRels.length > 0 || !!parentRow
              // Relivraison liée encore EN COURS (pas prête à facturer) → on
              // alerte pour ne pas facturer la chaîne tant que la REL n'est pas
              // terminée (on facture tout ensemble). Olivier 2026-06-17.
              const REL_NOT_READY = ['new', 'dispatching', 'assigned', 'accepted', 'in_progress', 'delivering', 'parked']
              const relEnCours   = childRels.filter(c => REL_NOT_READY.includes(c.status) && !c.no_charge_at)
              const hasRelEnCours = relEnCours.length > 0
              const pays         = paymentsByMission.get(m.id) || []
              const advs         = advancesByMission.get(m.id) || []
              const hasAdv       = advs.length > 0
              const advTotal     = advs.reduce((s, a) => s + Number(a.amount_htva || 0), 0)
              const hasSpecial   = m.special_tarif_htva != null && Number(m.special_tarif_htva) > 0
              // Code couleur état Odoo (prioritaire) : facture directe créée = vert,
              // devis créé pas encore facturé = bleu. Olivier 2026-07-26.
              const hasInvoice   = m.invoice_odoo_id != null
              const hasQuote     = m.odoo_quote_id != null && !hasInvoice
              const cardBg =
                hasInvoice ? 'bg-emerald-50 border-2 border-emerald-500 hover:bg-emerald-100 hover:border-emerald-600'
                : hasQuote ? 'bg-blue-50 border-2 border-blue-500 hover:bg-blue-100 hover:border-blue-600'
                : hasSpecial ? 'bg-amber-50 border-2 border-amber-500 hover:bg-amber-100 hover:border-amber-600'
                : hasAdv ? 'bg-indigo-50 border-2 border-indigo-400 hover:bg-indigo-100 hover:border-indigo-500'
                : 'bg-surface border hover:bg-surface-hover'

              return (
                  <Link
                    href={`/dispatch/${m.id}`}
                    className={`block rounded-2xl p-4 transition flex flex-col sm:flex-row sm:items-center gap-3 relative overflow-hidden ${cardBg}`}
                  >
                    {/* Ruban "Avance" en coin haut-gauche — Olivier 2026-06-01 */}
                    {hasAdv && (
                      <div className={`absolute top-0 left-0 text-white text-[10px] font-bold px-2 py-0.5 rounded-br-lg uppercase tracking-wider ${hasSpecial ? 'bg-amber-600' : 'bg-indigo-600'}`}>
                        💰 {advs.length} Avance{advs.length > 1 ? 's' : ''}
                      </div>
                    )}
                    {/* Ruban "Tarif spécial" — Olivier 2026-06-02 PM */}
                    {hasSpecial && (
                      <div className={`absolute top-0 ${hasAdv ? 'right-0 rounded-bl-lg' : 'left-0 rounded-br-lg'} bg-amber-600 text-white text-[10px] font-bold px-2 py-0.5 uppercase tracking-wider`}>
                        ⚡ Tarif spécial
                      </div>
                    )}

                    <span className={`inline-flex items-center justify-center w-12 h-12 rounded-xl text-white text-xs font-bold flex-shrink-0 ${KIND_COLOR[kind]} ${hasAdv ? 'mt-3 sm:mt-0' : ''}`}>
                      {kind}
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-ink font-semibold text-sm">{m.mission_number != null ? `#${m.mission_number}` : (m.external_id || m.dossier_number || m.id.slice(0, 8))}</span>
                        <span className="text-ink-muted text-xs">·</span>
                        <span className="text-ink-secondary text-xs">{fmtSource(m.source)}</span>
                        {hasChain && (
                          <span className="ml-2 px-2 py-0.5 bg-purple-600/15 text-purple-400 text-xs rounded font-medium">
                            chaîne REM+REL
                          </span>
                        )}
                        {hasRelEnCours && (
                          <span className="px-2 py-0.5 bg-amber-500 text-white text-xs rounded font-bold uppercase tracking-wide"
                            title="Une relivraison liée est encore en cours — attends qu'elle soit terminée pour tout facturer ensemble">
                            ⚠ Relivraison en cours
                          </span>
                        )}
                      </div>
                      <p className="text-ink-secondary text-sm mt-0.5 truncate">
                        {m.vehicle_plate ? <span className="font-mono">{m.vehicle_plate}</span> : '—'}
                        {' · '}
                        {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'}
                        {' · '}
                        {m.client_name || '—'}
                      </p>
                      <p className="text-ink-muted text-xs mt-0.5 truncate">
                        {m.dossier_number && <>📁 Dossier {m.dossier_number}{' · '}</>}
                        💳 Facturé à : <span className="text-ink-secondary">{m.billed_to_name || '—'}</span>
                      </p>
                      <p className="text-ink-muted text-xs mt-0.5">
                        Terminé le {fmtDateTime(m.completed_at)}
                      </p>
                    </div>

                    {hasAdv && (
                      <span className="px-2.5 py-1 bg-indigo-100 border-2 border-indigo-400 text-indigo-800 text-xs font-semibold rounded-lg whitespace-nowrap" title="Avances de fonds liées à ajouter au devis">
                        💰 {advTotal.toFixed(2)} € HTVA
                      </span>
                    )}
                    {hasSpecial && (
                      <span className="px-2.5 py-1 bg-amber-100 border-2 border-amber-500 text-amber-900 text-xs font-bold rounded-lg whitespace-nowrap" title="Tarif spécial HTVA — Intervention suivant prix convenu">
                        ⚡ {Number(m.special_tarif_htva).toFixed(2)} € HTVA
                      </span>
                    )}

                    {pays.length > 0 && (
                      <span className="px-2.5 py-1 bg-warning-soft border border-warning text-warning text-xs font-semibold rounded-lg whitespace-nowrap">
                        ⚠ {pays.reduce((s, p) => s + Number(p.amount || 0), 0).toFixed(2)} € encaissé
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSel(m.id) }}
                      title="Sélectionner pour la facturation par lot"
                      className={`w-7 h-7 rounded-md border-2 flex items-center justify-center flex-shrink-0 text-sm font-bold transition ${
                        selectedIds.has(m.id) ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-surface border-ink-faint text-transparent hover:border-emerald-500'
                      }`}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSelected(m) }}
                      className="px-3 py-2 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-semibold transition whitespace-nowrap flex-shrink-0"
                    >
                      Facturer →
                    </button>
                  </Link>
              )
              } // fin renderCard

              // Chaîne liée (≥2 fiches visibles) : on encadre l'ensemble en violet.
              if (group.items.length >= 2) {
                return (
                  <li key={group.root}>
                    <div className="rounded-2xl border-2 border-purple-400 bg-purple-50/60 p-2 space-y-2">
                      <div className="flex items-center gap-2 px-2 pt-1">
                        <span className="px-2 py-0.5 bg-purple-600 text-white text-[11px] rounded font-bold uppercase tracking-wide">
                          🔗 Chaîne liée
                        </span>
                        <span className="text-purple-700 text-xs font-medium">
                          {group.items.length} fiches à facturer ensemble (REM + REL)
                        </span>
                      </div>
                      {group.items.map(m => (
                        <div key={m.id}>{renderCard(m)}</div>
                      ))}
                    </div>
                  </li>
                )
              }
              return <li key={group.items[0].id}>{renderCard(group.items[0])}</li>
            })}
          </ul>
        )}
      </div>
      </AmbientBackground>

      {selected && (
        <FacturerModal
          mission={selected}
          siblings={(() => {
            // Olivier 2026-06-24 : le parent (REM) peut être lui-même dans la
            // liste principale `data` (cas REM+REL ET REL tous deux to_invoice)
            // → on le cherche dans siblings ET dans data, sinon partir de la REL
            // n'affichait qu'elle. Idem enfants (depuis data si déjà chargés).
            const out: any[] = []
            if (selected.parent_mission_id) {
              const p = siblingsByMission.byId.get(selected.parent_mission_id)
                     || data.find(d => d.id === selected.parent_mission_id)
              if (p) out.push(p)
            }
            const kids = [
              ...(siblingsByMission.byParentId.get(selected.id) || []),
              ...data.filter(d => d.parent_mission_id === selected.id),
            ]
            for (const k of kids) if (!out.some(o => o.id === k.id)) out.push(k)
            return out as any
          })()}
          payments={paymentsByMission.get(selected.id) || []}
          driverName={driverName}
          onClose={() => setSelected(null)}
          onUpdated={handleInvoiceUpdated}
        />
      )}
    </AppShell>
  )
}
