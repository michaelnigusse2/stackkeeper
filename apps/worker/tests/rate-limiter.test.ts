import { test } from "node:test";
import assert from "node:assert/strict";
import { HostRateLimiter, jitter } from "../src/rate-limiter.ts";

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

test("spends the burst, then refuses until tokens refill", () => {
  const time = clock();
  const limiter = new HostRateLimiter({ ratePerSecond: 1, burst: 3 }, time.now);

  assert.ok(limiter.tryTake("rdap.verisign.com"));
  assert.ok(limiter.tryTake("rdap.verisign.com"));
  assert.ok(limiter.tryTake("rdap.verisign.com"));
  assert.equal(limiter.tryTake("rdap.verisign.com"), false);

  time.advance(1000);
  assert.ok(limiter.tryTake("rdap.verisign.com"));
});

test("reports how long the caller should wait", () => {
  const time = clock();
  const limiter = new HostRateLimiter({ ratePerSecond: 2, burst: 1 }, time.now);

  assert.equal(limiter.delayFor("a.example"), 0);
  limiter.tryTake("a.example");
  assert.equal(limiter.delayFor("a.example"), 500);

  time.advance(500);
  assert.equal(limiter.delayFor("a.example"), 0);
});

test("keeps one host's limit away from another's", () => {
  const time = clock();
  const limiter = new HostRateLimiter({ ratePerSecond: 1, burst: 1 }, time.now);

  assert.ok(limiter.tryTake("a.example"));
  assert.equal(limiter.tryTake("a.example"), false);
  assert.ok(limiter.tryTake("b.example"), "a second host has its own bucket");
});

test("never accumulates more than the burst while idle", () => {
  const time = clock();
  const limiter = new HostRateLimiter({ ratePerSecond: 1, burst: 2 }, time.now);

  time.advance(60_000);
  assert.ok(limiter.tryTake("a.example"));
  assert.ok(limiter.tryTake("a.example"));
  assert.equal(limiter.tryTake("a.example"), false);
});

test("honours a back-off and doubles it when refused again", () => {
  const time = clock();
  const limiter = new HostRateLimiter({ ratePerSecond: 10, burst: 10 }, time.now);

  limiter.backOff("strict.example", 60);
  assert.ok(limiter.isBlocked("strict.example"));
  assert.equal(limiter.tryTake("strict.example"), false);
  assert.equal(limiter.delayFor("strict.example"), 60_000);

  // Refused again while still blocked: wait twice as long, not the same again.
  limiter.backOff("strict.example", 10);
  assert.equal(limiter.delayFor("strict.example"), 120_000);

  time.advance(120_001);
  assert.equal(limiter.isBlocked("strict.example"), false);
  assert.ok(limiter.tryTake("strict.example"));
});

test("jitter stays within its spread and averages out", () => {
  assert.equal(jitter(1000, 0.2, () => 0), 800);
  assert.equal(jitter(1000, 0.2, () => 1), 1200);
  assert.equal(jitter(1000, 0.2, () => 0.5), 1000);
});
