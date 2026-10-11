const express = require('express');
const { normaliseFields } = require('./middleware/versioning');
const { authenticate } = require('./middleware/auth');
const { requireRoles } = require('./middleware/authorize');
const { rateLimiter } = require('./middleware/rateLimiter');
const paymentsRouter = require('./routes/payments');

const app = express();

// Parse JSON request bodies
app.use(express.json());

// Health check endpoint (unauthenticated)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'zpay-payments' });
});

// Reliability Decision 4: Backward Compatibility Versioning Normalization
app.use(normaliseFields);

// Reliability Decision 1: Authentication (401 on missing/invalid token)
app.use(authenticate);

// Reliability Decision 1: Authorization (403 on insufficient permissions, e.g. viewer role)
app.use(requireRoles('operator', 'admin'));

// Reliability Decision 3: Rate Limiting (429 + Retry-After when exceeding 50 req/min)
app.use(rateLimiter(50, 60));

// Mount v1 payments routes
app.use('/v1', paymentsRouter);

// Fallback for undefined routes
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: `Route ${req.method} ${req.url} not found`
    }
  });
});

// Centralized error handler
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'An unexpected internal error occurred'
    }
  });
});

module.exports = app;
