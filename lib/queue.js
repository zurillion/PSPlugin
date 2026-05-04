// Throttle semplice per evitare di stressare gli endpoint Sony.
// Ogni chiamata aspetta che siano passati almeno minDelayMs dall'ultima.
// In caso di 429/403/5xx ritenta con backoff esponenziale.

export class RateLimitedQueue {
  constructor({ minDelayMs = 1500, maxRetries = 3 } = {}) {
    this.minDelayMs = minDelayMs;
    this.maxRetries = maxRetries;
    this.lastRequestAt = 0;
    this.chain = Promise.resolve();
  }

  run(fn) {
    const next = this.chain.then(() => this._execute(fn));
    this.chain = next.catch(() => {});
    return next;
  }

  async _execute(fn) {
    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const since = Date.now() - this.lastRequestAt;
      const baseWait = Math.max(0, this.minDelayMs - since);
      const backoff = attempt > 0 ? this.minDelayMs * Math.pow(2, attempt) : 0;
      const wait = baseWait + backoff;
      if (wait > 0) await sleep(wait);

      this.lastRequestAt = Date.now();
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const status = e?.status;
        const retryable = status === 429 || status === 403 || (status >= 500 && status < 600);
        if (!retryable) throw e;
      }
    }
    throw lastErr;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
