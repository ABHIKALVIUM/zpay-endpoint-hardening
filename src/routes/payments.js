const express = require('express');
const { db } = require('../mock/db');
const { cache } = require('../mock/cache');

const router = express.Router();

/**
 * POST /v1/payments
 * Hardened payment processing endpoint implementing:
 * 1. Semantic Error Responses (400, 401, 403, 409, 422, 429)
 * 2. Idempotency & Retry Safety (Idempotency-Key header)
 * 3. Rate Limiting (enforced via middleware)
 * 4. Versioning & Backward Compatibility (amount_inr fallback via middleware)
 */
router.post('/payments', async (req, res, next) => {
  try {
    const { amount, transaction_ref } = req.body;

    // Reliability Decision 1: Error Responses - Validate Required Fields
    if (amount === undefined || amount === null || amount === '') {
      return res.status(400).json({
        error: {
          code: 'required',
          param: 'amount',
          message: 'The amount field is required'
        }
      });
    }

    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        error: {
          code: 'invalid',
          param: 'amount',
          message: 'The amount must be a positive number'
        }
      });
    }

    // Reliability Decision 1: Error Responses - Business Rule Violation (Max ₹1,00,000)
    const MAX_AMOUNT = 100000;
    if (amount > MAX_AMOUNT) {
      return res.status(422).json({
        error: {
          code: 'limit_exceeded',
          param: 'amount',
          max: MAX_AMOUNT,
          message: `Amount exceeds the maximum allowed limit of ₹${MAX_AMOUNT.toLocaleString('en-IN')}`
        }
      });
    }

    // Reliability Decision 2: Idempotency Check
    const idempotencyKey = req.get('Idempotency-Key') || req.headers['idempotency-key'];
    if (idempotencyKey) {
      const cached = await cache.get(`idem:${idempotencyKey}`);
      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        const cachedAmount = parsed.amount !== undefined ? parsed.amount : parsed.response?.amount;

        // Reject if same idempotency key is reused with different amount
        if (cachedAmount !== amount) {
          return res.status(400).json({
            error: {
              code: 'idempotency_conflict',
              param: 'amount',
              message: 'Idempotency-Key sent before with different amount.'
            }
          });
        }

        // Return original cached result without re-charging
        const originalResponse = parsed.response || parsed;
        return res.status(201).json(originalResponse);
      }
    }

    // Reliability Decision 1: Error Responses - Duplicate Resource Conflict (409)
    if (transaction_ref) {
      const existing = await db.findTransactionByRef(transaction_ref);
      if (existing) {
        return res.status(409).json({
          error: {
            code: 'duplicate',
            param: 'transaction_ref',
            existing_id: existing.id,
            message: `Transaction reference '${transaction_ref}' has already been processed`
          }
        });
      }
    }

    // Perform payment charge
    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const payment = {
      id: paymentId,
      amount,
      currency: 'INR',
      status: 'processed',
      transaction_ref: transaction_ref || `tx_${paymentId}`,
      user_id: req.user.id,
      created_at: new Date().toISOString()
    };

    // Save to database
    await db.savePayment(payment);

    // Reliability Decision 2: Store Idempotent Response (24h TTL)
    if (idempotencyKey) {
      await cache.set(`idem:${idempotencyKey}`, JSON.stringify(payment), 86400);
    }

    return res.status(201).json(payment);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
