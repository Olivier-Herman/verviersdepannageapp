const puppeteer = require('puppeteer');
const TOWSOFT_URL = 'https://verviers.towsoft.ca';
async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({ headless: false, slowMo: 100, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setDefaultTimeout(60000);

  await page.goto(`${TOWSOFT_URL}/auth/login`, { waitUntil: 'networkidle0' });
  await page.type('#nomusager', 'VDBot');
  await page.type('#passusager', '!Verviers4800');
  await page.click('[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  await page.goto(`${TOWSOFT_URL}/appel-ajouter5.php`, { waitUntil: 'networkidle0' });

  // Remplir juste le minimum et soumettre avec dispatch=3
  await page.select('#dispatch', '3');
  await wait(500);
  await page.click('#recherche_client');
  await page.type('#recherche_client', 'Clients divers');
  await wait(2000);
  const c = await page.$('.ui-autocomplete li.ui-menu-item');
  if (c) await c.click();
  await page.evaluate(() => { document.querySelector('#plaque').value = '1TEST002'; });
  await page.select('#remorque', '13');

  // Soumettre
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button,a')].find(b => b.textContent.toLowerCase().includes('confirmer la mission'));
    if (btn) { console.log('Btn trouvé:', btn.textContent); btn.click(); }
  });
  await wait(3000);
  await page.screenshot({ path: 'after-confirm.png' });

  // Inspecter tout le DOM du modal
  const info = await page.evaluate(() => {
    // Chercher tous les modals possibles
    const modals = [...document.querySelectorAll('[class*="modal"], [id*="modal"], [id*="parc"], [id*="remise"]')];
    return modals.map(m => ({
      tag: m.tagName,
      id: m.id,
      class: m.className.substring(0, 80),
      visible: m.offsetParent !== null,
      buttons: [...m.querySelectorAll('button, a, input[type=submit]')].map(b => ({
        text: b.textContent.trim().substring(0, 30),
        id: b.id,
        class: b.className.substring(0, 40),
        onclick: b.getAttribute('onclick')?.substring(0, 60)
      }))
    }));
  });
  console.log('Modals trouvés:', JSON.stringify(info, null, 2));

  await wait(5000);
  await browser.close();
})();
