/**
 * Mock Database Layer (In-memory persistent datastore abstraction)
 * Tracks payments and unique transaction references.
 */
class MockDatabase {
  constructor() {
    this.payments = new Map();
    this.refIndex = new Map();
  }

  async findTransactionByRef(transactionRef) {
    if (!transactionRef) return null;
    const paymentId = this.refIndex.get(transactionRef);
    if (!paymentId) return null;
    return this.payments.get(paymentId) || null;
  }

  async savePayment(payment) {
    if (!payment || !payment.id) {
      throw new Error('Payment must have an id');
    }
    this.payments.set(payment.id, { ...payment });
    if (payment.transaction_ref) {
      this.refIndex.set(payment.transaction_ref, payment.id);
    }
    return { ...payment };
  }

  async getPayment(id) {
    return this.payments.get(id) || null;
  }

  async getAllPayments() {
    return Array.from(this.payments.values());
  }

  async clear() {
    this.payments.clear();
    this.refIndex.clear();
  }
}

const db = new MockDatabase();

module.exports = {
  MockDatabase,
  db
};
