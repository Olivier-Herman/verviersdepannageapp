'use client'
// Admin › AXA go&assist. Un seul écran : état, réamorçage, clôtures en attente.
import { useCallback, useEffect, useState } from 'react'

type Health = { ok: boolean; at: string; last_ok_at: string | null; error: string | null; consecutive_failures: number; awaiting?: number } | null
type Me = { auth0Id: string | null; email: string | null; roles: string[]; canBeAssigned: boolean | null; providerId: string | null } | null
type Closure = { id: string; mission_number: number; vehicle_plate: string | null; mission_type: string | null; completed_at: string | null; status: string; ga_status?: string | null }
type Tech = { auth0Id: string; email: string | null; name: string; missions: number; last: string | null; isToken: boolean; canBeAssigned: boolean | null }

const fmt = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export default function AxaClient() {
  const [health, setHealth]     = useState<Health>(null)
  const [closures, setClosures] = useState<Closure[]>([])
  const [tokenAt, setTokenAt]   = useState<string | null>(null)
  const [me, setMe]             = useState<Me>(null)
  const [techs, setTechs]       = useState<Tech[]>([])
  const [tech, setTech]         = useState<string | null>(null)
  const [token, setToken]       = useState('')
  const [busy, setBusy]         = useState<string | null>(null)
  const [msg, setMsg]           = useState<{ ok: boolean; text: string } | null>(null)
  const [loaded, setLoaded]     = useState(false)

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/axa', { cache: 'no-store' })
    if (!r.ok) return
    const j = await r.json()
    setHealth(j.health); setClosures(j.failed_closures || []); setTokenAt(j.token_updated_at); setMe(j.me || null); setTechs(j.technicians || []); setTech(j.technician || null); setLoaded(true)
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (action: string, extra: any = {}) => {
    setBusy(action); setMsg(null)
    try {
      const r = await fetch('/api/admin/axa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) })
      const j = await r.json()
      if (!r.ok) setMsg({ ok: false, text: j.error || 'Échec' })
      else if (action === 'seed') { setToken(''); setMsg({ ok: true, text: `Connexion rétablie${j.me?.email ? ' avec ' + j.me.email : ''}. ${j.missions} missions visibles côté go&assist.` }) }
      else if (action === 'test') setMsg({ ok: true, text: `Poll OK : ${j.awaiting} mission(s) à traiter, dont ${j.news} nouvelle(s) à valider.` })
      else if (action === 'retry_closures') {
        const okN = (j.results || []).filter((x: any) => x.ok).length
        setMsg({ ok: okN === j.tried, text: `${okN}/${j.tried} clôture(s) poussée(s) vers AXA${j.autoclosed ? `, ${j.autoclosed} déjà clôturée(s) par AXA (retirées de la liste)` : ''}.${okN < j.tried ? ' Les autres restent listées avec leur erreur dans le journal de la fiche.' : ''}` })
      }
      else if (action === 'set_technician') setMsg({ ok: true, text: 'Technicien enregistré. Pris en compte dans l’heure.' })
    } catch (e: any) { setMsg({ ok: false, text: e?.message || 'Erreur réseau' }) }
    setBusy(null); load()
  }

  const down = health && !health.ok
  return (
    <div className="max-w-3xl mx-auto p-4 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">AXA go&assist</h1>
        <p className="text-ink-muted text-sm">Connexion au portail AXA : lecture des missions, acceptation, affectation et clôtures.</p>
      </div>

      <section className={`rounded-xl border p-4 ${!loaded ? 'bg-surface border-border' : down ? 'bg-red-50 border-red-300' : health ? 'bg-emerald-50 border-emerald-300' : 'bg-amber-50 border-amber-300'}`}>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-3 h-3 rounded-full ${!loaded ? 'bg-gray-300' : down ? 'bg-red-500' : health ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <h2 className="font-semibold text-ink">
            {!loaded ? 'Chargement…' : down ? 'Déconnecté' : health ? 'Connecté' : 'Jamais mesuré'}
          </h2>
        </div>
        {health && (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-ink-secondary">
            <dt>Dernier tour</dt><dd className="text-ink">{fmt(health.at)}</dd>
            <dt>Dernier succès</dt><dd className="text-ink">{fmt(health.last_ok_at)}</dd>
            <dt>Échecs consécutifs</dt><dd className="text-ink">{health.consecutive_failures}</dd>
            <dt>Jeton posé le</dt><dd className="text-ink">{fmt(tokenAt)}</dd>
            {health.ok && health.awaiting != null && (<><dt>Missions à traiter</dt><dd className="text-ink">{health.awaiting}</dd></>)}
          </dl>
        )}
        {down && health?.error && <p className="mt-2 text-xs text-red-800 break-words">{health.error}</p>}
        {me && (() => {
          const need = ['Manager', 'Dispatcher', 'Technician']
          const missing = need.filter(r => !me.roles.includes(r))
          return (
            <div className="mt-3 text-sm">
              <p className="text-ink"><b>Compte du jeton :</b> {me.email || me.auth0Id || '—'}{me.providerId ? ` · prestataire ${me.providerId}` : ''}</p>
              <p className="text-ink-secondary">Rôles : {me.roles.join(', ') || '—'}</p>
              {missing.length > 0 && <p className="text-red-800 mt-1">⚠️ Il manque {missing.join(' + ')} : {missing.includes('Technician') ? 'les clôtures échoueront' : 'les affectations peuvent échouer'}. À corriger chez AXA.</p>}
              {me.canBeAssigned === false && <p className="text-amber-800 mt-1">⚠️ Ce compte n'est pas « assignable » comme technicien chez AXA. Les affectations passent par le technicien de repli (info@) tant que ce n'est pas activé dans les réglages utilisateur go&assist.</p>}
            </div>
          )
        })()}
        <div className="mt-3 flex gap-2">
          <button onClick={() => post('test')} disabled={!!busy} className="px-3 py-1.5 rounded-lg bg-surface border border-border text-sm text-ink hover:bg-surface-hover disabled:opacity-50">
            {busy === 'test' ? 'Test…' : 'Tester la connexion'}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <h2 className="font-semibold text-ink">Réamorcer la connexion</h2>
        <ol className="list-decimal pl-5 text-sm text-ink-secondary space-y-1">
          <li>Ouvre une <b>fenêtre privée</b>, va sur le portail go&assist <b>web</b> (pas l'app mobile), ouvre les outils de développement (F12) onglet <b>Network</b>, puis connecte-toi avec le compte réservé au serveur. Ce compte doit porter les rôles Manager + Dispatcher + Technicien : c'est lui qui sera affecté et qui clôturera.</li>
          <li>Cherche la requête <b>oauth/token</b> (domaine auth0.com). Dans sa réponse, copie la valeur de <b>refresh_token</b> (commence par <code>v1.</code>).</li>
          <li>Colle-la ci-dessous et clique sur Réamorcer. La connexion est vérifiée immédiatement.</li>
          <li><b>Ferme la fenêtre privée sans rien faire d'autre.</b> Si cette session est réutilisée ensuite, AXA révoque notre jeton et on revient ici.</li>
        </ol>
        <textarea value={token} onChange={e => setToken(e.target.value)} rows={3} placeholder="v1.…" spellCheck={false}
          className="w-full rounded-lg border border-border bg-page px-3 py-2 text-sm font-mono text-ink" />
        <button onClick={() => post('seed', { token })} disabled={!!busy || token.trim().length < 20}
          className="px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-50">
          {busy === 'seed' ? 'Vérification…' : 'Réamorcer'}
        </button>
      </section>

      {health?.ok && (
        <section className="rounded-xl border border-border bg-surface p-4 space-y-2">
          <h2 className="font-semibold text-ink">Technicien affecté chez AXA</h2>
          <p className="text-sm text-ink-secondary">Utilisateur go&assist auquel nos missions sont affectées. Sans choix, c'est le compte du jeton s'il est assignable. Un technicien n'apparaît ici qu'après avoir été affecté au moins une fois depuis le portail.</p>
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm text-ink"><input type="radio" name="tech" checked={!tech} onChange={() => post('set_technician', { auth0Id: '' })} /> Automatique (compte du jeton)</label>
            {techs.map(t => (
              <label key={t.auth0Id} className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" name="tech" checked={tech === t.auth0Id} onChange={() => post('set_technician', { auth0Id: t.auth0Id })} />
                <span>{t.email || t.name}{t.isToken ? ' (compte du jeton)' : ''}</span>
                <span className="text-ink-muted">· {t.missions} mission{t.missions > 1 ? 's' : ''}{t.last ? `, dernière ${fmt(t.last)}` : ''}{t.canBeAssigned === false ? ' · non assignable' : ''}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-ink">Clôtures non poussées vers AXA <span className="text-ink-muted font-normal">({closures.length})</span></h2>
          <button onClick={() => post('retry_closures')} disabled={!!busy || !closures.length || !!down}
            className="px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-50">
            {busy === 'retry_closures' ? 'Envoi…' : 'Repousser / rapprocher'}
          </button>
        </div>
        {!closures.length ? <p className="text-sm text-ink-muted">Rien en attente.</p> : (
          <ul className="divide-y divide-border text-sm">
            {closures.map(c => (
              <li key={c.id} className="py-1.5 flex items-center justify-between gap-3">
                <a href={`/dispatch/${c.id}`} className="text-brand font-medium">#{c.mission_number}</a>
                <span className="text-ink flex-1 truncate">{c.vehicle_plate || '—'} · {c.mission_type || '—'}{c.ga_status ? <span className={`ml-2 text-xs ${/^(New|AwaitingDispatch|Dispatched|InProgress|Accepted|Started)$/i.test(c.ga_status) ? 'text-emerald-700' : 'text-ink-muted'}`}>AXA : {c.ga_status}</span> : null}</span>
                <span className="text-ink-muted">{fmt(c.completed_at)}</span>
              </li>
            ))}
          </ul>
        )}
        {down && !!closures.length && <p className="text-xs text-amber-800">Réamorce d'abord la connexion, puis repousse.</p>}
      </section>

      {msg && <p className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{msg.text}</p>}
    </div>
  )
}
