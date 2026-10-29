'use strict';

const MAX_KEYS = 50000;

/**
 * In-memory sliding-window limiter. Every rule must pass for a hit to be allowed.
 * A denied attempt is NOT recorded, so a blocked client does not extend its own block.
 */
class RateLimiter {
  constructor(rules) {
    this.rules = rules;
    this.hits = new Map();
    this.longestWindow = Math.max(...rules.map((rule) => rule.windowMs));
  }

  _recent(rule, key, now) {
    const list = this.hits.get(`${rule.name}|${key}`) || [];
    const cutoff = now - rule.windowMs;
    let start = 0;
    while (start < list.length && list[start] <= cutoff) start += 1;
    return start ? list.slice(start) : list;
  }

  /** @returns {{allowed: boolean, retryAfterSec: number}} */
  consume(key, now = Date.now()) {
    let retryAfterMs = 0;
    const recents = [];

    for (const rule of this.rules) {
      const recent = this._recent(rule, key, now);
      recents.push(recent);
      if (recent.length >= rule.max) {
        retryAfterMs = Math.max(retryAfterMs, recent[0] + rule.windowMs - now);
      }
    }

    if (retryAfterMs > 0) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    // Fail closed if an attacker tries to fill memory with unique keys.
    if (this.hits.size >= MAX_KEYS) {
      this.sweep(now);
      if (this.hits.size >= MAX_KEYS) return { allowed: false, retryAfterSec: 60 };
    }

    this.rules.forEach((rule, index) => {
      const recent = recents[index];
      recent.push(now);
      this.hits.set(`${rule.name}|${key}`, recent);
    });
    return { allowed: true, retryAfterSec: 0 };
  }

  sweep(now = Date.now()) {
    for (const [mapKey, list] of this.hits) {
      const ruleName = mapKey.slice(0, mapKey.indexOf('|'));
      const rule = this.rules.find((r) => r.name === ruleName);
      const cutoff = now - (rule ? rule.windowMs : this.longestWindow);
      if (!list.length || list[list.length - 1] <= cutoff) this.hits.delete(mapKey);
    }
  }

  startSweeper(intervalMs = 60 * 1000) {
    const timer = setInterval(() => this.sweep(), intervalMs);
    timer.unref();
    return timer;
  }
}

module.exports = { RateLimiter };
