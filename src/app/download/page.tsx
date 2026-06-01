// /download : page publique d onboarding mobile pour Momo + chauffeurs.
// Detection plateforme via User-Agent (Server Component, Next 14 headers
// synchrone). QR cote serveur via api.qrserver.com (zero dep).
//
// URLs :
//   - Android : redirige via /downloads/android (route 302 -> Supabase Storage)
//   - iOS     : App Store Unlisted
//
// Olivier 2026-06-01.

import { headers } from 'next/headers'
import Image       from 'next/image'
import Link        from 'next/link'

export const metadata = {
  title:       'Télécharger VD Soft',
  description: "Téléchargez l'application VD Soft pour iPhone ou Android",
}

const APK_URL = 'https://app.verviersdepannage.com/downloads/android'
const IOS_URL = 'https://apps.apple.com/us/app/vd-soft/id6769551627'

type Platform = 'ios' | 'android' | 'desktop'

function detectPlatform(userAgent: string): Platform {
  if (/iPad|iPhone|iPod/.test(userAgent)) return 'ios'
  if (/Android/.test(userAgent))          return 'android'
  return 'desktop'
}

function QR({ url, size = 280 }: { url: string; size?: number }) {
  // api.qrserver.com : service public, pas de dep npm, image PNG cachable
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&data=${encodeURIComponent(url)}`
  return (
    <div className="bg-white p-3 rounded-2xl inline-block shadow-md">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`QR code vers ${url}`} width={size} height={size} className="block" />
    </div>
  )
}

function AndroidCard({ highlighted }: { highlighted: boolean }) {
  return (
    <section className={`rounded-3xl border-2 p-6 sm:p-8 space-y-5 ${
      highlighted
        ? 'bg-green-50 border-green-400'
        : 'bg-surface border-gray-200'
    }`}>
      <header className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-green-600 text-white flex items-center justify-center text-2xl">
          🤖
        </div>
        <div>
          <h2 className="text-ink font-bold text-xl">Android</h2>
          <p className="text-ink-muted text-xs">Tablettes & téléphones Samsung, Google, Xiaomi…</p>
        </div>
      </header>

      {highlighted && (
        <div className="grid sm:grid-cols-[auto,1fr] gap-5 items-center">
          <div className="hidden sm:block"><QR url={APK_URL} size={180} /></div>
          <a href={APK_URL}
            className="block w-full text-center py-4 px-6 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-bold text-lg shadow-md transition">
            ⬇ Télécharger l'app (8 MB)
          </a>
        </div>
      )}

      {!highlighted && (
        <div className="space-y-3">
          <a href={APK_URL}
            className="inline-block py-2.5 px-5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold text-sm transition">
            ⬇ Télécharger l'APK
          </a>
          <details className="text-sm">
            <summary className="text-ink-muted cursor-pointer hover:text-ink">Scanner depuis un téléphone Android</summary>
            <div className="mt-3"><QR url={APK_URL} size={200} /></div>
          </details>
        </div>
      )}

      <details className="text-sm">
        <summary className="text-ink-muted cursor-pointer hover:text-ink font-medium">
          📱 Comment installer ? (1ère fois)
        </summary>
        <ol className="mt-3 space-y-2 text-ink-muted pl-5 list-decimal">
          <li>Télécharge l'APK avec le bouton vert ci-dessus</li>
          <li>Ouvre le fichier téléchargé (notification ou dossier <strong>Téléchargements</strong>)</li>
          <li>Android va dire : <em>"Pour votre sécurité, vous ne pouvez pas installer…"</em> → tape <strong>Paramètres</strong></li>
          <li>Active <strong>"Autoriser cette source"</strong> pour Chrome (ou ton navigateur)</li>
          <li>Reviens et tape <strong>Installer</strong></li>
          <li>Ouvre VD Soft → autorise les notifications, la localisation et la caméra</li>
        </ol>
        <p className="mt-3 text-xs text-ink-muted italic">
          Les mises à jour suivantes utiliseront le même bouton — l'app détectera automatiquement la nouvelle version.
        </p>
      </details>
    </section>
  )
}

function IosCard({ highlighted }: { highlighted: boolean }) {
  return (
    <section className={`rounded-3xl border-2 p-6 sm:p-8 space-y-5 ${
      highlighted
        ? 'bg-blue-50 border-blue-400'
        : 'bg-surface border-gray-200'
    }`}>
      <header className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center text-2xl">

        </div>
        <div>
          <h2 className="text-ink font-bold text-xl">iPhone / iPad</h2>
          <p className="text-ink-muted text-xs">iOS 15 ou plus récent</p>
        </div>
      </header>

      {highlighted ? (
        <div className="grid sm:grid-cols-[auto,1fr] gap-5 items-center">
          <div className="hidden sm:block"><QR url={IOS_URL} size={180} /></div>
          <a href={IOS_URL} target="_blank" rel="noopener noreferrer"
            className="block w-full text-center py-4 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-lg shadow-md transition">
            ⬇ Télécharger sur l'App Store
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          <a href={IOS_URL} target="_blank" rel="noopener noreferrer"
            className="inline-block py-2.5 px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition">
            ⬇ App Store
          </a>
          <details className="text-sm">
            <summary className="text-ink-muted cursor-pointer hover:text-ink">Scanner depuis un iPhone</summary>
            <div className="mt-3"><QR url={IOS_URL} size={200} /></div>
          </details>
        </div>
      )}

      <p className="text-xs text-ink-muted">
        L'app est distribuée en <strong>Unlisted</strong> — le lien ci-dessus est obligatoire (pas de recherche App Store).
      </p>
    </section>
  )
}

export default function DownloadPage() {
  const ua       = headers().get('user-agent') || ''
  const platform = detectPlatform(ua)

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-8">

        <header className="text-center space-y-3">
          <Image src="/logo.jpg" alt="VD Soft" width={80} height={80}
            className="mx-auto rounded-2xl shadow-md" />
          <h1 className="text-ink font-bold text-3xl sm:text-4xl">Télécharger VD Soft</h1>
          <p className="text-ink-muted text-base">
            L'app mobile pour les chauffeurs et dispatchers Verviers Dépannage.
          </p>
        </header>

        {/* Sections : la plateforme detectee est mise en avant, l autre reste accessible plus bas */}
        {platform === 'android' && (
          <>
            <AndroidCard highlighted />
            <IosCard highlighted={false} />
          </>
        )}
        {platform === 'ios' && (
          <>
            <IosCard highlighted />
            <AndroidCard highlighted={false} />
          </>
        )}
        {platform === 'desktop' && (
          <>
            <div className="text-center bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900">
              📱 Tu es sur un ordinateur. Scanne un QR ci-dessous avec le téléphone à installer.
            </div>
            <div className="grid sm:grid-cols-2 gap-6">
              <AndroidCard highlighted />
              <IosCard highlighted />
            </div>
          </>
        )}

        <footer className="text-center text-xs text-ink-muted pt-6 border-t border-gray-200">
          <p>Problème d'installation ? Contacte Olivier.</p>
          <p className="mt-2">
            <Link href="/login" className="text-brand hover:underline">Aller à l'app</Link>
          </p>
        </footer>

      </div>
    </div>
  )
}
