// src/components/decharges/CarSilhouettes.tsx
//
// 5 silhouettes SVG d une berline pour servir de fond au schema de degats.
// Vues : dessus, avant, arriere, gauche, droite.
// ViewBox standardise 400x240. Contour fin gris + vitres ombrees gris clair
// + jantes detaillees - rendu plus pro que des silhouettes plates.

import React from 'react'

const STROKE = 'currentColor'
const FILL_GLASS = '#e5e7eb'   // gris clair pour les vitres
const FILL_TIRE  = '#374151'   // gris foncé pour les pneus
const FILL_BODY  = '#fafafa'   // blanc cassé pour la carrosserie (legere)
const SW = 1.8

export const CAR_VIEW_LABEL: Record<CarView, string> = {
  top:   'Dessus',
  front: 'Avant',
  back:  'Arrière',
  left:  'Gauche',
  right: 'Droite',
}

export type CarView = 'top' | 'front' | 'back' | 'left' | 'right'

export function CarSilhouette({ view, className = '' }: { view: CarView; className?: string }) {
  switch (view) {
    case 'top':   return <TopView   className={className} />
    case 'front': return <FrontView className={className} />
    case 'back':  return <RearView  className={className} />
    case 'left':  return <LeftView  className={className} />
    case 'right': return <RightView className={className} />
  }
}

// ───────────────────────────────────────────────────────────
// VUE DE DESSUS — voiture orientee horizontalement (capot a gauche)
// ───────────────────────────────────────────────────────────
function TopView({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" className={className}>
      <g stroke={STROKE} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        {/* Ombre legere */}
        <ellipse cx="200" cy="220" rx="160" ry="8" fill="#00000010" stroke="none" />

        {/* Carrosserie principale (vue de dessus) */}
        <path
          d="M 50 120 Q 50 90 80 78 L 110 70 Q 200 60 290 70 L 320 78 Q 350 90 350 120 Q 350 150 320 162 L 290 170 Q 200 180 110 170 L 80 162 Q 50 150 50 120 Z"
          fill={FILL_BODY}
        />

        {/* Toit (zone vitree centrale) */}
        <path
          d="M 130 95 Q 200 88 270 95 L 275 145 Q 200 152 125 145 Z"
          fill={FILL_GLASS}
        />

        {/* Pare-brise (avant) */}
        <path d="M 130 95 L 110 90 L 110 150 L 125 145 Z" fill={FILL_GLASS} opacity="0.7" />
        {/* Lunette arriere */}
        <path d="M 270 95 L 290 90 L 290 150 L 275 145 Z" fill={FILL_GLASS} opacity="0.7" />

        {/* Separation toit/pare-brise et toit/lunette */}
        <line x1="130" y1="95" x2="125" y2="145" />
        <line x1="270" y1="95" x2="275" y2="145" />

        {/* Capot - lignes */}
        <line x1="60" y1="105" x2="105" y2="100" opacity="0.4" />
        <line x1="60" y1="135" x2="105" y2="140" opacity="0.4" />

        {/* Coffre - lignes */}
        <line x1="295" y1="100" x2="340" y2="105" opacity="0.4" />
        <line x1="295" y1="140" x2="340" y2="135" opacity="0.4" />

        {/* Rétroviseurs (depassent un peu de chaque cote) */}
        <ellipse cx="110" cy="62"  rx="10" ry="4" fill={FILL_BODY} />
        <ellipse cx="110" cy="178" rx="10" ry="4" fill={FILL_BODY} />

        {/* 4 jantes - vues de dessus = ovales sous la carrosserie */}
        <rect x="68"  y="55"  width="22" height="14" rx="3" fill={FILL_TIRE} stroke="none" />
        <rect x="68"  y="171" width="22" height="14" rx="3" fill={FILL_TIRE} stroke="none" />
        <rect x="310" y="55"  width="22" height="14" rx="3" fill={FILL_TIRE} stroke="none" />
        <rect x="310" y="171" width="22" height="14" rx="3" fill={FILL_TIRE} stroke="none" />

        {/* Indicateur avant (petit triangle ou marque sur le capot) */}
        <path d="M 55 115 L 65 120 L 55 125 Z" fill={STROKE} opacity="0.3" stroke="none" />
      </g>
    </svg>
  )
}

// ───────────────────────────────────────────────────────────
// VUE DE FACE (AVANT)
// ───────────────────────────────────────────────────────────
function FrontView({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" className={className}>
      <g stroke={STROKE} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        {/* Ombre */}
        <ellipse cx="200" cy="222" rx="160" ry="8" fill="#00000010" stroke="none" />

        {/* Carrosserie principale (capot + toit + pare-brise) */}
        <path
          d="M 60 195 L 60 130 Q 60 105 85 92 L 115 78 Q 135 65 165 60 Q 200 56 235 60 Q 265 65 285 78 L 315 92 Q 340 105 340 130 L 340 195 Z"
          fill={FILL_BODY}
        />

        {/* Pare-brise (zone vitree) */}
        <path
          d="M 125 80 Q 200 70 275 80 L 280 125 L 120 125 Z"
          fill={FILL_GLASS}
        />

        {/* Capot (separation horizontale entre vitre et carosserie) */}
        <line x1="120" y1="125" x2="280" y2="125" />

        {/* Phares */}
        <ellipse cx="95"  cy="158" rx="22" ry="11" fill="#fef3c7" />
        <ellipse cx="305" cy="158" rx="22" ry="11" fill="#fef3c7" />
        <circle  cx="95"  cy="158" r="4"  fill={STROKE} opacity="0.4" stroke="none" />
        <circle  cx="305" cy="158" r="4"  fill={STROKE} opacity="0.4" stroke="none" />

        {/* Calandre centrale */}
        <rect x="160" y="155" width="80" height="22" rx="4" fill={STROKE} fillOpacity="0.15" />
        <line x1="170" y1="160" x2="230" y2="160" opacity="0.4" />
        <line x1="170" y1="166" x2="230" y2="166" opacity="0.4" />
        <line x1="170" y1="172" x2="230" y2="172" opacity="0.4" />

        {/* Logo */}
        <circle cx="200" cy="166" r="6" fill={FILL_BODY} />

        {/* Plaque immatriculation */}
        <rect x="170" y="183" width="60" height="12" rx="2" fill={FILL_BODY} />
        <line x1="175" y1="189" x2="225" y2="189" opacity="0.3" />

        {/* Pare-chocs */}
        <line x1="50"  y1="200" x2="350" y2="200" />
        <line x1="50"  y1="200" x2="60"  y2="195" opacity="0.6" />
        <line x1="350" y1="200" x2="340" y2="195" opacity="0.6" />

        {/* Roues visibles */}
        <ellipse cx="80"  cy="208" rx="26" ry="9" fill={FILL_TIRE} stroke="none" />
        <ellipse cx="320" cy="208" rx="26" ry="9" fill={FILL_TIRE} stroke="none" />
        <ellipse cx="80"  cy="208" rx="14" ry="5" fill="#9ca3af" stroke="none" />
        <ellipse cx="320" cy="208" rx="14" ry="5" fill="#9ca3af" stroke="none" />

        {/* Antenne ou shark fin */}
        <path d="M 195 60 Q 200 50 210 56 L 208 62 Z" fill={FILL_BODY} opacity="0.6" />
      </g>
    </svg>
  )
}

// ───────────────────────────────────────────────────────────
// VUE ARRIERE
// ───────────────────────────────────────────────────────────
function RearView({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" className={className}>
      <g stroke={STROKE} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        {/* Ombre */}
        <ellipse cx="200" cy="222" rx="160" ry="8" fill="#00000010" stroke="none" />

        {/* Carrosserie + lunette + coffre */}
        <path
          d="M 60 195 L 60 130 Q 60 108 80 95 L 110 82 Q 135 70 165 65 Q 200 62 235 65 Q 265 70 290 82 L 320 95 Q 340 108 340 130 L 340 195 Z"
          fill={FILL_BODY}
        />

        {/* Lunette arriere (plus inclinee, donc + grande) */}
        <path
          d="M 120 90 Q 200 78 280 90 L 280 130 L 120 130 Z"
          fill={FILL_GLASS}
        />

        {/* Separation entre lunette et coffre */}
        <line x1="120" y1="130" x2="280" y2="130" />

        {/* Feux arriere (plus larges, rouge) */}
        <path d="M 70 148 L 130 148 L 130 172 L 70 172 Q 65 168 65 162 Q 65 152 70 148 Z" fill="#fca5a5" />
        <path d="M 330 148 L 270 148 L 270 172 L 330 172 Q 335 168 335 162 Q 335 152 330 148 Z" fill="#fca5a5" />
        {/* Subdivisions feux */}
        <line x1="95"  y1="148" x2="95"  y2="172" opacity="0.5" />
        <line x1="115" y1="148" x2="115" y2="172" opacity="0.5" />
        <line x1="305" y1="148" x2="305" y2="172" opacity="0.5" />
        <line x1="285" y1="148" x2="285" y2="172" opacity="0.5" />

        {/* Coffre - ligne horizontale */}
        <line x1="60" y1="155" x2="340" y2="155" opacity="0.3" />

        {/* Plaque immatriculation */}
        <rect x="170" y="170" width="60" height="14" rx="2" fill={FILL_BODY} />
        <line x1="175" y1="177" x2="225" y2="177" opacity="0.3" />

        {/* Logo central */}
        <circle cx="200" cy="143" r="6" fill={FILL_BODY} />

        {/* Pare-chocs + tuyau echappement */}
        <line x1="50" y1="200" x2="350" y2="200" />
        <line x1="50" y1="200" x2="60" y2="195" opacity="0.6" />
        <line x1="350" y1="200" x2="340" y2="195" opacity="0.6" />
        <circle cx="305" cy="198" r="5" fill={STROKE} fillOpacity="0.3" />

        {/* Roues */}
        <ellipse cx="80"  cy="208" rx="26" ry="9" fill={FILL_TIRE} stroke="none" />
        <ellipse cx="320" cy="208" rx="26" ry="9" fill={FILL_TIRE} stroke="none" />
        <ellipse cx="80"  cy="208" rx="14" ry="5" fill="#9ca3af" stroke="none" />
        <ellipse cx="320" cy="208" rx="14" ry="5" fill="#9ca3af" stroke="none" />

        {/* Antenne (sur le toit, sortant) */}
        <line x1="200" y1="65" x2="200" y2="55" />
        <circle cx="200" cy="55" r="2" fill={STROKE} />
      </g>
    </svg>
  )
}

// ───────────────────────────────────────────────────────────
// VUE LATERALE GAUCHE — capot a gauche, coffre a droite
// ───────────────────────────────────────────────────────────
function LeftView({ className }: { className?: string }) {
  return <SideView className={className} mirror={false} />
}

function RightView({ className }: { className?: string }) {
  return <SideView className={className} mirror={true} />
}

function SideView({ className, mirror }: { className?: string; mirror: boolean }) {
  return (
    <svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" className={className}>
      <g
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={mirror ? 'translate(400 0) scale(-1 1)' : undefined}
      >
        {/* Ombre */}
        <ellipse cx="200" cy="220" rx="170" ry="8" fill="#00000010" stroke="none" />

        {/* Carrosserie - silhouette berline */}
        <path
          d="M 30 175
             Q 30 158 50 152
             L 78 148
             L 88 130
             Q 100 105 130 92
             L 155 82
             Q 200 72 250 76
             L 280 88
             Q 305 98 318 122
             L 328 145
             L 355 150
             Q 370 156 370 170
             L 370 188
             L 30 188 Z"
          fill={FILL_BODY}
        />

        {/* Vitres (3 sections : pare-brise, vitre avant, vitre arriere, custode) */}
        {/* Pare-brise (avant) */}
        <path d="M 130 92 L 155 82 L 200 78 L 195 130 L 130 130 Q 125 110 130 92 Z" fill={FILL_GLASS} />
        {/* Vitre porte conducteur */}
        <path d="M 200 78 L 245 80 L 240 130 L 195 130 Z" fill={FILL_GLASS} />
        {/* Vitre porte arriere */}
        <path d="M 245 80 L 280 88 L 285 130 L 240 130 Z" fill={FILL_GLASS} />
        {/* Custode (petit triangle arriere) */}
        <path d="M 280 88 L 305 98 L 312 130 L 285 130 Z" fill={FILL_GLASS} />

        {/* Montants entre vitres */}
        <line x1="195" y1="130" x2="200" y2="78" />
        <line x1="240" y1="130" x2="245" y2="80" />
        <line x1="285" y1="130" x2="280" y2="88" />

        {/* Ligne bas des vitres */}
        <line x1="130" y1="130" x2="312" y2="130" />

        {/* Portes - separation verticale carrosserie */}
        <line x1="200" y1="130" x2="200" y2="188" opacity="0.5" />
        <line x1="245" y1="130" x2="245" y2="188" opacity="0.5" />

        {/* Poignees de portes */}
        <rect x="208" y="148" width="28" height="3.5" rx="1.5" fill={STROKE} fillOpacity="0.5" />
        <rect x="252" y="148" width="28" height="3.5" rx="1.5" fill={STROKE} fillOpacity="0.5" />

        {/* Retroviseur exterieur (avant porte conducteur) */}
        <ellipse cx="192" cy="105" rx="5" ry="3" fill={STROKE} fillOpacity="0.3" stroke="none" />
        <line x1="192" y1="108" x2="195" y2="120" />

        {/* Passages de roues + roues */}
        <path d="M 78 188 Q 80 165 105 155" />
        <path d="M 130 188 Q 128 165 105 155" />
        <path d="M 268 188 Q 270 165 295 155" />
        <path d="M 320 188 Q 318 165 295 155" />

        {/* Roue avant */}
        <circle cx="105" cy="200" r="26" fill={FILL_TIRE} stroke="none" />
        <circle cx="105" cy="200" r="22" fill="none" stroke="#9ca3af" strokeWidth="1" />
        <circle cx="105" cy="200" r="12" fill="#d1d5db" stroke="none" />
        <circle cx="105" cy="200" r="4"  fill="#6b7280" stroke="none" />
        {/* Rayons jante */}
        {[0, 60, 120, 180, 240, 300].map(deg => {
          const rad = (deg * Math.PI) / 180
          const x1 = 105 + Math.cos(rad) * 5
          const y1 = 200 + Math.sin(rad) * 5
          const x2 = 105 + Math.cos(rad) * 11
          const y2 = 200 + Math.sin(rad) * 11
          return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6b7280" strokeWidth="1.5" />
        })}

        {/* Roue arriere */}
        <circle cx="295" cy="200" r="26" fill={FILL_TIRE} stroke="none" />
        <circle cx="295" cy="200" r="22" fill="none" stroke="#9ca3af" strokeWidth="1" />
        <circle cx="295" cy="200" r="12" fill="#d1d5db" stroke="none" />
        <circle cx="295" cy="200" r="4"  fill="#6b7280" stroke="none" />
        {[0, 60, 120, 180, 240, 300].map(deg => {
          const rad = (deg * Math.PI) / 180
          const x1 = 295 + Math.cos(rad) * 5
          const y1 = 200 + Math.sin(rad) * 5
          const x2 = 295 + Math.cos(rad) * 11
          const y2 = 200 + Math.sin(rad) * 11
          return <line key={`r-${deg}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6b7280" strokeWidth="1.5" />
        })}

        {/* Phare avant */}
        <ellipse cx="38" cy="168" rx="8" ry="6" fill="#fef3c7" />
        {/* Feu arriere */}
        <rect x="358" y="160" width="10" height="14" rx="2" fill="#fca5a5" />
      </g>
    </svg>
  )
}
