const path = require('path');
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.redirect('/form');
});

router.get('/form', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'form.html'));
});

module.exports = router;
