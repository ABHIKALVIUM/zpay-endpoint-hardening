const { cache } = require('../mock/cache');

/**
 * Rate Limiter Middleware
 * Enforces per-client quota (50 requests per minute per authenticated user).
 * Returns 429 Too Many Requests with Retry-After header and structured error body.
 */
function rateLimiter(limit = 50, windowSeconds = 60) {
  return async (req, res, next) => {
    try {
      const userId = req.user ? req.user.id : (req.ip || 'anonymous');
      const key = `rate:${userId}`;
      const count = await cache.incr(key, windowSeconds);

      if (count > limit) {
        res.setHeader('Retry-After', windowSeconds);
        return res.status(429).json({
          error: {
            code: 'rate_limit_exceeded',
            limit: `${limit} per minute`,
            retry_after_seconds: windowSeconds,
            message: `Rate limit exceeded. Maximum ${limit} requests per minute allowed.`
          }
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  rateLimiter
};
