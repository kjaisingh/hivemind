export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required.' });
  }
  next();
}

export function requireTrustedOrigin(clientOrigin) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if ((origin && origin !== clientOrigin) || req.get('sec-fetch-site') === 'cross-site') {
      return res.status(403).json({ message: 'Requests must come from Hivemind.' });
    }
    next();
  };
}
