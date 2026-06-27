const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PDF_DIR = path.join(__dirname, '..', 'pdfs');

const LOGO_DATA_URI = `data:image/png;base64,${fs.readFileSync(
  path.join(__dirname, '..', 'public', 'img', 'logo-ckcir.png'),
).toString('base64')}`;

const ATTESTATION_ITEMS = [
  'Je sais nager 25 metres, m’immerger et je suis apte a la pratique des sports nautiques',
  'J’ai recu mon materiel en parfait etat de marche et j’ai ete informe de la zone de navigation et des parcours autorises',
  'Je suis responsable juridiquement du materiel loue des sa prise en charge et ce jusqu’a sa restitution',
  'Je vais utiliser le materiel dans les conditions normales de navigation et du nombre d’utilisateurs par embarcation',
  'Je m’engage a porter en permanence mon gilet d’aide a la flottabilite ainsi que des chaussures fermees',
  'Je m’engage a verser selon ma responsabilite en cas de sinistre, perte ou casse du materiel, le montant des frais de reparation, d’intervention ou de remplacement du materiel',
  'Je m’engage a verser en cas de depassement horaire le supplement ecoule au prorata des tarifs en vigueur',
  'Je m’engage a respecter le milieu naturel et les autres utilisateurs du site',
  'Je m’engage a accepter le fait que le loueur reste seul juge de la competence des participants et peut sans preavis refuser le depart d’embarcations reservees suivant l’evolution des conditions de navigation',
  'Je me porte garant pour toute personne dont je suis le responsable legal au regard des engagements precedents',
];

const SOURCE_LABELS = {
  site_internet: 'Site internet',
  reseaux_sociaux: 'Reseaux sociaux',
  flyer: 'Flyer ou affiche',
  bouche_a_oreille: 'Bouche-a-oreille',
  autre: 'Autre',
};

function numeroContrat(id) {
  return `LOC-${String(id).padStart(6, '0')}`;
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDate(d) {
  const date = new Date(d);
  return date.toLocaleDateString('fr-FR');
}

// Les colonnes DATE de Postgres sont renvoyees par "pg" comme des Date JS
// construites a minuit dans le fuseau local du processus Node : on doit donc
// relire l'annee/mois/jour avec les getters locaux, jamais via toISOString
// (qui convertit en UTC et peut decaler le jour d'un cran).
function toYMD(d) {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function buildHtml(location, membres) {
  const numero = numeroContrat(location.id);
  const sources = Array.isArray(location.source_decouverte) ? location.source_decouverte : [];

  const sourcesHtml = Object.entries(SOURCE_LABELS).map(([key, label]) => {
    const checked = sources.includes(key);
    return `<span class="src-item">${checked ? '☑' : '☐'} ${esc(label)}</span>`;
  }).join('');

  const attestationHtml = ATTESTATION_ITEMS.map((item) => `<li>${esc(item)}</li>`).join('');

  const membresRows = membres.map((m) => `
    <tr>
      <td>${esc(m.civilite)}</td>
      <td>${esc(m.nom)}</td>
      <td>${esc(m.prenom)}</td>
      <td>${esc(formatDate(m.date_naissance))}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 14mm 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 10.5pt; margin: 0; }
  .header { text-align: center; margin-bottom: 6px; }
  .header-logo-line { display: flex; align-items: center; justify-content: center; gap: 10px; }
  .header-logo { height: 52px; width: auto; }
  .header h1 { color: #C0392B; font-size: 15pt; margin: 0; font-weight: 800; }
  .header .ffck { font-size: 9pt; font-style: italic; color: #555; margin: 2px 0 0; }
  .header-sep { height: 2.5px; background: #1B3A6B; margin: 6px 0 8px; }
  .meta-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .bandeau { background: #C0392B; color: #fff; text-align: center; font-size: 16pt; font-weight: 800; letter-spacing: 1px; padding: 8px; border-radius: 4px; flex: 1; margin-right: 14px; }
  .meta-box { font-size: 9pt; text-align: right; white-space: nowrap; }
  .meta-box .num { font-weight: 700; color: #1B3A6B; font-size: 11pt; }
  .section-title { background: #1B3A6B; color: #fff; padding: 4px 10px; font-weight: 700; font-size: 10pt; border-radius: 3px 3px 0 0; margin-top: 11px; }
  .section-body { border: 1px solid #CBD5E0; border-top: none; border-radius: 0 0 3px 3px; padding: 6px 10px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; font-size: 9.5pt; }
  .src-list { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 9.5pt; }
  .attestation-list { font-size: 9pt; margin: 4px 0 0 0; padding-left: 16px; }
  .attestation-list li { margin-bottom: 1.5px; }
  .rgpd-text { font-size: 8pt; color: #444; margin: 6px 0 0; padding-top: 5px; border-top: 1px solid #CBD5E0; line-height: 1.35; }
  table.membres { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 9.5pt; }
  table.membres th { background: #1B3A6B; color: #fff; text-align: left; padding: 4px 8px; }
  table.membres td { padding: 3px 8px; border-bottom: 1px solid #CBD5E0; vertical-align: middle; }
  table.membres tr:nth-child(even) td { background: #F4F6F9; }
  table.recap { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 9.5pt; }
  table.recap th { background: #1B3A6B; color: #fff; padding: 5px 8px; text-align: left; }
  table.recap td { padding: 5px 8px; border-bottom: 1px solid #CBD5E0; }
  .signature-final { margin-top: 8px; display: flex; justify-content: flex-end; align-items: flex-end; gap: 16px; }
  .signature-final .note { flex: 1; font-size: 8.5pt; color: #555; }
  .signature-final .box { text-align: center; }
  .signature-final img { height: 60px; border-bottom: 1px solid #1B3A6B; }
  .signature-final .lu-approuve { font-size: 8.5pt; font-style: italic; color: #555; margin-top: 4px; }
</style>
</head>
<body>
  <div class="header">
    <div class="header-logo-line">
      <img src="${LOGO_DATA_URI}" class="header-logo" alt="Logo CKCIR" />
      <div>
        <h1>Club de Canoe-Kayak de l'Ile Robinson (CKCIR Saint-Gregoire)</h1>
        <p class="ffck">affilie a la Federation Francaise de Canoe-Kayak (FFCK)</p>
      </div>
    </div>
  </div>
  <div class="header-sep"></div>

  <div class="meta-row">
    <div class="bandeau">CONTRAT DE LOCATION</div>
    <div class="meta-box">
      <div class="num">N&deg; ${esc(numero)}</div>
      <div>${esc(formatDate(location.date_location))}</div>
      <div>${esc(location.heure_location)}</div>
    </div>
  </div>

  <div class="section-title">Representant du groupe</div>
  <div class="section-body">
    <div class="info-grid">
      <div><strong>Nom :</strong> ${esc(location.representant_nom)}</div>
      <div><strong>Prenom :</strong> ${esc(location.representant_prenom)}</div>
      <div><strong>Adresse :</strong> ${esc(location.representant_adresse)}</div>
      <div><strong>Ville :</strong> ${esc(location.representant_ville)} (${esc(location.representant_cp)})</div>
      <div><strong>Telephone :</strong> ${esc(location.representant_tel)}</div>
      <div><strong>Email :</strong> ${esc(location.representant_email)}</div>
    </div>
  </div>

  <div class="section-title">Comment avez-vous connu le CKCIR ?</div>
  <div class="section-body">
    <div class="src-list">${sourcesHtml}</div>
  </div>

  <div class="section-title">Attestation sur l'honneur</div>
  <div class="section-body">
    <ol class="attestation-list">${attestationHtml}</ol>
    <p class="rgpd-text"><strong>Donnees personnelles (RGPD) :</strong> les informations
      recueillies ci-dessus sont necessaires a la gestion de cette location et au respect
      des obligations legales et assurantielles du club (dont son affiliation a la FFCK).
      Elles sont conservees par le CKCIR pendant la duree necessaire a ces finalites, puis
      supprimees. Vous disposez d'un droit d'acces, de rectification et de suppression de
      vos donnees en ecrivant a infockcir@gmail.com.</p>
  </div>

  <div class="section-title">Membres du groupe</div>
  <div class="section-body">
    <table class="membres">
      <thead><tr><th>Civilite</th><th>Nom</th><th>Prenom</th><th>Date de naissance</th></tr></thead>
      <tbody>${membresRows}</tbody>
    </table>
  </div>

  <div class="section-title">Recapitulatif</div>
  <div class="section-body">
    <table class="recap">
      <thead><tr><th>Participants</th><th>Montant</th><th>Reglement</th></tr></thead>
      <tbody>
        <tr>
          <td>${esc(location.nb_participants)}</td>
          <td>${Number(location.montant_total).toFixed(2)} &euro;</td>
          <td>${esc(location.type_reglement)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="signature-final">
    <div class="note">
      Cette signature unique, donnee par le representant du groupe, vaut pour
      l'ensemble des membres listes ci-dessus : le representant certifie sur
      l'honneur l'exactitude de leurs informations et se porte garant pour
      chacun d'eux, conformement a l'attestation rappelee plus haut.
    </div>
    <div class="box">
      ${location.signature_representant ? `<img src="${esc(location.signature_representant)}" />` : ''}
      <div class="lu-approuve">Signature precedee de la mention &laquo; lu et approuve &raquo;</div>
    </div>
  </div>
</body>
</html>`;
}

function buildFooterTemplate() {
  return `<div style="width: 100%; box-sizing: border-box; margin: 0 14mm; padding-top: 4px; border-top: 1px solid #CBD5E0; display: flex; justify-content: space-between; align-items: center; font-family: Arial, Helvetica, sans-serif; font-size: 8px; color: #555;">
    <div>Ile Robinson &mdash; 35760 Saint-Gregoire &mdash; 06 07 89 31 03 &mdash; infockcir@gmail.com &mdash; ckcir.net</div>
    <div style="color: #C0392B; font-weight: 800; font-size: 9px;">CKCIR</div>
  </div>`;
}

// Chemins ou apt-get installe Chromium/Chrome dans l'image Docker (voir
// Dockerfile). On les detecte directement sur le disque en plus de
// CHROME_EXECUTABLE_PATH : si cette variable d'env disparait (mauvaise
// config Render, etc.), on retombe quand meme sur le Chromium systeme
// plutot que sur @sparticuz/chromium-min, qui plante en ETXTBSY hors AWS
// Lambda (cf. incident deja rencontre sur Render).
const KNOWN_SYSTEM_CHROMIUM_PATHS = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable'];

async function getBrowser() {
  const systemPath = KNOWN_SYSTEM_CHROMIUM_PATHS.find((p) => fs.existsSync(p));
  const executablePath = process.env.CHROME_EXECUTABLE_PATH || systemPath;

  if (executablePath) {
    return puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  const chromium = require('@sparticuz/chromium-min');
  const packUrl = process.env.CHROMIUM_PACK_URL
    || 'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar';

  const remoteExecutablePath = await chromium.executablePath(packUrl);

  return puppeteer.launch({
    args: chromium.args,
    executablePath: remoteExecutablePath,
    headless: chromium.headless,
  });
}

async function generateContractPdf(location, membres) {
  if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  }

  const html = buildHtml(location, membres);
  const browser = await getBrowser();

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });

    const dateStr = toYMD(location.date_location);
    const filename = `contrat-${location.id}-${dateStr}.pdf`;
    const filePath = path.join(PDF_DIR, filename);

    await page.pdf({
      path: filePath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: buildFooterTemplate(),
      margin: { top: '14mm', right: '14mm', bottom: '12mm', left: '14mm' },
    });

    return { filePath, filename };
  } finally {
    await browser.close();
  }
}

module.exports = { generateContractPdf, numeroContrat };
