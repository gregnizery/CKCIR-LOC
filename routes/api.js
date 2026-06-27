const fs = require('fs');
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { generateContractPdf, numeroContrat } = require('../lib/pdf-generator');
const { requireAdmin } = require('../middleware/auth');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

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
      if (!isNonEmptyString(m.civilite)) errors.push(`membres[${i}].civilite requis`);
      if (!isNonEmptyString(m.date_naissance)) errors.push(`membres[${i}].date_naissance requis`);
    });
  }

  if (body.attestation_acceptee !== true) errors.push('attestation_acceptee doit etre acceptee');
  if (!isNonEmptyString(body.heure_location)) errors.push('heure_location requis');
  if (!isNonEmptyString(body.date_location)) errors.push('date_location requis');
  if (!body.nb_participants || Number(body.nb_participants) < 1) errors.push('nb_participants requis');
  if (body.montant_total === undefined || body.montant_total === null || Number.isNaN(Number(body.montant_total))) {
    errors.push('montant_total requis');
  }
  if (!isNonEmptyString(body.type_reglement)) errors.push('type_reglement requis');
  if (!isNonEmptyString(body.signature_representant)) errors.push('signature_representant requise');

  return errors;
}

router.post('/locations', async (req, res) => {
  const body = req.body || {};
  const errors = validatePayload(body);
  if (errors.length) {
    return res.status(400).json({ error: 'Donnees invalides', details: errors });
  }

  const r = body.representant;
  const client = await pool.connect();
  let location;

  try {
    await client.query('BEGIN');

    const insertLocation = await client.query(
      `INSERT INTO locations (
        representant_nom, representant_prenom, representant_adresse, representant_ville,
        representant_cp, representant_tel, representant_email, source_decouverte,
        attestation_acceptee, heure_location, date_location, nb_participants,
        montant_total, type_reglement, signature_representant
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        r.nom.trim(), r.prenom.trim(), r.adresse.trim(), r.ville.trim(), r.cp.trim(),
        r.tel.trim(), r.email.trim(), JSON.stringify(body.source_decouverte || []),
        true, body.heure_location, body.date_location, Number(body.nb_participants),
        Number(body.montant_total), body.type_reglement, body.signature_representant,
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
    pdfUrl: `/api/locations/${location.id}/pdf`,
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
