const puppeteer = require('puppeteer');

const TOWSOFT_URL = process.env.TOWSOFT_URL;
const QUEUE_ID    = process.env.QUEUE_ID;

// Parser le payload JSON
const payload = JSON.parse(process.env.PAYLOAD_DATA || '{}');

const TYPE_CONFIG = {
  accident:  { codeService: 'Appel Police - Accident',                           parc: 'K3', motif: 'ACCIDENT' },
  saisie:    { codeService: 'Appel Police - Saisie',                             parc: 'J',  motif: 'SAISIE' },
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
  const missionType = payload.mission_type;
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
    if (payload.officer_name) {
      await page.evaluate((n) => { document.querySelector('#nom_responsable').value = n; }, payload.officer_name);
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
    await page.type('#origine', payload.location);
    await wait(2000);
    await page.keyboard.press('Escape');

    // Véhicule
    await page.evaluate((plate, brand, model, vin) => {
      if (plate) document.querySelector('#plaque').value = plate;
      if (brand) document.querySelector('#marque').value = brand;
      if (model) document.querySelector('#modele').value = model;
      if (vin)   document.querySelector('#serie').value  = vin;
    }, payload.plate, payload.brand, payload.model, payload.vin);

    // Propriétaire
    if (payload.owner_first || payload.owner_last) {
      await page.evaluate((fn, ln, ph) => {
        if (fn) document.querySelector('#prenom_beneficiaire').value   = fn;
        if (ln) document.querySelector('#nom_beneficiaire').value      = ln;
        if (ph) document.querySelector('#beneficiaireTelephone').value = ph;
      }, payload.owner_first, payload.owner_last, payload.owner_phone);
    }

    // Remarques
    if (payload.remarks) {
      await page.evaluate((r) => { document.querySelector('#remarques').value = r; }, payload.remarks);
    }

    // Dépanneuse = Balisage (value 13)
    await page.select('#remorque', '13');

    // Conducteur
    await page.evaluate((dn) => {
      const sel = document.querySelector('#chauffeur');
      const opt = [...sel.options].find(o => o.text.toLowerCase().includes(dn.toLowerCase()));
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }, payload.driver_name);

    // Soumettre — clic direct via querySelector
    const confirmBtn = await page.$('button.btn-success, a.btn-success');
    if (confirmBtn) {
      await confirmBtn.click();
    } else {
      // Fallback: chercher par texte
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button, a')];
        const btn = btns.find(b => {
          const t = b.textContent?.trim().toLowerCase() || '';
          return t.includes('confirmer') && t.includes('mission');
        });
        if (btn) btn.click();
      });
    }
    await wait(3000);
    // Screenshot pour debug
    const screenshotBuffer = await page.screenshot({ encoding: 'base64' });
    console.log('SCREENSHOT_BASE64:' + screenshotBuffer.substring(0, 100) + '...');
    const pageTitle = await page.title();
    const pageUrl = page.url();
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('Page après soumission:', pageTitle, pageUrl);
    console.log('Texte page:', pageText);
    console.log('✓ Formulaire soumis');

    // Modal parc
    const modalVisible = await page.$('#modal');
    if (modalVisible) {
      // Attendre que les selects du modal soient chargés
      await wait(1500);

      // Parc — 1er select de #formRemise
      await page.evaluate((parc) => {
        const selects = [...document.querySelectorAll('#formRemise select, #modal select')];
        console.log('Nombre de selects:', selects.length);
        const parcSelect = selects[0]; // Premier select = Informations fiche parc
        if (parcSelect) {
          const opt = [...parcSelect.options].find(o => o.text.includes(parc) || o.value.toUpperCase().includes(parc));
          if (opt) { parcSelect.value = opt.value; parcSelect.dispatchEvent(new Event('change', { bubbles: true })); console.log('Parc:', opt.text); }
        }
      }, config.parc);
      await wait(1000);

      // Motif — 2ème select de #formRemise
      await page.evaluate((motif) => {
        const selects = [...document.querySelectorAll('#formRemise select, #modal select')];
        const motifSelect = selects[1]; // Deuxième select = Motif
        if (motifSelect) {
          const opt = [...motifSelect.options].find(o => o.text.toUpperCase().includes(motif));
          if (opt) { motifSelect.value = opt.value; motifSelect.dispatchEvent(new Event('change', { bubbles: true })); console.log('Motif:', opt.text); }
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
