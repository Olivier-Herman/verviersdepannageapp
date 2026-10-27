'use client'
// src/app/vr/[token]/VrClient.tsx — parcours du client pour le contrat VR VAB (Olivier 23/10/2026).
// 4 photos guidées (carte d'identité et permis, recto + verso) → informations lues sur les documents
// (en vert), à vérifier → adresse Google en boutons, découpée comme dans Comet → signature.
// FR / NL / EN / DE. Thème clair, zones tactiles ≥ 44 px, sans habillage de l'application.

import { useEffect, useState } from 'react'
import SigPad from '@/components/mission/SigPad'
import { loadGoogleMaps } from '@/components/AddressField'

type Lang = 'fr' | 'nl' | 'en' | 'de'
const LANGS: Lang[] = ['fr', 'nl', 'en', 'de']
const LANG_NOM: Record<Lang, string> = { fr: 'Français', nl: 'Nederlands', en: 'English', de: 'Deutsch' }
const PHOTOS = ['id_recto', 'id_verso', 'permis_recto', 'permis_verso'] as const
type Photo = typeof PHOTOS[number]

const T: Record<Lang, Record<string, string>> = {
  fr: {
    titre: 'Véhicule de remplacement VAB', sous: 'Verviers Dépannage', intro: 'Pour vous remettre le véhicule de remplacement, VAB demande votre carte d’identité et votre permis de conduire. Cela prend environ 2 minutes.',
    langue: 'Langue', commencer: 'Commencer', photo: 'Photo', id_recto: 'Carte d’identité · recto', id_verso: 'Carte d’identité · verso', permis_recto: 'Permis de conduire · recto', permis_verso: 'Permis de conduire · verso',
    conseil: 'Posez le document à plat, bien éclairé, sans reflet. Tout le document doit être visible.', prendre: 'Prendre la photo', reprendre: 'Reprendre', suivant: 'Suivant', envoi: 'Envoi…', lecture: 'Lecture du document…',
    verifier: 'Vérifiez vos informations', vert: 'En vert : lu sur vos documents', nom: 'Nom', prenom: 'Prénom', naissance: 'Date de naissance', naissance_ph: 'JJ/MM/AAAA', carte: 'N° carte d’identité', permis: 'N° permis de conduire',
    adresse: 'Adresse', adresse_ph: 'Commencez à taper votre adresse', adresse_aide: 'Touchez votre adresse dans la liste, puis vérifiez les cases.', pays: 'Pays', cp: 'Code postal', ville: 'Ville', rue: 'Rue', numero: 'N° de maison', boite: 'Boîte', facultatif: 'facultatif',
    email: 'E-mail', tel: 'Téléphone', correct: 'C’est correct', manque: 'Complétez les cases en rouge.', err_email: 'Adresse e-mail invalide.', err_naiss: 'Date de naissance : JJ/MM/AAAA.',
    signature: 'Signature', sig_sous: 'Contrat de prêt du véhicule de remplacement', engagement: 'Je reconnais recevoir le véhicule de remplacement dans l’état constaté avec le dépanneur et m’engage à le restituer selon les conditions de VAB.',
    merci: 'Merci', fini: 'C’est terminé. Tout est déjà transmis au dépanneur.', expire_t: 'Lien expiré', expire: 'Ce lien n’est plus valable. Demandez au dépanneur de vous montrer un nouveau code.', invalide_t: 'Lien invalide', chargement: 'Chargement…', erreur: 'Une erreur est survenue, réessayez.', priv: 'Ces données servent uniquement au contrat de prêt demandé par VAB.',
  },
  nl: {
    titre: 'Vervangwagen VAB', sous: 'Verviers Dépannage', intro: 'Om u de vervangwagen te overhandigen, vraagt VAB uw identiteitskaart en rijbewijs. Dit duurt ongeveer 2 minuten.',
    langue: 'Taal', commencer: 'Beginnen', photo: 'Foto', id_recto: 'Identiteitskaart · voorzijde', id_verso: 'Identiteitskaart · achterzijde', permis_recto: 'Rijbewijs · voorzijde', permis_verso: 'Rijbewijs · achterzijde',
    conseil: 'Leg het document plat, goed verlicht, zonder weerspiegeling. Het hele document moet zichtbaar zijn.', prendre: 'Foto nemen', reprendre: 'Opnieuw', suivant: 'Volgende', envoi: 'Verzenden…', lecture: 'Document wordt gelezen…',
    verifier: 'Controleer uw gegevens', vert: 'In het groen: gelezen op uw documenten', nom: 'Naam', prenom: 'Voornaam', naissance: 'Geboortedatum', naissance_ph: 'DD/MM/JJJJ', carte: 'Nr. identiteitskaart', permis: 'Nr. rijbewijs',
    adresse: 'Adres', adresse_ph: 'Begin uw adres te typen', adresse_aide: 'Tik op uw adres in de lijst en controleer dan de vakjes.', pays: 'Land', cp: 'Postcode', ville: 'Gemeente', rue: 'Straat', numero: 'Huisnummer', boite: 'Bus', facultatif: 'optioneel',
    email: 'E-mail', tel: 'Telefoon', correct: 'Dit klopt', manque: 'Vul de rode vakjes in.', err_email: 'Ongeldig e-mailadres.', err_naiss: 'Geboortedatum: DD/MM/JJJJ.',
    signature: 'Handtekening', sig_sous: 'Leenovereenkomst vervangwagen', engagement: 'Ik bevestig de vervangwagen te ontvangen in de staat vastgesteld met de takelaar en verbind me ertoe hem terug te bezorgen volgens de voorwaarden van VAB.',
    merci: 'Bedankt', fini: 'Klaar. Alles is doorgestuurd naar de takelaar.', expire_t: 'Link verlopen', expire: 'Deze link is niet meer geldig. Vraag de takelaar om een nieuwe code.', invalide_t: 'Ongeldige link', chargement: 'Laden…', erreur: 'Er ging iets mis, probeer opnieuw.', priv: 'Deze gegevens dienen enkel voor de leenovereenkomst die VAB vraagt.',
  },
  en: {
    titre: 'VAB replacement vehicle', sous: 'Verviers Dépannage', intro: 'To hand over the replacement vehicle, VAB needs your identity card and driving licence. It takes about 2 minutes.',
    langue: 'Language', commencer: 'Start', photo: 'Photo', id_recto: 'Identity card · front', id_verso: 'Identity card · back', permis_recto: 'Driving licence · front', permis_verso: 'Driving licence · back',
    conseil: 'Lay the document flat, well lit, without glare. The whole document must be visible.', prendre: 'Take the photo', reprendre: 'Retake', suivant: 'Next', envoi: 'Sending…', lecture: 'Reading the document…',
    verifier: 'Check your details', vert: 'In green: read from your documents', nom: 'Last name', prenom: 'First name', naissance: 'Date of birth', naissance_ph: 'DD/MM/YYYY', carte: 'Identity card no.', permis: 'Driving licence no.',
    adresse: 'Address', adresse_ph: 'Start typing your address', adresse_aide: 'Tap your address in the list, then check the boxes.', pays: 'Country', cp: 'Postcode', ville: 'City', rue: 'Street', numero: 'House no.', boite: 'Box', facultatif: 'optional',
    email: 'E-mail', tel: 'Phone', correct: 'This is correct', manque: 'Fill in the boxes in red.', err_email: 'Invalid e-mail address.', err_naiss: 'Date of birth: DD/MM/YYYY.',
    signature: 'Signature', sig_sous: 'Replacement vehicle loan agreement', engagement: 'I acknowledge receiving the replacement vehicle in the condition recorded with the tow operator and undertake to return it under VAB’s conditions.',
    merci: 'Thank you', fini: 'All done. Everything has been sent to the tow operator.', expire_t: 'Link expired', expire: 'This link is no longer valid. Ask the tow operator to show you a new code.', invalide_t: 'Invalid link', chargement: 'Loading…', erreur: 'Something went wrong, please try again.', priv: 'This information is used only for the loan agreement requested by VAB.',
  },
  de: {
    titre: 'VAB-Ersatzfahrzeug', sous: 'Verviers Dépannage', intro: 'Für die Übergabe des Ersatzfahrzeugs verlangt VAB Ihren Personalausweis und Ihren Führerschein. Das dauert etwa 2 Minuten.',
    langue: 'Sprache', commencer: 'Beginnen', photo: 'Foto', id_recto: 'Personalausweis · Vorderseite', id_verso: 'Personalausweis · Rückseite', permis_recto: 'Führerschein · Vorderseite', permis_verso: 'Führerschein · Rückseite',
    conseil: 'Legen Sie das Dokument flach hin, gut beleuchtet, ohne Spiegelung. Das ganze Dokument muss sichtbar sein.', prendre: 'Foto aufnehmen', reprendre: 'Neu aufnehmen', suivant: 'Weiter', envoi: 'Wird gesendet…', lecture: 'Dokument wird gelesen…',
    verifier: 'Prüfen Sie Ihre Angaben', vert: 'Grün: von Ihren Dokumenten gelesen', nom: 'Nachname', prenom: 'Vorname', naissance: 'Geburtsdatum', naissance_ph: 'TT/MM/JJJJ', carte: 'Ausweisnummer', permis: 'Führerscheinnummer',
    adresse: 'Adresse', adresse_ph: 'Beginnen Sie, Ihre Adresse einzugeben', adresse_aide: 'Tippen Sie auf Ihre Adresse in der Liste und prüfen Sie dann die Felder.', pays: 'Land', cp: 'PLZ', ville: 'Ort', rue: 'Straße', numero: 'Hausnummer', boite: 'Briefkasten', facultatif: 'optional',
    email: 'E-Mail', tel: 'Telefon', correct: 'Das stimmt', manque: 'Füllen Sie die roten Felder aus.', err_email: 'Ungültige E-Mail-Adresse.', err_naiss: 'Geburtsdatum: TT/MM/JJJJ.',
    signature: 'Unterschrift', sig_sous: 'Leihvertrag Ersatzfahrzeug', engagement: 'Ich bestätige, das Ersatzfahrzeug in dem mit dem Abschleppdienst festgestellten Zustand zu erhalten, und verpflichte mich, es gemäß den Bedingungen von VAB zurückzugeben.',
    merci: 'Danke', fini: 'Fertig. Der Abschleppdienst hat alles erhalten.', expire_t: 'Link abgelaufen', expire: 'Dieser Link ist nicht mehr gültig. Bitten Sie den Abschleppdienst um einen neuen Code.', invalide_t: 'Ungültiger Link', chargement: 'Laden…', erreur: 'Ein Fehler ist aufgetreten, bitte erneut versuchen.', priv: 'Diese Daten dienen nur dem von VAB verlangten Leihvertrag.',
  },
}
const PAYS: Record<string, Record<Lang, string>> = {
  BE: { fr: 'Belgique', nl: 'België', en: 'Belgium', de: 'Belgien' }, NL: { fr: 'Pays-Bas', nl: 'Nederland', en: 'Netherlands', de: 'Niederlande' },
  LU: { fr: 'Luxembourg', nl: 'Luxemburg', en: 'Luxembourg', de: 'Luxemburg' }, FR: { fr: 'France', nl: 'Frankrijk', en: 'France', de: 'Frankreich' },
  DE: { fr: 'Allemagne', nl: 'Duitsland', en: 'Germany', de: 'Deutschland' },
}

interface Adresse { pays: string; cp: string; ville: string; rue: string; numero: string; boite: string }
interface Client { nom: string; prenom: string; naissance: string; carte_id: string; permis: string; email: string; tel: string; langue: string; adresse: Adresse }

/** Photo du téléphone (souvent 4-8 Mo) → JPEG ≤ 2000 px : passe la limite d'envoi et reste lisible. */
async function compresser(f: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' } as any)
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    return await new Promise<Blob>((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('jpeg')), 'image/jpeg', 0.85))
  } catch { return f }
}

const formatDate = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}

export default function VrClient({ token, gmKey }: { token: string; gmKey: string }) {
  const [lang, setLang] = useState<Lang>('fr')
  const [etat, setEtat] = useState<'chargement' | 'accueil' | 'photos' | 'infos' | 'signature' | 'fini' | 'expire' | 'invalide'>('chargement')
  const [plaque, setPlaque] = useState<string | null>(null)
  const [faites, setFaites] = useState<Record<Photo, boolean>>({ id_recto: false, id_verso: false, permis_recto: false, permis_verso: false })
  const [idx, setIdx] = useState(0)
  const [apercu, setApercu] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [c, setC] = useState<Client | null>(null)
  const [lu, setLu] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [preds, setPreds] = useState<{ id: string; main: string; sub: string }[]>([])
  const [tente, setTente] = useState(false)
  const t = T[lang]

  const charger = async (versInfos = false) => {
    try {
      const j = await fetch(`/api/vr/${token}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject(r.status))
      setPlaque(j.plaque); setFaites(j.photos)
      const cl: Client = j.client
      setC(cl)
      // Ce qui vient des documents est affiché en vert (tant que le client n'y touche pas).
      setLu({ nom: !!cl.nom, prenom: !!cl.prenom, naissance: !!cl.naissance, carte_id: !!cl.carte_id, permis: !!cl.permis })
      if (cl.langue && (LANGS as string[]).includes(cl.langue) && j.status !== 'ouvert') setLang(cl.langue as Lang)
      if (j.status === 'signe') return setEtat('fini')
      if (j.status === 'expire') return setEtat('expire')
      const toutes = PHOTOS.every(k => j.photos[k])
      if (versInfos || (toutes && etat === 'chargement')) setEtat(toutes ? 'infos' : 'photos')
      else if (etat === 'chargement') { setEtat(PHOTOS.some(k => j.photos[k]) ? 'photos' : 'accueil'); setIdx(Math.max(0, PHOTOS.findIndex(k => !j.photos[k]))) }
    } catch { setEtat('invalide') }
  }
  useEffect(() => {
    const l = (navigator.language || 'fr').slice(0, 2).toLowerCase()
    if ((LANGS as string[]).includes(l)) setLang(l as Lang)
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Photos ───────────────────────────────────────────────────────────────
  const cle = PHOTOS[idx]
  const envoyerPhoto = async (f: File | undefined) => {
    if (!f) return
    setErr(null); setApercu(URL.createObjectURL(f))
    const verso = cle.endsWith('_verso')
    setBusy(verso ? t.lecture : t.envoi)
    try {
      const fd = new FormData(); fd.append('photo', cle); fd.append('file', await compresser(f), `${cle}.jpg`)
      const r = await fetch(`/api/vr/${token}`, { method: 'POST', body: fd })
      if (r.status === 410) return setEtat('expire')
      if (!r.ok) throw new Error()
      setFaites(p => ({ ...p, [cle]: true }))
    } catch { setErr(t.erreur); setApercu(null) } finally { setBusy(null) }
  }
  const suivant = () => {
    setApercu(null)
    const n = PHOTOS.findIndex(k => !faites[k])
    if (n < 0) { setEtat('chargement'); charger(true) } else setIdx(n)
  }

  // ── Adresse : suggestions Google en boutons (pas le widget, iPhone), découpée comme dans Comet ──
  useEffect(() => {
    if (etat !== 'infos' || q.trim().length < 4 || !gmKey) { setPreds([]); return }
    let stop = false
    const h = setTimeout(async () => {
      try {
        await loadGoogleMaps(gmKey)
        const g = (window as any).google
        new g.maps.places.AutocompleteService().getPlacePredictions(
          { input: q, types: ['address'] },   // Adresse d'un client : tous pays (client polonais bloqué le 27/10/2026).
          (res: any[], st: string) => {
            if (stop) return
            setPreds(st === g.maps.places.PlacesServiceStatus.OK && res ? res.slice(0, 5).map(p => ({ id: p.place_id, main: p.structured_formatting?.main_text || p.description, sub: p.structured_formatting?.secondary_text || '' })) : [])
          })
      } catch { if (!stop) setPreds([]) }
    }, 300)
    return () => { stop = true; clearTimeout(h) }
  }, [q, etat, gmKey])

  const choisirAdresse = async (id: string) => {
    const g = (window as any).google
    const place: any = await new Promise(res => new g.maps.places.PlacesService(document.createElement('div'))
      .getDetails({ placeId: id, fields: ['address_components'] }, (p: any, st: string) => res(st === g.maps.places.PlacesServiceStatus.OK ? p : null)))
    const comp = place?.address_components || []
    const get = (k: string, s = false) => { const x = comp.find((y: any) => y.types.includes(k)); return x ? (s ? x.short_name : x.long_name) : '' }
    setC(p => p && ({ ...p, adresse: {
      pays: (get('country', true) || 'BE').toUpperCase(), cp: get('postal_code'), ville: get('locality') || get('postal_town') || get('administrative_area_level_2'),
      rue: get('route'), numero: get('street_number'), boite: get('subpremise') || p.adresse.boite,
    } }))
    setQ(''); setPreds([])
  }

  const maj = (k: keyof Client, v: string) => { setC(p => p && ({ ...p, [k]: v })); setLu(l => ({ ...l, [k]: false })) }
  const majAdr = (k: keyof Adresse, v: string) => setC(p => p && ({ ...p, adresse: { ...p.adresse, [k]: v } }))
  const manque = (v: string) => tente && !v.trim()

  const valider = async () => {
    if (!c) return
    setTente(true); setErr(null)
    const a = c.adresse
    if (![c.nom, c.prenom, c.naissance, c.carte_id, c.permis, a.cp, a.ville, a.rue, a.numero].every(v => v.trim())) return setErr(t.manque)
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(c.naissance)) return setErr(t.err_naiss)
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return setErr(t.err_email)
    setBusy(t.envoi)
    try {
      const r = await fetch(`/api/vr/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'infos', lang, client: c }) })
      if (r.status === 410) return setEtat('expire')
      if (!r.ok) throw new Error()
      setEtat('signature'); window.scrollTo(0, 0)
    } catch { setErr(t.erreur) } finally { setBusy(null) }
  }

  const signer = async (data: string) => {
    setBusy(t.envoi); setErr(null)
    try {
      const r = await fetch(`/api/vr/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'signature', data }) })
      if (r.status === 410) return setEtat('expire')
      if (!r.ok) throw new Error()
      setEtat('fini')
    } catch { setErr(t.erreur) } finally { setBusy(null) }
  }

  // ── Rendu ────────────────────────────────────────────────────────────────
  const Champ = ({ k, label, val, onChange, vert, type = 'text', mode, ph, opt }: { k: string; label: string; val: string; onChange: (v: string) => void; vert?: boolean; type?: string; mode?: any; ph?: string; opt?: boolean }) => (
    <label className="block min-w-0">
      <span className="block text-[13px] font-semibold text-gray-700 mb-1">{label}{opt && <span className="font-normal text-gray-500"> ({t.facultatif})</span>}</span>
      <input key={k} type={type} inputMode={mode} placeholder={ph} value={val} onChange={e => onChange(e.target.value)} autoComplete="off"
        className={`w-full min-w-0 min-h-[48px] rounded-xl border-2 px-3 text-[16px] text-gray-900 outline-none focus:border-blue-600 ${!opt && manque(val) ? 'border-red-500 bg-red-50' : vert && val ? 'border-green-300 bg-green-50' : 'border-gray-300 bg-white'}`} />
    </label>
  )

  return (
    <div className="min-h-screen bg-slate-100 text-gray-900" style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <header className="bg-[#0b2e4f] text-white px-4 pt-4 pb-3">
        <div className="max-w-md mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0"><div className="font-bold text-[17px] leading-tight">{t.titre}</div><div className="text-[12px] text-blue-100">{t.sous}{plaque ? ` · ${plaque}` : ''}</div></div>
          <select aria-label={t.langue} value={lang} onChange={e => setLang(e.target.value as Lang)} className="min-h-[44px] rounded-lg bg-white/10 border border-white/30 px-2 text-[14px] text-white">
            {LANGS.map(l => <option key={l} value={l} className="text-gray-900">{LANG_NOM[l]}</option>)}
          </select>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-5 grid gap-4">
        {etat === 'chargement' && <p className="text-gray-700 text-center py-16">{t.chargement}</p>}
        {(etat === 'expire' || etat === 'invalide') && (
          <div className="bg-white rounded-2xl p-6 text-center"><div className="text-[40px]">⏱</div><h1 className="font-bold text-[18px] text-gray-900 mt-2">{etat === 'expire' ? t.expire_t : t.invalide_t}</h1><p className="text-gray-700 mt-2">{t.expire}</p></div>
        )}

        {etat === 'accueil' && (
          <div className="bg-white rounded-2xl p-5 grid gap-4">
            <p className="text-[16px] leading-relaxed text-gray-800">{t.intro}</p>
            <ol className="grid gap-1.5 text-[14px] text-gray-700">{PHOTOS.map((k, i) => <li key={k}>{i + 1}. {t[k]}</li>)}</ol>
            <button onClick={() => setEtat('photos')} className="min-h-[52px] rounded-xl bg-blue-700 text-white font-bold text-[16px]">{t.commencer}</button>
            <p className="text-[12px] text-gray-500">{t.priv}</p>
          </div>
        )}

        {etat === 'photos' && (
          <div className="bg-white rounded-2xl p-5 grid gap-4">
            <div><div className="text-[13px] font-semibold text-blue-800">{t.photo} {idx + 1} / 4</div><h1 className="font-bold text-[19px] text-gray-900">{t[cle]}</h1></div>
            <div className="aspect-[1.586] w-full max-w-full rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50 overflow-hidden flex items-center justify-center text-center px-6">
              {apercu ? <img src={apercu} alt="" className="w-full h-full object-cover" /> : faites[cle] ? <span className="text-[44px] text-green-700">✓</span> : <span className="text-[14px] text-blue-900">{t.conseil}</span>}
            </div>
            {busy ? <p className="min-h-[52px] flex items-center justify-center gap-2 text-gray-700 font-semibold"><span className="animate-spin">⏳</span> {busy}</p>
              : faites[cle] ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="min-h-[52px] rounded-xl bg-gray-100 text-gray-800 font-semibold flex items-center justify-center cursor-pointer">{t.reprendre}<input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { envoyerPhoto(e.target.files?.[0]); e.target.value = '' }} /></label>
                  <button onClick={suivant} className="min-h-[52px] rounded-xl bg-blue-700 text-white font-bold">{t.suivant}</button>
                </div>
              ) : (
                <label className="min-h-[52px] rounded-xl bg-blue-700 text-white font-bold text-[16px] flex items-center justify-center cursor-pointer">📷 {t.prendre}<input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { envoyerPhoto(e.target.files?.[0]); e.target.value = '' }} /></label>
              )}
            {err && <p className="text-red-700 font-semibold text-[14px]">{err}</p>}
            <ol className="grid gap-1 text-[13px]">
              {PHOTOS.map((k, i) => (
                <li key={k}><button type="button" disabled={!!busy} onClick={() => { setApercu(null); setIdx(i) }} className={`w-full min-h-[44px] text-left px-3 rounded-lg ${i === idx ? 'bg-blue-50 text-blue-900 font-semibold' : 'text-gray-700'}`}>{faites[k] ? '✅' : i === idx ? '▶️' : '⚪'} {t[k]}</button></li>
              ))}
            </ol>
          </div>
        )}

        {etat === 'infos' && c && (
          <div className="bg-white rounded-2xl p-5 grid gap-3">
            <div><h1 className="font-bold text-[19px] text-gray-900">{t.verifier}</h1><p className="text-[13px] text-green-800"><span className="inline-block w-3 h-3 rounded bg-green-200 border border-green-400 align-middle mr-1" />{t.vert}</p></div>
            <div className="grid grid-cols-2 gap-2">
              {Champ({ k: 'nom', label: t.nom, val: c.nom, onChange: v => maj('nom', v), vert: lu.nom })}
              {Champ({ k: 'prenom', label: t.prenom, val: c.prenom, onChange: v => maj('prenom', v), vert: lu.prenom })}
            </div>
            {Champ({ k: 'naissance', label: t.naissance, val: c.naissance, onChange: v => maj('naissance', formatDate(v)), vert: lu.naissance, mode: 'numeric', ph: t.naissance_ph })}
            {Champ({ k: 'carte', label: t.carte, val: c.carte_id, onChange: v => maj('carte_id', v), vert: lu.carte_id })}
            {Champ({ k: 'permis', label: t.permis, val: c.permis, onChange: v => maj('permis', v), vert: lu.permis })}

            <div className="grid gap-2 pt-1">
              <label className="block">
                <span className="block text-[13px] font-semibold text-gray-700 mb-1">{t.adresse}</span>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder={t.adresse_ph} autoComplete="off"
                  className="w-full min-h-[48px] rounded-xl border-2 border-blue-300 bg-white px-3 text-[16px] text-gray-900 outline-none focus:border-blue-600" />
              </label>
              {preds.length > 0 && (
                <div className="grid gap-1.5">
                  {preds.map(p => (
                    <button key={p.id} type="button" onClick={() => choisirAdresse(p.id)} className="w-full min-h-[52px] rounded-xl border-2 border-blue-300 bg-blue-50 px-3 py-2 text-left active:border-blue-600">
                      <span className="block text-gray-900 font-bold text-[15px]">📍 {p.main}</span>{p.sub && <span className="block text-gray-700 text-xs">{p.sub}</span>}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[12px] text-gray-600">{t.adresse_aide}</p>
              <label className="block">
                <span className="block text-[13px] font-semibold text-gray-700 mb-1">{t.pays}</span>
                <select value={c.adresse.pays} onChange={e => majAdr('pays', e.target.value)} className="w-full min-h-[48px] rounded-xl border-2 border-gray-300 bg-white px-3 text-[16px] text-gray-900">
                  {Object.keys(PAYS).map(k => <option key={k} value={k}>{PAYS[k][lang]}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
                {Champ({ k: 'cp', label: t.cp, val: c.adresse.cp, onChange: v => majAdr('cp', v), mode: 'numeric' })}
                {Champ({ k: 'ville', label: t.ville, val: c.adresse.ville, onChange: v => majAdr('ville', v) })}
              </div>
              {Champ({ k: 'rue', label: t.rue, val: c.adresse.rue, onChange: v => majAdr('rue', v) })}
              <div className="grid grid-cols-2 gap-2">
                {Champ({ k: 'numero', label: t.numero, val: c.adresse.numero, onChange: v => majAdr('numero', v) })}
                {Champ({ k: 'boite', label: t.boite, val: c.adresse.boite, onChange: v => majAdr('boite', v), opt: true })}
              </div>
            </div>

            {Champ({ k: 'email', label: t.email, val: c.email, onChange: v => maj('email', v.trim()), type: 'email', mode: 'email', opt: true })}
            {Champ({ k: 'tel', label: t.tel, val: c.tel, onChange: v => maj('tel', v), type: 'tel', mode: 'tel', opt: true })}
            {err && <p className="text-red-700 font-semibold text-[14px]">{err}</p>}
            <button onClick={valider} disabled={!!busy} className="min-h-[52px] rounded-xl bg-blue-700 text-white font-bold text-[16px] disabled:opacity-50">{busy || t.correct}</button>
          </div>
        )}

        {etat === 'signature' && (
          <div className="bg-white rounded-2xl p-5 grid gap-3">
            <div><h1 className="font-bold text-[19px] text-gray-900">{t.signature}</h1><p className="text-[13px] text-gray-700">{t.sig_sous}</p></div>
            <p className="text-[14px] leading-relaxed text-gray-800 bg-slate-50 border border-slate-200 rounded-xl p-3">{t.engagement}</p>
            {c && <p className="text-[14px] text-gray-800 font-semibold">{c.prenom} {c.nom}</p>}
            {busy ? <p className="text-center text-gray-700 py-6">{busy}</p> : <SigPad onSave={signer} />}
            {err && <p className="text-red-700 font-semibold text-[14px]">{err}</p>}
          </div>
        )}

        {etat === 'fini' && (
          <div className="bg-white rounded-2xl p-6 text-center"><div className="text-[48px] text-green-700">✓</div><h1 className="font-bold text-[20px] text-gray-900">{t.merci}</h1><p className="text-gray-700 mt-2">{t.fini}</p></div>
        )}
      </main>
    </div>
  )
}
