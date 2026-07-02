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

const CRENEAU_ORDER = ['Avant 10h', '10h–12h', '12h–14h', '14h–16h', '16h–18h', 'Après 18h'];
const TAILLE_ORDER = ['1 pers.', '2 pers.', '3 pers.', '4-5 pers.', '6-8 pers.', '9+ pers.'];
const JOURS_SEMAINE = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];

function getCreneauLabel(heureStr) {
  if (!heureStr) return 'Autre';
  const h = parseInt(heureStr.split(':')[0], 10);
  if (isNaN(h)) return 'Autre';
  if (h < 10) return 'Avant 10h';
  if (h < 12) return '10h–12h';
  if (h < 14) return '12h–14h';
  if (h < 16) return '14h–16h';
  if (h < 18) return '16h–18h';
  return 'Après 18h';
}

function getTailleLabel(nb) {
  if (nb <= 1) return '1 pers.';
  if (nb === 2) return '2 pers.';
  if (nb === 3) return '3 pers.';
  if (nb <= 5) return '4-5 pers.';
  if (nb <= 8) return '6-8 pers.';
  return '9+ pers.';
}

function prevPeriodRange(start, end) {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const duration = Math.round((e - s) / (24 * 3600 * 1000));
  const prevEnd = new Date(s);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevEnd.getDate() - duration);
  return { start: toYMD(prevStart), end: toYMD(prevEnd) };
}

function defaultStatsRange() {
  const today = new Date();
  const start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  return { start, end: todayStr() };
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
  const includeAnnulees = req.query.include_annulees === '1';

  const result = await pool.query(
    `SELECT id, heure_location, representant_nom, representant_prenom,
            nb_participants, montant_total, type_reglement, statut,
            motif_annulation, annule_le, reactive_le
     FROM locations
     WHERE date_location = $1 ${includeAnnulees ? '' : "AND statut != 'annule'"}
     ORDER BY heure_location ASC`,
    [date],
  );

  const totals = result.rows.reduce((acc, row) => {
    if (row.statut === 'annule') return acc;
    acc.montant += Number(row.montant_total);
    acc.parReglement[row.type_reglement] = (acc.parReglement[row.type_reglement] || 0) + Number(row.montant_total);
    return acc;
  }, { montant: 0, parReglement: {} });

  res.json({ date, locations: result.rows, totals });
});

router.patch('/api/locations/:id/annuler', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const motif = typeof req.body.motif === 'string' ? req.body.motif.trim() : '';

  const result = await pool.query(
    `UPDATE locations SET statut = 'annule', motif_annulation = $1, annule_le = now()
     WHERE id = $2 RETURNING id, statut, motif_annulation, annule_le`,
    [motif || null, id],
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: 'Location introuvable' });
  }

  res.json(result.rows[0]);
});

router.patch('/api/locations/:id/reactiver', requireAdmin, async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `UPDATE locations SET statut = 'actif', reactive_le = now()
     WHERE id = $1 RETURNING id, statut, motif_annulation, annule_le, reactive_le`,
    [id],
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: 'Location introuvable' });
  }

  res.json(result.rows[0]);
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

async function computeTotalsOnly(start, end) {
  const r = await pool.query(
    `SELECT nb_participants, montant_total FROM locations
     WHERE date_location BETWEEN $1 AND $2 AND statut != 'annule'`,
    [start, end],
  );
  const rows = r.rows;
  const nbLocations = rows.length;
  const nbParticipants = rows.reduce((sum, x) => sum + Number(x.nb_participants), 0);
  const chiffreAffaires = rows.reduce((sum, x) => sum + Number(x.montant_total), 0);
  const panierMoyen = nbLocations ? chiffreAffaires / nbLocations : 0;
  return { nbLocations, nbParticipants, chiffreAffaires, panierMoyen };
}

async function computeStats(start, end) {
  const result = await pool.query(
    `SELECT date_location, heure_location, nb_participants, montant_total,
            type_reglement, source_decouverte
     FROM locations
     WHERE date_location BETWEEN $1 AND $2 AND statut != 'annule'`,
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
  const parTaille = {};
  const parJourSemaine = {};

  rows.forEach((r) => {
    const dateKey = toYMD(r.date_location);
    parJour[dateKey] = (parJour[dateKey] || 0) + 1;

    parReglement[r.type_reglement] = (parReglement[r.type_reglement] || 0) + 1;

    const sources = Array.isArray(r.source_decouverte) ? r.source_decouverte : [];
    sources.forEach((s) => {
      const label = SOURCE_LABELS[s] || s;
      parSource[label] = (parSource[label] || 0) + 1;
    });

    const creneauLabel = getCreneauLabel(r.heure_location);
    if (!parCreneau[creneauLabel]) parCreneau[creneauLabel] = { count: 0, ca: 0 };
    parCreneau[creneauLabel].count++;
    parCreneau[creneauLabel].ca += Number(r.montant_total);

    const tailleLabel = getTailleLabel(Number(r.nb_participants));
    parTaille[tailleLabel] = (parTaille[tailleLabel] || 0) + 1;

    // getDay() utilise le fuseau local du processus Node ; on force midi pour
    // eviter tout decalage DST au passage minuit.
    const dow = new Date(`${toYMD(r.date_location)}T12:00:00`).getDay();
    const jourLabel = JOURS_SEMAINE[dow];
    parJourSemaine[jourLabel] = (parJourSemaine[jourLabel] || 0) + 1;
  });

  const frequentationParJour = Object.entries(parJour)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  const repartitionReglement = Object.entries(parReglement).map(([type, count]) => ({ type, count }));
  const sourcesDecouverte = Object.entries(parSource).map(([source, count]) => ({ source, count }));

  const revenusParCreneau = CRENEAU_ORDER
    .filter((c) => parCreneau[c])
    .map((c) => ({ creneau: c, count: parCreneau[c].count, ca: parCreneau[c].ca }));

  const tailleGroupes = TAILLE_ORDER
    .filter((l) => parTaille[l])
    .map((l) => ({ label: l, count: parTaille[l] }));

  const topJoursSemaine = JOURS_SEMAINE.map((j) => ({ jour: j, count: parJourSemaine[j] || 0 }));

  const prev = prevPeriodRange(start, end);
  const comparaison = {
    start: prev.start,
    end: prev.end,
    totals: await computeTotalsOnly(prev.start, prev.end),
  };

  return {
    start,
    end,
    totals: { nbLocations, nbParticipants, chiffreAffaires, panierMoyen },
    comparaison,
    frequentationParJour,
    repartitionReglement,
    sourcesDecouverte,
    revenusParCreneau,
    tailleGroupes,
    topJoursSemaine,
  };
}

router.get('/api/stats', requireAdmin, async (req, res) => {
  try {
    const { start, end } = (req.query.start && req.query.end)
      ? { start: req.query.start, end: req.query.end }
      : defaultStatsRange();
    const stats = await computeStats(start, end);
    res.json(stats);
  } catch (err) {
    console.error('Erreur stats:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/api/stats/export', requireAdmin, async (req, res) => {
  try {
  const { start, end } = (req.query.start && req.query.end)
    ? { start: req.query.start, end: req.query.end }
    : defaultStatsRange();
  const stats = await computeStats(start, end);

  const csvRow = (cols) => cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';');
  const lines = [];

  lines.push(csvRow(['Periode', `${stats.start} au ${stats.end}`]));
  lines.push(csvRow(['Periode precedente', `${stats.comparaison.start} au ${stats.comparaison.end}`]));
  lines.push('');
  lines.push(csvRow(['Totaux', 'Periode', 'Periode precedente']));
  lines.push(csvRow(['Nombre de locations', stats.totals.nbLocations, stats.comparaison.totals.nbLocations]));
  lines.push(csvRow(['Nombre de participants', stats.totals.nbParticipants, stats.comparaison.totals.nbParticipants]));
  lines.push(csvRow(["Chiffre d'affaires", stats.totals.chiffreAffaires.toFixed(2), stats.comparaison.totals.chiffreAffaires.toFixed(2)]));
  lines.push(csvRow(['Panier moyen', stats.totals.panierMoyen.toFixed(2), stats.comparaison.totals.panierMoyen.toFixed(2)]));
  lines.push('');
  lines.push(csvRow(['Frequentation par jour']));
  lines.push(csvRow(['Date', 'Nombre de locations']));
  stats.frequentationParJour.forEach((r) => lines.push(csvRow([r.date, r.count])));
  lines.push('');
  lines.push(csvRow(['Revenus par creneau']));
  lines.push(csvRow(['Creneau', 'Nombre de locations', 'CA (euros)']));
  stats.revenusParCreneau.forEach((r) => lines.push(csvRow([r.creneau, r.count, r.ca.toFixed(2)])));
  lines.push('');
  lines.push(csvRow(['Taille des groupes']));
  lines.push(csvRow(['Taille', 'Nombre de locations']));
  stats.tailleGroupes.forEach((r) => lines.push(csvRow([r.label, r.count])));
  lines.push('');
  lines.push(csvRow(['Jours de la semaine']));
  lines.push(csvRow(['Jour', 'Nombre de locations']));
  stats.topJoursSemaine.forEach((r) => lines.push(csvRow([r.jour, r.count])));
  lines.push('');
  lines.push(csvRow(['Repartition par reglement']));
  lines.push(csvRow(['Type', 'Nombre']));
  stats.repartitionReglement.forEach((r) => lines.push(csvRow([r.type, r.count])));
  lines.push('');
  lines.push(csvRow(['Sources de decouverte']));
  lines.push(csvRow(['Source', 'Nombre']));
  stats.sourcesDecouverte.forEach((r) => lines.push(csvRow([r.source, r.count])));

  const bom = '﻿';
  const csv = bom + lines.join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="statistiques-${stats.start}_${stats.end}.csv"`);
  res.send(csv);
  } catch (err) {
    console.error('Erreur export stats:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
