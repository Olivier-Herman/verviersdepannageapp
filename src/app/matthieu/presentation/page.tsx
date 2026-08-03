import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import { canUseMatthieu } from '@/lib/mecano/access'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function MatthieuPresentationPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const sb = createAdminClient()
  const uid = (session.user as any).id
  const { data: user } = uid
    ? await sb.from('users').select('id, role, language').eq('id', uid).single()
    : await sb.from('users').select('id, role, language').ilike('email', session.user!.email!).single()
  if (!canUseMatthieu(user?.role, user?.id)) redirect('/login')
  const sq = String((user as any)?.language || 'fr').toLowerCase() === 'sq'
  const T = sq ? {
    back: '← Kthehu', kicker: '🔧 E re në VD Soft', sub: 'Mekaniku që të gjithë e thërrasin në terren — tani në xhepin tënd, 24/7, në çdo ndërhyrje.',
    chips: ['🚗 Të gjitha markat & modelet', '🔧 Riparim + rimorkim', '📄 Të tregon fletën', '📷 Dërgo një foto'],
    chipsB: ['Të gjitha', '+', 'tregon', 'foto'],
    quote: '« I bllokuar me një makinë të kyçur, një defekt i çuditshëm, një 4×4 për ta rimorkuar pa dëmtim? Më pyet, unë përgjigjem. »',
    badge: 'E re', mtitle: 'Ja La tête à Matthieu', mlead: 'Mekaniku yt i xhepit. Ke një pyetje për automjetin? Ai njeh çdo model dhe të përgjigjet menjëherë.',
    mf: ['Pyete çfarëdo për automjetin', 'Të tregon fletën e duhur (hapje, lidhje…)', 'I pasigurt për modelin? Dërgo një foto'],
    tryBtn: 'Provoje →',
    cards: [['Fillimisht sqaron', 'Konfirmon modelin, gjeneratën dhe motorizimin para çdo veprimi — asnjë gabim te tensioni i lartë ose pikat e lidhjes.'],
            ['Të tregon', 'Ke nevojë për një skemë? Nxjerr fletën e saktë për pyetjen tënde, jo 40 faqe. E sheh menjëherë ku të shikosh.'],
            ['Kudo, gjithmonë', 'Në çdo ndërhyrje, edhe natën. Riparim dhe rimorkim, të gjitha markat.']],
    htHead: '👉 Si ta përdorësh',
    steps: ['Hap fletën e ndërhyrjes (misioni yt aktual).', 'Shtyp pllakën 🔧 La tête à Matthieu.', 'Bëj pyetjen (ose një shkurtore: « Si ta hap? », « Pikat e lidhjes »).', 'I pasigurt për modelin? Shtyp 📷 dhe dërgo një foto — ai e analizon.', 'Nëse të nxjerr një fletë, shtyp kartën 📄 për të parë skemën.'],
    finalBtn: 'Provoje tani (zgjidh një automjet) →', quoteAttr: '— La tête à Matthieu',
  } : {
    back: '← Retour', kicker: '🔧 Nouveau dans VD Soft', sub: 'Le mécano que tout le monde appelle sur le terrain — désormais dans ta poche, 24/7, sur chaque intervention.',
    chips: ['🚗 Toutes les marques & modèles', '🔧 Dépannage + remorquage', '📄 Il te montre la fiche', '📷 Envoie une photo'],
    chipsB: ['Toutes', '+', 'montre', 'photo'],
    quote: '« Bloqué sur une caisse verrouillée, une panne bizarre, un 4×4 à atteler sans casse ? Tu me demandes, je réponds. »',
    badge: 'Nouveau', mtitle: 'Voici La tête à Matthieu', mlead: 'Ton mécano de poche. Une question sur le véhicule ? Il connaît chaque modèle et te répond direct.',
    mf: ['Demande n\'importe quoi sur le véhicule', 'Il t\'affiche la bonne fiche (ouverture, ancrage…)', 'Pas sûr du modèle ? Envoie une photo'],
    tryBtn: 'Essayer →',
    cards: [['Il cadre d\'abord', 'Il confirme le modèle, la génération et la motorisation avant toute manip — pas d\'erreur sur une coupure haute tension ou un point d\'ancrage.'],
            ['Il te montre', 'Besoin d\'un schéma ? Il sort la fiche exacte concernée par ta question, pas 40 pages. Tu vois direct où regarder.'],
            ['Partout, tout le temps', 'Sur n\'importe quelle intervention, même la nuit. Dépannage comme remorquage, toutes les marques.']],
    htHead: '👉 Comment y accéder',
    steps: ['Ouvre ta fiche d\'intervention (ta mission en cours).', 'Appuie sur la tuile 🔧 La tête à Matthieu.', 'Pose ta question (ou un raccourci : « Comment l\'ouvrir ? », « Points d\'ancrage »).', 'Pas sûr du modèle ? Appuie sur 📷 et envoie une photo — il l\'analyse.', 'S\'il te sort une fiche, appuie sur la carte 📄 pour voir le schéma.'],
    finalBtn: 'Essayer maintenant (choisis un véhicule) →', quoteAttr: '— La tête à Matthieu',
  }

  return (
    <div className="mt-root">
      <style>{`
        .mt-root{--bg:#0e0d12;--panel:#17151d;--line:#2a2733;--ink:#f3f1ee;--ink-soft:#a7a2b3;
          --red:#e23b2e;--indigo:#7c74ff;--indigo-deep:#4b40e0;--gold:#f5c451;--screen:#111016;--screen-soft:#8b8698;--card:#1c1a24;
          min-height:100vh;color:var(--ink);
          font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5;
          background:radial-gradient(120% 80% at 85% -10%,rgba(124,116,255,.20),transparent 55%),radial-gradient(90% 70% at 0% 110%,rgba(226,59,46,.16),transparent 55%),var(--bg);}
        .mt-root *{box-sizing:border-box}
        .mt-wrap{max-width:1080px;margin:0 auto;padding:26px 22px 70px}
        .mt-back{display:inline-flex;align-items:center;gap:7px;color:var(--ink-soft);text-decoration:none;font-size:13px;font-weight:600;margin-bottom:18px}
        .mt-kicker{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;
          color:var(--indigo);background:rgba(124,116,255,.14);border:1px solid rgba(124,116,255,.32);padding:6px 13px;border-radius:999px}
        .mt-h1{font-size:clamp(38px,8vw,74px);line-height:.98;letter-spacing:-.035em;font-weight:900;margin:.28em 0 .12em;text-wrap:balance}
        .mt-grad{background:linear-gradient(100deg,var(--indigo),var(--red));-webkit-background-clip:text;background-clip:text;color:transparent}
        .mt-sub{font-size:clamp(16px,2.4vw,20px);color:var(--ink-soft);max-width:54ch}
        .mt-top{display:grid;grid-template-columns:1.05fr .95fr;gap:34px;align-items:center;margin-top:14px}
        @media (max-width:820px){.mt-top{grid-template-columns:1fr;gap:26px}}
        .mt-chips{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}
        .mt-chip{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:8px 13px}
        .mt-chip b{color:var(--indigo)}
        .mt-quote{margin-top:26px;border-left:3px solid var(--red);padding:6px 0 6px 16px;color:var(--ink);font-size:16px;font-style:italic}
        .mt-quote span{color:var(--ink-soft);font-style:normal;font-size:13px;display:block;margin-top:6px}
        .mt-phone{width:100%;max-width:300px;justify-self:center;background:#0a090d;border-radius:42px;padding:12px;
          box-shadow:0 40px 80px -30px rgba(124,116,255,.5),0 10px 30px rgba(0,0,0,.4);border:1px solid #23202c}
        .mt-screen{background:var(--screen);border-radius:31px;overflow:hidden;position:relative;min-height:566px}
        .mt-notch{position:absolute;top:0;left:50%;transform:translateX(-50%);width:112px;height:24px;background:#0a090d;border-radius:0 0 15px 15px;z-index:6}
        .mt-modal{position:absolute;inset:0;padding:26px 18px 18px;
          background:radial-gradient(120% 60% at 50% 0%,rgba(124,116,255,.22),transparent 60%),linear-gradient(180deg,var(--screen),#0b0a10)}
        .mt-crest{width:88px;height:88px;margin:14px auto 0;border-radius:26px;position:relative;
          background:linear-gradient(150deg,var(--indigo),var(--indigo-deep));display:flex;align-items:center;justify-content:center;box-shadow:0 18px 40px -10px rgba(124,116,255,.6)}
        .mt-crest span{font-size:42px}
        .mt-crest::after{content:"";position:absolute;inset:-7px;border-radius:31px;border:2px solid var(--indigo);opacity:.35}
        .mt-badge{display:block;width:max-content;margin:16px auto 0;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);
          background:rgba(245,196,81,.15);border:1px solid rgba(245,196,81,.34);padding:4px 11px;border-radius:999px}
        .mt-modal h2{text-align:center;font-size:25px;line-height:1.06;font-weight:900;letter-spacing:-.02em;margin:14px 6px 6px;color:var(--ink)}
        .mt-lead{text-align:center;font-size:13.5px;color:var(--screen-soft);margin:0 8px;line-height:1.5}
        .mt-feat{margin-top:16px;display:flex;flex-direction:column;gap:8px}
        .mt-frow{display:flex;align-items:center;gap:11px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 12px}
        .mt-frow .ic{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;background:rgba(124,116,255,.14)}
        .mt-frow .tx{font-size:12.5px;color:var(--ink);font-weight:600;line-height:1.25}
        .mt-cta{display:block;text-align:center;text-decoration:none;margin-top:16px;padding:14px;border-radius:16px;font-size:15px;font-weight:800;color:#fff;
          background:linear-gradient(135deg,var(--indigo),var(--red));box-shadow:0 14px 28px -10px rgba(226,59,46,.5)}
        .mt-rule{height:1px;background:var(--line);margin:44px 0 30px}
        .mt-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
        @media (max-width:720px){.mt-grid3{grid-template-columns:1fr}}
        .mt-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px}
        .mt-card .n{font-size:22px;font-weight:900;color:var(--indigo);letter-spacing:-.02em}
        .mt-card h3{margin:6px 0 5px;font-size:15px;font-weight:800}
        .mt-card p{margin:0;font-size:13.5px;color:var(--ink-soft);line-height:1.5}
        .mt-howto{margin-top:30px;background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:22px 24px}
        .mt-ht-head{font-size:15px;font-weight:900;margin-bottom:12px}
        .mt-steps{margin:0;padding:0;list-style:none;counter-reset:s;display:flex;flex-direction:column;gap:10px}
        .mt-steps li{position:relative;padding-left:40px;font-size:14px;color:var(--ink);line-height:1.45}
        .mt-steps li::before{counter-increment:s;content:counter(s);position:absolute;left:0;top:-1px;width:26px;height:26px;border-radius:50%;
          background:linear-gradient(135deg,var(--indigo),var(--indigo-deep));color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center}
        .mt-final{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
        .mt-btn-primary{flex:1;min-width:220px;text-align:center;text-decoration:none;padding:16px;border-radius:16px;font-size:16px;font-weight:900;color:#fff;
          background:linear-gradient(135deg,var(--indigo),var(--red));box-shadow:0 16px 32px -12px rgba(226,59,46,.5)}
        .mt-foot{margin-top:26px;text-align:center;color:var(--ink-soft);font-size:12px}
      `}</style>

      <div className="mt-wrap">
        <Link href="/dashboard" className="mt-back">{T.back}</Link>

        <div className="mt-top">
          <div>
            <span className="mt-kicker">{T.kicker}</span>
            <h1 className="mt-h1">La tête à<br /><span className="mt-grad">Matthieu</span></h1>
            <p className="mt-sub">{T.sub}</p>
            <div className="mt-chips">
              {T.chips.map((c, i) => <span key={i} className="mt-chip">{c}</span>)}
            </div>
            <div className="mt-quote">
              {T.quote}
              <span>{T.quoteAttr}</span>
            </div>
          </div>

          <div className="mt-phone"><div className="mt-screen">
            <div className="mt-notch" />
            <div className="mt-modal">
              <div className="mt-crest"><span>🔧</span></div>
              <span className="mt-badge">{T.badge}</span>
              <h2>{T.mtitle}</h2>
              <p className="mt-lead">{T.mlead}</p>
              <div className="mt-feat">
                {['💬', '📄', '📷'].map((ic, i) => (
                  <div key={i} className="mt-frow"><div className="ic">{ic}</div><div className="tx">{T.mf[i]}</div></div>
                ))}
              </div>
              <Link href="/matthieu" className="mt-cta">{T.tryBtn}</Link>
            </div>
          </div></div>
        </div>

        <div className="mt-rule" />

        <div className="mt-grid3">
          {T.cards.map((c, i) => (
            <div key={i} className="mt-card"><div className="n">{`0${i + 1}`}</div><h3>{c[0]}</h3><p>{c[1]}</p></div>
          ))}
        </div>

        <div className="mt-howto">
          <div className="mt-ht-head">{T.htHead}</div>
          <ol className="mt-steps">
            {T.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>

        <div className="mt-final">
          <Link href="/matthieu" className="mt-btn-primary">{T.finalBtn}</Link>
        </div>
        <p className="mt-foot">VD Soft · Verviers Dépannage — <b style={{ color: 'var(--ink)' }}>La tête à Matthieu</b></p>
      </div>
    </div>
  )
}
