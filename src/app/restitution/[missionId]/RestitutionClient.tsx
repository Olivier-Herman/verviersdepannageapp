'use client'

// Restitution unifiée — écran du parcours (Olivier 28/09/2026, maquette validée :
// https://claude.ai/artifact/F14wwMHQwPtrkR5BHRW9Zd). Une étape à la fois ;
// chaque geste part au serveur qui le trace au journal avec son auteur.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import EidImportButton, { type EidData } from '@/components/caisse/EidImportButton'
import AddressField from '@/components/AddressField'
import ScanToFicheButton from '@/components/missions/ScanToFicheButton'
import { compressImage } from '@/lib/image-compress'

type Ctx = any
const eur = (n: number) => (Number(n) || 0).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const hhmm = (iso?: string | null) => iso ? new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
const WHO: [string, string, string?][] = [['owner', 'Le propriétaire'], ['mandate', 'Un mandataire', 'avec procuration'], ['garage', 'Un garage'], ['assistance', 'Une assistance'], ['transport', 'Un transporteur', 'CMR demandé']]

const Card = ({ children, tone }: { children: React.ReactNode; tone?: 'cur' | 'done' }) =>
  <section className={`rounded-card border p-4 flex flex-col gap-3 ${tone === 'cur' ? 'bg-surface border-info shadow-md' : tone === 'done' ? 'bg-surface-2 border-border' : 'bg-surface border-border'}`}>{children}</section>
const Btn = ({ children, onClick, disabled, kind = 'ghost', className = '' }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; kind?: 'brand' | 'ghost' | 'ok' | 'derog'; className?: string }) =>
  <button type="button" onClick={onClick} disabled={disabled} className={`min-h-[44px] rounded-btn px-3.5 text-sm font-semibold disabled:opacity-45 disabled:cursor-not-allowed ${kind === 'brand' ? 'bg-brand hover:bg-brand-hover text-white shadow-brand' : kind === 'ok' ? 'bg-success-fill text-white' : kind === 'derog' ? 'border border-alert text-alert bg-surface' : 'border border-strong bg-surface text-ink'} ${className}`}>{children}</button>
const Opt = ({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub?: string }) =>
  <button type="button" onClick={onClick} aria-pressed={on} className={`flex-1 basis-40 min-h-[48px] text-left rounded-xl border px-3 py-2.5 ${on ? 'border-info bg-info-soft' : 'border-strong bg-surface'}`}>
    <span className="font-semibold text-ink">{title}</span>{sub && <span className="block text-xs text-ink-muted">{sub}</span>}
  </button>
const input = 'w-full rounded-btn border border-strong bg-surface px-3 py-2.5 text-ink'
const Chk = ({ state, title, children }: { state: 'ok' | 'ko' | 'warn'; title: string; children?: React.ReactNode }) =>
  <div className={`rounded-xl px-3 py-2.5 flex gap-2.5 ${state === 'ok' ? 'bg-success-soft' : state === 'ko' ? 'bg-critical-soft' : 'bg-warning-soft'}`}>
    <span className={`font-extrabold w-4 text-center ${state === 'ok' ? 'text-success' : state === 'ko' ? 'text-critical' : 'text-warning'}`}>{state === 'ok' ? '✓' : state === 'ko' ? '✕' : '•'}</span>
    <div className="flex-1 min-w-0"><div className="font-semibold text-ink">{title}</div><div className="text-sm text-ink-secondary">{children}</div></div>
  </div>

export default function RestitutionClient({ missionId, gmKey }: { missionId: string; gmKey: string }) {
  const [c, setC] = useState<Ctx | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [derog, setDerog] = useState<{ kind: string; label: string } | null>(null)
  const [signSkip, setSignSkip] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/restitution/${missionId}`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText)
      setC(j); setErr(null)
    } catch (e: any) { setErr(e?.message || 'Chargement impossible') }
  }, [missionId])
  useEffect(() => { load() }, [load])
  // Une dérogation en attente : on suit la réponse du responsable.
  useEffect(() => {
    if (!c?.pending?.length) return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [c?.pending?.length, load])

  const act = async (action: string, extra: any = {}, opts: { multipart?: FormData } = {}) => {
    setBusy(true); setErr(null)
    try {
      let r: Response
      if (opts.multipart) { opts.multipart.append('action', action); r = await fetch(`/api/restitution/${missionId}`, { method: 'POST', body: opts.multipart }) }
      else r = await fetch(`/api/restitution/${missionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText)
      if (j.mission) setC(j)
      return j
    } catch (e: any) { setErr(e?.message || 'Action impossible'); return null } finally { setBusy(false) }
  }
  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(null), 2600) }

  if (!c) return <div className="max-w-3xl mx-auto px-4 py-6 text-sm text-ink-muted">{err || 'Chargement…'}</div>
  const m = c.mission, R = c.restitution && c.restitution.status === 'open' ? c.restitution : null
  const approved = (k: string) => c.derogations.some((d: any) => d.kind === k && d.status === 'approved')
  const who = R?.who_kind || null
  const clientOk = !!R?.odoo_partner_id || approved('identite')
  const blockers = (c.checks || []).filter((k: any) => k.state === 'ko')
  const needSplit = m.saisie && (who === 'owner' || who === 'mandate')
  const splitOk = !needSplit || !!R?.split
  const inv = c.invoice
  const paidOdoo = inv && (['paid', 'in_payment'].includes(inv.payment_state) || Number(inv.residual) <= 0.01)
  const driverPaid = c.due.tvac > 0 && c.driverCollected >= c.due.tvac - 0.01
  const settled = !!R?.settlement || c.due.htva <= 0 || paidOdoo || driverPaid || approved('paiement')
  const signOk = !!R?.signed_at || signSkip

  const steps = [
    { id: 'who', title: 'Qui vient le reprendre ?', done: !!who && clientOk },
    { id: 'checks', title: 'Peut-il sortir ?', done: !!who && clientOk && blockers.length === 0 },
    ...(needSplit ? [{ id: 'split', title: 'Qui paie quoi ?', done: splitOk }] : []),
    { id: 'amount', title: 'Montant et paiement', done: settled },
    { id: 'sign', title: 'Signature et photos (facultatif)', done: signOk },
    { id: 'exit', title: 'Sortie du parc', done: false },
  ]
  const cur = steps.find(s => !s.done)?.id || 'exit'
  const done = c.restitution?.status === 'done'

  return (
    <div className="max-w-5xl mx-auto px-4 py-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
      <main className="flex flex-col gap-3 min-w-0">
        <div className="rounded-card border border-border bg-surface p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-2xl font-semibold text-ink">{m.plate || '—'}</div>
            <div className="text-sm text-ink-muted">{[m.brand, m.model].filter(Boolean).join(' ')} · zone {m.zone || '?'} · au parc depuis le {m.parked_at ? new Date(m.parked_at).toLocaleDateString('fr-BE') : '?'} · <Link className="underline" href={`/dispatch/${m.id}`}>fiche {m.number}</Link></div>
          </div>
          <div className="flex gap-2 flex-wrap"><span className="rounded-full bg-purple-soft text-purple px-2.5 py-0.5 text-xs font-bold">{m.source_label}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${m.status === 'parked' ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'}`}>{m.status === 'parked' ? (m.temp_out ? 'Chez le garagiste' : 'Au parc') : 'Sorti'}</span></div>
        </div>
        {err && <p className="rounded-xl bg-critical-soft text-critical px-3 py-2 text-sm font-semibold">{err}</p>}

        {c.mode === 'rel_assistance' && !done && (
          <Card>
            <div className="font-display text-lg font-bold text-ink">Repris par l’assistance en relivraison</div>
            <p className="text-sm text-ink-secondary">Ce véhicule part avec la relivraison de {c.rel?.label}. Pas de restitution au comptoir : la sortie se fait par la relivraison.</p>
            {m.saisie && !m.levee.ok && <Chk state="ko" title="Levée de saisie">Le véhicule était saisi : la levée doit être au dossier avant la sortie par relivraison.</Chk>}
            {m.saisie && !m.levee.ok && <LeveeCapture missionId={m.id} onDone={() => { say('Levée jointe au dossier'); load() }} setErr={setErr} />}
            {c.rel?.id && <Link href={`/dispatch/${c.rel.id}`} className="self-start underline text-sm font-semibold">Ouvrir la fiche de relivraison</Link>}
          </Card>
        )}

        {(c.mode === 'not_parked' || done) && (
          <Card tone="done">
            <div className="font-display text-lg font-bold text-success">{done ? '✓ Véhicule restitué' : 'Le véhicule n’est plus au parc'}</div>
            {c.restitution?.status === 'done' && <p className="text-sm text-ink-secondary">Restitution terminée par {c.restitution.completed_by_name || '—'} le {hhmm(c.restitution.completed_at)}{c.restitution.client?.name ? `, à ${c.restitution.client.name}` : ''}.</p>}
            <Link href={`/dispatch/${m.id}`} className="self-start underline text-sm font-semibold">Retour à la fiche</Link>
          </Card>
        )}

        {c.mode === 'restitution' && !done && steps.map((s, i) => (
          <Card key={s.id} tone={s.id === cur ? 'cur' : s.done ? 'done' : undefined}>
            <div className="flex items-center gap-2.5">
              <span className={`w-7 h-7 rounded-full grid place-items-center text-xs font-bold border-2 ${s.done ? 'bg-success-fill border-success-fill text-white' : s.id === cur ? 'border-info-fill text-info' : 'border-strong text-ink-muted'}`}>{s.done ? '✓' : i + 1}</span>
              <span className="font-display font-bold text-ink flex-1">{s.title}</span>
            </div>
            {s.id === cur && (
              <div className="flex flex-col gap-3 sm:pl-9">
                {s.id === 'who' && <WhoStep c={c} R={R} act={act} busy={busy} gmKey={gmKey} setErr={setErr} onDerog={() => setDerog({ kind: 'identite', label: 'Pas de pièce d’identité' })} />}
                {s.id === 'checks' && <ChecksStep c={c} missionId={m.id} load={load} say={say} setErr={setErr} onDerog={(k: string, l: string) => setDerog({ kind: k, label: l })} />}
                {s.id === 'split' && <SplitStep c={c} R={R} act={act} busy={busy} />}
                {s.id === 'amount' && <AmountStep c={c} R={R} act={act} busy={busy} setErr={setErr} say={say} onDerog={(k: string, l: string) => setDerog({ kind: k, label: l })} />}
                {s.id === 'sign' && <SignStep act={act} busy={busy} onSkip={() => setSignSkip(true)} missionId={m.id} />}
                {s.id === 'exit' && <>
                  <p className="text-sm text-ink-secondary">{m.levee.temporaire ? 'Levée temporaire : le véhicule part chez le garagiste, son emplacement est libéré et le dossier reste ouvert jusqu’à son retour.' : `Le véhicule quitte la zone ${m.zone || '?'}, l’emplacement est libéré et la fiche passe en « terminé ».`}</p>
                  <div className="flex gap-2 flex-wrap"><Btn kind="brand" disabled={busy} onClick={async () => { const j = await act('complete'); if (j) say('Véhicule restitué') }}>{busy ? 'Sortie en cours…' : 'Sortir le véhicule du parc'}</Btn></div>
                </>}
              </div>
            )}
          </Card>
        ))}
        {c.mode === 'restitution' && R && !done && <button type="button" onClick={() => act('cancel')} className="self-start text-sm font-semibold text-ink-muted underline">Abandonner cette restitution</button>}
      </main>

      <aside className="flex flex-col gap-3">
        {c.pending?.length > 0 && c.pending.map((p: any) => (
          <div key={p.id} className="rounded-card border border-alert bg-alert-soft p-3 flex flex-col gap-2">
            <div className="font-semibold text-ink">En attente de {p.responsable_name}</div>
            <div className="text-sm text-ink-secondary">Notification envoyée : il valide avec son code sur son téléphone. Cet écran se met à jour tout seul.</div>
            <div className="flex gap-2"><Btn onClick={async () => { await fetch(`/api/restitution/${missionId}/derogation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cancel_id: p.id }) }); load() }}>Annuler la demande</Btn></div>
          </div>
        ))}
        <div className="rounded-card border border-border bg-surface p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1">Journal de la restitution</div>
          {c.journal.length === 0 ? <p className="text-sm text-ink-muted">Rien encore. Chaque geste s’inscrit ici avec son auteur.</p> :
            <ul className="flex flex-col divide-y divide-border max-h-[420px] overflow-auto">{c.journal.map((l: any, i: number) => <li key={i} className="py-1.5 text-sm"><span className="font-mono text-xs text-ink-muted">{hhmm(l.at)}</span> · <b>{l.by || '—'}</b> : {l.notes}</li>)}</ul>}
        </div>
      </aside>

      {derog && <DerogModal c={c} missionId={missionId} kind={derog.kind} label={derog.label} onClose={() => setDerog(null)} onSent={() => { setDerog(null); say('Demande envoyée'); load() }} />}
      {flash && <div className="fixed left-1/2 -translate-x-1/2 bottom-5 rounded-full bg-ink text-surface px-4 py-2 text-sm font-semibold shadow-md z-50">{flash}</div>}
    </div>
  )
}

// ── 1. Qui vient + identité ──────────────────────────────────────────────
function WhoStep({ c, R, act, busy, gmKey, setErr, onDerog }: any) {
  const [mode, setMode] = useState<'eid' | 'photo' | null>(null)
  const [kind, setKind] = useState<'prive' | 'pro'>('prive')
  const [f, setF] = useState<any>({ first_name: '', last_name: '', street: '', zip: '', city: '', country: 'BE', phone: '', email: '', vat: '', company: '', contact: '' })
  const [vies, setVies] = useState<'idle' | 'checking' | 'ok' | 'ko'>('idle')
  const [addr, setAddr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }))
  const who = R?.who_kind
  const hasPhoto = !!R?.id_document_id

  const fromEid = async (d: EidData) => {
    await act('client', { client: { kind: 'prive', source: 'eid', first_name: d.firstName, last_name: d.lastName, street: d.street, zip: d.zip, city: d.city, country: d.country || 'BE', phone: d.phone, email: d.email, national_number: d.nationalNumber, birth_date: d.birthDate } })
  }
  const photo = async (file: File) => {
    const small = await compressImage(file, 1800)
    const fd = new FormData(); fd.append('file', new File([small], 'piece-identite.jpg', { type: small.type || 'image/jpeg' }))
    await act('id_photo', {}, { multipart: fd })
  }
  const checkVies = async () => {
    const vat = f.vat.replace(/\s|\./g, '').toUpperCase(); if (vat.length < 8) return
    setVies('checking')
    try {
      const j = await (await fetch(`/api/vies?vat=${encodeURIComponent(vat)}`)).json()
      if (j.valid) {
        setVies('ok')
        const a = String(j.address || '').split('\n').map((x: string) => x.trim()).filter(Boolean)
        const last = a[a.length - 1] || ''; const mm = last.match(/^(\d{4,5})\s+(.+)$/)
        setF((p: any) => ({ ...p, vat, company: j.name || p.company, street: a[0] || p.street, zip: mm ? mm[1] : p.zip, city: mm ? mm[2] : p.city, country: j.countryCode || p.country }))
      } else setVies('ko')
    } catch { setVies('ko') }
  }
  const save = () => act('client', { client: { ...f, kind, source: 'manual' } })

  return <>
    <div className="flex flex-wrap gap-2">{WHO.map(([k, l, sub]) => <Opt key={k} on={who === k} onClick={() => act('who', { who: k })} title={l} sub={sub} />)}</div>
    {who && !R?.odoo_partner_id && <div className="rounded-xl bg-surface-2 border border-border p-3 flex flex-col gap-2.5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Pièce d’identité (obligatoire)</div>
      <div className="flex flex-wrap gap-2">
        <Btn kind={mode === 'eid' ? 'ok' : 'ghost'} onClick={() => setMode('eid')}>🪪 Lire la carte eID</Btn>
        <Btn kind={mode === 'photo' ? 'ok' : 'ghost'} onClick={() => { setMode('photo'); if (!hasPhoto) fileRef.current?.click() }}>📷 Photographier la pièce et encoder</Btn>
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { const x = e.target.files?.[0]; if (x) photo(x); e.target.value = '' }} />
      {mode === 'eid' && <div className="flex flex-col gap-1.5">
        <p className="text-sm text-ink-secondary">Le client insère sa carte dans le lecteur du comptoir et valide sur l’écran client. Ses données servent à la restitution et à la facture.</p>
        <EidImportButton onImport={fromEid} />
      </div>}
      {mode === 'photo' && <>
        {hasPhoto ? <Chk state="ok" title="Photo de la pièce enregistrée">Encodez maintenant les données du client.</Chk> : <Btn onClick={() => fileRef.current?.click()}>📷 Prendre la photo</Btn>}
        {hasPhoto && <>
          <div className="flex gap-2"><Opt on={kind === 'prive'} onClick={() => setKind('prive')} title="Privé" /><Opt on={kind === 'pro'} onClick={() => setKind('pro')} title="Pro" /></div>
          {kind === 'pro' && <>
            <div className="flex gap-2"><input className={`${input} font-mono flex-1`} placeholder="N° de TVA (BE0123456789)" value={f.vat} onChange={e => { set('vat', e.target.value); setVies('idle') }} aria-label="Numéro de TVA" /><Btn onClick={checkVies} disabled={vies === 'checking'}>{vies === 'checking' ? '…' : 'Vérifier (VIES)'}</Btn></div>
            {vies === 'ok' && <Chk state="ok" title={`TVA valide : ${f.company}`}>{[f.street, `${f.zip} ${f.city}`].filter(Boolean).join(', ')}</Chk>}
            {vies === 'ko' && <Chk state="warn" title="TVA non confirmée par VIES">Vérifiez le numéro, ou encodez la société à la main.</Chk>}
            {(vies === 'ok' || vies === 'ko') && <>
              <input className={input} placeholder="Nom de la société" value={f.company} onChange={e => set('company', e.target.value)} aria-label="Nom de la société" />
              {vies === 'ko' && <AddressField value={addr} onChange={setAddr} onParts={p => setF((x: any) => ({ ...x, street: [p.rue, p.num].filter(Boolean).join(' '), zip: p.cp || '', city: p.loc || '' }))} gmKey={gmKey} placeholder="Adresse de la société" />}
              <input className={input} placeholder="Personne présente (nom et prénom)" value={f.contact} onChange={e => set('contact', e.target.value)} aria-label="Personne présente" />
            </>}
          </>}
          {kind === 'prive' && <>
            <div className="flex gap-2"><input className={input} placeholder="Nom" value={f.last_name} onChange={e => set('last_name', e.target.value)} aria-label="Nom" /><input className={input} placeholder="Prénom" value={f.first_name} onChange={e => set('first_name', e.target.value)} aria-label="Prénom" /></div>
            <AddressField value={addr} onChange={setAddr} onParts={p => setF((x: any) => ({ ...x, street: [p.rue, p.num].filter(Boolean).join(' '), zip: p.cp || '', city: p.loc || '' }))} gmKey={gmKey} placeholder="Adresse : commencez à taper…" />
          </>}
          <div className="flex gap-2"><input className={input} placeholder="Téléphone" inputMode="tel" value={f.phone} onChange={e => set('phone', e.target.value)} aria-label="Téléphone" /><input className={input} placeholder="E-mail pour la facture" inputMode="email" value={f.email} onChange={e => set('email', e.target.value)} aria-label="E-mail" /></div>
          <div className="flex gap-2"><Btn kind="brand" disabled={busy || (kind === 'pro' ? !(f.company && f.vat) : !(f.last_name && f.first_name))} onClick={save}>Créer le client</Btn></div>
        </>}
      </>}
    </div>}
    {R?.odoo_partner_id && <Chk state="ok" title={`${R.client?.name} · ${R.client?.kind === 'pro' ? 'Pro' : 'Privé'}`}>{[R.client?.street, [R.client?.zip, R.client?.city].filter(Boolean).join(' '), R.client?.phone, R.client?.email].filter(Boolean).join(' · ')} — {R.client?.source === 'eid' ? 'lu sur la carte eID' : 'encodé d’après la pièce photographiée'}.</Chk>}
    {who && !R?.odoo_partner_id && <div><Btn kind="derog" onClick={onDerog}>Pas de pièce : dérogation…</Btn></div>}
  </>
}

// ── 2. Contrôles ─────────────────────────────────────────────────────────
function ChecksStep({ c, missionId, load, say, setErr, onDerog }: any) {
  const [capture, setCapture] = useState<null | 'definitive' | 'temporaire'>(null)
  return <div className="flex flex-col gap-2">
    {c.checks.map((k: any) => <div key={k.id} className="flex flex-col gap-1.5">
      <Chk state={k.state} title={k.title}>{k.detail}</Chk>
      {k.state === 'ko' && <div className="flex flex-wrap gap-2 sm:pl-6">
        {k.actions?.includes('levee_capture') && <Btn onClick={() => setCapture('definitive')}>📷 Photographier ou scanner la levée</Btn>}
        {k.actions?.includes('levee_temporaire') && <Btn onClick={() => setCapture('temporaire')}>Levée temporaire (garagiste)</Btn>}
        {k.actions?.includes('exit_control') && <Link href={`/qr/mission/${missionId}`} className="min-h-[44px] rounded-btn border border-strong bg-surface px-3.5 text-sm font-semibold text-ink inline-flex items-center">Faire la procédure de sortie</Link>}
        {k.actions?.includes('open_fiche') && <Link href={`/dispatch/${missionId}`} className="min-h-[44px] rounded-btn border border-strong bg-surface px-3.5 text-sm font-semibold text-ink inline-flex items-center">Ouvrir la fiche</Link>}
        {k.derog && <Btn kind="derog" onClick={() => onDerog(k.derog, k.id === 'blk' ? 'Déblocage du véhicule' : `Dérogation : ${k.title}`)}>{k.id === 'blk' ? 'Demander le déblocage à un responsable…' : 'Dérogation…'}</Btn>}
      </div>}
    </div>)}
    {capture && <LeveeCapture missionId={missionId} type={capture} onDone={() => { setCapture(null); say('Levée jointe au dossier'); load() }} setErr={setErr} />}
    {c.checks.every((k: any) => k.state !== 'ko') && <p className="text-sm text-success font-semibold">Rien ne bloque la sortie.</p>}
  </div>
}

function LeveeCapture({ missionId, type = 'definitive', onDone, setErr }: { missionId: string; type?: 'definitive' | 'temporaire'; onDone: () => void; setErr: (e: string | null) => void }) {
  const [files, setFiles] = useState<File[]>([])
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [payer, setPayer] = useState<'frais_justice' | 'client'>('client')
  const [busy, setBusy] = useState(false)
  const camRef = useRef<HTMLInputElement>(null)
  const add = async (list: File[]) => { const out: File[] = []; for (const f of list) { const s = await compressImage(f, 1800); out.push(new File([s], f.name.replace(/\.[^.]+$/, '') + (s.type === 'application/pdf' ? '.pdf' : '.jpg'), { type: s.type || f.type })) } setFiles(p => [...p, ...out]) }
  const send = async () => {
    setBusy(true); setErr(null)
    try {
      const fd = new FormData(); fd.append('type', type); fd.append('date', date); fd.append('payer', payer)
      fd.append('note', type === 'temporaire' ? 'Levée temporaire (sortie vers un garagiste), jointe pendant la restitution.' : 'Levée jointe pendant la restitution.')
      files.forEach(f => fd.append('files', f))
      const r = await fetch(`/api/missions/${missionId}/levee-saisie`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Levée non enregistrée')
      onDone()
    } catch (e: any) { setErr(e?.message || 'Levée non enregistrée') } finally { setBusy(false) }
  }
  return <div className="rounded-xl border border-border bg-surface-2 p-3 flex flex-col gap-2">
    <div className="font-semibold text-ink">{type === 'temporaire' ? 'Levée temporaire (sortie vers un garagiste)' : 'Levée de saisie'}</div>
    <div className="flex flex-wrap gap-2">
      <Btn onClick={() => camRef.current?.click()}>📷 Photographier</Btn>
      <ScanToFicheButton label="🖨️ Scanner" onScanned={fs => add(fs)} />
    </div>
    <input ref={camRef} type="file" accept="image/*,application/pdf" capture="environment" multiple hidden onChange={e => { add(Array.from(e.target.files || [])); e.target.value = '' }} />
    {files.length > 0 && <p className="text-sm text-ink-secondary">{files.length} page{files.length > 1 ? 's' : ''} prête{files.length > 1 ? 's' : ''}.</p>}
    <label className="text-[11px] font-bold uppercase tracking-wider text-ink-muted" htmlFor="lv-date">Date de la levée</label>
    <input id="lv-date" type="date" className={input} value={date} onChange={e => setDate(e.target.value)} />
    <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Frais selon la levée</div>
    <div className="flex gap-2"><Opt on={payer === 'client'} onClick={() => setPayer('client')} title="Client" /><Opt on={payer === 'frais_justice'} onClick={() => setPayer('frais_justice')} title="Frais de justice" /></div>
    <div className="flex gap-2"><Btn kind="brand" disabled={busy || !files.length} onClick={send}>{busy ? 'Envoi…' : 'Joindre la levée au dossier'}</Btn></div>
  </div>
}

// ── 3. Qui paie quoi (saisie reprise par le client) ────────────────────────
function SplitStep({ c, R, act, busy }: any) {
  const init = R?.split || c.splitDefault || { dep: 'client', avant: 'client', apres: 'client' }
  const [s, setS] = useState<Record<string, string>>(init)
  const postes: [string, string][] = [['dep', 'Dépannage'], ['avant', 'Gardiennage jusqu’à la levée'], ['apres', 'Gardiennage après la levée']]
  const amount = (p: string) => c.legs.filter((l: any) => l.poste === p).reduce((t: number, l: any) => t + (l.due_htva || 0), 0)
  return <>
    <p className="text-sm text-ink-secondary">Le client reprend le véhicule : pour chaque poste, qui le paie ?</p>
    {postes.map(([k, l]) => <div key={k} className="rounded-xl border border-border p-3 flex flex-col gap-2">
      <div className="flex justify-between gap-2"><span className="font-semibold text-ink">{l}</span><span className="font-mono text-sm">{eur(amount(k))} HTVA</span></div>
      <div className="flex gap-1.5 flex-wrap">{[['client', 'Client'], ['parquet', 'Parquet'], ['fdj', 'Frais de justice']].map(([v, t]) => <button key={v} type="button" onClick={() => setS(p => ({ ...p, [k]: v }))} aria-pressed={s[k] === v} className={`min-h-[40px] rounded-full border px-3.5 text-sm font-semibold ${s[k] === v ? 'border-info bg-info-soft text-info' : 'border-strong bg-surface text-ink'}`}>{t}</button>)}</div>
    </div>)}
    <p className="text-xs text-ink-muted">Client : payé ici. Parquet : repris dans l’état de frais. Frais de justice : facturé aux Frais de Justice de Verviers par le bureau.</p>
    <div><Btn kind="brand" disabled={busy} onClick={() => act('split', { split: s })}>Répartition correcte, continuer</Btn></div>
  </>
}

// ── 4. Montant et paiement ─────────────────────────────────────────────
function AmountStep({ c, R, act, busy, setErr, say, onDerog }: any) {
  const inv = c.invoice
  const due = c.due
  const later = ['garage', 'assistance'].includes(R?.who_kind)
  const noPay = later ? <Btn onClick={() => act('later')} disabled={busy}>Part sans payer : à facturer ({R?.who_kind === 'garage' ? 'garage' : 'assistance'})</Btn> : <Btn kind="derog" onClick={() => onDerog('paiement', 'Départ sans paiement')}>Part sans payer : dérogation…</Btn>
  const payerTxt = (p: string) => p === 'client' ? 'payé ici' : p === 'parquet' ? 'état de frais au Parquet' : p === 'fdj' ? 'facturé aux Frais de justice' : 'facturé à l’assistance ou au tiers'
  const table = <div className="flex flex-col gap-1.5">
    {c.legs.map((l: any) => <div key={l.mission_id} className="flex justify-between gap-3 border-b border-border pb-1.5 text-sm">
      <div className="min-w-0"><div className="text-ink">{l.letter ? `${l.letter} · ` : ''}{l.title}</div><div className="text-xs text-ink-muted">{l.nothing ? l.nothing : l.unknown ? `à calculer : ${l.amount_note || 'voir la fiche'}` : payerTxt(l.payer)}{l.billed_refs?.length ? ` · déjà facturé ${l.billed_refs.join(', ')}` : ''}</div></div>
      <div className="font-mono whitespace-nowrap">{eur(l.due_htva)}</div>
    </div>)}
    <div className="flex justify-between gap-3 font-bold text-ink"><span>À payer maintenant</span><span className="font-mono">{eur(due.htva)} HTVA · {eur(due.tvac)} TVAC</span></div>
  </div>
  if (c.legs.some((l: any) => l.unknown && l.payer === 'client')) return <>{table}<p className="text-sm text-warning font-semibold">Un montant n’est pas calculable : corrigez la fiche avant de facturer.</p></>
  if (due.htva <= 0 && !inv) return <>{table}<Chk state="ok" title="Reste à payer : 0 €">Aucune facture à créer.</Chk><div><Btn kind="brand" disabled={busy} onClick={() => act('nothing_due')}>Continuer</Btn></div></>

  if (!c.me.hasOdoo) {
    const paid = c.driverCollected >= due.tvac - 0.01
    return <>{table}
      {paid ? <Chk state="ok" title="Encaissé">{eur(c.driverCollected)} encaissés par l’encaissement chauffeur.</Chk> : <p className="text-sm text-ink-secondary">Vous n’avez pas d’accès Odoo : le paiement se fait dans l’encaissement chauffeur, comme d’habitude, puis vous revenez ici.</p>}
      {!paid && <div className="flex flex-wrap gap-2"><Btn kind="brand" disabled={busy} onClick={async () => { const j = await act('driver_cash', { amount_tvac: due.tvac }); if (j?.url) window.location.href = j.url }}>Confirmer et ouvrir l’encaissement</Btn>{noPay}</div>}
    </>
  }
  if (!inv) return <>{table}
    <p className="text-sm text-ink-secondary">En confirmant, la facture de <b>{eur(due.tvac)}</b> est créée dans Odoo au nom du client et s’ouvre dans un nouvel onglet, prête à encaisser.</p>
    <div className="flex flex-wrap gap-2">
      <Btn kind="brand" disabled={busy || !R?.odoo_partner_id} onClick={async () => {
        const w = window.open('about:blank', '_blank')   // ouvert dans le clic, sinon le navigateur bloque
        const j = await act('invoice')
        if (j?.invoice?.url && w) w.location.href = j.invoice.url
        else if (w) w.close()
      }}>{busy ? 'Création de la facture…' : 'Confirmer, créer la facture et l’ouvrir dans Odoo'}</Btn>
    </div>
    <div className="flex flex-wrap gap-2">{noPay}</div>
  </>
  const paid = ['paid', 'in_payment'].includes(inv.payment_state) || Number(inv.residual) <= 0.01
  return <>{table}
    <Chk state={paid ? 'ok' : 'warn'} title={`Facture ${inv.name || ''} ${paid ? 'payée' : 'créée dans Odoo'}`}>{paid ? 'Reste à payer : 0 €.' : `Encaissez-la dans Odoo (reste ${eur(inv.residual ?? due.tvac)}), revenez ici et vérifiez.`}</Chk>
    <div className="flex flex-wrap gap-2">
      {!paid && <a href={inv.url} target="_blank" rel="noreferrer" className="min-h-[44px] rounded-btn border border-strong bg-surface px-3.5 text-sm font-semibold text-ink inline-flex items-center">Rouvrir la facture dans Odoo</a>}
      {!paid && <Btn kind="brand" disabled={busy} onClick={async () => { const j = await act('check_payment'); if (j && j.paymentChecked !== 'paid') setErr(j.paymentChecked) ; else if (j) say('Facture payée') }}>Vérifier le paiement</Btn>}
      {paid && <Btn kind="brand" disabled={busy} onClick={() => act('check_payment')}>Payée, continuer</Btn>}
    </div>
    {!paid && <div className="flex flex-wrap gap-2">{noPay}</div>}
  </>
}

// ── 5. Signature (facultatif) ─────────────────────────────────────────────
function SignStep({ act, busy, onSkip, missionId }: any) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const cv = ref.current; if (!cv) return
    const ctx = cv.getContext('2d')!; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1F1A17'
    let down = false
    const pos = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height] }
    const d = (e: PointerEvent) => { down = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); cv.setPointerCapture(e.pointerId) }
    const mv = (e: PointerEvent) => { if (!down) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); setDrawn(true) }
    const up = () => { down = false }
    cv.addEventListener('pointerdown', d); cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up)
    return () => { cv.removeEventListener('pointerdown', d); cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up) }
  }, [])
  return <>
    <p className="text-sm text-ink-secondary">Le client reconnaît avoir repris le véhicule dans l’état constaté ce jour. Facultatif.</p>
    <canvas ref={ref} width={900} height={260} className="w-full h-32 rounded-xl border border-dashed border-strong bg-white touch-none" aria-label="Zone de signature" />
    <div className="flex flex-wrap gap-2">
      <Btn kind="brand" disabled={busy || !drawn} onClick={() => act('sign', { signature: ref.current!.toDataURL('image/png') })}>Enregistrer la signature</Btn>
      <Btn onClick={() => { const cv = ref.current!; cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height); setDrawn(false) }}>Effacer</Btn>
      <Btn onClick={onSkip}>Continuer sans signature</Btn>
      <Link href={`/dispatch/${missionId}`} target="_blank" className="min-h-[44px] rounded-btn border border-strong bg-surface px-3.5 text-sm font-semibold text-ink inline-flex items-center">📷 Photos de sortie (fiche)</Link>
    </div>
  </>
}

// ── Dérogation : responsable + motif → notification ──────────────────────
function DerogModal({ c, missionId, kind, label, onClose, onSent }: any) {
  const [resp, setResp] = useState<string>(c.responsables.find((r: any) => r.has_pin)?.id || '')
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const send = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/restitution/${missionId}/derogation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, reason, responsable_id: resp, amount_tvac: amount ? Number(amount.replace(',', '.')) : undefined }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Demande non envoyée')
      onSent()
    } catch (e: any) { setErr(e?.message) } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4" role="dialog" aria-label="Dérogation">
    <div className="bg-surface rounded-card w-full max-w-md p-4 flex flex-col gap-2.5 shadow-md">
      <div className="flex items-center justify-between"><div className="font-display text-lg font-bold text-ink">{label}</div><button type="button" onClick={onClose} aria-label="Fermer" className="min-h-[36px] min-w-[36px] rounded-btn border border-strong">✕</button></div>
      <p className="text-sm text-ink-secondary">Le responsable reçoit une notification et valide avec son code sur son téléphone.</p>
      <label className="text-[11px] font-bold uppercase tracking-wider text-ink-muted" htmlFor="dg-resp">Responsable</label>
      <select id="dg-resp" className={input} value={resp} onChange={e => setResp(e.target.value)}>
        {c.responsables.map((r: any) => <option key={r.id} value={r.id} disabled={!r.has_pin}>{r.name}{r.has_pin ? '' : ' (pas encore de code)'}</option>)}
      </select>
      <label className="text-[11px] font-bold uppercase tracking-wider text-ink-muted" htmlFor="dg-why">Motif (obligatoire)</label>
      <textarea id="dg-why" rows={3} className={input} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex. accord de l’agent Dumont par téléphone à 9h40" />
      {kind === 'montant' && <><label className="text-[11px] font-bold uppercase tracking-wider text-ink-muted" htmlFor="dg-amt">Nouveau montant TVAC</label><input id="dg-amt" className={input} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" /></>}
      {err && <p className="text-sm text-critical font-semibold">{err}</p>}
      <Btn kind="brand" disabled={busy || reason.trim().length < 5 || !resp} onClick={send}>{busy ? 'Envoi…' : 'Envoyer la demande'}</Btn>
    </div>
  </div>
}
