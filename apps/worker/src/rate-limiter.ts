/**
 * A token bucket per host.
 *
 * Registries are strict and unforgiving: rdap.org allows ten requests every
 * ten seconds, Nominet blocks an address for the best part of a day after
 * sustained querying. One bucket per host, refilling steadily, keeps the
 * worker inside those limits without a central scheduler.
 *
 * Pure and clock-injectable, so its behaviour can be tested without waiting.
 */

export interface BucketOptions {
  /** Sustained rate, in requests per second. */
  readonly ratePerSecond: number;
  /** How many requests may be spent at once after an idle period. */
  readonly burst: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
  /** Set while a host is in a back-off imposed by a 429 or a 403. */
  blockedUntil: number;
}

export class HostRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly options: BucketOptions;
  private readonly now: () => number;

  // Fields are assigned explicitly rather than through constructor parameter
  // properties, which Node cannot strip when it runs TypeScript directly.
  constructor(
    options: BucketOptions = { ratePerSecond: 1, burst: 3 },
    now: () => number = Date.now,
  ) {
    this.options = options;
    this.now = now;
  }

  /** Milliseconds to wait before this host may be queried. Zero means now. */
  delayFor(host: string): number {
    const bucket = this.bucketFor(host);
    const time = this.now();

    if (bucket.blockedUntil > time) return bucket.blockedUntil - time;

    this.refill(bucket, time);
    if (bucket.tokens >= 1) return 0;

    const missing = 1 - bucket.tokens;
    return Math.ceil((missing / this.options.ratePerSecond) * 1000);
  }

  /** Spend a token if one is available. Returns false when the caller must wait. */
  tryTake(host: string): boolean {
    const bucket = this.bucketFor(host);
    const time = this.now();
    if (bucket.blockedUntil > time) return false;

    this.refill(bucket, time);
    if (bucket.tokens < 1) return false;

    bucket.tokens -= 1;
    return true;
  }

  /**
   * Record a refusal. A 429 with Retry-After is honoured exactly; anything
   * else backs off for the given number of seconds, doubling on repeats.
   */
  backOff(host: string, seconds: number): void {
    const bucket = this.bucketFor(host);
    const time = this.now();
    const alreadyBlocked = Math.max(0, bucket.blockedUntil - time);
    const requested = seconds * 1000;
    bucket.blockedUntil = time + Math.max(requested, alreadyBlocked * 2);
    bucket.tokens = 0;
  }

  isBlocked(host: string): boolean {
    return this.bucketFor(host).blockedUntil > this.now();
  }

  clear(host: string): void {
    this.buckets.delete(host);
  }

  private bucketFor(host: string): Bucket {
    let bucket = this.buckets.get(host);
    if (!bucket) {
      bucket = { tokens: this.options.burst, lastRefill: this.now(), blockedUntil: 0 };
      this.buckets.set(host, bucket);
    }
    return bucket;
  }

  private refill(bucket: Bucket, time: number): void {
    const elapsedSeconds = Math.max(0, (time - bucket.lastRefill) / 1000);
    bucket.tokens = Math.min(
      this.options.burst,
      bucket.tokens + elapsedSeconds * this.options.ratePerSecond,
    );
    bucket.lastRefill = time;
  }
}

/** Spread work over a window so a thousand monitors do not fire together. */
export function jitter(baseMs: number, spread = 0.2, random: () => number = Math.random): number {
  const delta = baseMs * spread;
  return Math.round(baseMs - delta + random() * delta * 2);
}
