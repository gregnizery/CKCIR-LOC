require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const { pool, initSchema } = require('./config/db');
const publicRoutes = require('./routes/public');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Render/Railway terminent le HTTPS au niveau du proxy et transmettent en
// HTTP en interne : sans ceci, Express ne voit jamais la connexion comme
// securisee et le cookie de session (secure: true en production) ne se
// persiste pas, ce qui renvoie systematiquement vers /admin/login.
app.set('trust proxy', 1);

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
  },
}));

app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/img', express.static(path.join(__dirname, 'public', 'img')));

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
