function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Non authentifie' });
  }
  return res.redirect('/admin/login');
}

module.exports = { requireAdmin };
