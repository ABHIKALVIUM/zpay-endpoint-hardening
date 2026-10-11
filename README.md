# ZPay Payment API Endpoint Hardening

Production-grade hardening implementation for the ZPay payment processing service (`POST /v1/payments`).

This service implements four core reliability decisions to ensure resilient payment processing under real-world failures, high-concurrency spikes, and backward compatibility during contract evolution.

---

## The Four Reliability Decisions

### 1. Semantic Error Responses & HTTP Status Codes
Every error response returns standard, structured JSON following the contract:
```json
{
  "error": {
    "code": "error_code_slug",
    "param": "field_name",
    "message": "human readable message"
  }
}
```

| HTTP Status | Trigger Scenario | Error Code Slug | Response Contract |
|---|---|---|---|
| **400 Bad Request** | Missing `amount` field | `required` | `{ "error": { "param": "amount", "code": "required", "message": "The amount field is required" } }` |
| **400 Bad Request** | Reusing `Idempotency-Key` with different amount | `idempotency_conflict` | `{ "error": { "code": "idempotency_conflict", "param": "amount", "message": "Idempotency-Key sent before with different amount." } }` |
| **401 Unauthorized** | Missing or invalid auth token | `auth_failed` | `{ "error": { "code": "auth_failed", "message": "Authentication token missing or invalid" } }` |
| **403 Forbidden** | Authenticated user with `viewer` role attempting write | `permission_denied` | `{ "error": { "code": "permission_denied", "message": "Authenticated user with insufficient role" } }` |
| **422 Unprocessable** | Amount exceeds ₹1,00,000 limit | `limit_exceeded` | `{ "error": { "param": "amount", "code": "limit_exceeded", "max": 100000, "message": "Amount exceeds the maximum allowed limit of ₹1,00,000" } }` |
| **409 Conflict** | Duplicate `transaction_ref` already processed | `duplicate` | `{ "error": { "code": "duplicate", "param": "transaction_ref", "existing_id": "<id>", "message": "..." } }` |
| **429 Too Many Requests** | Exceeding 50 requests/min quota | `rate_limit_exceeded` | `{ "error": { "code": "rate_limit_exceeded", "limit": "50 per minute", "retry_after_seconds": 60, "message": "..." } }` |

### 2. Idempotency & Retry Safety
- Clients send the `Idempotency-Key` header with payment requests.
- **First request**: Processed normally, stores the result in cache with 24h TTL, returns `201 Created`.
- **Retry with same key and same amount**: Returns original cached response immediately with `201 Created` without duplicate payment creation or double-charging.
- **Retry with same key but different amount**: Rejected with `400 Bad Request` and message `"Idempotency-Key sent before with different amount."`.

### 3. Rate Limiting & Abuse Defense
- Rate limiter middleware enforces **50 requests per minute per authenticated user** (`rate:${userId}`).
- When quota is exceeded, returns `429 Too Many Requests`.
- Sets `Retry-After: 60` HTTP response header indicating seconds until quota resets.

### 4. API Versioning & Backward Compatibility
- In `v1`, accepts both `amount` and legacy `amount_inr` fields.
- If only `amount_inr` is provided, normalizes it as `amount`.
- If both fields are provided, prioritizes `amount`.
- Code comment explicitly marks fallback for removal in v2 (`// v2: remove amount_inr fallback`).

---

## Project Structure

```
zpay-endpoint-hardening/
├── src/
│   ├── app.js                 # Express application & middleware assembly
│   ├── server.js              # Server entrypoint
│   ├── middleware/
│   │   ├── auth.js            # Authentication middleware (401)
│   │   ├── authorize.js       # Role authorization middleware (403)
│   │   ├── rateLimiter.js     # Rate limiting middleware (429 + Retry-After)
│   │   └── versioning.js      # Backward compatibility normalization (v1 -> v2)
│   ├── mock/
│   │   ├── db.js              # Mock database for payments & transaction refs
│   │   └── cache.js           # Mock cache for idempotency & rate limits
│   └── routes/
│       └── payments.js        # POST /v1/payments route handler
├── test/
│   └── payments.test.js       # Comprehensive test suite (12 tests)
├── package.json
└── README.md
```

---

## Local Setup Instructions

### Prerequisites
- Node.js >= 18.0.0 (v20+ recommended)
- npm >= 9.0.0

### 1. Installation
```bash
npm install
```

### 2. Run the Server
```bash
npm start
```
The server will start on `http://localhost:3000`.

### 3. Run Automated Tests
```bash
npm test
```
Runs the full automated test suite verifying all 4 reliability decisions and edge cases.

---

## cURL Examples

### Test Credentials
- **Operator Token (Write access)**: `Authorization: Bearer operator-token`
- **Admin Token (Write access)**: `Authorization: Bearer admin-token`
- **Viewer Token (Read-only access)**: `Authorization: Bearer viewer-token`

---

### 1. Successful Payment Creation (201 Created)
```bash
curl -X POST http://localhost:3000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer operator-token" \
  -H "Idempotency-Key: idem_001" \
  -d '{
    "amount": 2500,
    "transaction_ref": "tx_20261011_001"
  }'
```
**Response (201 Created):**
```json
{
  "id": "pay_1776000000000_abc12",
  "amount": 2500,
  "currency": "INR",
  "status": "processed",
  "transaction_ref": "tx_20261011_001",
  "user_id": "usr_operator_01",
  "created_at": "2026-10-11T07:15:00.000Z"
}
```

---

### 2. Idempotent Retry (201 Replay - Same Key + Same Amount)
```bash
curl -X POST http://localhost:3000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer operator-token" \
  -H "Idempotency-Key: idem_001" \
  -d '{
    "amount": 2500,
    "transaction_ref": "tx_20261011_001"
  }'
```
**Response (201 Created):**
Returns original payment response immediately without second charge.

---

### 3. Idempotency Conflict (400 Bad Request - Same Key + Different Amount)
```bash
curl -X POST http://localhost:3000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer operator-token" \
  -H "Idempotency-Key: idem_001" \
  -d '{
    "amount": 5000
  }'
```
**Response (400 Bad Request):**
```json
{
  "error": {
    "code": "idempotency_conflict",
    "param": "amount",
    "message": "Idempotency-Key sent before with different amount."
  }
}
```

---

### 4. Missing Amount (400 Bad Request)
```bash
curl -X POST http://localhost:3000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer operator-token" \
  -d '{
    "transaction_ref": "tx_test_missing"
  }'
```
**Response (400 Bad Request):**
```json
{
  "error": {
    "code": "required",
    "param": "amount",
    "message": "The amount field is required"
  }
}
```

---

### 5. Missing / Invalid Auth Token (401 Unauthorized)
```bash
curl -X POST http://localhost:3000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid-token" \
  -d '{
    "amount": 500
  }'
```
**Response (401 Unauthorized):**
```json
{
  "error": {
    "code": "auth_failed",
    "message": "Authentication token missing or invalid"
  }
}
```

---

### 6. Viewer Role Insufficient Permissions (403 Forbidden)
```bash
curl -X POST http://localhost:3000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer viewer-token" \
  -d '{
    "amount": 500
  }'
```
**Response (403 Forbidden):**
```json
{
  "error": {
    "code": "permission_denied",
    "message": "Authenticated user with insufficient role"
  }
}
```

---

### 7. Duplicate Transaction Reference (409 Conflict)
```bash
curl -X POST http://localhost:3000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer operator-token" \
  -d '{
    "amount": 3000,
    "transaction_ref": "tx_20261011_001"
  }'
```
**Response (409 Conflict):**
```json
{
  "error": {
    "code": "duplicate",
    "param": "transaction_ref",
    "existing_id": "pay_1776000000000_abc12",
    "message": "Transaction reference 'tx_20261011_001' has already been processed"
  }
}
```

---

### 8. Amount Exceeding Limit ₹1,00,000 (422 Unprocessable Entity)
```bash
curl -X POST http://localhost:3000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer operator-token" \
  -d '{
    "amount": 150000
  }'
```
**Response (422 Unprocessable Entity):**
```json
{
  "error": {
    "code": "limit_exceeded",
    "param": "amount",
    "max": 100000,
    "message": "Amount exceeds the maximum allowed limit of ₹1,00,000"
  }
}
```

---

### 9. Rate Limit Exceeded (429 Too Many Requests)
*Triggered after sending > 50 requests in a 60-second window by the same user.*
```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer operator-token" \
  -d '{"amount": 100}'
```
**Response (429 Too Many Requests):**
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{
  "error": {
    "code": "rate_limit_exceeded",
    "limit": "50 per minute",
    "retry_after_seconds": 60,
    "message": "Rate limit exceeded. Maximum 50 requests per minute allowed."
  }
}
```

---

### 10. Backward Compatibility Versioning (`amount_inr` Fallback)
```bash
curl -X POST http://localhost:3000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer operator-token" \
  -d '{
    "amount_inr": 8500
  }'
```
**Response (201 Created):**
```json
{
  "id": "pay_1776000000000_xyz89",
  "amount": 8500,
  "currency": "INR",
  "status": "processed",
  "transaction_ref": "tx_pay_1776000000000_xyz89",
  "user_id": "usr_operator_01",
  "created_at": "2026-10-11T07:15:00.000Z"
}
```

---

## Assumptions Made in the Implementation

1. **Storage Layers**: In-memory mock layers (`MockDatabase` and `MockCache`) simulate PostgreSQL and Redis operations cleanly for isolation, testing, and zero external infrastructure setup dependencies.
2. **Authentication**: Tokens are passed via the standard `Authorization: Bearer <token>` header. A mock token resolver maps known test tokens (`operator-token`, `admin-token`, `viewer-token`) to user identities.
3. **Roles & Permissions**: The endpoint represents a state-mutating financial write operation; `operator` and `admin` roles are permitted, while `viewer` role is restricted (403).
4. **Idempotency Window**: Cached idempotent requests are preserved with an 86,400-second (24-hour) TTL.
5. **Rate Limiting**: Rate tracking is scoped per authenticated user (`rate:${user.id}`) across a 60-second sliding/fixed window with 50 request ceiling.
6. **Currency & Limits**: Currency is defaulted to `INR`, and maximum transaction single charge limit is set to ₹1,00,000 (422 business validation).
