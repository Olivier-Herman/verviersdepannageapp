'use client'

import { useState }  from 'react'
import { useRouter }  from 'next/navigation'
import { signIn } from 'next-auth/react'
import { signOutCascade as signOut } from '@/lib/auth-signout'
import FeatureFlagsPanel from '@/components/admin/FeatureFlagsPanel'

const LIST_TYPES = [
  { key: 'motif',        label: 'Motifs d\'intervention' },
  { key: 'payment_mode', label: 'Modes de paiement' },
]

import { BUSINESS_SETTINGS } from '@/lib/settings/business-registry'

export default function SettingsClient({
  listItems,
  callShortcuts,
  appSettings,
}: {
  listItems:    any[]
  callShortcuts: any[]
  appSettings:  Record<string, string>
}) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'motif' | 'payment_mode' | 'calls' | 'params'>('motif')
  const [showAdd,      setShowAdd]      = useState(false)
  const [newLabel,     setNewLabel]     = useState('')
  const [newValue,     setNewValue]     = useState('')
  const [newPhone,     setNewPhone]     = useState('')
  const [newCategory,  setNewCategory]  = useState('assistance')
  const [saving,       setSaving]       = useState(false)

  // Paramètres app
  const [purchaseEmail,  setPurchaseEmail]  = useState(appSettings['odoo_purchase_email'] ?? '')
  // Inventaire 07/09/2026 (partie D) : trois clés que seul du SQL pouvait écrire.
  const geo0: any = (appSettings as any)['reception_geofence'] || {}
  const [geoLat,      setGeoLat]      = useState(geo0.lat != null ? String(geo0.lat) : '')
  const [geoLng,      setGeoLng]      = useState(geo0.lng != null ? String(geo0.lng) : '')
  const [geoRadius,   setGeoRadius]   = useState(geo0.radius_m != null ? String(geo0.radius_m) : '')
  const [tgrEmail,    setTgrEmail]    = useState(String(appSettings['tgr_info_email'] ?? ''))
  const [rfqMailbox,  setRfqMailbox]  = useState(String(appSettings['achats_rfq_mailbox'] ?? ''))
  const [paramsError, setParamsError] = useState<string | null>(null)
  const [savingParams,   setSavingParams]   = useState(false)
  // Réglages métier (lot A « admin sans valeurs en dur », 09/09/2026) : texte tel que saisi ;
  // vide = repli du registre (la valeur qui était codée).
  const [biz, setBiz] = useState<Record<string, string>>(() => Object.fromEntries(BUSINESS_SETTINGS.map(d => {
    const v = (appSettings as any)[d.key]
    return [d.key, v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v)]
  })))
  const [paramsSaved,    setParamsSaved]    = useState(false)

  const items = listItems.filter(i => i.list_type === activeTab)

  const addItem = async () => {
    if (!newLabel) return
    setSaving(true)
    try {
      await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:       'list_item',
          list_type:  activeTab,
          label:      newLabel,
          value:      newValue || newLabel.toLowerCase().replace(/\s+/g, '_'),
          sort_order: items.length + 1
        })
      })
      setNewLabel('')
      setNewValue('')
      setShowAdd(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const addShortcut = async () => {
    if (!newLabel || !newPhone) return
    setSaving(true)
    try {
      await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:       'call_shortcut',
          label:      newLabel,
          phone:      newPhone,
          category:   newCategory,
          sort_order: callShortcuts.length + 1
        })
      })
      setNewLabel('')
      setNewPhone('')
      setShowAdd(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (id: string, table: string, current: boolean) => {
    await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, table, active: !current })
    })
    router.refresh()
  }

  const deleteItem = async (id: string, table: string) => {
    await fetch('/api/admin/settings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, table })
    })
    router.refresh()
  }

  const saveParams = async () => {
    setSavingParams(true); setParamsError(null)
    try {
      const settings: Record<string, unknown> = { odoo_purchase_email: purchaseEmail }
      const lat = parseFloat(geoLat.replace(',', '.')), lng = parseFloat(geoLng.replace(',', '.')), radius = parseInt(geoRadius, 10)
      if (geoLat.trim() || geoLng.trim() || geoRadius.trim()) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !(radius > 0)) { setParamsError('Zone GPS : latitude, longitude et rayon (m) doivent être remplis tous les trois.'); return }
        settings.reception_geofence = { lat, lng, radius_m: radius }
      }
      if (tgrEmail.trim() && !tgrEmail.includes('@')) { setParamsError('Adresse TGR invalide.'); return }
      if (rfqMailbox.trim() && !rfqMailbox.includes('@')) { setParamsError('Boîte des demandes de prix invalide.'); return }
      settings.tgr_info_email = tgrEmail.trim()
      settings.achats_rfq_mailbox = rfqMailbox.trim()
      for (const d of BUSINESS_SETTINGS) {
        const raw = (biz[d.key] || '').trim()
        if (!raw) { setParamsError(`« ${d.label} » est obligatoire (valeur d'origine : ${Array.isArray(d.seed) ? d.seed.join(', ') : String(d.seed)}).`); return }
        if (d.kind === 'number') { const n = Number(raw.replace(',', '.')); if (!Number.isFinite(n) || n <= 0) { setParamsError(`« ${d.label} » : nombre attendu.`); return } settings[d.key] = n }
        else if (d.kind === 'emails') settings[d.key] = raw.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean)
        else settings[d.key] = raw
      }
      const r = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); setParamsError(j.error || `Erreur ${r.status}`); return }
      setParamsSaved(true)
      setTimeout(() => setParamsSaved(false), 2000)
    } finally {
      setSavingParams(false)
    }
  }

  return (
    <div className="px-4 py-5">
      {/* Tabs */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {LIST_TYPES.map(t => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key as any); setShowAdd(false) }}
            className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === t.key ? 'bg-brand text-white' : 'bg-surface-2 text-ink-muted border border'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => { setActiveTab('calls' as any); setShowAdd(false) }}
          className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === 'calls' ? 'bg-brand text-white' : 'bg-surface-2 text-ink-muted border border'
          }`}
        >
          Raccourcis appel
        </button>
        <button
          onClick={() => { setActiveTab('params'); setShowAdd(false) }}
          className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === 'params' ? 'bg-brand text-white' : 'bg-surface-2 text-ink-muted border border'
          }`}
        >
          ⚙️ Paramètres
        </button>
      </div>

      {/* ── Onglet Paramètres ── */}
      {activeTab === 'params' && (
        <div className="flex flex-col gap-4">
          <div className="bg-surface-2 border border rounded-2xl p-4">
            <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">
              Odoo — Avance de fonds
            </p>
            <label className="block text-sm text-ink-secondary mb-1.5">
              Email boîte achat
            </label>
            <input
              type="email"
              placeholder="achats@verviersdepannage.be"
              value={purchaseEmail}
              onChange={e => setPurchaseEmail(e.target.value)}
              className="w-full bg-surface-hover border border-strong rounded-xl px-4 py-2.5
                         text-ink text-sm outline-none focus:border-brand"
            />
            <p className="text-ink-faint text-xs mt-1.5">
              Les factures fournisseurs (avances de fonds) seront envoyées à cette adresse pour traitement OCR Odoo.
            </p>
          </div>

          <div className="bg-surface-2 border border rounded-2xl p-4">
            <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">
              Accueil visiteurs — zone GPS
            </p>
            <p className="text-ink-faint text-xs mb-3">
              Le QR de l'accueil n'accepte un visiteur que si son téléphone est dans ce rayon autour du comptoir. Vide = dépôt de Pepinster, 200 m.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-ink-secondary flex flex-col gap-1">Latitude
                <input inputMode="decimal" placeholder="50.5703357" value={geoLat} onChange={e => setGeoLat(e.target.value)}
                  className="bg-surface-hover border border-strong rounded-xl px-3 py-2 text-ink text-sm outline-none focus:border-brand" />
              </label>
              <label className="text-xs text-ink-secondary flex flex-col gap-1">Longitude
                <input inputMode="decimal" placeholder="5.8216501" value={geoLng} onChange={e => setGeoLng(e.target.value)}
                  className="bg-surface-hover border border-strong rounded-xl px-3 py-2 text-ink text-sm outline-none focus:border-brand" />
              </label>
              <label className="text-xs text-ink-secondary flex flex-col gap-1">Rayon (m)
                <input inputMode="numeric" placeholder="200" value={geoRadius} onChange={e => setGeoRadius(e.target.value)}
                  className="bg-surface-hover border border-strong rounded-xl px-3 py-2 text-ink text-sm outline-none focus:border-brand" />
              </label>
            </div>
          </div>

          <div className="bg-surface-2 border border rounded-2xl p-4">
            <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">
              TGR — adresse d'information
            </p>
            <input type="email" placeholder="info@verviersdepannage.com" value={tgrEmail} onChange={e => setTgrEmail(e.target.value)}
              className="w-full bg-surface-hover border border-strong rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-brand" />
            <p className="text-ink-faint text-xs mt-1.5">Reçoit le mail à chaque nouvelle demande TGR déposée par un partenaire. Vide = pas de mail.</p>
          </div>

          <div className="bg-surface-2 border border rounded-2xl p-4">
            <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">
              Achats — boîte des demandes de prix
            </p>
            <input type="email" placeholder="administration@verviersdepannage.com" value={rfqMailbox} onChange={e => setRfqMailbox(e.target.value)}
              className="w-full bg-surface-hover border border-strong rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-brand" />
            <p className="text-ink-faint text-xs mt-1.5">Boîte qui envoie et reçoit les appels d'offre du module Achats. Vide = administration@. La boîte doit être autorisée côté Microsoft avant de basculer.</p>
          </div>

          {(['Odoo', 'Boîtes mail', 'Montants'] as const).map(group => (
            <div key={group} className="bg-surface-2 border border rounded-2xl p-4">
              <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-1">Réglages métier — {group}</p>
              <p className="text-ink-faint text-xs mb-3">Obligatoire — la valeur d'origine est rappelée entre parenthèses. Pris en compte dans la minute, sans déploiement.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {BUSINESS_SETTINGS.filter(d => d.group === group).map(d => (
                  <label key={d.key} className="block">
                    <span className="block text-ink-secondary text-xs font-medium mb-1">{d.label} <span className="text-ink-faint font-normal">({Array.isArray(d.seed) ? d.seed.join(', ') : String(d.seed)})</span></span>
                    <input type="text" inputMode={d.kind === 'number' ? 'decimal' : undefined} value={biz[d.key] || ''} onChange={e => setBiz(b => ({ ...b, [d.key]: e.target.value }))}
                      placeholder={Array.isArray(d.seed) ? d.seed.join(', ') : String(d.seed)}
                      className="w-full bg-surface-hover border border-strong rounded-xl px-3 py-2 text-ink text-sm outline-none focus:border-brand" />
                    {d.help && <span className="block text-ink-faint text-[11px] mt-0.5">{d.help}</span>}
                  </label>
                ))}
              </div>
            </div>
          ))}

          {paramsError && <p className="text-red-700 text-sm">{paramsError}</p>}

          <button
            onClick={saveParams}
            disabled={savingParams}
            className="w-full py-3 bg-brand text-white rounded-xl font-bold text-sm
                       disabled:opacity-50 transition-all"
          >
            {paramsSaved ? '✅ Enregistré' : savingParams ? 'Enregistrement...' : 'Enregistrer les paramètres'}
          </button>

          {/* Préversions (feature flags) — visible superadmin uniquement */}
          <FeatureFlagsPanel />

          {/* Vider le cache session */}
          <div className="bg-surface-2 border border rounded-2xl p-4 mt-2">
            <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-2">
              Cache session
            </p>
            <p className="text-ink-faint text-xs mb-3">
              Si les rôles ou modules d'un utilisateur ne se reflètent pas après modification,
              utilisez ce bouton pour forcer le renouvellement du token de session.
            </p>
            <button
              onClick={async () => {
                await signOut({ redirect: false })
                await signIn(undefined, { callbackUrl: '/admin/settings' })
              }}
              className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-ink-secondary rounded-xl
                         font-medium text-sm transition-all border border-zinc-700">
              🔄 Vider le cache et reconnecter
            </button>
          </div>
        </div>
      )}

      {/* ── Onglets listes / raccourcis ── */}
      {activeTab !== 'params' && (
        <>
          {/* Bouton ajouter */}
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="w-full bg-surface-2 border border-dashed border-strong text-ink-muted rounded-xl py-3 text-sm mb-4 hover:border-brand hover:text-brand transition-colors"
          >
            + Ajouter un élément
          </button>

          {/* Formulaire ajout */}
          {showAdd && (
            <div className="bg-surface-2 border border rounded-2xl p-4 mb-4">
              <input
                placeholder="Libellé *"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                className="w-full bg-surface-hover border border-strong rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-brand mb-2"
              />
              {activeTab !== 'calls' && (
                <input
                  placeholder="Valeur technique (optionnel)"
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  className="w-full bg-surface-hover border border-strong rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-brand mb-2"
                />
              )}
              {activeTab === 'calls' && (
                <>
                  <input
                    placeholder="Numéro de téléphone *"
                    value={newPhone}
                    onChange={e => setNewPhone(e.target.value)}
                    className="w-full bg-surface-hover border border-strong rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-brand mb-2"
                  />
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    className="w-full bg-surface-hover border border-strong rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-brand mb-2"
                  >
                    <option value="assistance">Assistance</option>
                    <option value="police">Police</option>
                    <option value="prive">Privé</option>
                    <option value="autre">Autre</option>
                  </select>
                </>
              )}
              <div className="flex gap-2">
                <button onClick={() => setShowAdd(false)} className="flex-1 bg-surface-hover border border-strong text-ink-muted rounded-xl py-2.5 text-sm">
                  Annuler
                </button>
                <button
                  onClick={activeTab === 'calls' ? addShortcut : addItem}
                  disabled={saving || !newLabel}
                  className="flex-1 bg-brand text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50"
                >
                  {saving ? 'Ajout...' : 'Ajouter'}
                </button>
              </div>
            </div>
          )}

          {/* Liste */}
          <div className="flex flex-col gap-2">
            {(activeTab === 'calls' ? callShortcuts : items).map((item: any) => (
              <div
                key={item.id}
                className={`bg-surface-2 border rounded-xl p-3.5 flex items-center gap-3 ${item.active ? 'border' : 'border opacity-50'}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-ink text-sm font-medium">{item.label}</p>
                  <p className="text-ink-faint text-xs mt-0.5">
                    {activeTab === 'calls' ? item.phone : item.value}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleActive(item.id, activeTab === 'calls' ? 'call_shortcuts' : 'list_items', item.active)}
                    className={`w-9 h-5 rounded-full transition-colors relative ${item.active ? 'bg-green-600' : 'bg-zinc-700'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${item.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <button
                    onClick={() => deleteItem(item.id, activeTab === 'calls' ? 'call_shortcuts' : 'list_items')}
                    className="text-ink-faint hover:text-critical text-lg transition-colors"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}

            {(activeTab === 'calls' ? callShortcuts : items).length === 0 && (
              <div className="text-center py-8 text-ink-faint text-sm">
                Aucun élément — clique sur + pour ajouter
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
