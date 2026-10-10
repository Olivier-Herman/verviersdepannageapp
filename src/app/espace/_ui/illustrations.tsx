// Illustrations de l'espace client (SVG maison, animées en CSS — voir espace.css).

export function Depanneuse({ className = '', avecVoiture = true }: { className?: string; avecVoiture?: boolean }) {
  return (
    <svg viewBox="0 0 320 120" className={className} aria-hidden>
      <g className="esp-truck">
        {/* plateau */}
        <path d="M118 70 L262 62 L268 74 L118 82 Z" fill="#cbd5e1" />
        <rect x="118" y="78" width="150" height="10" rx="3" fill="#475569" />
        {avecVoiture && (
          <g transform="translate(150 30) rotate(-3)">
            <path d="M8 34 C10 20 22 12 40 11 L70 10 C84 10 92 16 100 26 L108 28 C114 29 116 33 116 38 L116 42 L4 44 L4 39 C4 36 6 35 8 34 Z" fill="#1d4ed8" />
            <path d="M30 16 L44 14 L50 26 L24 27 Z M54 13 L70 13 C78 13 84 18 88 25 L56 26 Z" fill="#bfdbfe" />
            <circle cx="28" cy="44" r="9" fill="#0f172a" /><circle cx="28" cy="44" r="3.5" fill="#94a3b8" />
            <circle cx="92" cy="43" r="9" fill="#0f172a" /><circle cx="92" cy="43" r="3.5" fill="#94a3b8" />
          </g>
        )}
        {/* grue */}
        <path d="M232 64 L276 36 L282 40 L240 68 Z" fill="#94a3b8" />
        <path d="M279 39 L286 70" stroke="#334155" strokeWidth="2.5" />
        <path d="M283 70 q4 6 -2 9" stroke="#334155" strokeWidth="2.5" fill="none" />
        {/* cabine */}
        <path d="M30 88 L30 58 C30 50 36 44 44 44 L84 44 C92 44 98 48 102 56 L116 76 L118 88 Z" fill="#cc2222" />
        <path d="M48 50 L82 50 C87 50 90 53 93 58 L101 72 L48 72 Z" fill="#dbeafe" />
        <path d="M66 50 L66 72" stroke="#cc2222" strokeWidth="3" />
        <rect x="26" y="80" width="14" height="8" rx="2" fill="#fbbf24" />
        <rect x="44" y="76" width="18" height="3" rx="1.5" fill="#7f1d1d" />
        {/* gyrophare */}
        <rect x="56" y="38" width="20" height="7" rx="3.5" className="esp-beacon" fill="#f59e0b" />
        {/* bandes */}
        <path d="M30 82 L118 82" stroke="#fff" strokeWidth="3" strokeDasharray="10 6" opacity=".85" />
        {/* roues */}
        <g className="esp-wheel"><circle cx="62" cy="92" r="15" fill="#0f172a" /><circle cx="62" cy="92" r="6" fill="#cbd5e1" /><path d="M62 80 L62 104 M50 92 L74 92" stroke="#475569" strokeWidth="2" /></g>
        <g className="esp-wheel"><circle cx="212" cy="92" r="15" fill="#0f172a" /><circle cx="212" cy="92" r="6" fill="#cbd5e1" /><path d="M212 80 L212 104 M200 92 L224 92" stroke="#475569" strokeWidth="2" /></g>
        <g className="esp-wheel"><circle cx="246" cy="92" r="15" fill="#0f172a" /><circle cx="246" cy="92" r="6" fill="#cbd5e1" /><path d="M246 80 L246 104 M234 92 L258 92" stroke="#475569" strokeWidth="2" /></g>
      </g>
    </svg>
  )
}

/** Dépannage sur place : voiture capot ouvert, clé, étincelles. */
export function IlluDsp({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 120" className={className} aria-hidden>
      <ellipse cx="100" cy="104" rx="78" ry="8" fill="#0f172a" opacity=".08" />
      <path d="M30 86 C32 68 46 58 70 56 L120 54 C140 54 152 62 162 74 L172 76 C178 77 180 81 180 86 L180 92 L26 94 L26 89 C26 87 28 86 30 86 Z" fill="#0ea5e9" />
      <path d="M58 62 L76 60 L82 74 L50 75 Z M88 59 L118 58 C128 58 136 63 142 72 L92 73 Z" fill="#e0f2fe" />
      <path d="M150 68 L176 44 L182 50 L162 74 Z" fill="#0284c7" />
      <circle cx="58" cy="94" r="12" fill="#0f172a" /><circle cx="58" cy="94" r="4.5" fill="#94a3b8" />
      <circle cx="148" cy="93" r="12" fill="#0f172a" /><circle cx="148" cy="93" r="4.5" fill="#94a3b8" />
      <g className="esp-pop" style={{ animationDelay: '.2s' }}>
        <path d="M120 22 l10 10 -4 4 -10 -10 a8 8 0 1 1 4 -4 z" fill="#f59e0b" />
        <path d="M128 30 L150 52" stroke="#f59e0b" strokeWidth="6" strokeLinecap="round" />
      </g>
      <g fill="#fbbf24"><circle cx="160" cy="30" r="3" className="esp-beacon" /><circle cx="172" cy="40" r="2" /><circle cx="150" cy="18" r="2.2" /></g>
    </svg>
  )
}

/** Remorquage : petite dépanneuse avec voiture chargée. */
export function IlluRem({ className = '' }: { className?: string }) {
  return <Depanneuse className={className} />
}

/** État vide : route qui file vers l'horizon. */
export function IlluVide({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 140" className={className} aria-hidden>
      <defs><linearGradient id="esp-sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#fde68a" /><stop offset="1" stopColor="#fff7ed" /></linearGradient></defs>
      <rect x="0" y="0" width="220" height="140" rx="24" fill="url(#esp-sky)" />
      <circle cx="160" cy="48" r="18" fill="#fbbf24" opacity=".9" />
      <path d="M0 96 Q60 70 110 90 T220 84 L220 140 L0 140 Z" fill="#fcd9b6" />
      <path d="M96 140 L108 92 L114 92 L128 140 Z" fill="#334155" />
      <path d="M110 136 L111 126 M111 118 L111.5 110 M112 104 L112 98" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}
