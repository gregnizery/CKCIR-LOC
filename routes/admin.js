const path = require('path');
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { requireAdmin } = require('../middleware/auth');

const SOURCE_LABELS = {
  site_internet: 'Site internet',
  reseaux_sociaux: 'Reseaux sociaux',
  flyer: 'Flyer ou affiche',
  bouche_a_oreille: 'Bouche-a-oreille',
  autre: 'Autre',
};

// Le club ne dispose que d'un seul QR code FFCK reutilisable (pas un par
// licencie) : c'est la valeur par defaut tant qu'un membre n'a pas un UUID
// different saisi explicitement.
const DEFAULT_QR_UUID = 'a04b83aff30cf6a81eef78d059';

const CLUB_TZ = 'Europe/Paris';

// "Aujourd'hui" doit toujours refleter le jour calendaire au club (France),
// quel que soit le fuseau horaire du serveur (Railway tourne en general en UTC).
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLUB_TZ }).format(new Date());
}

// Les colonnes DATE de Postgres sont renvoyees par "pg" comme des Date JS
// construites a minuit dans le fuseau local du processus Node : on doit donc
// relire l'annee/mois/jour avec les getters locaux, jamais via toISOString
// (qui convertit en UTC et peut decaler le jour d'un cran).
function toYMD(d) {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateRangeForPeriod(period, refDateStr) {
  const ref = refDateStr ? new Date(`${refDateStr}T00:00:00`) : new Date();
  let start;
  let end;

  if (period === 'year') {
    start = new Date(ref.getFullYear(), 0, 1);
    end = new Date(ref.getFullYear(), 11, 31);
  } else if (period === 'month') {
    start = new Date(ref.getFullYear(), ref.getMonth(), 1);
    end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  } else {
    const day = ref.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start = new Date(ref);
    start.setDate(ref.getDate() + diffToMonday);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  }

  return {
    start: toYMD(start),
    end: toYMD(end),
  };
}

// ===== Pages =====

router.get('/login', (req, res) => {
  if (req.session && req.session.isAdmin) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, '..', 'views', 'admin-login.html'));
});

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (password && password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.redirect('/admin/login?error=1');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

router.get('/', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'admin.html'));
});

// ===== API: locations du jour =====

router.get('/api/locations', requireAdmin, async (req, res) => {
  const date = req.query.date || todayStr();
  const result = await pool.query(
    `SELECT id, heure_location, representant_nom, representant_prenom,
            nb_participants, montant_total, type_reglement
     FROM locations
     WHERE date_location = $1
     ORDER BY heure_location ASC`,
    [date],
  );

  const totals = result.rows.reduce((acc, row) => {
    acc.montant += Number(row.montant_total);
    acc.parReglement[row.type_reglement] = (acc.parReglement[row.type_reglement] || 0) + Number(row.montant_total);
    return acc;
  }, { montant: 0, parReglement: {} });

  res.json({ date, locations: result.rows, totals });
});

router.get('/api/locations/export', requireAdmin, async (req, res) => {
  const end = req.query.end || todayStr();
  const start = req.query.start || end;

  const result = await pool.query(
    `SELECT date_location, heure_location, representant_nom, representant_prenom,
            representant_adresse, representant_ville, representant_cp, representant_tel,
            representant_email, source_decouverte, nb_participants, montant_total,
            type_reglement, statut
     FROM locations
     WHERE date_location BETWEEN $1 AND $2
     ORDER BY date_location ASC, heure_location ASC`,
    [start, end],
  );

  const header = ['Date', 'Heure', 'Nom', 'Prenom', 'Adresse', 'Ville', 'Code postal', 'Telephone', 'Email', 'Source', 'Participants', 'Montant', 'Reglement', 'Statut'];
  const csvLines = [header.join(';')];

  result.rows.forEach((row) => {
    const sources = Array.isArray(row.source_decouverte) ? row.source_decouverte : [];
    const line = [
      new Date(row.date_location).toLocaleDateString('fr-FR'),
      row.heure_location,
      row.representant_nom,
      row.representant_prenom,
      row.representant_adresse,
      row.representant_ville,
      row.representant_cp,
      row.representant_tel,
      row.representant_email,
      sources.map((s) => SOURCE_LABELS[s] || s).join(', '),
      row.nb_participants,
      Number(row.montant_total).toFixed(2),
      row.type_reglement,
      row.statut,
    ];
    csvLines.push(line.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'));
  });

  const bom = '﻿';
  const csv = bom + csvLines.join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="locations-${start}_${end}.csv"`);
  res.send(csv);
});

// ===== API: licences FFCK =====

async function getLicencesRows(start, end) {
  const result = await pool.query(
    `SELECT m.id, m.civilite, m.nom, m.prenom, m.date_naissance, m.qr_uuid, m.carte_prise,
            l.representant_email AS email, l.date_location
     FROM membres m
     JOIN locations l ON l.id = m.location_id
     WHERE l.date_location BETWEEN $1 AND $2
     ORDER BY l.date_location ASC, l.heure_location ASC, m.ordre ASC`,
    [start, end],
  );
  return result.rows.map((row) => ({ ...row, qr_uuid: row.qr_uuid || DEFAULT_QR_UUID }));
}

router.get('/api/licences', requireAdmin, async (req, res) => {
  const date = req.query.date || todayStr();
  const rows = await getLicencesRows(date, date);
  res.json({ date, rows });
});

router.patch('/api/membres/:id/qr-uuid', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const qrUuid = typeof req.body.qr_uuid === 'string' ? req.body.qr_uuid.trim() : '';

  const result = await pool.query(
    'UPDATE membres SET qr_uuid = $1 WHERE id = $2 RETURNING id, qr_uuid',
    [qrUuid || null, id],
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: 'Membre introuvable' });
  }

  res.json(result.rows[0]);
});

router.patch('/api/membres/:id/carte-prise', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const cartePrise = req.body.carte_prise === true;

  const result = await pool.query(
    'UPDATE membres SET carte_prise = $1 WHERE id = $2 RETURNING id, carte_prise',
    [cartePrise, id],
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: 'Membre introuvable' });
  }

  res.json(result.rows[0]);
});

// Format imose par l'extranet FFCK pour l'import des licences : l'ordre des
// colonnes ci-dessous doit etre respecte tel quel, dates en jj/mm/AAAA.
const FFCK_HEADER = ['UUID du QR code utilisé', 'Civilité', 'Nom', 'Prénom', 'Email', 'Date de naissance', 'Date de validité'];

function ffckRows(rows) {
  return rows.map((row) => [
    row.qr_uuid || '',
    row.civilite,
    row.nom,
    row.prenom,
    row.email,
    new Date(row.date_naissance).toLocaleDateString('fr-FR'),
    new Date(row.date_location).toLocaleDateString('fr-FR'),
  ]);
}

router.get('/api/licences/export', requireAdmin, async (req, res) => {
  const end = req.query.end || todayStr();
  const start = req.query.start || end;
  const rows = await getLicencesRows(start, end);

  const csvLines = [FFCK_HEADER.join(';')];
  ffckRows(rows).forEach((line) => {
    csvLines.push(line.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'));
  });

  const bom = '﻿';
  const csv = bom + csvLines.join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="licences-ffck-${start}_${end}.csv"`);
  res.send(csv);
});

router.get('/api/licences/export.xlsx', requireAdmin, async (req, res) => {
  const end = req.query.end || todayStr();
  const start = req.query.start || end;
  const rows = await getLicencesRows(start, end);

  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Licences');

  sheet.addRow(FFCK_HEADER);
  ffckRows(rows).forEach((line) => sheet.addRow(line));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="licences-ffck-${start}_${end}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

// ===== API: statistiques =====

async function computeStats(period, refDateStr) {
  const { start, end } = dateRangeForPeriod(period, refDateStr);

  const result = await pool.query(
    `SELECT date_location, heure_location, nb_participants, montant_total,
            type_reglement, source_decouverte
     FROM locations
     WHERE date_location BETWEEN $1 AND $2`,
    [start, end],
  );

  const rows = result.rows;
  const nbLocations = rows.length;
  const nbParticipants = rows.reduce((sum, r) => sum + Number(r.nb_participants), 0);
  const chiffreAffaires = rows.reduce((sum, r) => sum + Number(r.montant_total), 0);
  const panierMoyen = nbLocations ? chiffreAffaires / nbLocations : 0;

  const parJour = {};
  const parReglement = {};
  const parSource = {};
  const parCreneau = {};

  rows.forEach((r) => {
    const dateKey = toYMD(r.date_location);
    parJour[dateKey] = (parJour[dateKey] || 0) + 1;

    parReglement[r.type_reglement] = (parReglement[r.type_reglement] || 0) + 1;

    const sources = Array.isArray(r.source_decouverte) ? r.source_decouverte : [];
    sources.forEach((s) => {
      const label = SOURCE_LABELS[s] || s;
      parSource[label] = (parSource[label] || 0) + 1;
    });

    const creneau = r.heure_location;
    parCreneau[creneau] = (parCreneau[creneau] || 0) + 1;
  });

  const frequentationParJour = Object.entries(parJour)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  const repartitionReglement = Object.entries(parReglement).map(([type, count]) => ({ type, count }));
  const sourcesDecouverte = Object.entries(parSource).map(([source, count]) => ({ source, count }));

  const topCreneaux = Object.entries(parCreneau)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([heure, count]) => ({ heure, count }));

  return {
    period,
    start,
    end,
    totals: { nbLocations, nbParticipants, chiffreAffaires, panierMoyen },
    frequentationParJour,
    repartitionReglement,
    sourcesDecouverte,
    topCreneaux,
  };
}

router.get('/api/stats', requireAdmin, async (req, res) => {
  const period = ['week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'week';
  const stats = await computeStats(period, req.query.date || todayStr());
  res.json(stats);
});

router.get('/api/stats/export', requireAdmin, async (req, res) => {
  const period = ['week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'week';
  const stats = await computeStats(period, req.query.date || todayStr());

  const csvRow = (cols) => cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';');
  const lines = [];

  lines.push(csvRow(['Periode', `${stats.start} au ${stats.end}`]));
  lines.push('');
  lines.push(csvRow(['Totaux']));
  lines.push(csvRow(['Nombre de locations', stats.totals.nbLocations]));
  lines.push(csvRow(['Nombre de participants', stats.totals.nbParticipants]));
  lines.push(csvRow(["Chiffre d'affaires", stats.totals.chiffreAffaires.toFixed(2)]));
  lines.push(csvRow(['Panier moyen', stats.totals.panierMoyen.toFixed(2)]));
  lines.push('');
  lines.push(csvRow(['Frequentation par jour']));
  lines.push(csvRow(['Date', 'Nombre de locations']));
  stats.frequentationParJour.forEach((r) => lines.push(csvRow([r.date, r.count])));
  lines.push('');
  lines.push(csvRow(['Repartition par reglement']));
  lines.push(csvRow(['Type', 'Nombre']));
  stats.repartitionReglement.forEach((r) => lines.push(csvRow([r.type, r.count])));
  lines.push('');
  lines.push(csvRow(['Sources de decouverte']));
  lines.push(csvRow(['Source', 'Nombre']));
  stats.sourcesDecouverte.forEach((r) => lines.push(csvRow([r.source, r.count])));
  lines.push('');
  lines.push(csvRow(['Creneaux les plus demandes']));
  lines.push(csvRow(['Heure', 'Nombre']));
  stats.topCreneaux.forEach((r) => lines.push(csvRow([r.heure, r.count])));

  const bom = '﻿';
  const csv = bom + lines.join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="statistiques-${stats.start}_${stats.end}.csv"`);
  res.send(csv);
});

module.exports = router;
