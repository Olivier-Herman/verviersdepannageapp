const puppeteer = require('puppeteer');

const TOWSOFT_URL = process.env.TOWSOFT_URL;
const QUEUE_ID    = process.env.QUEUE_ID;

const payload = JSON.parse(process.env.PAYLOAD_DATA || '{}');

const TYPE_CONFIG = {
  accident:    { codeService: 'Appel Police - Accident',                        parc: 'K3',                               motif: 'ACCIDENT',           dispatch: '3' },
  saisie:      { codeService: 'Appel Police - Saisie',                          parc: 'J',                                motif: 'SAISIE',             dispatch: '3' },
  mal_garee:   { codeService: 'Appel Police - Mal Garée',                        parc: 'L - Fourrière - Zone L Mal Garée', motif: 'MAL GARÉE',          dispatch: '3' },
  snc:         { codeService: 'Siabis Non Couvert - Remorquage avec balisage',  parc: 'K2',                               motif: 'SIABIS NON COUVERT', dispatch: '3' },
  appel_prive: { codeService: 'Appel Police - Accident',                        parc: 'K3',                               motif: 'APPEL PRIVE',         dispatch: '3' },
  // AVP : parc + motif confirmés côté src/app/api/towsoft/create/route.ts.
  // codeService non spécifié côté Next → valeur héritée par analogie avec appel_prive (TowSoft route les "Appel Police - Accident" vers les sous-types). À VALIDER avec un test réel.
  avp:         { codeService: 'Appel Police - Accident',                        parc: 'J',                                motif: 'ABANDON',            dispatch: '3' },
};

const ASSISTANCE_COMPANY = {
  touring: { client: 'Touring SA',                        dsp: 'TOURING - DEPANNAGE',                    rem: 'TOUREM TOURING - REMORQUAGE' },
  vab:     { client: 'VAB NV',                            dsp: 'VAB - DEPANNAGE SURPLACE (APD 07/2024)', rem: 'VAB - REMORQUAGE (APD 07/2024)' },
  ima:     { client: 'IMA BENELUX',                       dsp: 'IMA BENELUX - DEPANNAGE SURPLACE',       rem: 'IMA BENELUX - REMORQUAGE' },
  mondial: { client: 'AWP Automatique Dispatch',          dsp: 'MONDIAL - DSP',                          rem: 'MONDIAL - REMORQUAGE' },
  ipa:     { client: 'Inter Partner Assistance (007928)', dsp: 'IPA - DEPANNAGE SURPLACE',               rem: 'IPA - REMORQUAGE' },
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

// Taper dans un champ lettre par lettre (simule un vrai utilisateur)
async function typeInField(page, selector, value) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) { el.value = ''; el.focus(); }
  }, selector);
  await page.type(selector, value, { delay: 50 });
}

// Sélectionner dans un autocomplete jQuery UI
async function selectAutocomplete(page, inputSelector, value) {
  await typeInField(page, inputSelector, value);
  await wait(2500);
  const clicked = await page.evaluate(() => {
    const item = document.querySelector('.ui-autocomplete li.ui-menu-item');
    if (item) { item.click(); return true; }
    return false;
  });
  console.log(`Autocomplete ${inputSelector}: ${clicked ? '✓' : '⚠️ non trouvé'}`);
  return clicked;
}

// Sélectionner dans un Select2
async function selectSelect2(page, containerId, value) {
  // Ouvrir le dropdown en cliquant le SPAN à l'intérieur
  await page.evaluate((id) => {
    const container = document.getElementById(id);
    if (container) {
      const span = container.querySelector('span');
      if (span) span.click();
      else container.click();
    }
  }, containerId);
  await wait(800);
  // Chercher et cliquer l'option
  const clicked = await page.evaluate((val) => {
    const results = document.querySelector('.select2-results__options, .select2-dropdown ul');
    if (!results) return false;
    const opts = [...results.querySelectorAll('li')];
    const opt = opts.find(o => o.textContent.toLowerCase().includes(val.toLowerCase()));
    if (opt) { opt.click(); return true; }
    return false;
  }, value);
  console.log(`Select2 ${containerId}: ${clicked ? '✓' : '⚠️ non trouvé'}`);
  return clicked;
}

(async () => {
  const missionType      = payload.mission_type;
  const company          = payload.company;
  const interventionType = payload.intervention_type;
  const isAssistance     = missionType === 'assistance';

  let towsoftClient, codeService, dispatchValue, useParc, parc, motif;

  if (isAssistance) {
    const cc = ASSISTANCE_COMPANY[company];
    if (!cc) { await updateQueue('error', null, `Compagnie inconnue: ${company}`); process.exit(1); }
    towsoftClient = cc.client;
    codeService   = interventionType === 'dsp' ? cc.dsp : cc.rem;
    dispatchValue = '3'; // Toujours En parc pour assistance
    useParc       = true;
    if (interventionType === 'rem_parc') {
      parc  = 'K - Relivraison - Zone K';
      motif = 'A Relivrer';
    } else {
      parc  = '112 - CAPTURE ECRAN';
      motif = interventionType === 'dsp' ? 'DSP' : 'REM';
    }
  } else {
    const config = TYPE_CONFIG[missionType];
    if (!config) { await updateQueue('error', null, `Type inconnu: ${missionType}`); process.exit(1); }
    towsoftClient = 'Clients divers';
    codeService   = config.codeService;
    dispatchValue = config.dispatch;
    useParc       = true;
    parc          = config.parc;
    motif         = config.motif;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    protocolTimeout: 120000,
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
    console.log('✓ Page formulaire chargée');

    // Fermer toute modale SweetAlert2 affichée à l'ouverture (depuis ~01/05/2026 TowSoft
    // affiche un bandeau "Avis important concernant votre abonnement" qui interceptait
    // les clics et bloquait silencieusement le submit du formulaire mission).
    const modalsClosed = await page.evaluate(() => {
      let n = 0;
      if (window.Swal && typeof window.Swal.close === 'function') { window.Swal.close(); n++; }
      document.querySelectorAll('.swal2-confirm, .swal2-close, .swal2-cancel').forEach(b => { b.click(); n++; });
      // Fallback : retire tout overlay résiduel
      document.querySelectorAll('.swal2-container, .swal2-backdrop-show').forEach(el => el.remove());
      return n;
    });
    if (modalsClosed > 0) console.log(`✓ ${modalsClosed} modale(s) SweetAlert2 fermée(s)`);
    await wait(500);

    // Répartir
    await page.evaluate((val) => {
      const el = document.querySelector('#dispatch');
      if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }
    }, dispatchValue);
    console.log('✓ Dispatch:', dispatchValue);
    await wait(500);

    // Client (autocomplete)
    await selectAutocomplete(page, '#recherche_client', towsoftClient);
    await wait(500);

    // N° dossier → champ #po (pas #numero_dossier !)
    const dossierValue = payload.dossier_number || 'Encodage automatique';
    await page.evaluate((val) => {
      const el = document.querySelector('#po');
      if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }
    }, dossierValue);
    console.log('✓ Dossier (#po):', dossierValue);

    // Prénom bénéficiaire
    if (payload.owner_first) {
      await typeInField(page, '#prenom_beneficiaire', payload.owner_first);
    }

    // Nom bénéficiaire
    if (payload.owner_last) {
      await typeInField(page, '#nom_beneficiaire', payload.owner_last);
    }

    // Téléphone bénéficiaire
    if (payload.owner_phone) {
      await typeInField(page, '#beneficiaireTelephone', payload.owner_phone);
    }

    // Dépanneuse — via le select natif #remorque + trigger Select2
    await page.evaluate(() => {
      const el = document.querySelector('#remorque');
      if (el) {
        el.value = '13'; // Balisage 01
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // Trigger Select2 update
        if (window.$ && $(el).data('select2')) $(el).trigger('change');
      }
    });
    console.log('✓ Dépanneuse (Balisage)');
    await wait(300);

    // Conducteur — via le select natif #chauffeur
    await page.evaluate((dn) => {
      const sel = document.querySelector('#chauffeur');
      if (sel) {
        const opt = [...sel.options].find(o => o.text.toLowerCase().includes(dn.toLowerCase()));
        if (opt) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          if (window.$ && $(sel).data('select2')) $(sel).trigger('change');
          console.log('Conducteur:', opt.text);
        }
      }
    }, payload.driver_name);
    console.log('✓ Conducteur sélectionné');
    await wait(300);

    // Code service (autocomplete)
    await selectAutocomplete(page, '#nom_service', codeService);
    await wait(500);

    // Nature intervention — laissée automatique selon code service

    // Lieu d'intervention — comme le script police (click + type + Escape)
    await page.click('#origine');
    await page.type('#origine', payload.location);
    await wait(2000);
    await page.keyboard.press('Escape');
    await wait(500);
    console.log('✓ Lieu:', payload.location);

    // Destination (REM / REM+Parc)
    if (payload.destination) {
      await page.click('#destination');
      await page.type('#destination', payload.destination);
      await wait(2000);
      await page.keyboard.press('Escape');
      await wait(500);
      console.log('✓ Destination:', payload.destination);
      // Attendre que TomTom finisse ses calculs
      await wait(4000);
    }

    // Véhicule
    await page.evaluate((plate, brand, model, vin) => {
      if (plate) document.querySelector('#plaque').value  = plate;
      if (brand) document.querySelector('#marque').value  = brand;
      if (model) document.querySelector('#modele').value  = model;
      if (vin)   document.querySelector('#serie').value   = vin;
    }, payload.plate, payload.brand, payload.model, payload.vin);
    console.log('✓ Véhicule');

    // Remarques (TEXTAREA)
    if (payload.remarks) {
      await page.evaluate((r) => {
        const el = document.querySelector('#remarques');
        if (el) { el.value = r; el.dispatchEvent(new Event('change', { bubbles: true })); }
      }, payload.remarks);
      console.log('✓ Remarques');
    }

    // Nom responsable (police uniquement)
    if (payload.officer_name) {
      await page.evaluate((n) => {
        const el = document.querySelector('#nom_responsable');
        if (el) el.value = n;
      }, payload.officer_name);
    }

    // Soumettre — même approche que script police
    console.log('→ Soumission...');

    // === DIAGNOSTIC AVANT SUBMIT ===
    console.log('========== DIAGNOSTIC AVANT SUBMIT ==========');
    const urlBeforeSubmit = page.url();
    console.log('URL avant submit:', urlBeforeSubmit);
    await page.screenshot({ path: 'debug-before-submit.png', fullPage: true });
    console.log('Screenshot avant submit sauvé');

    const buttonState = await page.evaluate(() => {
      const b = document.querySelector('#triggerSubmitAppelAjouterForm');
      if (!b) return { exists: false };
      return {
        exists: true,
        disabled: b.disabled,
        visible: b.offsetParent !== null,
        text: (b.innerText || b.value || '').substring(0, 100),
        tagName: b.tagName,
        type: b.type,
        onclick: b.getAttribute('onclick'),
      };
    });
    console.log('Bouton submit:', JSON.stringify(buttonState));

    const formInfo = await page.evaluate(() => {
      const form = document.querySelector('form');
      if (!form) return { exists: false };
      const fields = Array.from(form.querySelectorAll('input, select, textarea'))
        .filter(f => f.name && !['hidden'].includes(f.type))
        .map(f => ({ name: f.name, type: f.type, value: (f.value || '').substring(0, 80), required: f.required }));
      return { exists: true, action: form.action, method: form.method, fieldCount: fields.length, fields };
    });
    console.log('Form (premiers 30 champs):', JSON.stringify({ ...formInfo, fields: formInfo.fields?.slice(0, 30) }));
    console.log('=============================================');

    // Submit en JS direct (bypass tout overlay résiduel qui intercepterait le clic souris)
    await page.evaluate(() => {
      const btn = document.getElementById('triggerSubmitAppelAjouterForm');
      if (btn) btn.click();
    });
    await wait(5000);

    // === DIAGNOSTIC APRÈS SUBMIT ===
    console.log('========== DIAGNOSTIC APRÈS SUBMIT ==========');
    await page.screenshot({ path: 'debug-after-submit.png', fullPage: true });
    console.log('Screenshot après submit sauvé');
    const urlAfterSubmit = page.url();
    console.log('URL après submit:', urlAfterSubmit);
    console.log('URL identique avant/après ?', urlBeforeSubmit === urlAfterSubmit);
    console.log('Page title:', await page.title());

    const bodyText = await page.evaluate(() => document.body.innerText || '');
    console.log('Body text (2500 premiers chars):', bodyText.substring(0, 2500));

    const alertsAndModals = await page.evaluate(() => {
      const selectors = ['.alert', '.alert-danger', '.alert-warning', '.error', '.modal.show', '.modal[style*="display: block"]', '.swal2-popup', '[role="alert"]', '.has-error', '.field-validation-error'];
      const found = [];
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          const txt = (el.innerText || '').trim();
          if (txt) found.push({ selector: sel, text: txt.substring(0, 400) });
        });
      });
      return found;
    });
    console.log('Alertes / modales / erreurs:', JSON.stringify(alertsAndModals));

    const urlMatch = urlAfterSubmit.match(/num=(\d+)/);
    console.log('Numéro trouvé dans URL après submit:', urlMatch ? urlMatch[1] : 'AUCUN');
    console.log('=============================================');

    console.log('✓ Formulaire soumis');
    console.log('URL:', page.url());

    // Modal parc (uniquement si useParc)
    if (useParc) {
      const modalVisible = await page.$('#modal, #formRemise');
      if (modalVisible) {
        await wait(1500);
        // Parc
        await page.evaluate((parcValue) => {
          const selects = [...document.querySelectorAll('#formRemise select, #modal select')];
          const parcSelect = selects[0];
          if (parcSelect) {
            const opt = [...parcSelect.options].find(o => o.text.includes(parcValue) || o.value.toUpperCase().includes(parcValue));
            if (opt) { parcSelect.value = opt.value; parcSelect.dispatchEvent(new Event('change', { bubbles: true })); console.log('Parc:', opt.text); }
          }
        }, parc);
        await wait(1000);
        // Motif
        await page.evaluate((motifValue) => {
          const selects = [...document.querySelectorAll('#formRemise select, #modal select')];
          const motifSelect = selects[1];
          if (motifSelect) {
            // Chercher correspondance exacte d'abord, puis partielle
            const opts = [...motifSelect.options];
            const opt = opts.find(o => o.text.toUpperCase() === motifValue)
                     || opts.find(o => o.text.toUpperCase() === motifValue.toUpperCase());
            if (opt) { motifSelect.value = opt.value; motifSelect.dispatchEvent(new Event('change', { bubbles: true })); console.log('Motif:', opt.text); }
          }
        }, motif);
        await wait(500);
        await page.evaluate(() => {
          const btn = document.getElementById('remiserSubmitButton');
          if (btn) btn.click();
        });
        await wait(3000);
        console.log('✓ Mise en parc effectuée');
      }
    }

    // === CAPTURE STRICTE — bug semaine du 01/05/2026 ===
    // On ne fait confiance QU'à l'URL après submit
    // + on vérifie que l'URL a CHANGÉ (sinon = formulaire pas soumis, numéro pré-réservé fantôme)
    const captureResult = {
      number: urlAfterSubmit.match(/num=(\d+)/)?.[1] || null,
      urlChanged: urlBeforeSubmit !== urlAfterSubmit,
      url: urlAfterSubmit,
    };

    console.log('Capture résultat:', JSON.stringify(captureResult));

    // IMPORTANT : on ne se fie plus à la regex DOM "de mission XXXXX" ni "de livraison XXXXX"
    // Ces fallbacks captaient n'importe quel numéro qui traînait dans le DOM (cause du bug week-end).

    if (!captureResult.number) {
      console.error('❌ Numéro mission absent de l\'URL après submit');
      await updateQueue('error', null, `Création TowSoft échouée - numéro absent de l'URL. URL: ${captureResult.url}`);
      process.exit(1);
    }

    if (!captureResult.urlChanged) {
      console.error('❌ URL identique avant/après submit - formulaire probablement pas soumis');
      await updateQueue('error', null, `Création TowSoft échouée - URL inchangée après submit (numéro ${captureResult.number} probablement pré-réservé fantôme). URL: ${captureResult.url}`);
      process.exit(1);
    }

    const missionNumber = captureResult.number;
    console.log('✓ Mission TowSoft:', missionNumber);

    await updateQueue('done', missionNumber, null);
    console.log('✓ Queue mise à jour');

    // Callback Odoo
    if (missionNumber) {
      try {
        const appUrl = 'https://app.verviersdepannage.com';
        const cbRes = await fetch(`${appUrl}/api/towsoft/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queue_id:       process.env.QUEUE_ID,
            mission_number: missionNumber,
            secret:         process.env.TOWSOFT_CALLBACK_SECRET,
            print_label:    isAssistance ? interventionType === 'rem_parc' : true,
          }),
        });
        const cbData = await cbRes.json();
        console.log('✓ Callback Odoo:', cbData.ok ? 'OK' : cbData.error);
      } catch (e) {
        console.error('❌ Callback Odoo échec:', e.message);
      }
    }

  } catch (err) {
    console.error('❌ Erreur:', err.message);
    await updateQueue('error', null, err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
