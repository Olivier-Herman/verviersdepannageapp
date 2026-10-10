'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useEspace } from '../EspaceShell'
import { Depanneuse, IlluDsp, IlluRem } from '../../_ui/illustrations'
import AdresseInline, { type AdresseChoisie } from '../../_ui/AdresseInline'

const vide: AdresseChoisie = { texte: '', lat: null, lng: null }

export default function NouvelleDemande() {
  const { societes } = useEspace()
  const [societeId, setSocieteId] = useState(societes.length === 1 ? societes[0].id : '')
  const [type, setType] = useState<'DSP' | 'REM' | ''>('')
  const [plaque, setPlaque] = useState('')
  const [marque, setMarque] = useState('')
  const [modele, setModele] = useState('')
  const [adresse, setAdresse] = useState<AdresseChoisie>(vide)
  const [destination, setDestination] = useState<AdresseChoisie>(vide)
  const [planifier, setPlanifier] = useState(false)
  const [quand, setQuand] = useState('')
  const [contactNom, setContactNom] = useState('')
  const [contactTel, setContactTel] = useState('')
  const [remarques, setRemarques] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [fait, setFait] = useState<{ numero: number } | null>(null)

  const manque = [!societeId && 'la société', !type && 'le type d’intervention', !plaque.trim() && 'la plaque', !adresse.texte.trim() && 'l’adresse', planifier && !quand && 'la date'].filter(Boolean) as string[]

  const envoyer = async () => {
    setErr('')
    if (manque.length) return setErr(`Il manque ${manque.join(', ')}.`)
    setBusy(true)
    try {
      const r = await fetch('/api/espace/missions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ societeId, type, plaque, marque, modele, adresse: adresse.texte, lat: adresse.lat, lng: adresse.lng, destination: destination.texte || null, quand: planifier && quand ? new Date(quand).toISOString() : null, contactNom, contactTel, remarques }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.status === 401) { location.href = '/espace/connexion'; return }
      if (!r.ok) throw new Error(j.error || 'Envoi impossible')
      setFait({ numero: j.numero }); window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  if (fait) return (
    <div className="mx-auto max-w-xl px-4 pt-10">
      <div className="esp-card esp-pop overflow-hidden text-center">
        <div className="esp-hero relative h-44">
          <div className="esp-road" />
          <div className="esp-drive absolute bottom-[14px] left-0 w-[240px]"><Depanneuse /></div>
        </div>
        <div className="p-7">
          <div className="mx-auto -mt-14 grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-3xl text-white shadow-xl ring-8 ring-white">✓</div>
          <h1 className="font-display mt-4 text-2xl font-extrabold">Demande envoyée</h1>
          <p className="mt-2 text-slate-600">Notre équipe est prévenue à l’instant. Vous suivez l’intervention n° <b>{fait.numero}</b> en direct, de la validation jusqu’à la fin.</p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Link href="/espace" className="esp-btn esp-btn-red">Suivre l’intervention</Link>
            <button onClick={() => location.reload()} className="esp-btn esp-btn-ghost">Nouvelle demande</button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8">
      <div className="esp-rise">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Commander une intervention</h1>
        <p className="mt-1 text-slate-600">Quelques informations et nous nous occupons du reste. Vous suivez tout en direct.</p>
      </div>

      <div className="mt-6 space-y-4">
        {societes.length > 1 && (
          <Bloc n={1} titre="Pour quelle société ?">
            <div className="grid gap-2 sm:grid-cols-2">
              {societes.map(s => (
                <button key={s.id} type="button" onClick={() => setSocieteId(s.id)} className={`flex min-h-[56px] items-center gap-3 rounded-2xl border-2 px-4 text-left font-bold transition ${societeId === s.id ? 'border-rose-600 bg-rose-50/60' : 'border-[#ece6df] bg-white hover:border-slate-300'}`}>
                  <span className="h-3.5 w-3.5 rounded-full" style={{ background: s.couleur || '#cc2222' }} />{s.nom}
                  {societeId === s.id && <span className="ml-auto text-rose-600">✓</span>}
                </button>
              ))}
            </div>
          </Bloc>
        )}

        <Bloc n={societes.length > 1 ? 2 : 1} titre="De quoi avez-vous besoin ?">
          <div className="grid gap-3 sm:grid-cols-2">
            <Choix actif={type === 'DSP'} onClick={() => setType('DSP')} titre="Dépannage sur place" sous="Batterie, crevaison, démarrage… on répare sur place si possible."><IlluDsp className="h-24" /></Choix>
            <Choix actif={type === 'REM'} onClick={() => setType('REM')} titre="Remorquage" sous="Le véhicule ne roule plus : on le charge et on le livre où vous voulez."><IlluRem className="h-24" /></Choix>
          </div>
        </Bloc>

        <Bloc n={societes.length > 1 ? 3 : 2} titre="Le véhicule">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="sm:col-span-1">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Plaque *</span>
              <div className="flex overflow-hidden rounded-[14px] border-2 border-[#b91c1c] bg-white focus-within:shadow-[0_0_0_4px_rgba(204,34,34,.12)]">
                <span className="grid w-7 place-items-center bg-[#1d4ed8] text-[10px] font-bold text-white">B</span>
                <input value={plaque} onChange={e => setPlaque(e.target.value.toUpperCase())} placeholder="1ABC234" className="min-h-[46px] w-full bg-transparent px-3 font-mono text-lg font-bold tracking-widest text-[#b91c1c] outline-none placeholder:text-rose-200" />
              </div>
            </label>
            <Champ label="Marque" v={marque} set={setMarque} ph="Volkswagen" />
            <Champ label="Modèle" v={modele} set={setModele} ph="Golf" />
          </div>
        </Bloc>

        <Bloc n={societes.length > 1 ? 4 : 3} titre="Où se trouve le véhicule ?">
          <AdresseInline valeur={adresse} onChange={setAdresse} placeholder="Rue, numéro, localité" />
          {type === 'REM' && (
            <div className="mt-4">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Où le livrer ?</span>
              <AdresseInline valeur={destination} onChange={setDestination} placeholder="Laissez vide si c’est à votre garage" />
            </div>
          )}
        </Bloc>

        <Bloc n={societes.length > 1 ? 5 : 4} titre="Quand ?">
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => setPlanifier(false)} className={`min-h-[56px] rounded-2xl border-2 px-4 text-left font-bold ${!planifier ? 'border-rose-600 bg-rose-50/60' : 'border-[#ece6df] bg-white'}`}>⚡ Dès que possible</button>
            <button type="button" onClick={() => setPlanifier(true)} className={`min-h-[56px] rounded-2xl border-2 px-4 text-left font-bold ${planifier ? 'border-rose-600 bg-rose-50/60' : 'border-[#ece6df] bg-white'}`}>🗓️ À une date précise</button>
          </div>
          {planifier && <input type="datetime-local" value={quand} onChange={e => setQuand(e.target.value)} className="esp-input esp-pop mt-3" min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} />}
        </Bloc>

        <Bloc n={societes.length > 1 ? 6 : 5} titre="Contact sur place et précisions" facultatif>
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ label="Nom" v={contactNom} set={setContactNom} ph="Personne à contacter" />
            <Champ label="Téléphone" v={contactTel} set={setContactTel} ph="+32 …" type="tel" />
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Remarques</span>
            <textarea value={remarques} onChange={e => setRemarques(e.target.value)} className="esp-input" placeholder="Clés, accès, panne constatée, votre référence…" />
          </label>
        </Bloc>

        <div className="esp-card sticky bottom-20 z-10 flex flex-col gap-3 p-4 md:bottom-4 md:flex-row md:items-center">
          <p className={`flex-1 text-sm ${err ? 'font-semibold text-rose-700' : 'text-slate-500'}`}>
            {err || (manque.length ? `Encore : ${manque.join(', ')}.` : 'Tout est prêt. Notre équipe est prévenue dès l’envoi.')}
          </p>
          <button onClick={envoyer} disabled={busy} className="esp-btn esp-btn-red px-6 text-[15px] disabled:opacity-60">{busy ? 'Envoi…' : 'Envoyer la demande'}</button>
        </div>
      </div>
    </div>
  )
}

function Bloc({ n, titre, facultatif, children }: { n: number; titre: string; facultatif?: boolean; children: React.ReactNode }) {
  return (
    <section className="esp-card esp-rise p-5" style={{ animationDelay: `${n * 60}ms` }}>
      <h2 className="mb-4 flex items-center gap-3 font-display text-lg font-extrabold">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-slate-900 text-sm text-white">{n}</span>{titre}
        {facultatif && <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">facultatif</span>}
      </h2>
      {children}
    </section>
  )
}

function Choix({ actif, onClick, titre, sous, children }: { actif: boolean; onClick: () => void; titre: string; sous: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`group relative overflow-hidden rounded-3xl border-2 p-4 text-left transition ${actif ? 'border-rose-600 bg-gradient-to-br from-rose-50 to-amber-50 shadow-lg shadow-rose-900/10' : 'border-[#ece6df] bg-white hover:-translate-y-0.5 hover:border-slate-300'}`}>
      <div className="flex h-28 items-center justify-center transition group-hover:scale-[1.03]">{children}</div>
      <div className="mt-2 font-display text-base font-extrabold text-slate-900">{titre}</div>
      <div className="text-sm text-slate-600">{sous}</div>
      {actif && <span className="esp-pop absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-rose-600 text-white">✓</span>}
    </button>
  )
}

function Champ({ label, v, set, ph, type = 'text' }: { label: string; v: string; set: (s: string) => void; ph?: string; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <input type={type} value={v} onChange={e => set(e.target.value)} placeholder={ph} className="esp-input" />
    </label>
  )
}
