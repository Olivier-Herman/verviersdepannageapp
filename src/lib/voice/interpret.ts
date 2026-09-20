// src/lib/voice/interpret.ts
//
// ASSISTANT VOCAL CHAUFFEUR (Olivier 20/09/2026) : « créer une fiche en roulant ».
// Le chauffeur parle, l'app transcrit, et CE module transforme la phrase en
// champs structurés selon l'étape en cours (Claude, JSON strict). Le dialogue
// lui-même (quoi demander ensuite, relecture, confirmation) vit côté client
// dans VocalClient : ici on ne fait qu'interpréter UNE phrase.
// Alphabets radio compris : OTAN (Alpha Bravo…) et français (Anatole Berthe…).

import { ANTHROPIC_CHEAP_MODELS } from '@/lib/anthropic-model'

export type VoiceStep = 'intent' | 'plate' | 'vehicle' | 'address' | 'zone_agent' | 'destination' | 'yesno' | 'pointage_pick'

export interface VoiceContext {
  zones?: string[]                       // zones de police connues (libellés)
  missions?: { id: string; plate: string; label: string }[]   // missions actives du chauffeur (pointages)
  field?: string                         // champ en cours de correction
}

const SYSTEM = `Tu es l'assistant vocal des chauffeurs de Verviers Dépannage (dépanneuses, Belgique).
Tu reçois la TRANSCRIPTION d'une phrase dite en roulant, souvent bruitée, et l'ÉTAPE du dialogue.
Tu réponds UNIQUEMENT par un objet JSON, sans texte autour.

Règles générales :
- Plaques belges : 1-ABC-123 (chiffre, 3 lettres, 3 chiffres), 2-ABC-123, ou anciennes ABC-123 / 123-ABC ; plaques étrangères possibles.
  Le chauffeur épelle souvent en alphabet radio OTAN (Alpha, Bravo, Charlie, Delta, Echo, Foxtrot, Golf, Hotel, India, Juliett, Kilo, Lima, Mike, November, Oscar, Papa, Quebec, Romeo, Sierra, Tango, Uniform, Victor, Whiskey, X-ray, Yankee, Zulu)
  ou français (Anatole, Berthe, Célestin, Désiré, Eugène, François, Gaston, Henri, Irma, Joseph, Kléber, Louis, Marcel, Nicolas, Oscar, Pierre, Quintal, Raoul, Suzanne, Thérèse, Ursule, Victor, William, Xavier, Yvonne, Zoé).
  Les chiffres peuvent être dits « un deux trois » ou « cent vingt-trois ». Rends la plaque SANS tirets ni espaces, en majuscules (ex. 1ABC123), et une forme épelée lisible « 1 A B C 1 2 3 ».
- Types de fiche police : accident (police accident), saisie, mal_garee (mal garée / stationnement gênant), rodeo, avp (abandon voie publique). Siabis non couvert = snc. Appel privé = appel_prive.
- Adresses : autoroutes E40, E42, E25, A27, A3 ; bornes kilométriques « borne 12 », « BK 12,5 » ; direction (Liège, Aachen, Bruxelles, Luxembourg) ; sorties ; ou rue + commune. Rends une adresse normalisée courte et la commune si connue (Battice, Verviers, Herve, Pepinster, Spa, Malmedy…).
- Zones de police : choisis dans la liste fournie quand il y en a une (Vesdre, Fagnes, Pays de Herve, Stavelot-Malmedy…), sinon rends ce qui est dit.
- Destination : « dépôt », « Pepinster », « chez nous » → depot ; sinon adresse dite.
- POINTAGES (étape intent) : « je suis en route », « je pars », « j'y vais » → pointage on_way ; « je suis sur place », « j'arrive », « arrivé » → on_site ; « chargé », « véhicule chargé », « je repars avec » → load_vehicle ; « terminé », « fini », « livré » → completed. Dans ce cas intent = "pointage", understood = true.
- Si la phrase est vide, inaudible ou hors sujet : "understood": false et un "ask" court pour redemander.

Formats par étape :
intent → {"understood":bool,"intent":"create"|"pointage"|"cancel"|"unknown","mission_type":string|null,"plate":string|null,"plate_spoken":string|null,"brand":string|null,"model":string|null,"address":string|null,"city":string|null,"zone":string|null,"officer":string|null,"destination":"depot"|"address"|null,"destination_address":string|null,"pointage":"on_way"|"on_site"|"load_vehicle"|"completed"|null,"ask":string|null}
plate → {"understood":bool,"plate":string|null,"plate_spoken":string|null,"ask":string|null}
vehicle → {"understood":bool,"brand":string|null,"model":string|null,"ask":string|null}
address → {"understood":bool,"address":string|null,"city":string|null,"ask":string|null}
zone_agent → {"understood":bool,"zone":string|null,"officer":string|null,"ask":string|null}
destination → {"understood":bool,"destination":"depot"|"address"|null,"destination_address":string|null,"ask":string|null}
yesno → {"understood":bool,"answer":"yes"|"no"|"correction"|null,"field":"type"|"plate"|"vehicle"|"address"|"zone"|"officer"|"destination"|null,"value":string|null,"ask":string|null}
pointage_pick → {"understood":bool,"mission_id":string|null,"ask":string|null}
Le champ "ask" est une question courte en français parlé, tutoiement, à relire au chauffeur.`

export async function interpretUtterance(step: VoiceStep, transcript: string, ctx: VoiceContext = {}): Promise<Record<string, any>> {
  const user = [
    `ÉTAPE : ${step}`,
    ctx.zones?.length ? `ZONES DE POLICE CONNUES : ${ctx.zones.join(' | ')}` : '',
    ctx.missions?.length ? `MISSIONS ACTIVES DU CHAUFFEUR : ${ctx.missions.map(m => `${m.id} = ${m.label} (plaque ${m.plate})`).join(' | ')}` : '',
    ctx.field ? `CHAMP EN CORRECTION : ${ctx.field}` : '',
    `PHRASE : « ${transcript.trim()} »`,
  ].filter(Boolean).join('\n')
  let lastErr = ''
  for (const model of ANTHROPIC_CHEAP_MODELS) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 400, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
    })
    if (!res.ok) { lastErr = await res.text(); if (res.status === 404) continue; throw new Error(`Claude ${res.status}: ${lastErr.slice(0, 200)}`) }
    const j = await res.json()
    const text: string = (j.content || []).map((c: any) => c.text || '').join('')
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return { understood: false, ask: 'Je n\'ai pas compris, tu peux répéter ?' }
    try {
      const out = JSON.parse(m[0])
      if (typeof out.plate === 'string') out.plate = out.plate.replace(/[^A-Z0-9]/gi, '').toUpperCase() || null
      return out
    } catch { return { understood: false, ask: 'Je n\'ai pas compris, tu peux répéter ?' } }
  }
  throw new Error(`Aucun modèle Anthropic disponible : ${lastErr.slice(0, 200)}`)
}
