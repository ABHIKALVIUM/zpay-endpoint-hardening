/**
 * Authorization Middleware
 * Enforces role-based access control.
 * Returns 403 when authenticated user has insufficient permissions (e.g. viewer role calling write endpoint).
 */

function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: 'permission_denied',
          message: 'Authenticated user with insufficient role'
        }
      });
    }
    next();
  };
}

module.exports = {
  requireRoles
};
