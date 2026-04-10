const puppeteer = require('puppeteer');

const TOWSOFT_URL = process.env.TOWSOFT_URL;
const QUEUE_ID    = process.env.QUEUE_ID;

const TYPE_CONFIG = {
  accident:  { codeService: 'Appel Police - Accident',                           parc: 'K3', motif: 'ACCIDENT' },
  saisie:    { codeService: 'Appel Police - Saisie (Cyclo, voiture, camionette)', parc: 'J',  motif: 'SAISIE' },
  mal_garee: { codeService: 'Appel Police - Mal Garée',                           parc: 'L',  motif: 'MAL GARÉE' },
  snc:       { codeService: 'Siabis Non Couvert - Remorquage avec balisage',      parc: 'K2', motif: 'SIABIS NON COUVERT' },
};

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function updateQueue(status, missionNumber, error) {
  const body = { status, processed_at: new Date().toISOString() };
  if (missionNumber) body.towsoft_mission_number = missionNumber;
  if (error)         body.error_message = error;

  await fetch(`${process.env.SUPABASE_URL}/rest/v1/towsoft_queue?id=eq.${QUEUE_ID}`, {
    method: 'PATCH',
    headers: {
      'Content-Type':  'application/json',
      'apikey':         process.env.SUPABASE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

(async () => {
  const missionType = process.env.MISSION_TYPE;
  const config = TYPE_CONFIG[missionType];
  if (!config) {
    await updateQueue('error', null, `Type inconnu: ${missionType}`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setDefaultTimeout(60000);

  try {
    // Login
    await page.goto(`${TOWSOFT_URL}/auth/login`, { waitUntil: 'networkidle0' });
    await page.type('#nomusager', process.env.TOWSOFT_USER);
    await page.type('#passusager', process.env.TOWSOFT_PASS);
    await page.click('[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    console.log('✓ Connecté');

    await page.goto(`${TOWSOFT_URL}/appel-ajouter5.php`, { waitUntil: 'networkidle0' });

    // Répartir = En parc
    await page.select('#dispatch', '3');
    await wait(500);

    // Facturé à = Clients divers
    await page.click('#recherche_client');
    await page.type('#recherche_client', 'Clients divers');
    await wait(2000);
    const c = await page.$('.ui-autocomplete li.ui-menu-item');
    if (c) await c.click();

    // N° dossier
    await page.evaluate(() => { document.querySelector('#numero_dossier').value = 'Encodage automatique'; });

    // Nom responsable
    if (process.env.OFFICER_NAME) {
      await page.evaluate((n) => { document.querySelector('#nom_responsable').value = n; }, process.env.OFFICER_NAME);
    }

    // Code service
    await page.click('#nom_service', { clickCount: 3 });
    await page.type('#nom_service', config.codeService);
    await wait(2000);
    const s = await page.$('.ui-autocomplete li.ui-menu-item');
    if (s) await s.click();

    // Nature intervention
    await page.select('#natureIntervention', 'REMORQUAGE_RELIVRAISON');

    // Lieu d'intervention
    await page.click('#origine');
    await page.type('#origine', process.env.LOCATION);
    await wait(2000);
    await page.keyboard.press('Escape');

    // Véhicule
    await page.evaluate((plate, brand, model, vin) => {
      if (plate) document.querySelector('#plaque').value = plate;
      if (brand) document.querySelector('#marque').value = brand;
      if (model) document.querySelector('#modele').value = model;
      if (vin)   document.querySelector('#serie').value  = vin;
    }, process.env.PLATE, process.env.BRAND, process.env.MODEL, process.env.VIN);

    // Propriétaire
    if (process.env.OWNER_FIRST || process.env.OWNER_LAST) {
      await page.evaluate((fn, ln, ph) => {
        if (fn) document.querySelector('#prenom_beneficiaire').value   = fn;
        if (ln) document.querySelector('#nom_beneficiaire').value      = ln;
        if (ph) document.querySelector('#beneficiaireTelephone').value = ph;
      }, process.env.OWNER_FIRST, process.env.OWNER_LAST, process.env.OWNER_PHONE);
    }

    // Remarques
    if (process.env.REMARKS) {
      await page.evaluate((r) => { document.querySelector('#remarques').value = r; }, process.env.REMARKS);
    }

    // Dépanneuse = Balisage (value 13)
    await page.select('#remorque', '13');

    // Conducteur
    await page.evaluate((dn) => {
      const sel = document.querySelector('#chauffeur');
      const opt = [...sel.options].find(o => o.text.toLowerCase().includes(dn.toLowerCase()));
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }, process.env.DRIVER_NAME);

    // Soumettre
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button,a')].find(b =>
        b.textContent.trim().toLowerCase().includes('confirmer la mission'));
      if (btn) btn.click();
    });
    await wait(3000);
    console.log('✓ Formulaire soumis');

    // Modal parc
    const modalVisible = await page.$('#modal');
    if (modalVisible) {
      // Parc
      await page.evaluate((parc) => {
        const selects = [...document.querySelectorAll('#formRemise select')];
        for (const sel of selects) {
          const opt = [...sel.options].find(o => o.text.includes(parc));
          if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); break; }
        }
      }, config.parc);
      await wait(500);

      // Motif
      await page.evaluate((motif) => {
        const selects = [...document.querySelectorAll('#formRemise select')];
        for (const sel of selects) {
          const opt = [...sel.options].find(o => o.text.toUpperCase().includes(motif));
          if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); break; }
        }
      }, config.motif);
      await wait(500);

      // Soumettre le modal
      await page.click('#remiserSubmitButton');
      await wait(3000);
      console.log('✓ Mise en parc effectuée');
    }

    // Récupérer le numéro de mission
    const missionNumber = await page.evaluate(() => {
      const match = document.body.innerText.match(/SVR-(\d+)/);
      return match ? match[0] : null;
    });
    console.log('✓ Mission TowSoft:', missionNumber);

    await updateQueue('done', missionNumber, null);
    console.log('✓ Queue mise à jour');

  } catch (err) {
    console.error('❌ Erreur:', err.message);
    await updateQueue('error', null, err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
