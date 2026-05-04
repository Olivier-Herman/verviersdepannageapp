// scripts/towsoft-replay.js
//
// Replay des missions police perdues durant le bug de la modale SweetAlert2 (semaine du 01/05/2026).
// Étapes :
//   1) Reset des 8 queues 'towsoft_queue' à status='pending' (effacement towsoft_mission_number et error_message).
//   2) Dispatch en parallèle de 8 workflows GitHub Actions create-towsoft-mission, chacun avec
//      le queue_id original et le payload reconstruit depuis la ligne queue.
//
// Le workflow corrigé (modale fermée + waitForFunction sur ?num=) crée la vraie mission TowSoft.
// Le callback /api/towsoft/callback met à jour le numéro TowSoft sur le ticket Odoo existant
// (odoo_ticket_id déjà présent dans la queue) et redéclenche l'impression d'étiquette.
//
// Usage :
//   node scripts/towsoft-replay.js
//
// Pré-requis :
//   - .env.local : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   - Soit GITHUB_TOKEN exporté, soit gh CLI authentifié (gh auth status).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Charger .env.local sans dépendance externe ────────────────────────
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      // Strip commentaire inline (whitespace + # ...) puis quotes éventuelles
      const value = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
      process.env[m[1]] = value;
    }
  });
}

// ── Config ───────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GITHUB_REPO  = 'Olivier-Herman/verviersdepannageapp';

let GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  try { GITHUB_TOKEN = execSync('gh auth token', { encoding: 'utf-8' }).trim(); }
  catch { /* on tombera sur le check ci-dessous */ }
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans .env.local');
  process.exit(1);
}
if (!GITHUB_TOKEN) {
  console.error('❌ GITHUB_TOKEN absent (ni en env, ni via gh auth token). Faire `gh auth login` ou exporter GITHUB_TOKEN.');
  process.exit(1);
}

// ── 8 missions à rejouer (test #9 et mission de validation 56371 exclues) ──
const QUEUE_IDS = [
  '26249e8f-0c1e-4ef5-bd3f-f20131c99b68',  // 01/05 09:32 mal_garee → ticket 1641
  'a67f328f-d13f-4c54-aa98-4a038f980892',  // 01/05 18:32 accident  → ticket 1642
  '2c3ad6a6-fbf3-4173-a77f-ab3aca69a3de',  // 01/05 18:34 accident  → ticket 1643
  '805a76d2-70f2-4916-a5f4-1069a1b1b582',  // 02/05 07:55 accident  → ticket 1644
  'e7291f23-6105-4853-9173-ffd12af527e6',  // 02/05 08:25 accident  → ticket 1646
  '41775b76-acf3-42cf-9870-cd72bb132be3',  // 03/05 07:32 accident  → ticket 1647
  '6e264ee0-6219-4ab6-8066-27fc1e910f83',  // 03/05 15:49 accident  → ticket 1648
  '7fdfd135-5e3d-41ea-803a-bd8c81955d5b',  // 03/05 17:00 saisie    → ticket 1649
];

// ── Helpers ──────────────────────────────────────────────────────────
async function getQueue(id) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/towsoft_queue?id=eq.${id}&select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  if (!r.ok) throw new Error(`Supabase GET ${r.status} ${id}`);
  const data = await r.json();
  return Array.isArray(data) ? data[0] : null;
}

async function resetQueue(id) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/towsoft_queue?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      status: 'pending',
      towsoft_mission_number: null,
      error_message: null,
      processed_at: null,
    }),
  });
  if (!r.ok) throw new Error(`Supabase PATCH ${r.status} ${id}: ${await r.text()}`);
}

async function triggerWorkflow(queue) {
  const data = {
    mission_type:      queue.mission_type,
    company:           '',
    intervention_type: '',
    date:              queue.date,
    time:              queue.time,
    plate:             queue.plate || '',
    vin:               queue.vin || '',
    brand:             queue.brand || '',
    model:             queue.model || '',
    location:          queue.location || '',
    destination:       '',
    // Si on connaît déjà le ticket Odoo lié, on l'inclut dans le dossier TowSoft
    // pour permettre le ping-pong TowSoft↔Odoo depuis n'importe quelle fiche.
    dossier_number:    queue.odoo_ticket_id ? `Encodage automatique ${queue.odoo_ticket_id}` : '',
    officer_name:      queue.officer_name || '',
    owner_first:       queue.owner_first || '',
    owner_last:        queue.owner_last || '',
    owner_phone:       queue.owner_phone || '',
    remarks:           queue.remarks || '',
    driver_name:       queue.driver_name,
    parc:              queue.parc || '',
    motif:             queue.motif || '',
  };

  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'create-towsoft-mission',
      client_payload: { queue_id: queue.id, data: JSON.stringify(data) },
    }),
  });
  if (!r.ok) throw new Error(`GH dispatch ${r.status}: ${await r.text()}`);
}

// ── Run ──────────────────────────────────────────────────────────────
(async () => {
  console.log(`🔁 Replay de ${QUEUE_IDS.length} missions perdues (bug semaine du 01/05/2026)\n`);

  console.log('📥 Reset des queues à status=pending...');
  const resetResults = await Promise.allSettled(QUEUE_IDS.map(resetQueue));
  resetResults.forEach((r, i) => {
    if (r.status === 'rejected') console.log(`  ❌ ${QUEUE_IDS[i]} → ${r.reason.message}`);
  });
  const resetOk = resetResults.filter(r => r.status === 'fulfilled').length;
  console.log(`✓ ${resetOk}/${QUEUE_IDS.length} queues reset\n`);

  if (resetOk === 0) {
    console.error('❌ Aucune queue n\'a pu être reset, abandon.');
    process.exit(1);
  }

  console.log('🚀 Dispatch des workflows GitHub Actions en parallèle...');
  const dispatchResults = await Promise.allSettled(QUEUE_IDS.map(async id => {
    const queue = await getQueue(id);
    if (!queue) throw new Error(`Queue ${id} introuvable`);
    await triggerWorkflow(queue);
    return { id, plate: queue.plate, mission_type: queue.mission_type, ticket: queue.odoo_ticket_id };
  }));

  console.log('\n📊 Résultats du dispatch :');
  dispatchResults.forEach((r, i) => {
    const id = QUEUE_IDS[i];
    if (r.status === 'fulfilled') {
      console.log(`  ✓ ${id} → ${r.value.mission_type.padEnd(10)} ${(r.value.plate || '').padEnd(10)} (ticket Odoo #${r.value.ticket})`);
    } else {
      console.log(`  ❌ ${id} → ${r.reason.message}`);
    }
  });

  const ok = dispatchResults.filter(r => r.status === 'fulfilled').length;
  console.log(`\n${ok}/${QUEUE_IDS.length} workflow(s) lancé(s) en parallèle.`);
  console.log(`👀 Suivi : https://github.com/${GITHUB_REPO}/actions/workflows/towsoft.yml`);
  console.log(`Pour vérifier en temps réel : gh run list --workflow=towsoft.yml --limit ${QUEUE_IDS.length}`);
})().catch(e => { console.error('❌ Erreur fatale :', e); process.exit(1); });
