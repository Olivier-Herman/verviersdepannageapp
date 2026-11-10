// Contrôle de la lecture du boîtier OBD, sans voiture : npx tsx --tsconfig tsconfig.json scripts/obd-elm327-check.ts
// Chaque cas part d'une réponse type (format de la documentation ELM327, en-têtes allumés).
import assert from 'node:assert/strict'
import * as E from '../src/lib/obd/elm327'
import * as C from '../src/lib/obd/calculateurs'

const codes = (raw: string, mode = 3, p: string | null = '6') => E.dtcsOf(E.parseReply(raw, mode, null, p)).map(c => c.code)

// Codes : un calculateur, deux calculateurs, message long, aucun code.
assert.deepEqual(codes('7E8 04 43 01 01 33\r\r>'), ['P0133'])
assert.deepEqual(codes('7E8 04 43 01 01 33 00 00 00\r7E9 02 43 00 00 00 00 00 00\r\r>'), ['P0133'], 'bourrage ignoré, 2e calculateur vide')
assert.deepEqual(codes('7E8 04 43 01 01 33\r7E9 04 43 01 07 00\r\r>'), ['P0133', 'P0700'])
assert.deepEqual(codes('7E8 10 0A 43 04 01 33 01 71\r7E9 02 43 00\r7E8 21 03 00 04 20 00 00 00\r\r>'), ['P0133', 'P0171', 'P0300', 'P0420'], 'trames entremêlées')
assert.deepEqual(codes('18 DA F1 10 04 43 01 01 33\r\r>', 3, '7'), ['P0133'], 'CAN 29 bits')
assert.deepEqual(codes('48 6B 10 43 01 33 01 71 00 00 AA\r\r>', 3, 'A3'), ['P0133', 'P0171'], 'ancien protocole')
assert.equal(E.parseReply('7E8 02 43 00\r\r>', 3, null, '6').status, 'ok')
assert.deepEqual(codes('7E8 02 43 00\r\r>'), [])
// Sans en-têtes (boîtier qui ignorerait ATH1).
assert.deepEqual(codes('43 01 01 33\r\r>', 3, null), ['P0133'])
assert.deepEqual(codes('00A\r0: 43 04 01 33 01\r1: 71 03 00 04 20\r\r>', 3, null), ['P0133', 'P0171', 'P0300', 'P0420'])

// Jamais de faux code : refus, réponse décalée, erreurs, silence.
assert.equal(E.parseReply('7E8 03 7F 03 11\r\r>', 3, null, '6').status, 'refus')
assert.deepEqual(codes('7E8 03 7F 03 11\r\r>'), [])
assert.equal(E.parseReply('7E8 06 41 01 00 07 E5 00\r\r>', 3, null, '6').detail, 'decalee')
assert.deepEqual(codes('7E8 06 41 01 00 07 E5 00\r\r>'), [])
for (const [raw, detail] of [[E.TIMEOUT, 'delai'], [E.LIEN_PERDU, 'lien_perdu'], ['UNABLE TO CONNECT\r\r>', 'voiture_muette'], ['BUFFER FULL\r>', 'bus'], ['7E8 04 43 01 01 33\r<DATA ERROR\r>', 'bus'], ['CAN ERROR\r>', 'bus']] as const) {
  const r = E.parseReply(raw, 3, null, '6')
  assert.equal(r.status, 'erreur', raw); assert.equal(r.detail, detail, raw); assert.deepEqual(E.dtcsOf(r), [])
}
assert.equal(E.parseReply('NO DATA\r\r>', 3, null, '6').status, 'pas_de_reponse')
assert.equal(E.parseReply('7E8 10 0A 43 04 01 33 01 71\r\r>', 3, null, '6').detail, 'corrompu', 'message long tronqué')

// Témoin : le moteur peut répondre en second, plusieurs calculateurs s'additionnent.
const mon = E.monitorOf(E.parseReply('7E9 06 41 01 00 07 E5 00\r7E8 06 41 01 83 07 E5 00\r\r>', 1, 1, '6'))!
assert.equal(mon.mil, true); assert.equal(mon.count, 3)

// Allumage et contrôles non terminés.
const m2 = E.monitorOf(E.parseReply('7E8 06 41 01 00 6D 01 01\r\r>', 1, 1, '6'))!
assert.equal(m2.allumage, 'compression')   // 0x6D : bit 3 allumé
assert.equal(E.monitorOf(E.parseReply('7E8 06 41 01 00 07 E5 00\r\r>', 1, 1, '6'))!.allumage, 'etincelle')

// Carburant : table SAE.
const fuel = (n: number) => E.fuelType(E.parseReply(`7E8 03 41 51 ${n.toString(16).padStart(2, '0')}\r\r>`, 1, 0x51, '6'))
assert.equal(fuel(4), 'diesel'); assert.equal(fuel(19), 'hybride diesel'); assert.equal(fuel(18), 'hybride éthanol'); assert.equal(fuel(0), null)

// Mesures disponibles.
const sup = E.supportedOf(E.parseReply('7E8 06 41 00 BE 3F B8 13\r\r>', 1, 0, '6'), 0)
assert.ok(sup.has(1)); assert.ok(sup.has(5)); assert.ok(sup.has(0x20)); assert.ok(!sup.has(2))

// VIN sur plusieurs trames, CAN puis ancien protocole.
const can = '7E8 10 14 49 02 01 57 30 56\r7E8 21 45 55 48 4E 53 33 4C\r7E8 22 4A 39 31 39 38 30 31\r\r>'
assert.equal(E.vinOf(E.parseReply(can, 9, 2, '6')), 'W0VEUHNS3LJ919801')
const old = ['49 02 01 00 00 00 57', '49 02 02 30 56 45 55', '49 02 03 48 4E 53 33', '49 02 04 4C 4A 39 31', '49 02 05 39 38 30 31'].map(l => `48 6B 10 ${l} AA`).join('\r') + '\r\r>'
assert.equal(E.vinOf(E.parseReply(old, 9, 2, '3')), 'W0VEUHNS3LJ919801')

// Image figée et effacement.
assert.deepEqual(E.freezeValue(E.parseReply('7E8 05 42 02 00 01 33\r\r>', 2, 2, '6')), [1, 0x33])
assert.equal(E.clearAccepted('7E8 01 44\r\r>', '6'), true)
assert.equal(E.clearAccepted('7E8 03 7F 04 22\r\r>', '6'), false)

// Verdict de la lecture.
const ok = E.parseReply('7E8 02 43 00\r\r>', 3, null, '6'), non = E.parseReply('NO DATA\r>', 3, null, '6'), err = E.parseReply(E.TIMEOUT, 3)
const premier = E.parseReply('7E8 06 41 00 BE 3F B8 13\r\r>', 1, 0, '6')
const base = { perdu: false, premier, stored: ok, pending: ok, nbStored: 0, monitor: { mil: false, count: 0, allumage: null, moniteurs: 0, non_prets: 0 } as E.Monitor }
assert.equal(E.lectureOf(base).complete, true)
assert.equal(E.lectureOf({ ...base, stored: non }).complete, true, 'silence confirmé par 0 code')
assert.equal(E.lectureOf({ ...base, stored: non, monitor: null }).complete, false)
assert.equal(E.lectureOf({ ...base, stored: err }).complete, false)
assert.equal(E.lectureOf({ ...base, premier: E.parseReply('UNABLE TO CONNECT\r>', 1, 0) }).muette, true)
assert.equal(E.lectureOf({ ...base, monitor: { ...base.monitor, mil: true } }).manques[0], 'temoin_sans_code')
assert.equal(E.lectureOf({ ...base, monitor: { ...base.monitor, count: 2 }, nbStored: 1 }).manques[0], 'codes_manquants')
assert.equal(E.lectureOf({ ...base, perdu: true }).complete, false)

// Réponses réelles du boîtier sur une Opel 2020 (D-0004, 07/11/2026) : deux calculateurs, aucun code, essence.
const reel = (raw: string, mode: number, pid: number | null = null) => E.parseReply(raw, mode, pid, 'A6')
const sReel = reel('SEARCHING...\r7E8 06 41 00 BE 3E A8 13 \r7E9 06 41 00 80 00 00 01 \r\r>', 1, 0)
assert.equal(sReel.status, 'ok'); assert.ok(E.supportedOf(sReel, 0).has(0x0c))
assert.deepEqual(E.dtcsOf(reel('7E8 02 43 00 \r7E9 02 43 00 \r\r>', 3)), [])
const mReel = E.monitorOf(reel('7E8 06 41 01 00 07 E1 00 \r7E9 06 41 01 00 04 00 00 \r\r>', 1, 1))!
assert.equal(mReel.mil, false); assert.equal(mReel.count, 0); assert.equal(mReel.allumage, 'etincelle')
assert.equal(E.fuelType(reel('7E8 03 41 51 01 \r\r>', 1, 0x51)), 'essence')
assert.equal(E.rpm(reel('7E8 04 41 0C 0D 3C \r\r>', 1, 0x0c)), 847)
assert.equal(E.word(reel('7E8 04 41 31 FF FF \r\r>', 1, 0x31)), 65535)

// Nom du calculateur (mode 09, PID 0A), sur plusieurs trames.
assert.equal(E.textOf(E.parseReply('7E8 10 0F 49 0A 01 45 43 4D\r7E8 21 00 2D 45 6E 67 69 6E\r7E8 22 65 00 00 00 00 00 00\r\r>', 9, 0x0a, '6')), 'ECM-Engine')
assert.equal(E.textOf(E.parseReply('NO DATA\r>', 9, 0x0a, '6')), null)

// Calculateur de boîte : réponse réelle de l'Opel (D-0005).
const noms = E.parseReply('7E8 10 17 49 0A 01 45 43 4D \r7E8 21 00 2D 45 6E 67 69 6E \r7E8 22 65 43 6F 6E 74 72 6F \r7E9 10 17 49 0A 01 54 43 4D \r7E8 23 6C 00 00 FF FF FF FF \r7E9 21 00 2D 54 72 61 6E 73 \r7E9 22 6D 69 73 43 74 72 6C \r7E9 23 00 00 00 FF FF FF FF \r\r>', 9, 0x0a, 'A6')
assert.equal(E.textOf(noms), 'ECM-EngineControl'); assert.equal(E.hasGearboxEcu(noms), true)
assert.equal(E.hasGearboxEcu(E.parseReply('7E8 10 0F 49 0A 01 45 43 4D\r7E8 21 00 2D 45 6E 67 69 6E\r7E8 22 65 00 00 00 00 00 00\r\r>', 9, 0x0a, '6')), false)

// Autres calculateurs (UDS 19 02) : ABS de VW à l'adresse 77D, un code confirmé, un « test pas encore fait » ignoré.
const uds = (raw: string) => E.udsDtcsOf(E.parseReply(raw, 0x19, 0x02, 'A6'))
assert.deepEqual(uds('77D 03 59 02 FF\r\r>'), [], 'calculateur sans code')
assert.deepEqual(uds('77D 0B 59 02 FF 50 10 29 09 C1 23 00 50\r\r>').map(c => [c.code, c.ecu, c.detail, c.actif, c.confirme]), [['C1010', '77D', '29', true, true]], 'état 50 = pas une panne')
assert.deepEqual(uds('77F 10 0B 59 02 FF 90 01 00\r77F 21 08 C1 23 00 04\r\r>').map(c => [c.code, c.confirme]), [['B1001', true], ['U0123', false]], 'message long (airbag)')
assert.equal(E.parseReply('77D 03 7F 19 11\r\r>', 0x19, 0x02, 'A6').status, 'refus')
assert.equal(E.parseReply('NO DATA\r\r>', 0x19, 0x02, 'A6').status, 'pas_de_reponse')
assert.deepEqual(uds('77D 03 7F 19 78\r77D 07 59 02 FF C1 23 00 09\r\r>').map(c => c.code), ['U0123'], 'réponse retardée (7F 78)')

// Groupe de marques : par le châssis d'abord (la Caddy du 09/11/2026), la marque seulement sans châssis.
assert.equal(C.groupeDe('WV1ZZZSKZMX045145'), 'vag')
assert.equal(C.groupeDe('VF1RJA00X12345678'), 'renault')
assert.equal(C.groupeDe('VF3ABCDEF12345678', 'Volkswagen'), 'psa', 'le châssis Peugeot l’emporte sur la marque écrite')
assert.equal(C.groupeDe('WBA12345678901234', 'Volkswagen'), null, 'châssis BMW : pas d’adresses VW')
assert.equal(C.groupeDe(null, 'Skoda Octavia'), 'vag')
assert.equal(C.calculateursDe(null).length, 8, 'marque inconnue : seulement 7E0 à 7E7')
assert.ok(C.calculateursDe('vag').some(c => c.tx === '713' && c.rx === '77D' && c.systeme === 'abs'))
assert.ok(C.calculateursDe('renault').some(c => c.tx === '752' && c.rx === '772' && c.systeme === 'airbag'))

// Apprentissage : Peugeot/Citroën récentes seulement, nom donné par le calculateur → système.
assert.equal(C.groupeDe('VR3UHZKXZNT123456'), 'psa')
assert.equal(C.decouverteAutorisee('VR3UHZKXZNT123456', 'psa'), true)
assert.equal(C.decouverteAutorisee('VF3XXXXXX71234567', 'psa'), false, 'avant 2010 : pas d’essai')
assert.equal(C.decouverteAutorisee('WV1ZZZSKZMX045145', 'vag'), false, 'groupe connu : pas d’essai')
assert.equal(C.systemeDeNom('ESP 9.1'), 'abs'); assert.equal(C.systemeDeNom('AIRBAG'), 'airbag'); assert.equal(C.systemeDeNom('BSI 2010'), 'carrosserie'); assert.equal(C.systemeDeNom('XYZ'), 'autre')
assert.equal(E.textOf(E.parseReply('68D 10 0A 62 F1 97 45 53 50\r68D 21 20 39 2E 31 AA AA AA\r\r>', 0x22, 0xf1, 'A6')), 'ESP 9.1', 'nom du calculateur (22 F1 97)')

console.log('OK : lecture du boîtier conforme')
