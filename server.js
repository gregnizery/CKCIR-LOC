require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { pool, initSchema } = require('./config/db');
const publicRoutes = require('./routes/public');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// En production, un SESSION_SECRET absent ferait retomber sur la valeur par
// defaut codee en dur (publique, puisque ce depot est sur GitHub) : n'importe
// qui pourrait alors forger un cookie de session admin valide. On refuse de
// demarrer plutot que de tourner avec un secret connu de tous.
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET manquant en production : arret du serveur.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD manquant en production : arret du serveur.');
  process.exit(1);
}

// Render/Railway terminent le HTTPS au niveau du proxy et transmettent en
// HTTP en interne : sans ceci, Express ne voit jamais la connexion comme
// securisee et le cookie de session (secure: true en production) ne se
// persiste pas, ce qui renvoie systematiquement vers /admin/login.
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
      'img-src': ["'self'", 'data:'],
    },
  },
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'ckcir-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8h
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
  },
}));

app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/img', express.static(path.join(__dirname, 'public', 'img')));

// Anti brute-force sur le login admin : 10 tentatives / 15 min / IP.
// Note : un mot de passe errone renvoie une redirection 302 (pas un 401), donc
// on ne peut pas se fier a skipSuccessfulRequests (qui se base sur le code
// HTTP) pour ignorer les echecs ; on limite simplement chaque POST.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Anti-spam sur la creation de contrats (formulaire public) : 20 / heure / IP.
const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/admin/login', (req, res, next) => {
  if (req.method === 'POST') return loginLimiter(req, res, next);
  return next();
});
app.use('/api/locations', (req, res, next) => {
  if (req.method === 'POST') return bookingLimiter(req, res, next);
  return next();
});

app.use('/', publicRoutes);
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).send('Page non trouvee');
});

async function start() {
  try {
    await initSchema();
    console.log('Schema PostgreSQL initialise.');
  } catch (err) {
    console.error('Erreur initialisation schema:', err.message);
  }
  app.listen(PORT, () => {
    console.log(`CKCIR app demarree sur le port ${PORT}`);
  });
}

start();

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
