import { test } from "node:test";
import assert from "node:assert/strict";
import { isMonitorable, planMonitors } from "../src/monitor-plan.ts";

test("a domain gets both a registration watch and a certificate watch", () => {
  const planned = planMonitors({ kind: "domain", label: "acmebakery.com" });
  assert.deepEqual(planned.map((p) => p.kind), ["domain_expiry", "tls"]);
  assert.equal(planned[0]!.target, "acmebakery.com");
});

test("the registration is watched at the registrable name, not the hostname", () => {
  const planned = planMonitors({ kind: "domain", label: "shop.acmebakery.co.uk" });
  const registration = planned.find((p) => p.kind === "domain_expiry");
  assert.equal(registration?.target, "acmebakery.co.uk");
  // The certificate is still read from the exact host that serves it.
  assert.equal(planned.find((p) => p.kind === "tls")?.target, "shop.acmebakery.co.uk");
});

test("prefers the identifier when the label is a friendly name", () => {
  const planned = planMonitors({
    kind: "hosting",
    label: "Marketing site hosting",
    identifier: "www.acmebakery.com",
  });
  assert.equal(planned.length, 1);
  assert.equal(planned[0]!.kind, "tls");
  assert.equal(planned[0]!.target, "www.acmebakery.com");
});

test("a server recorded by IP address gets nothing rather than a monitor that always fails", () => {
  assert.deepEqual(planMonitors({ kind: "server", label: "web-01", identifier: "203.0.113.10" }), []);
  assert.equal(isMonitorable({ kind: "server", label: "web-01", identifier: "203.0.113.10" }), false);
});

test("a server with a hostname gets a certificate watch", () => {
  const planned = planMonitors({ kind: "server", label: "web-01", identifier: "web01.example.com" });
  assert.deepEqual(planned.map((p) => p.kind), ["tls"]);
});

test("kinds with nothing checkable from outside get nothing", () => {
  for (const kind of ["saas", "license", "email", "database", "storage", "other"]) {
    assert.deepEqual(planMonitors({ kind, label: "something.example.com" }), [], kind);
  }
});

test("strips a scheme and path from whatever was typed", () => {
  const planned = planMonitors({ kind: "domain", label: "https://Acme-Bakery.com/shop" });
  assert.equal(planned[0]!.target, "acme-bakery.com");
});

test("ignores a label that is not host-shaped", () => {
  assert.deepEqual(planMonitors({ kind: "domain", label: "Acme main domain" }), []);
  assert.deepEqual(planMonitors({ kind: "domain", label: "" }), []);
});

test("every planned monitor explains itself", () => {
  for (const planned of planMonitors({ kind: "domain", label: "example.com" })) {
    assert.ok(planned.reason.length > 10, "a reason the interface can show");
  }
});
