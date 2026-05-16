// src/components/decharges/CarSilhouettes.tsx
//
// 4 silhouettes SVG basiques d une berline pour servir de fond au schema de
// degats. Vues : avant, arriere, gauche, droite. ViewBox standardise 400x240
// pour que les 4 vues soient interchangeables dans le canvas de dessin.
//
// Style trait fin gris pour ne pas distraire de l annotation dessinee par
// le chauffeur (rouge epais). Pas de details inutiles (jantes ouvertes,
// logos, etc) - juste les contours principaux.

import React from 'react'

const STROKE = 'currentColor'
const SW = 2

export const CAR_VIEW_LABEL: Record<CarView, string> = {
  front: 'Avant',
  back:  'Arrière',
  left:  'Gauche',
  right: 'Droite',
}

export type CarView = 'front' | 'back' | 'left' | 'right'

export function CarSilhouette({ view, className = '' }: { view: CarView; className?: string }) {
  switch (view) {
    case 'front': return <FrontView className={className} />
    case 'back':  return <RearView  className={className} />
    case 'left':  return <LeftView  className={className} />
    case 'right': return <RightView className={className} />
  }
}

function FrontView({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" className={className}>
      <g fill="none" stroke={STROKE} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        {/* Carrosserie haut (toit + pare-brise + capot) */}
        <path d="M70 180 L70 130 Q70 105 90 95 L120 75 L130 70 Q200 55 270 70 L280 75 L310 95 Q330 105 330 130 L330 180" />
        {/* Capot (bas) */}
        <line x1="70" y1="180" x2="330" y2="180" />
        {/* Pare-brise séparateur */}
        <line x1="130" y1="70" x2="120" y2="120" />
        <line x1="270" y1="70" x2="280" y2="120" />
        <line x1="120" y1="120" x2="280" y2="120" />
        {/* Phares */}
        <ellipse cx="100" cy="155" rx="18" ry="9" />
        <ellipse cx="300" cy="155" rx="18" ry="9" />
        {/* Calandre */}
        <rect x="170" y="155" width="60" height="18" rx="3" />
        {/* Logo central */}
        <circle cx="200" cy="164" r="4" />
        {/* Pare-chocs bas */}
        <line x1="55" y1="200" x2="345" y2="200" />
        <line x1="55" y1="200" x2="70" y2="180" />
        <line x1="345" y1="200" x2="330" y2="180" />
        {/* Roues visibles */}
        <ellipse cx="80" cy="210" rx="22" ry="8" />
        <ellipse cx="320" cy="210" rx="22" ry="8" />
      </g>
    </svg>
  )
}

function RearView({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" className={className}>
      <g fill="none" stroke={STROKE} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        {/* Lunette arrière + toit + coffre */}
        <path d="M70 180 L70 130 Q70 110 85 100 L115 85 L125 75 Q200 65 275 75 L285 85 L315 100 Q330 110 330 130 L330 180" />
        {/* Coffre (bas) */}
        <line x1="70" y1="180" x2="330" y2="180" />
        {/* Lunette arrière haute (zone vitrée) */}
        <line x1="125" y1="75" x2="120" y2="125" />
        <line x1="275" y1="75" x2="280" y2="125" />
        <line x1="120" y1="125" x2="280" y2="125" />
        {/* Feux arrière (plus larges, fragmentés) */}
        <path d="M75 145 L130 145 L130 165 L75 165 Z" />
        <path d="M270 145 L325 145 L325 165 L270 165 Z" />
        <line x1="100" y1="145" x2="100" y2="165" />
        <line x1="295" y1="145" x2="295" y2="165" />
        {/* Plaque arrière */}
        <rect x="170" y="155" width="60" height="18" rx="2" />
        {/* Pare-chocs */}
        <line x1="55" y1="200" x2="345" y2="200" />
        <line x1="55" y1="200" x2="70" y2="180" />
        <line x1="345" y1="200" x2="330" y2="180" />
        {/* Roues */}
        <ellipse cx="80" cy="210" rx="22" ry="8" />
        <ellipse cx="320" cy="210" rx="22" ry="8" />
        {/* Tuyau d échappement */}
        <circle cx="315" cy="195" r="4" />
      </g>
    </svg>
  )
}

function LeftView({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" className={className}>
      <g fill="none" stroke={STROKE} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        {/* Silhouette : capot (gauche) + toit + coffre (droite) — vue cote gauche, l avant a gauche */}
        <path d="M30 175 L30 160 Q30 145 50 140 L80 135 Q90 105 130 90 L150 80 Q200 70 260 75 L290 90 Q310 105 320 135 L355 145 Q370 155 370 170 L370 180" />
        {/* Pare-chocs bas */}
        <line x1="30" y1="175" x2="370" y2="180" />
        {/* Pare-brise avant (gauche) */}
        <line x1="130" y1="90" x2="115" y2="135" />
        {/* Vitre conducteur (porte avant) */}
        <line x1="170" y1="80" x2="170" y2="135" />
        {/* Vitre passager arrière (porte arrière) */}
        <line x1="225" y1="78" x2="225" y2="135" />
        {/* Vitre custode */}
        <line x1="280" y1="80" x2="290" y2="135" />
        {/* Bas des vitres */}
        <line x1="115" y1="135" x2="320" y2="135" />
        {/* Portes (séparation verticale carrosserie) */}
        <line x1="170" y1="135" x2="170" y2="180" />
        <line x1="225" y1="135" x2="225" y2="180" />
        {/* Poignées portes */}
        <rect x="178" y="155" width="22" height="3" rx="1" />
        <rect x="233" y="155" width="22" height="3" rx="1" />
        {/* Roue avant (gauche) */}
        <circle cx="105" cy="195" r="22" />
        <circle cx="105" cy="195" r="10" />
        {/* Roue arrière */}
        <circle cx="295" cy="195" r="22" />
        <circle cx="295" cy="195" r="10" />
        {/* Passages de roues */}
        <path d="M83 175 Q105 165 127 175" />
        <path d="M273 175 Q295 165 317 175" />
      </g>
    </svg>
  )
}

function RightView({ className }: { className?: string }) {
  // Vue cote droit = miroir horizontal de la vue gauche
  return (
    <svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" className={className}>
      <g fill="none" stroke={STROKE} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" transform="translate(400 0) scale(-1 1)">
        <path d="M30 175 L30 160 Q30 145 50 140 L80 135 Q90 105 130 90 L150 80 Q200 70 260 75 L290 90 Q310 105 320 135 L355 145 Q370 155 370 170 L370 180" />
        <line x1="30" y1="175" x2="370" y2="180" />
        <line x1="130" y1="90" x2="115" y2="135" />
        <line x1="170" y1="80" x2="170" y2="135" />
        <line x1="225" y1="78" x2="225" y2="135" />
        <line x1="280" y1="80" x2="290" y2="135" />
        <line x1="115" y1="135" x2="320" y2="135" />
        <line x1="170" y1="135" x2="170" y2="180" />
        <line x1="225" y1="135" x2="225" y2="180" />
        <rect x="178" y="155" width="22" height="3" rx="1" />
        <rect x="233" y="155" width="22" height="3" rx="1" />
        <circle cx="105" cy="195" r="22" />
        <circle cx="105" cy="195" r="10" />
        <circle cx="295" cy="195" r="22" />
        <circle cx="295" cy="195" r="10" />
        <path d="M83 175 Q105 165 127 175" />
        <path d="M273 175 Q295 165 317 175" />
      </g>
    </svg>
  )
}
