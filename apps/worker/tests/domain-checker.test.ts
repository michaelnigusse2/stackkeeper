import { test } from "node:test";
import assert from "node:assert/strict";
import type { BootstrapFile } from "@stackkeeper/core";
import { checkDomain, clearBootstrapCache } from "../src/checkers/domain.ts";
import { HostRateLimiter } from "../src/rate-limiter.ts";

const BOOTSTRAP: BootstrapFile = {
  services: [[["com"], ["https://rdap.verisign.com/com/v1/"]]],
};

const RDAP_BODY = {
  ldhName: "EXAMPLE.COM",
  status: ["client transfer prohibited"],
  events: [{ eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" }],
  nameservers: [{ ldhName: "NS1.EXAMPLE.COM" }],
};

/** A fetch that answers from a script, and records what it was asked for. */
function stubFetch(
  responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>,
) {
  const calls: string[] = [];
  let index = 0;
  const impl = (async (input: string | URL) => {
    calls.push(String(input));
    const next = responses[Math.min(index++, responses.length - 1)]!;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: { get: (key: string) => next.headers?.[key.toLowerCase()] ?? null },
      json: async () => next.body,
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("reads a registration over RDAP", async () => {
  const { impl, calls } = stubFetch([{ status: 200, body: RDAP_BODY }]);
  const result = await checkDomain("www.example.com", { fetchImpl: impl, bootstrap: BOOTSTRAP });

  assert.equal(result.domain, "example.com", "looks up the registrable domain, not the host");
  assert.equal(result.source, "rdap");
  assert.equal(result.record?.expiresAt?.toISOString(), "2027-08-13T04:00:00.000Z");
  assert.equal(result.error, null);
  assert.equal(calls[0], "https://rdap.verisign.com/com/v1/domain/example.com");
});

test("converts an internationalised name before looking it up", async () => {
  const { impl, calls } = stubFetch([{ status: 200, body: RDAP_BODY }]);
  await checkDomain("bücher.com", { fetchImpl: impl, bootstrap: BOOTSTRAP });
  assert.ok(calls[0]?.endsWith("/domain/xn--bcher-kva.com"), `got ${calls[0]}`);
});

test("refuses anything that is not a registrable domain", async () => {
  const { impl, calls } = stubFetch([{ status: 200, body: RDAP_BODY }]);
  for (const input of ["203.0.113.10", "com", "localhost"]) {
    const result = await checkDomain(input, { fetchImpl: impl, bootstrap: BOOTSTRAP });
    assert.equal(result.source, "none", `${input} should not be looked up`);
    assert.match(result.error ?? "", /not a registrable domain/);
  }
  assert.equal(calls.length, 0, "no registry should have been contacted");
});

test("reports a rate limit and backs that host off", async () => {
  const limiter = new HostRateLimiter({ ratePerSecond: 10, burst: 10 });
  const { impl } = stubFetch([{ status: 429, headers: { "retry-after": "120" } }]);

  const result = await checkDomain("example.com", {
    fetchImpl: impl,
    bootstrap: BOOTSTRAP,
    limiter,
  });

  assert.equal(result.source, "none");
  assert.match(result.error ?? "", /rate limiting/);
  assert.ok(limiter.isBlocked("rdap.verisign.com"), "the host should now be in back-off");
});

test("treats 403 as a block too", async () => {
  const limiter = new HostRateLimiter({ ratePerSecond: 10, burst: 10 });
  const { impl } = stubFetch([{ status: 403 }]);
  await checkDomain("example.com", { fetchImpl: impl, bootstrap: BOOTSTRAP, limiter });
  assert.ok(limiter.isBlocked("rdap.verisign.com"));
});

test("says so plainly when the registry has never heard of the domain", async () => {
  const { impl } = stubFetch([{ status: 404 }]);
  const result = await checkDomain("example.com", { fetchImpl: impl, bootstrap: BOOTSTRAP });
  assert.equal(result.source, "rdap");
  assert.equal(result.record, null);
  assert.match(result.error ?? "", /no record/);
});

test("flags registries that publish no expiry date at all", async () => {
  const { impl } = stubFetch([{ status: 200, body: { ldhName: "EXAMPLE.DE", events: [] } }]);
  const result = await checkDomain("example.de", {
    fetchImpl: impl,
    // .de is absent from the bootstrap file; the built-in table supplies it.
    bootstrap: BOOTSTRAP,
  });
  assert.equal(result.expiryUnavailable, true, "a date must be entered by hand for .de");
  assert.equal(result.record?.expiresAt ?? null, null);
});

test("a .com is not marked as lacking a published expiry", async () => {
  const { impl } = stubFetch([{ status: 200, body: RDAP_BODY }]);
  const result = await checkDomain("example.com", { fetchImpl: impl, bootstrap: BOOTSTRAP });
  assert.equal(result.expiryUnavailable, false);
});

test("caches the bootstrap file rather than fetching it per domain", async () => {
  clearBootstrapCache();
  const { impl, calls } = stubFetch([
    { status: 200, body: BOOTSTRAP },
    { status: 200, body: RDAP_BODY },
    { status: 200, body: RDAP_BODY },
  ]);

  await checkDomain("example.com", { fetchImpl: impl });
  await checkDomain("example.com", { fetchImpl: impl });

  const bootstrapCalls = calls.filter((url) => url.includes("data.iana.org"));
  assert.equal(bootstrapCalls.length, 1, "the bootstrap file should be fetched once");
  clearBootstrapCache();
});
