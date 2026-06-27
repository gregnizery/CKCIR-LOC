const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { generateContractPdf, numeroContrat } = require('../lib/pdf-generator');
const { requireAdmin } = require('../middleware/auth');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// data:image/png;base64,... uniquement : c'est strictement ce que produit
// signature_pad cote client (toDataURL('image/png')). Toute autre valeur est
// rejetee pour empecher l'injection de HTML/JS dans le PDF genere (la valeur
// est inseree dans un attribut src sans echappement dans pdf-generator.js).
const SIGNATURE_DATA_URI_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Ces champs sont des <select>/<input type="time"> cote client, mais rien
// n'empeche un appel direct a l'API de poster autre chose : on revalide le
// format ici (defense en profondeur, en plus de l'echappement a l'affichage).
const CIVILITES = ['M.', 'Mme', 'Autre'];
const TYPES_REGLEMENT = ['cb', 'especes', 'cheque', 'virement'];
const SOURCES_DECOUVERTE = ['site_internet', 'reseaux_sociaux', 'flyer', 'bouche_a_oreille', 'autre'];
const HEURE_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validatePayload(body) {
  const errors = [];
  const r = body.representant || {};

  ['nom', 'prenom', 'adresse', 'ville', 'cp', 'tel', 'email'].forEach((field) => {
    if (!isNonEmptyString(r[field])) errors.push(`representant.${field} requis`);
  });

  if (!Array.isArray(body.membres) || body.membres.length < 1 || body.membres.length > 8) {
    errors.push('membres: entre 1 et 8 requis');
  } else {
    body.membres.forEach((m, i) => {
      if (!isNonEmptyString(m.nom)) errors.push(`membres[${i}].nom requis`);
      if (!isNonEmptyString(m.prenom)) errors.push(`membres[${i}].prenom requis`);
      if (!CIVILITES.includes(m.civilite)) errors.push(`membres[${i}].civilite invalide`);
      if (!isNonEmptyString(m.date_naissance)) errors.push(`membres[${i}].date_naissance requis`);
    });
  }

  if (body.attestation_acceptee !== true) errors.push('attestation_acceptee doit etre acceptee');
  if (!isNonEmptyString(body.heure_location) || !HEURE_RE.test(body.heure_location)) {
    errors.push('heure_location invalide');
  }
  if (!isNonEmptyString(body.date_location)) errors.push('date_location requis');
  if (!body.nb_participants || Number(body.nb_participants) < 1) errors.push('nb_participants requis');
  if (body.montant_total === undefined || body.montant_total === null || Number.isNaN(Number(body.montant_total))) {
    errors.push('montant_total requis');
  }
  if (!TYPES_REGLEMENT.includes(body.type_reglement)) errors.push('type_reglement invalide');
  if (!isNonEmptyString(body.signature_representant) || !SIGNATURE_DATA_URI_RE.test(body.signature_representant)) {
    errors.push('signature_representant invalide');
  }
  if (body.source_decouverte !== undefined) {
    if (!Array.isArray(body.source_decouverte) || !body.source_decouverte.every((s) => SOURCES_DECOUVERTE.includes(s))) {
      errors.push('source_decouverte invalide');
    }
  }

  return errors;
}

router.post('/locations', async (req, res) => {
  const body = req.body || {};
  const errors = validatePayload(body);
  if (errors.length) {
    return res.status(400).json({ error: 'Donnees invalides', details: errors });
  }

  const r = body.representant;
  const accessToken = crypto.randomBytes(24).toString('hex');
  const client = await pool.connect();
  let location;

  try {
    await client.query('BEGIN');

    const insertLocation = await client.query(
      `INSERT INTO locations (
        representant_nom, representant_prenom, representant_adresse, representant_ville,
        representant_cp, representant_tel, representant_email, source_decouverte,
        attestation_acceptee, heure_location, date_location, nb_participants,
        montant_total, type_reglement, signature_representant, access_token
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        r.nom.trim(), r.prenom.trim(), r.adresse.trim(), r.ville.trim(), r.cp.trim(),
        r.tel.trim(), r.email.trim(), JSON.stringify(body.source_decouverte || []),
        true, body.heure_location, body.date_location, Number(body.nb_participants),
        Number(body.montant_total), body.type_reglement, body.signature_representant, accessToken,
      ],
    );

    location = insertLocation.rows[0];

    for (let i = 0; i < body.membres.length; i += 1) {
      const m = body.membres[i];
      await client.query(
        `INSERT INTO membres (location_id, nom, prenom, civilite, date_naissance, ordre)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [location.id, m.nom.trim(), m.prenom.trim(), m.civilite, m.date_naissance, i],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur creation location:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de l\'enregistrement du contrat' });
  } finally {
    client.release();
  }

  // Le contrat est enregistre : on repond immediatement sans attendre le PDF.
  // Le premier lancement de Chromium (cold start sur Railway) peut prendre
  // plusieurs dizaines de secondes, ce qui faisait expirer la requete cote
  // client ("Load failed") si on attendait la fin du rendu avant de repondre.
  res.status(201).json({
    id: location.id,
    numero: numeroContrat(location.id),
    pdfUrl: `/api/locations/${location.id}/pdf?token=${accessToken}`,
  });

  try {
    const membresResult = await pool.query(
      'SELECT * FROM membres WHERE location_id = $1 ORDER BY ordre ASC',
      [location.id],
    );
    const { filePath } = await generateContractPdf(location, membresResult.rows);
    await pool.query('UPDATE locations SET pdf_path = $1 WHERE id = $2', [filePath, location.id]);
  } catch (err) {
    console.error('Erreur generation PDF (arriere-plan):', err);
  }
});

router.get('/locations/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const locationResult = await pool.query('SELECT * FROM locations WHERE id = $1', [id]);
  if (!locationResult.rows.length) {
    return res.status(404).json({ error: 'Location introuvable' });
  }
  const membresResult = await pool.query(
    'SELECT * FROM membres WHERE location_id = $1 ORDER BY ordre ASC',
    [id],
  );
  res.json({
    location: locationResult.rows[0],
    membres: membresResult.rows,
    numero: numeroContrat(locationResult.rows[0].id),
  });
});

router.get('/locations/:id/pdf', async (req, res) => {
  const { id } = req.params;
  const result = await pool.query('SELECT * FROM locations WHERE id = $1', [id]);
  if (!result.rows.length) {
    return res.status(404).send('Contrat introuvable');
  }

  const location = result.rows[0];

  // L'id sequentiel ne suffit jamais a lui seul : il faut soit etre connecte
  // en tant qu'admin, soit presenter le jeton recu a la creation du contrat
  // (cf. audit securite : sans ca, n'importe qui pouvait enumerer les ids et
  // telecharger le contrat de n'importe quel client).
  const isAdmin = !!(req.session && req.session.isAdmin);
  if (!isAdmin && !tokenMatches(req.query.token, location.access_token)) {
    return res.status(403).send('Acces refuse');
  }

  // Le PDF est normalement genere en arriere-plan juste apres la creation du
  // contrat ; s'il n'est pas encore pret (ou si le fichier a disparu apres un
  // redemarrage, le filesystem Railway etant ephemere), on le (re)genere ici
  // a la demande avant de le servir.
  if (!location.pdf_path || !fs.existsSync(location.pdf_path)) {
    try {
      const membresResult = await pool.query(
        'SELECT * FROM membres WHERE location_id = $1 ORDER BY ordre ASC',
        [id],
      );
      const { filePath } = await generateContractPdf(location, membresResult.rows);
      await pool.query('UPDATE locations SET pdf_path = $1 WHERE id = $2', [filePath, id]);
      location.pdf_path = filePath;
    } catch (err) {
      console.error('Erreur generation PDF (a la demande):', err);
      return res.status(500).send('Erreur lors de la generation du PDF');
    }
  }

  res.download(location.pdf_path, `contrat-${id}.pdf`);
});

module.exports = router;
