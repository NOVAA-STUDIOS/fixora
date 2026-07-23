// A minimal bounded response cache with time-based expiry.

export class ResponseCache {
  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  set(key, value, ttlMs) {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get(key) {
    const hit = this.entries.get(key);
    if (hit === undefined) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  // BUG: `size === NaN` is always false, so a NaN maxEntries is never reported as unbounded.
  isUnbounded() {
    return this.maxEntries === NaN;
  }
}
