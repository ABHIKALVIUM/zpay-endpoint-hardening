const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { db } = require('../src/mock/db');
const { cache } = require('../src/mock/cache');

describe('POST /v1/payments - Endpoint Hardening Suite', () => {
  const validToken = 'Bearer operator-token';
  const viewerToken = 'Bearer viewer-token';
  const adminToken = 'Bearer admin-token';

  beforeEach(async () => {
    await db.clear();
    await cache.clear();
  });

  describe('1. Error Responses & Status Codes', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app)
        .post('/v1/payments')
        .send({ amount: 500 });

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'auth_failed');
      assert.ok(res.body.error.message);
    });

    it('returns 401 when Authorization token is invalid', async () => {
      const res = await request(app)
        .post('/v1/payments')
        .set('Authorization', 'Bearer invalid-token')
        .send({ amount: 500 });

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'auth_failed');
      assert.ok(res.body.error.message);
    });

    it('returns 403 when authenticated user has viewer role', async () => {
      const res = await request(app)
        .post('/v1/payments')
        .set('Authorization', viewerToken)
        .send({ amount: 500 });

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'permission_denied');
      assert.ok(res.body.error.message);
    });

    it('returns 400 when amount field is missing', async () => {
      const res = await request(app)
        .post('/v1/payments')
        .set('Authorization', validToken)
        .send({ transaction_ref: 'tx_missing_amount' });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'required');
      assert.equal(res.body.error.param, 'amount');
      assert.ok(res.body.error.message);
    });

    it('returns 422 when amount exceeds maximum limit of ₹1,00,000', async () => {
      const res = await request(app)
        .post('/v1/payments')
        .set('Authorization', validToken)
        .send({ amount: 150000 });

      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'limit_exceeded');
      assert.equal(res.body.error.param, 'amount');
      assert.equal(res.body.error.max, 100000);
      assert.ok(res.body.error.message);
    });

    it('returns 409 when duplicate transaction_ref has already been processed', async () => {
      const firstRes = await request(app)
        .post('/v1/payments')
        .set('Authorization', validToken)
        .send({ amount: 1000, transaction_ref: 'tx_dup_test_01' });

      assert.equal(firstRes.status, 201);
      const originalId = firstRes.body.id;

      const dupRes = await request(app)
        .post('/v1/payments')
        .set('Authorization', validToken)
        .send({ amount: 2000, transaction_ref: 'tx_dup_test_01' });

      assert.equal(dupRes.status, 409);
      assert.equal(dupRes.body.error.code, 'duplicate');
      assert.equal(dupRes.body.error.param, 'transaction_ref');
      assert.equal(dupRes.body.error.existing_id, originalId);
      assert.ok(dupRes.body.error.message);
    });
  });

  describe('2. Idempotency & Retry Safety', () => {
    it('returns 201 on first request and subsequent retries with same key and amount return identical cached response', async () => {
      const key = 'idem_key_test_001';

      // First request
      const firstRes = await request(app)
        .post('/v1/payments')
        .set('Authorization', validToken)
        .set('Idempotency-Key', key)
        .send({ amount: 5000, transaction_ref: 'tx_retry_001' });

      assert.equal(firstRes.status, 201);
      assert.equal(firstRes.body.amount, 5000);
      const originalPayment = firstRes.body;

      // Ensure single payment in database
      const initialPayments = await db.getAllPayments();
      assert.equal(initialPayments.length, 1);

      // Retry with same key and same amount
      const retryRes = await request(app)
        .post('/v1/payments')
        .set('Authorization', validToken)
        .set('Idempotency-Key', key)
        .send({ amount: 5000, transaction_ref: 'tx_retry_001' });

      assert.equal(retryRes.status, 201);
      assert.deepEqual(retryRes.body, originalPayment);

      // Verify no second charge / duplicate record was created
      const subsequentPayments = await db.getAllPayments();
      assert.equal(subsequentPayments.length, 1);
    });

    it('returns 400 when same Idempotency-Key is sent with different amount', async () => {
      const key = 'idem_key_mismatch_002';

      // First request with 2500
      const firstRes = await request(app)
        .post('/v1/payments')
        .set('Authorization', validToken)
        .set('Idempotency-Key', key)
        .send({ amount: 2500 });

      assert.equal(firstRes.status, 201);

      // Second request with same key but 4000
      const conflictRes = await request(app)
        .post('/v1/payments')
        .set('Authorization', validToken)
        .set('Idempotency-Key', key)
        .send({ amount: 4000 });

      assert.equal(conflictRes.status, 400);
      assert.equal(conflictRes.body.error.code, 'idempotency_conflict');
      assert.equal(conflictRes.body.error.param, 'amount');
      assert.equal(conflictRes.body.error.message, 'Idempotency-Key sent before with different amount.');
    });
  });

  describe('3. Rate Limiting (50 requests/min)', () => {
    it('allows up to 50 requests and returns 429 + Retry-After header on 51st request', async () => {
      const userToken = 'Bearer operator-token';

      // Fire 50 requests
      for (let i = 1; i <= 50; i++) {
        const res = await request(app)
          .post('/v1/payments')
          .set('Authorization', userToken)
          .send({ amount: 100, transaction_ref: `tx_rate_${i}` });

        assert.equal(res.status, 201);
      }

      // 51st request must trigger 429
      const rateLimitedRes = await request(app)
        .post('/v1/payments')
        .set('Authorization', userToken)
        .send({ amount: 100, transaction_ref: 'tx_rate_51' });

      assert.equal(rateLimitedRes.status, 429);
      assert.equal(rateLimitedRes.headers['retry-after'], '60');
      assert.equal(rateLimitedRes.body.error.code, 'rate_limit_exceeded');
      assert.equal(rateLimitedRes.body.error.limit, '50 per minute');
      assert.equal(rateLimitedRes.body.error.retry_after_seconds, 60);
      assert.ok(rateLimitedRes.body.error.message);
    });
  });

  describe('4. Versioning & Backward Compatibility', () => {
    it('accepts amount_inr as fallback when amount is not provided', async () => {
      const res = await request(app)
        .post('/v1/payments')
        .set('Authorization', validToken)
        .send({ amount_inr: 7500 });

      assert.equal(res.status, 201);
      assert.equal(res.body.amount, 7500);
    });

    it('prioritizes amount when both amount and amount_inr are provided', async () => {
      const res = await request(app)
        .post('/v1/payments')
        .set('Authorization', validToken)
        .send({ amount: 3000, amount_inr: 8000 });

      assert.equal(res.status, 201);
      assert.equal(res.body.amount, 3000);
    });
  });

  describe('5. Role Permissions (Admin and Operator)', () => {
    it('allows admin role to process payments', async () => {
      const res = await request(app)
        .post('/v1/payments')
        .set('Authorization', adminToken)
        .send({ amount: 1200 });

      assert.equal(res.status, 201);
      assert.equal(res.body.amount, 1200);
    });
  });
});
