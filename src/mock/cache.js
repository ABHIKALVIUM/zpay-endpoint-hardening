/**
 * Mock Cache Layer (In-memory Redis-like abstraction)
 * Supports get, set (with TTL), incr (with sliding/fixed window), and clear.
 */
class MockCache {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
    const item = this.store.get(key);
    if (!item) return null;

    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return item.value;
  }

  async set(key, value, ttlSeconds = 86400) {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, {
      value,
      expiresAt
    });
    return 'OK';
  }

  async incr(key, windowSeconds = 60) {
    const now = Date.now();
    const item = this.store.get(key);

    if (!item || (item.expiresAt && now > item.expiresAt)) {
      const expiresAt = now + windowSeconds * 1000;
      this.store.set(key, {
        value: 1,
        expiresAt
      });
      return 1;
    }

    item.value = (Number(item.value) || 0) + 1;
    return item.value;
  }

  async ttl(key) {
    const item = this.store.get(key);
    if (!item) return -2;
    if (!item.expiresAt) return -1;
    const remaining = Math.ceil((item.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  async del(key) {
    return this.store.delete(key);
  }

  async clear() {
    this.store.clear();
  }
}

const cache = new MockCache();

module.exports = {
  MockCache,
  cache
};
