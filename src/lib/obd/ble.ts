// src/lib/obd/ble.ts — dialogue Bluetooth avec un boîtier OBD ELM327 (Vgate iCar Pro 2S…), dans l'app VD Soft.
// Diagnostic OBD (Olivier 05/11/2026). Côté navigateur seulement : le module natif BluetoothLe n'existe que dans la
// version de l'app qui l'embarque (test Mobi / Franck). Ailleurs, obdAvailable() est faux et rien ne s'affiche.
// Le service et les caractéristiques ne sont pas figés : on prend le premier couple « notification + écriture »
// trouvé (les boîtiers Vgate utilisent FFF0/FFF1/FFF2, d'autres E7810A71…).
'use client'

import * as E from './elm327'
import { adressesFixes, calculateursDe, ESSAIS_PAR_LECTURE, groupeDe, systemeDeNom, type Calculateur, type Groupe, type SystemeId } from './calculateurs'

type Ble = typeof import('@capacitor-community/bluetooth-le').BleClient

export interface ObdLink { deviceId: string; name: string; send: (cmd: string, timeoutMs?: number) => Promise<string>; close: () => Promise<void>; lost: () => boolean; initRaw: RawEntry[] }

export interface RawEntry { cmd: string; raw: string }
// systeme : code lu sur un autre calculateur que le moteur (ABS, airbag…), qui ne s'efface pas par le boîtier.
export type ObdCode = { code: string; type: 'memorise' | 'en_attente' | 'permanent'; ecu?: string; systeme?: SystemeId; detail?: string; actif?: boolean; nom?: string | null }
// appris : adresse venue de l'apprentissage ; decouvert : trouvée pendant cette lecture-ci.
export interface CalculateurLu { adresse: string; rx?: string | null; systeme: SystemeId; nom?: string | null; statut: 'ok' | 'absent' | 'refus' | 'erreur'; nb_codes: number; appris?: boolean; decouvert?: boolean }
// ok : tous lus ; protocole : voiture pas en CAN 11 bits ; boitier : boîtier qui refuse les réglages ; lien_perdu.
export type ScanStatut = 'ok' | 'protocole' | 'boitier' | 'lien_perdu'
export interface ObdMeasures {
  batterie_v: number | null; temp_moteur_c: number | null; regime_tr_min: number | null
  carburant?: string | null; carburant_source?: 'voiture' | 'allumage' | null
  temoin_moteur: boolean | null; nb_codes: number | null
  km_temoin_allume?: number | null; km_depuis_effacement?: number | null; demarrages_depuis_effacement?: number | null; minutes_depuis_effacement?: number | null
  calculateur_nom?: string | null; calibration?: string | null; calculateur_boite?: boolean
  kilometrage?: number | null; controles_total?: number | null; controles_non_prets?: number | null
  calculateurs?: CalculateurLu[]; calculateurs_essais?: { adresse: string; statut: string }[]; calculateurs_groupe?: Groupe | null; calculateurs_scan?: ScanStatut
}
export interface ObdFreeze { code: string; charge_pct: number | null; temp_moteur_c: number | null; regime_tr_min: number | null; vitesse_kmh: number | null }
export interface ObdReading {
  vin: string | null
  codes: ObdCode[]
  measures: ObdMeasures
  protocol: string | null
  lecture: E.Lecture
  freeze: ObdFreeze | null
  raw: RawEntry[]
}

/** Le module Bluetooth est-il dans cette version de l'app ? (jamais d'await sur un proxy de plugin) */
export async function obdAvailable(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BluetoothLe')
  } catch { return false }
}

async function client(): Promise<Ble> {
  const m = await import('@capacitor-community/bluetooth-le')
  return m.BleClient
}

const enc = new TextEncoder(), dec = new TextDecoder()
const BOITIER_MEMO = 'vd-obd-boitier'

/** Recherche le boîtier (fenêtre de choix du système), s'y connecte et prépare le dialogue ELM327. */
export async function connectObd(onStatus?: (s: string) => void): Promise<ObdLink> {
  const ble = await client()
  await ble.initialize({ androidNeverForLocation: true })
  let perdu = false
  let surPerte: (() => void) | null = null
  const onDisconnect = () => { perdu = true; surPerte?.() }
  // Le téléphone retient son boîtier : la liste de tous les appareils Bluetooth autour (illisible, « Unknown »)
  // ne s'ouvre que la première fois ou si ce boîtier ne répond pas (Olivier 07/11/2026).
  let device: { deviceId: string; name?: string } | null = null
  let memo: string | null = null
  try { memo = localStorage.getItem(BOITIER_MEMO) } catch { memo = null }
  if (memo) {
    onStatus?.('connexion')
    try {
      const [connu] = await ble.getDevices([memo])
      if (connu) {
        await Promise.race([ble.connect(connu.deviceId, onDisconnect), new Promise((_, ko) => setTimeout(() => ko(new Error('délai')), 8000))])
        device = connu
      }
    } catch { await ble.disconnect(memo).catch(() => {}) }
  }
  if (!device) {
    onStatus?.('recherche')
    device = await ble.requestDevice({ optionalServices: ['0000fff0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '000018f0-0000-1000-8000-00805f9b34fb'] })
    onStatus?.('connexion')
    await ble.connect(device.deviceId, onDisconnect)
  }
  try { localStorage.setItem(BOITIER_MEMO, device.deviceId) } catch { /* sans mémoire : la liste s'ouvrira la prochaine fois */ }
  const services = await ble.getServices(device.deviceId)
  let svc = '', rx = '', tx = ''
  for (const s of services) {
    const n = s.characteristics.find(c => c.properties.notify || c.properties.indicate)
    const w = s.characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse)
    if (n && w) { svc = s.uuid; rx = n.uuid; tx = w.uuid; if (/fff0|e7810a71|18f0/i.test(s.uuid)) break }
  }
  if (!svc) { await ble.disconnect(device.deviceId).catch(() => {}); throw new Error('Boîtier non reconnu (aucun canal de dialogue trouvé)') }
  const writeNoResp = !!services.find(s => s.uuid === svc)?.characteristics.find(c => c.uuid === tx)?.properties.writeWithoutResponse

  let buffer = '', waiter: ((s: string) => void) | null = null
  await ble.startNotifications(device.deviceId, svc, rx, (v: DataView) => {
    buffer += dec.decode(v)
    if (buffer.includes('>') && waiter) { const out = buffer; buffer = ''; const w = waiter; waiter = null; w(out) }
  })

  // Par paquets de 20 octets (taille minimale garantie en BLE). Faux si l'écriture échoue : jamais lu comme « pas de code ».
  const write = async (txt: string) => {
    const bytes = enc.encode(txt)
    try {
      for (let i = 0; i < bytes.length; i += 20) {
        const chunk = new DataView(bytes.slice(i, i + 20).buffer)
        if (writeNoResp) await ble.writeWithoutResponse(device.deviceId, svc, tx, chunk)
        else await ble.write(device.deviceId, svc, tx, chunk)
      }
      return true
    } catch { return false }
  }

  let queue = Promise.resolve('')
  const send = (cmd: string, timeoutMs = 4000) => {
    queue = queue.then(() => new Promise<string>((resolve) => {
      if (perdu) { resolve(E.LIEN_PERDU); return }
      buffer = ''
      let fini = false, t1: ReturnType<typeof setTimeout>, t2: ReturnType<typeof setTimeout>
      const finish = (s: string) => { if (fini) return; fini = true; clearTimeout(t1); clearTimeout(t2); waiter = null; surPerte = null; resolve(s) }
      surPerte = () => finish(E.LIEN_PERDU)
      // Trop long : on interrompt la commande et on attend l'invite, sinon sa réponse tardive serait prise pour la suivante.
      t1 = setTimeout(() => {
        waiter = () => finish(E.TIMEOUT)
        t2 = setTimeout(() => finish(E.TIMEOUT), 1500)
        write('\r')
      }, timeoutMs)
      waiter = finish
      write(cmd + '\r').then(ok => { if (!ok) finish(E.LIEN_PERDU) })
    }))
    return queue
  }
  const initRaw: RawEntry[] = []
  // ATH1 : chaque réponse dit quel calculateur parle. ATI, AT@1, AT@2 : identité du boîtier, gardée avec la lecture.
  for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS1', 'ATH1', 'ATSP0', 'ATI', 'AT@1', 'AT@2']) {
    const raw = await send(c, c === 'ATZ' ? 3000 : 2000)
    if (['ATZ', 'ATH1', 'ATI', 'AT@1', 'AT@2'].includes(c)) initRaw.push({ cmd: c, raw: raw.slice(0, 200) })
  }
  return { deviceId: device.deviceId, name: device.name || 'Boîtier OBD', send, lost: () => perdu, initRaw, close: async () => { await ble.stopNotifications(device.deviceId, svc, rx).catch(() => {}); await ble.disconnect(device.deviceId).catch(() => {}) } }
}

/** Lecture complète : codes, mesures disponibles, image figée. Rien n'est effacé ici. */
export async function readVehicle(link: ObdLink, onStatus?: (s: string) => void, opts?: { marque?: string | null }): Promise<ObdReading> {
  onStatus?.('lecture')
  const raw: RawEntry[] = [...link.initRaw]
  const log = async (cmd: string, timeoutMs?: number) => { const r = await link.send(cmd, timeoutMs); raw.push({ cmd, raw: r.slice(0, 1500) }); return r }
  let protocol: string | null = null
  const ask = async (cmd: string, mode: number, pid: number | null, timeoutMs = 4000, essais = 2): Promise<E.Reply> => {
    let r = E.parseReply(await log(cmd, timeoutMs), mode, pid, protocol)
    for (let i = 1; i < essais && r.status === 'erreur' && r.detail !== 'lien_perdu'; i++) r = E.parseReply(await log(cmd, timeoutMs), mode, pid, protocol)
    return r
  }

  const premierRaw = await log('0100', 10000)   // le boîtier cherche le protocole de la voiture (jusqu'à quelques secondes)
  const dpn = (await log('ATDPN', 2000)).replace(/[>\s]/g, '')
  protocol = /^A?[0-9A-C]$/i.test(dpn) ? dpn.toUpperCase() : null
  let premier = E.parseReply(premierRaw, 1, 0, protocol)
  if (premier.status !== 'ok') premier = await ask('0100', 1, 0, 10000, 1)
  const volt0 = E.parseAtVoltage(await log('ATRV', 2000))
  const vide: ObdMeasures = { batterie_v: volt0, temp_moteur_c: null, regime_tr_min: null, carburant: null, carburant_source: null, temoin_moteur: null, nb_codes: null }
  const refusVide = { status: 'pas_de_reponse' as const, messages: [] }
  if (premier.status !== 'ok') return { vin: null, codes: [], measures: vide, protocol, freeze: null, raw, lecture: E.lectureOf({ perdu: link.lost(), premier, monitor: null, stored: refusVide, pending: refusVide, nbStored: 0 }) }

  // Ce que cette voiture sait donner : « non disponible » n'est pas un échec.
  const sup = E.supportedOf(premier, 0)
  for (let base = 0x20; base <= 0xa0 && sup.has(base); base += 0x20) {
    const cmd = '01' + base.toString(16).toUpperCase().padStart(2, '0')
    E.supportedOf(await ask(cmd, 1, base), base).forEach(p => sup.add(p))
  }
  const mesure = async (pid: number) => sup.has(pid) ? ask('01' + pid.toString(16).toUpperCase().padStart(2, '0'), 1, pid) : null

  let vin = E.vinOf(await ask('0902', 9, 2, 6000))
  if (!vin && !link.lost()) vin = E.vinOf(await ask('0902', 9, 2, 8000))   // souvent lu au 2e essai (essai du 06/11/2026)
  // Nom et référence du calculateur : gardés sur la fiche, ils aideront à reconnaître le moteur (Olivier 07/11/2026).
  const nomsR = await ask('090A', 9, 0x0a, 3000, 1)
  const calculateur_nom = E.textOf(nomsR), calculateur_boite = E.hasGearboxEcu(nomsR), calibration = E.textOf(await ask('0904', 9, 4, 3000, 1))
  const monitor = E.monitorOf(await ask('0101', 1, 1))
  const storedR = await ask('03', 3, null, 6000), pendingR = await ask('07', 7, null, 6000), permR = await ask('0A', 0x0a, null, 6000)
  const stored = E.dtcsOf(storedR), pending = E.dtcsOf(pendingR), perm = E.dtcsOf(permR)
  const lecture = E.lectureOf({ perdu: link.lost(), premier, monitor, stored: storedR, pending: pendingR, nbStored: stored.length })

  const val = async <T,>(pid: number, f: (r: E.Reply) => T): Promise<T | null> => { const r = await mesure(pid); return r ? f(r) : null }
  const temp = await val(0x05, E.coolant), regime = await val(0x0c, E.rpm)
  // Carburant : ce que dit la voiture, sinon son type d'allumage ; jamais la fiche (Olivier 06/11/2026).
  let carburant = await val(0x51, E.fuelType), carburant_source: 'voiture' | 'allumage' | null = carburant ? 'voiture' : null
  if (!carburant && monitor?.allumage && sup.has(0x0c)) { carburant = monitor.allumage === 'compression' ? 'diesel' : 'essence'; carburant_source = 'allumage' }
  const volt = volt0 ?? await val(0x42, E.moduleVoltage)

  let freeze: ObdFreeze | null = null
  if (stored.length && !link.lost()) {
    const f = E.freezeValue(await ask('020200', 2, 2))
    const code = f.length >= 2 ? E.dtcFromBytes(f[0], f[1]) : null
    if (code) {
      const fz = async (pid: number) => { if (!sup.has(pid)) return [] as number[]; return E.freezeValue(await ask('02' + pid.toString(16).toUpperCase().padStart(2, '0') + '00', 2, pid)) }
      const charge = await fz(0x04), t = await fz(0x05), rp = await fz(0x0c), v = await fz(0x0d)
      freeze = { code, charge_pct: charge.length ? Math.round(charge[0] * 100 / 255) : null, temp_moteur_c: t.length ? t[0] - 40 : null, regime_tr_min: rp.length >= 2 ? Math.round((rp[0] * 256 + rp[1]) / 4) : null, vitesse_kmh: v.length ? v[0] : null }
    }
  }

  const vus = new Set<string>()
  const liste = (l: { code: string; ecu: string }[], type: ObdCode['type']): ObdCode[] => l.filter(c => !vus.has(c.code) && vus.add(c.code)).map(c => ({ code: c.code, type, ecu: c.ecu }))
  const codesMoteur = [...liste(stored, 'memorise'), ...liste(pending, 'en_attente'), ...liste(perm, 'permanent')]
  onStatus?.('calculateurs')
  const autres = await lireCalculateurs(link, protocol, vin, groupeDe(vin, opts?.marque), raw)
  return {
    vin, protocol, lecture, freeze, raw,
    // Un code déjà lu par le mode 03 n'est pas répété ; ceux des autres calculateurs gardent leur système.
    codes: [...codesMoteur, ...autres.codes.filter(c => !(c.systeme === 'moteur' && vus.has(c.code)))],
    measures: {
      calculateurs: autres.lus, calculateurs_essais: autres.essais, calculateurs_groupe: autres.groupe, calculateurs_scan: autres.scan,
      batterie_v: volt, temp_moteur_c: temp, regime_tr_min: regime, carburant, carburant_source, calculateur_nom, calibration, calculateur_boite,
      temoin_moteur: monitor?.mil ?? null, nb_codes: monitor?.count ?? null,
      km_temoin_allume: await val(0x21, E.word), km_depuis_effacement: await val(0x31, E.word),
      demarrages_depuis_effacement: await val(0x30, r => E.valueOf(r)[0] ?? null), minutes_depuis_effacement: await val(0x4e, E.word),
      kilometrage: await val(0xa6, E.odometer), controles_total: monitor?.moniteurs ?? null, controles_non_prets: monitor?.non_prets ?? null,
    },
  }
}

/** Ce que le serveur a appris pour ce groupe de marques : adresses confirmées, et quelques adresses à essayer. */
async function planCalculateurs(vin: string | null, groupe: Groupe | null): Promise<{ appris: Calculateur[]; essais: string[] }> {
  if (!groupe) return { appris: [], essais: [] }
  try {
    const r = await fetch(`/api/obd/calculateurs?groupe=${groupe}${vin ? `&vin=${vin}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    const j = await r.json()
    return { appris: Array.isArray(j.appris) ? j.appris : [], essais: Array.isArray(j.essais) ? j.essais : [] }
  } catch { return { appris: [], essais: [] } }   // hors réseau : on lit ce qui est connu d'office
}

const nomDe = (r: E.Reply) => { const t = E.textOf(r); return t ? t.replace(/\s+/g, ' ').slice(0, 40) : null }

/**
 * Tous les autres calculateurs (ABS, airbag, tableau de bord…), en lecture seule (UDS 19 02 FF), un par un.
 * CAN 11 bits seulement : les en-têtes et le contrôle de flux sont réglés pour chaque adresse, puis remis comme avant
 * (le mode 04 et la relecture du moteur repartent vers toutes les adresses). Rien n'est jamais effacé ici.
 * Apprentissage (Olivier 10/11/2026) : quelques adresses de plus sont essayées à chaque lecture (« qui es-tu ? », 22 F1 97) ;
 * celles qui répondent sont lues aussitôt et enregistrées par le serveur, qui les lira d'office une fois confirmées.
 */
async function lireCalculateurs(link: ObdLink, protocol: string | null, vin: string | null, groupe: Groupe | null, raw: RawEntry[]): Promise<{ codes: ObdCode[]; lus: CalculateurLu[]; essais: { adresse: string; statut: string }[]; groupe: Groupe | null; scan: ScanStatut }> {
  const vide = (scan: ScanStatut) => ({ codes: [], lus: [], essais: [], groupe, scan })
  if (link.lost()) return vide('lien_perdu')
  if (!/^A?[68]$/i.test(protocol || '')) return vide('protocole')
  const plan = await planCalculateurs(vin, groupe)
  // Réglages du boîtier : seul un refus est gardé dans le journal (il est limité en taille).
  const ok = async (cmd: string) => { const r = await link.send(cmd, 2000); if (/OK/i.test(r)) return true; raw.push({ cmd, raw: r.slice(0, 200) }); return false }
  const ask = async (cmd: string, label: string, garder = true) => { const r = await link.send(cmd, 3000); if (garder) raw.push({ cmd: label, raw: r.slice(0, 1500) }); return r }
  // Contrôle de flux réglé à la main : l'ELM327 refuse « FC SM 1 » (« ? ») tant que l'en-tête ET les données du
  // contrôle de flux ne sont pas définis. L'en-tête n'était posé qu'ensuite, adresse par adresse : tous les boîtiers
  // refusaient (Vlink, Olivier 10/11/2026, D-0011). Un boîtier qui refuse quand même garde son contrôle de flux
  // automatique : on lit alors tout de même chaque calculateur (les réponses courtes passent), au lieu de tout sauter.
  const fcManuel = (await ok('ATFCSH7E0')) && (await ok('ATFCSD300000')) && (await ok('ATFCSM1'))
  if (!fcManuel) await link.send('ATFCSM0', 2000)
  const codes: ObdCode[] = [], lus: CalculateurLu[] = [], essais: { adresse: string; statut: string }[] = []
  // Adresse sans réponse connue : on écoute toute la plage de diagnostic (600 à 7FF) et l'en-tête dit qui répond.
  const viser = async (c: { tx: string; rx: string }) => (await ok('ATSH' + c.tx)) && (await ok(c.rx ? 'ATCRA' + c.rx : 'ATCF600') && (c.rx || await ok('ATCM600'))) && (!fcManuel || await ok('ATFCSH' + c.tx))
  const lireCodes = async (c: Calculateur, nom: string | null) => {
    const r = E.parseReply(await ask('1902FF', `${c.tx} 1902FF`), 0x19, 0x02, protocol)
    const l = r.status === 'ok' ? E.udsDtcsOf(r) : []
    const systeme = c.systeme !== 'autre' ? c.systeme : systemeDeNom(nom)
    for (const d of l) codes.push({ code: d.code, type: d.confirme || d.actif ? 'memorise' : 'en_attente', ecu: d.ecu, systeme, detail: d.detail, actif: d.actif, nom })
    return { r, l, systeme }
  }
  try {
    for (const c of calculateursDe(groupe, plan.appris)) {
      if (link.lost()) break
      const appris = !adressesFixes(groupe).has(c.tx)
      if (!(await viser(c))) { lus.push({ adresse: c.tx, systeme: c.systeme, statut: 'erreur', nb_codes: 0, appris }); continue }
      const { r, l, systeme } = await lireCodes(c, c.nom || null)
      // Une adresse commune muette (7E2…7E7) n'existe simplement pas sur cette voiture : on ne la garde pas.
      if (r.status === 'pas_de_reponse' && systeme === 'autre') continue
      lus.push({ adresse: c.tx, rx: r.messages[0]?.ecu || c.rx || null, systeme, nom: c.nom || null, statut: r.status === 'ok' ? 'ok' : r.status === 'pas_de_reponse' ? 'absent' : r.status === 'refus' ? 'refus' : 'erreur', nb_codes: l.length, appris })
      if (appris) { await ok('ATCRA') }
    }
    const fixes = new Set(calculateursDe(groupe, plan.appris).map(c => c.tx))
    for (const tx of plan.essais.filter(t => /^[67][0-9A-F]{2}$/.test(t) && !fixes.has(t)).slice(0, ESSAIS_PAR_LECTURE)) {
      if (link.lost()) break
      if (!(await viser({ tx, rx: '' }))) { essais.push({ adresse: tx, statut: 'erreur' }); continue }
      const raw22 = await link.send('22F197', 2500)
      const q = E.parseReply(raw22, 0x22, 0xf1, protocol)
      if (q.status === 'pas_de_reponse' || (q.status === 'erreur' && q.detail === 'delai')) { essais.push({ adresse: tx, statut: 'absent' }); continue }
      if (q.status !== 'ok' && q.status !== 'refus') { essais.push({ adresse: tx, statut: 'erreur' }); continue }
      raw.push({ cmd: `${tx} 22F197`, raw: raw22.slice(0, 600) })
      // Il répond : on lit ses codes tout de suite, et on le montre au chauffeur comme les autres.
      const nom = q.status === 'ok' ? nomDe(q) : null
      const { r, l, systeme } = await lireCodes({ tx, rx: '', systeme: 'autre' }, nom)
      lus.push({ adresse: tx, rx: q.messages[0]?.ecu || r.messages[0]?.ecu || null, systeme, nom, statut: r.status === 'ok' ? 'ok' : r.status === 'refus' ? 'refus' : 'erreur', nb_codes: l.length, appris: true, decouvert: true })
    }
  } finally {
    for (const cmd of ['ATCRA', 'ATFCSM0', 'ATSH7DF']) await link.send(cmd, 2000)
  }
  return { codes, lus, essais, groupe, scan: link.lost() ? 'lien_perdu' : 'ok' }
}

/** Le moteur tourne-t-il ? Certaines voitures n'acceptent l'effacement que contact mis, moteur coupé. */
export async function moteurTourne(link: ObdLink, protocol: string | null): Promise<boolean> {
  const r = E.rpm(E.parseReply(await link.send('010C'), 1, 0x0c, protocol))
  return (r ?? 0) > 0
}

export type ClearResult = 'ok' | 'partiel' | 'refuse' | 'lien_perdu' | 'non_verifie'

/** Effacement (mode 04), après la signature par PIN validée par le serveur, puis relecture : « accepté » ne prouve pas « effacé ». */
export async function clearCodes(link: ObdLink, protocol: string | null): Promise<{ result: ClearResult; reste: string[]; raw: RawEntry[] }> {
  const raw: RawEntry[] = []
  const r04 = await link.send('04', 8000); raw.push({ cmd: '04', raw: r04.slice(0, 500) })
  if (r04.includes(E.LIEN_PERDU)) return { result: 'lien_perdu', reste: [], raw }
  if (!E.clearAccepted(r04, protocol)) return { result: 'refuse', reste: [], raw }
  const r03 = await link.send('03', 6000); raw.push({ cmd: '03', raw: r03.slice(0, 1500) })
  const rep = E.parseReply(r03, 3, null, protocol)
  if (rep.status === 'erreur' || rep.status === 'refus') return { result: 'non_verifie', reste: [], raw }
  const reste = E.dtcsOf(rep).map(c => c.code)
  return { result: reste.length ? 'partiel' : 'ok', reste, raw }
}
