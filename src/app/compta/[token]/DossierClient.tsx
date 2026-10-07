'use client'
// Dossier comptable — page de la comptable (maquette validée par Olivier le 07/10/2026).
// Fiches classées Réglé → En attente d'un fournisseur → À faire chez nous, puis par numéro.
// Boutons : « OK, c'est réglé » (réversible) et « Ajouter une remarque ».
import { useMemo, useState } from 'react'
import type { DossierVue, PointVue, Etat } from '@/lib/compta/dossier'

const ETATS: Record<Etat, string> = { regle: 'Réglé', fournisseur: "En attente d'un fournisseur", interne: 'À faire chez nous' }
const ORDRE: Etat[] = ['regle', 'fournisseur', 'interne']
const COUL: Record<Etat, string> = { regle: 'var(--vert)', fournisseur: 'var(--bleu)', interne: 'var(--rouge)' }
const fmt = (iso: string) => new Intl.DateTimeFormat('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }).format(new Date(iso))
const jour = (iso: string) => new Intl.DateTimeFormat('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Brussels' }).format(new Date(iso))

export default function DossierClient({ token, dossier }: { token: string; dossier: DossierVue }) {
  const [points, setPoints] = useState<PointVue[]>(dossier.points)
  const [filtre, setFiltre] = useState<Etat | null>(null)
  const [form, setForm] = useState<string | null>(null)
  const [texte, setTexte] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const dire = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2800) }

  const tries = useMemo(() => [...points].sort((a, b) => ORDRE.indexOf(a.etat) - ORDRE.indexOf(b.etat) || a.numero - b.numero), [points])
  const vus = tries.filter(p => !filtre || p.etat === filtre)
  const n = (e: Etat) => points.filter(p => p.etat === e).length

  async function agir(p: PointVue, kind: 'ok' | 'reouvert' | 'remarque', t?: string) {
    setBusy(p.id)
    try {
      const r = await fetch(`/api/compta/${token}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pointId: p.id, kind, texte: t }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { dire(j.error || "L'action n'a pas abouti, réessaie dans un instant."); return }
      const now = new Date().toISOString()
      setPoints(ps => ps.map(x => x.id !== p.id ? x : {
        ...x,
        valide_le: kind === 'ok' ? now : kind === 'reouvert' ? null : x.valide_le,
        fil: [...x.fil, { auteur: 'comptable', kind, texte: kind === 'remarque' ? (t || '') : null, created_at: now }],
      }))
      if (kind === 'remarque') { setForm(null); setTexte('') }
      dire(kind === 'ok' ? "Merci : l'équipe de Mobi est prévenue" : kind === 'remarque' ? "Remarque envoyée à l'équipe de Mobi" : 'Point rouvert')
    } finally { setBusy(null) }
  }

  return (
    <div className="dc">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Source+Sans+3:wght@400;500;600;700&display=swap" />
      <style>{CSS}</style>
      <div className="barre"><div className="in"><span className="logo">VERVIERS DÉPANNAGE<small>Dossier comptable</small></span>{dossier.destinataire && <span className="qui">Lien personnel de {dossier.destinataire}</span>}</div></div>
      <main>
        <header><h1>{dossier.titre}</h1><p className="sous">{[dossier.sous_titre, `${points.length} annotations`, `mis à jour le ${jour(dossier.updated_at)}`].filter(Boolean).join(' · ')}</p></header>
        {dossier.intro && <section className="intro">{dossier.intro.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}<p className="sign">{dossier.signature}</p></section>}
        <div className="etat-gen" role="group" aria-label="Filtrer par état">
          {ORDRE.map(e => (
            <button key={e} type="button" className={`tuile ${e}`} aria-pressed={filtre === e} onClick={() => setFiltre(filtre === e ? null : e)}>
              <b>{n(e)}</b><span>{ETATS[e]}</span>
            </button>
          ))}
        </div>
        <div className="progress" aria-hidden="true">{ORDRE.map(e => <i key={e} style={{ width: `${points.length ? n(e) / points.length * 100 : 0}%`, background: COUL[e] }} />)}</div>
        <section className="liste">
          <h2>{filtre ? `${ETATS[filtre]} (${vus.length})` : `Les ${points.length} annotations`}</h2>
          <p className="aide">Classées par état : d'abord ce qui est réglé, puis ce qui attend un fournisseur, puis ce qui reste à faire chez nous. Le numéro renvoie à l'ordre de ton PDF.</p>
          {vus.length === 0 && <p className="aide">Aucun point dans cette catégorie.</p>}
          {vus.map(p => (
            <article key={p.id} id={`point-${p.numero}`} className={`fiche${p.valide_le ? ' valide' : ''}`}>
              <div className="tete"><span className="num">n° {p.numero}</span><span className="compte">{p.compte}</span><span className={`pastille p-${p.etat}`}>{ETATS[p.etat]}</span></div>
              {p.ligne && <div className="ligne">{p.ligne}</div>}
              <div><div className="lbl">Ton annotation</div><span className={`annot ${p.couleur}`}>{p.annotation}</span></div>
              <div className="rep"><div className="lbl">Notre réponse</div><p>{p.reponse}</p></div>
              {p.docs.length > 0 && <div><div className="lbl">Documents</div><div className="docs">
                {p.docs.map(d => <a key={d.id} className="doc" href={`/api/compta/${token}/doc/${d.id}`}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 3v12m0 0l-5-5m5 5l5-5M4 19h16" /></svg>{d.nom}</a>)}
              </div></div>}
              {p.suivi && <div className="suivi">{p.suivi}</div>}
              {p.fil.length > 0 && <div className="fil">{p.fil.map((m, i) => (
                <div key={i} className="msg"><b>{m.auteur === 'comptable' ? 'Toi' : 'Équipe de Mobi'} : </b>
                  {m.kind === 'ok' ? "OK, c'est réglé." : m.kind === 'reouvert' ? 'Point rouvert.' : m.texte}
                  <time>{fmt(m.created_at)}</time></div>
              ))}</div>}
              <div className="actions">
                <button type="button" disabled={busy === p.id} className={`btn ok${p.valide_le ? ' fait' : ''}`} onClick={() => agir(p, p.valide_le ? 'reouvert' : 'ok')}>
                  {p.valide_le ? '✓ Réglé pour toi (annuler)' : "OK, c'est réglé"}
                </button>
                <button type="button" className="btn" onClick={() => { setForm(form === p.id ? null : p.id); setTexte('') }}>Ajouter une remarque</button>
              </div>
              {form === p.id && (
                <form className="form" onSubmit={e => { e.preventDefault(); if (texte.trim()) agir(p, 'remarque', texte.trim()) }}>
                  <textarea autoFocus value={texte} onChange={e => setTexte(e.target.value)} placeholder={`Ta remarque sur le point ${p.numero} (par exemple : il me manque encore la facture de…)`} />
                  <div className="actions">
                    <button type="submit" className="btn ok" disabled={!texte.trim() || busy === p.id}>Envoyer la remarque</button>
                    <button type="button" className="btn" onClick={() => setForm(null)}>Annuler</button>
                  </div>
                </form>
              )}
            </article>
          ))}
        </section>
        <footer>{[dossier.pied, 'Une question ? Ajoute simplement une remarque sur le point concerné.'].filter(Boolean).join(' · ')}</footer>
      </main>
      <div className={`toast${toast ? ' vu' : ''}`} role="status">{toast}</div>
    </div>
  )
}

const CSS = `
.dc{--fond:#f5f3f1;--carte:#fff;--encre:#1c1a19;--doux:#6a6461;--trait:#e2ddd8;--rouge:#c8102e;--rouge-f:#9d0c24;--surl-o:#ffe3c2;--surl-o-t:#8a4300;--surl-b:#d6e6ff;--surl-b-t:#123f8c;--vert:#14784d;--vert-p:#e3f3eb;--bleu:#2559b8;--bleu-p:#e6eefc;--gris-p:#efecea;--int-p:#fde7ea;
background:var(--fond);color:var(--encre);font:16px/1.55 "Source Sans 3",system-ui,sans-serif;min-height:100vh}
@media (prefers-color-scheme:dark){.dc{--fond:#161414;--carte:#211e1d;--encre:#f2eeeb;--doux:#a9a19c;--trait:#3a3533;--rouge:#ff4d63;--rouge-f:#ff7385;--surl-o:#4a2c10;--surl-o-t:#ffc58a;--surl-b:#18294a;--surl-b-t:#a9c6ff;--vert:#4fd39a;--vert-p:#15301f;--bleu:#86a9ff;--bleu-p:#1a2440;--gris-p:#2a2625;--int-p:#3a1a20;color-scheme:dark}}
.dc *{box-sizing:border-box}
.dc .barre{background:var(--rouge);color:#fff;padding-inline:16px;padding-top:env(safe-area-inset-top,0px)}
.dc .barre .in{max-width:980px;margin:0 auto;display:flex;align-items:center;gap:12px;padding-block:12px;flex-wrap:wrap}
.dc .logo{font:800 17px Archivo,sans-serif;letter-spacing:.03em}
.dc .logo small{font:600 12px "Source Sans 3",sans-serif;opacity:.85;letter-spacing:.06em;text-transform:uppercase;margin-left:8px}
.dc .qui{margin-left:auto;font-size:14px;opacity:.95}
.dc main{max-width:980px;margin:0 auto;padding-inline:16px;padding-block:26px 70px;display:grid;gap:22px}
.dc h1{font:800 clamp(24px,4vw,32px)/1.15 Archivo,sans-serif;margin:0;text-wrap:balance}
.dc .sous{color:var(--doux);margin:6px 0 0}
.dc .intro{background:var(--carte);border:1px solid var(--trait);border-radius:10px;padding:18px 20px;display:grid;gap:10px}
.dc .intro p{margin:0;max-width:72ch}.dc .intro .sign{color:var(--doux);font-size:14.5px}
.dc .etat-gen{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.dc .tuile{background:var(--carte);border:1px solid var(--trait);border-radius:10px;padding:12px 14px;display:grid;gap:2px;cursor:pointer;text-align:left;font:inherit;color:inherit;min-height:44px}
.dc .tuile b{font:800 26px Archivo,sans-serif;font-variant-numeric:tabular-nums}.dc .tuile span{font-size:13.5px;color:var(--doux)}
.dc .tuile[aria-pressed="true"]{outline:2px solid var(--encre)}
.dc .tuile.regle b{color:var(--vert)}.dc .tuile.fournisseur b{color:var(--bleu)}.dc .tuile.interne b{color:var(--rouge)}
.dc .progress{height:8px;background:var(--gris-p);border-radius:99px;overflow:hidden;display:flex}.dc .progress i{display:block;height:100%}
.dc .liste{display:grid;gap:12px}
.dc .liste h2{font:700 13px Archivo,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:var(--doux);margin:0}
.dc .aide{margin:0;color:var(--doux);font-size:14.5px}
.dc .fiche{background:var(--carte);border:1px solid var(--trait);border-radius:10px;padding:16px 18px;display:grid;gap:12px}
.dc .fiche.valide{border-color:var(--vert)}
.dc .tete{display:flex;gap:10px 14px;flex-wrap:wrap;align-items:baseline}
.dc .num{font:800 14px Archivo,sans-serif;color:var(--doux);font-variant-numeric:tabular-nums}
.dc .compte{font:700 18px Archivo,sans-serif}
.dc .pastille{margin-left:auto;font:700 12.5px "Source Sans 3",sans-serif;border-radius:99px;padding:3px 10px;white-space:nowrap}
.dc .p-regle{background:var(--vert-p);color:var(--vert)}.dc .p-fournisseur{background:var(--bleu-p);color:var(--bleu)}.dc .p-interne{background:var(--int-p);color:var(--rouge-f)}
.dc .ligne{font-size:14.5px;color:var(--doux);font-variant-numeric:tabular-nums}
.dc .annot{display:inline;padding:2px 6px;border-radius:3px;font-weight:600;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.dc .annot.orange{background:var(--surl-o);color:var(--surl-o-t)}.dc .annot.bleu{background:var(--surl-b);color:var(--surl-b-t)}
.dc .lbl{font:700 12px Archivo,sans-serif;text-transform:uppercase;letter-spacing:.07em;color:var(--doux);margin-bottom:3px}
.dc .rep p{margin:0;max-width:75ch}
.dc .docs{display:flex;flex-wrap:wrap;gap:8px}
.dc .doc{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--trait);border-radius:7px;padding:8px 10px;min-height:44px;font:600 13.5px "Source Sans 3",sans-serif;background:var(--fond);color:var(--encre);text-decoration:none}
.dc .suivi{font-size:14px;color:var(--doux);display:flex;gap:6px;align-items:center}
.dc .suivi:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.6;flex:none}
.dc .fil{display:grid;gap:6px;border-left:3px solid var(--trait);padding-left:12px}
.dc .msg{font-size:14.5px}.dc .msg time{color:var(--doux);font-size:13px;margin-left:6px}
.dc .actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dc .btn{font:700 14px "Source Sans 3",sans-serif;border-radius:7px;padding:10px 14px;min-height:44px;cursor:pointer;border:1px solid var(--trait);background:var(--carte);color:var(--encre)}
.dc .btn:disabled{opacity:.6;cursor:default}
.dc .btn.ok{background:var(--vert);border-color:var(--vert);color:#fff}.dc .btn.ok.fait{background:var(--vert-p);color:var(--vert)}
.dc .btn:focus-visible,.dc .doc:focus-visible,.dc .tuile:focus-visible,.dc textarea:focus-visible{outline:2px solid var(--rouge);outline-offset:2px}
.dc .form{display:grid;gap:8px}
.dc textarea{font:15px/1.45 "Source Sans 3",sans-serif;border:1px solid var(--trait);border-radius:7px;padding:9px 11px;background:var(--fond);color:var(--encre);min-height:80px;resize:vertical;width:100%}
.dc .toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--encre);color:var(--fond);padding:10px 16px;border-radius:8px;font-size:14.5px;opacity:0;transition:opacity .2s;pointer-events:none;max-width:calc(100% - 32px)}
.dc .toast.vu{opacity:1}
.dc footer{color:var(--doux);font-size:13.5px;text-align:center}
@media (max-width:640px){.dc .etat-gen{grid-template-columns:1fr}.dc .pastille{margin-left:0}}
@media (prefers-reduced-motion:reduce){.dc .toast{transition:none}}
`
