'use client'

import { useEffect, useState }  from 'react'
import { useRouter }  from 'next/navigation'
import { signIn } from 'next-auth/react'
import { signOutCascade as signOut } from '@/lib/auth-signout'
import { GROUPE_AFFICHE, ORDRE_GROUPES, normaliser } from '@/lib/admin/reglages'

const LIST_TYPES = [
  { key: 'motif',        label: 'Motifs d\'intervention' },
  { key: 'payment_mode', label: 'Modes de paiement' },
]

import { BUSINESS_SETTINGS } from '@/lib/settings/business-registry'

export default function SettingsClient({
  listItems,
  callShortcuts,
  appSettings,
  focus,
  onglet,
}: {
  listItems:    any[]
  callShortcuts: any[]
  appSettings:  Record<string, string>
  /** Réglage à montrer (lien de la recherche de la page Réglages : ?r=<clé>). */
  focus?:       string
  /** Onglet à ouvrir (?onglet=motif|payment_mode|calls|params). */
  onglet?:      string
}) {
  const router = useRouter()
  const ongletInitial = (['motif', 'payment_mode', 'calls', 'params'] as const).find(o => o === onglet) || 'params'
  const [activeTab, setActiveTab] = useState<'motif' | 'payment_mode' | 'calls' | 'params'>(ongletInitial)
  const [filtre, setFiltre] = useState('')

  // Arrivée depuis la recherche : défiler jusqu'au réglage et le surligner quelques secondes.
  const [surligne, setSurligne] = useState<string | null>(focus || null)
  useEffect(() => {
    if (!focus) return
    const t = setTimeout(() => document.getElementById(`reglage-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150)
    const fin = setTimeout(() => setSurligne(null), 4000)
    return () => { clearTimeout(t); clearTimeout(fin) }
  }, [focus])
  const anneau = (key: string) => surligne === key ? ' ring-2 ring-brand ring-offset-2' : ''
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
  // 11/11/2026 : une valeur structurée (règles de tri des mails, loyers sans facture,
  // comptes par fournisseur, absences) s'affiche et se renvoie en JSON, telle quelle :
  // avant, elle devenait « [object Object] » à l'enregistrement.
  const estStructure = (v: unknown) => v != null && typeof v === 'object' && (!Array.isArray(v) || v.some(x => x != null && typeof x === 'object'))
  const [structures] = useState<Set<string>>(() => new Set(BUSINESS_SETTINGS.filter(d => estStructure((appSettings as any)[d.key])).map(d => d.key)))
  const [bizInitial, setBizInitial] = useState<Record<string, string>>(() => Object.fromEntries(BUSINESS_SETTINGS.map(d => {
    const v = (appSettings as any)[d.key]
    return [d.key, v == null ? '' : estStructure(v) ? JSON.stringify(v, null, 1) : Array.isArray(v) ? v.join(', ') : String(v)]
  })))
  const [biz, setBiz] = useState<Record<string, string>>(bizInitial)
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
        // Seuls les réglages modifiés à l'écran sont écrits : un réglage non touché garde
        // exactement sa valeur en base (un 0 voulu, un réglage jamais renseigné) et ne bloque plus les autres.
        if ((biz[d.key] || '') === (bizInitial[d.key] || '')) continue
        const raw = (biz[d.key] || '').trim()
        if (structures.has(d.key)) {
          try { settings[d.key] = JSON.parse(raw) } catch { setParamsError(`« ${d.label} » : contenu mal formé, vérifiez les crochets, accolades et guillemets.`); return }
          continue
        }
        // Liste vide autorisée quand l'origine est vide (talkie permanent, adresses du comptable).
        if (!raw && Array.isArray(d.seed) && d.seed.length === 0) { settings[d.key] = []; continue }
        if (!raw) { setParamsError(`« ${d.label} » est obligatoire (valeur d'origine : ${Array.isArray(d.seed) ? d.seed.join(', ') : String(d.seed)}).`); return }
        if (d.kind === 'number') { const n = Number(raw.replace(',', '.')); if (!Number.isFinite(n) || n <= 0) { setParamsError(`« ${d.label} » : nombre attendu.`); return } settings[d.key] = n }
        else if (d.kind === 'emails' || d.kind === 'list') settings[d.key] = raw.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean)
        else settings[d.key] = raw
      }
      const r = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); setParamsError(j.error || `Erreur ${r.status}`); return }
      setBizInitial(biz)
      setParamsSaved(true)
      setTimeout(() => setParamsSaved(false), 2000)
    } finally {
      setSavingParams(false)
    }
  }

  return (
    <div className="px-4 py-4 lg:px-0 max-w-[1800px]">
      {/* Onglets de la page (11/11/2026 : Paramètres en premier, c'est lui qui s'ouvre ; même style que les onglets de Réglages). */}
      <div className="mb-5 overflow-x-auto [contain:inline-size] scrollbar-hide"><div role="tablist" className="inline-flex p-1 rounded-full bg-surface-hover">
        {([
          { key: 'params',       label: 'Paramètres' },
          ...LIST_TYPES,
          { key: 'calls',        label: 'Raccourcis d’appel' },
        ] as { key: 'motif' | 'payment_mode' | 'calls' | 'params'; label: string }[]).map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={activeTab === t.key}
            onClick={() => { setActiveTab(t.key); setShowAdd(false) }}
            className={`flex items-center min-h-[42px] px-4 rounded-full text-sm font-semibold whitespace-nowrap transition ${
              activeTab === t.key ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink'
            }`}>
            {t.label}
          </button>
        ))}
      </div></div>

      {/* ── Onglet Paramètres ── */}
      {activeTab === 'params' && (() => {
        // Filtre de la page (11/11/2026) : tous les mots tapés, sans accents ni majuscules.
        const mots = normaliser(filtre).split(/\s+/).filter(Boolean)
        const montre = (texte: string) => !mots.length || mots.every(m => normaliser(texte).includes(m))
        const groupes = ORDRE_GROUPES
          .map(g => ({ g, defs: BUSINESS_SETTINGS.filter(d => d.group === g && montre(`${d.label} ${d.help || ''} ${GROUPE_AFFICHE[g] || g}`)) }))
          .filter(x => x.defs.length)
        const blocs = {
          achat:  montre('Avance de fonds email boîte achat factures fournisseurs'),
          gps:    montre('Accueil visiteurs zone GPS QR rayon latitude longitude'),
          tgr:    montre('TGR adresse information mail'),
          rfq:    montre('Achats boîte demandes de prix appels d’offre'),
          cache:  montre('Cache session reconnecter rôles accès'),
        }
        const rien = !groupes.length && !Object.values(blocs).some(Boolean)
        return (
        <div className="flex flex-col gap-4">
          <input type="search" value={filtre} onChange={e => setFiltre(e.target.value)} autoComplete="off"
            placeholder={`Filtrer les ${BUSINESS_SETTINGS.length + 4} réglages…`} aria-label="Filtrer les réglages"
            className="w-full min-h-[48px] bg-surface border border-strong rounded-xl px-4 text-ink text-base outline-none focus:border-brand" />
          {rien && <p className="text-ink-muted text-sm text-center py-4">Aucun réglage ne correspond à « {filtre.trim()} ».</p>}

          {blocs.achat && (
          <div id="reglage-odoo_purchase_email" className={`bg-surface-2 border border rounded-2xl p-4${anneau('odoo_purchase_email')}`}>
            <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">
              Avance de fonds
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
              Les factures fournisseurs (avances de fonds) sont envoyées à cette adresse pour être lues automatiquement.
            </p>
          </div>
          )}

          {blocs.gps && (
          <div id="reglage-reception_geofence" className={`bg-surface-2 border border rounded-2xl p-4${anneau('reception_geofence')}`}>
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
          )}

          {blocs.tgr && (
          <div id="reglage-tgr_info_email" className={`bg-surface-2 border border rounded-2xl p-4${anneau('tgr_info_email')}`}>
            <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">
              TGR — adresse d'information
            </p>
            <input type="email" placeholder="info@verviersdepannage.com" value={tgrEmail} onChange={e => setTgrEmail(e.target.value)}
              className="w-full bg-surface-hover border border-strong rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-brand" />
            <p className="text-ink-faint text-xs mt-1.5">Reçoit le mail à chaque nouvelle demande TGR déposée par un partenaire. Vide = pas de mail.</p>
          </div>
          )}

          {blocs.rfq && (
          <div id="reglage-achats_rfq_mailbox" className={`bg-surface-2 border border rounded-2xl p-4${anneau('achats_rfq_mailbox')}`}>
            <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">
              Achats — boîte des demandes de prix
            </p>
            <input type="email" placeholder="administration@verviersdepannage.com" value={rfqMailbox} onChange={e => setRfqMailbox(e.target.value)}
              className="w-full bg-surface-hover border border-strong rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-brand" />
            <p className="text-ink-faint text-xs mt-1.5">Boîte qui envoie et reçoit les appels d'offre du module Achats. Vide = administration@. La boîte doit être autorisée côté Microsoft avant de basculer.</p>
          </div>
          )}

          {groupes.map(({ g, defs }) => (
            <div key={g} className="bg-surface-2 border border rounded-2xl p-4">
              <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-1">Réglages métier — {GROUPE_AFFICHE[g] || g}</p>
              <p className="text-ink-faint text-xs mb-3">La valeur d'origine est rappelée entre parenthèses. Seuls les réglages modifiés sont enregistrés ; pris en compte dans la minute, sans déploiement.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {defs.map(d => {
                  const json = structures.has(d.key)
                  const origine = Array.isArray(d.seed) ? d.seed.join(', ') : String(d.seed)
                  return (
                  <label key={d.key} id={`reglage-${d.key}`} className={`block rounded-xl${json ? ' md:col-span-2' : ''}${anneau(d.key)}`}>
                    <span className="block text-ink-secondary text-xs font-medium mb-1">{d.label}{!json && origine && <span className="text-ink-faint font-normal"> ({origine})</span>}</span>
                    {json ? (
                      <textarea value={biz[d.key] || ''} onChange={e => setBiz(b => ({ ...b, [d.key]: e.target.value }))} rows={6} spellCheck={false}
                        className="w-full bg-surface-hover border border-strong rounded-xl px-3 py-2 text-ink text-xs font-mono outline-none focus:border-brand" />
                    ) : (
                      <input type="text" inputMode={d.kind === 'number' ? 'decimal' : undefined} value={biz[d.key] || ''} onChange={e => setBiz(b => ({ ...b, [d.key]: e.target.value }))}
                        placeholder={origine}
                        className="w-full bg-surface-hover border border-strong rounded-xl px-3 py-2 text-ink text-sm outline-none focus:border-brand" />
                    )}
                    {d.help && <span className="block text-ink-faint text-[11px] mt-0.5">{d.help}</span>}
                  </label>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="sticky bottom-0 z-10 -mx-4 px-4 py-3 bg-surface/95 backdrop-blur border-t border-strong space-y-2">
            {paramsError && <p className="text-red-700 text-sm">{paramsError}</p>}
            <button
              onClick={saveParams}
              disabled={savingParams}
              className="w-full min-h-[48px] py-3 bg-brand text-white rounded-xl font-bold text-sm
                         disabled:opacity-50 transition-all"
            >
              {paramsSaved ? '✅ Enregistré' : savingParams ? 'Enregistrement...' : 'Enregistrer les paramètres'}
            </button>
          </div>

          {/* Les préversions ont leur onglet : Réglages › Général › Préversions (11/11/2026). */}

          {/* Vider le cache session */}
          {blocs.cache && (
          <div id="reglage-cache-session" className={`bg-surface-2 border border rounded-2xl p-4 mt-2${anneau('cache-session')}`}>
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
          )}
        </div>
        )
      })()}

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
