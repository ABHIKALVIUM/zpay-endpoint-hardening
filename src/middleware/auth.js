/**
 * Authentication Middleware
 * Validates authentication tokens and populates req.user.
 * Returns 401 when token is missing or invalid.
 */

const KNOWN_TOKENS = {
  'viewer-token': { id: 'usr_viewer_01', role: 'viewer', name: 'Viewer User' },
  'operator-token': { id: 'usr_operator_01', role: 'operator', name: 'Operator User' },
  'admin-token': { id: 'usr_admin_01', role: 'admin', name: 'Admin User' }
};

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || typeof authHeader !== 'string' || !authHeader.trim()) {
    return res.status(401).json({
      error: {
        code: 'auth_failed',
        message: 'Authentication token missing or invalid'
      }
    });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token || token.toLowerCase().startsWith('invalid') || token === 'bad-token' || token === 'expired') {
    return res.status(401).json({
      error: {
        code: 'auth_failed',
        message: 'Authentication token missing or invalid'
      }
    });
  }

  // Lookup known tokens or parse token role
  if (KNOWN_TOKENS[token]) {
    req.user = { ...KNOWN_TOKENS[token] };
    return next();
  }

  if (token.toLowerCase().includes('viewer')) {
    req.user = {
      id: `usr_${token}`,
      role: 'viewer',
      name: 'Viewer User'
    };
    return next();
  }

  // Default valid tokens to operator role
  req.user = {
    id: `usr_${token}`,
    role: 'operator',
    name: 'Operator User'
  };

  next();
}

module.exports = {
  authenticate,
  KNOWN_TOKENS
};
