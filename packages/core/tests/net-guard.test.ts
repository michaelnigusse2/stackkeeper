import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allAddressesAllowed, checkAddress, isAllowedPort, isPlausibleHostname, parseIpv4,
} from "../src/net-guard.ts";

test("allows ordinary public addresses", () => {
  for (const address of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700::6810:85e5"]) {
    assert.equal(checkAddress(address).allowed, true, `${address} should be allowed`);
  }
});

test("blocks loopback, private and link-local ranges", () => {
  const cases: Array<[string, string]> = [
    ["127.0.0.1", "loopback"],
    ["127.99.1.2", "loopback"],
    ["10.0.0.5", "private"],
    ["172.16.4.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["100.64.0.1", "private"],
    ["169.254.10.1", "link_local"],
    ["0.0.0.0", "unspecified"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "reserved"],
  ];
  for (const [address, reason] of cases) {
    const verdict = checkAddress(address);
    assert.equal(verdict.allowed, false, `${address} should be blocked`);
    assert.equal(verdict.reason, reason, `${address} should be blocked as ${reason}`);
  }
});

test("blocks the cloud metadata endpoint specifically", () => {
  assert.equal(checkAddress("169.254.169.254").reason, "cloud_metadata");
});

test("does not let 172.32 or 172.15 be mistaken for private space", () => {
  assert.equal(checkAddress("172.32.0.1").allowed, true);
  assert.equal(checkAddress("172.15.0.1").allowed, true);
});

test("judges IPv4-mapped IPv6 addresses as the IPv4 they are", () => {
  assert.equal(checkAddress("::ffff:127.0.0.1").reason, "loopback");
  assert.equal(checkAddress("::ffff:10.0.0.1").reason, "private");
  assert.equal(checkAddress("::ffff:8.8.8.8").allowed, true);
});

test("blocks IPv6 loopback, unique local and link-local", () => {
  assert.equal(checkAddress("::1").reason, "loopback");
  assert.equal(checkAddress("fd00::1").reason, "private");
  assert.equal(checkAddress("fc00::1").reason, "private");
  assert.equal(checkAddress("fe80::1").reason, "link_local");
  assert.equal(checkAddress("ff02::1").reason, "multicast");
  assert.equal(checkAddress("::").reason, "unspecified");
});

test("ignores a zone identifier when judging", () => {
  assert.equal(checkAddress("fe80::1%eth0").reason, "link_local");
});

test("rejects anything it cannot parse", () => {
  for (const value of ["", "  ", "not-an-address", "1.2.3", "1.2.3.4.5", "999.1.1.1", "1.2.3.-1"]) {
    assert.equal(checkAddress(value).allowed, false, `${value} should not be allowed`);
  }
});

test("parses dotted quads strictly", () => {
  assert.deepEqual(parseIpv4("192.168.0.1"), [192, 168, 0, 1]);
  assert.equal(parseIpv4("192.168.0"), null);
  assert.equal(parseIpv4("192.168.0.256"), null);
  assert.equal(parseIpv4("0x7f.0.0.1"), null);
});

test("one bad address in a set blocks the whole name", () => {
  assert.equal(allAddressesAllowed(["8.8.8.8", "1.1.1.1"]).allowed, true);
  assert.equal(allAddressesAllowed(["8.8.8.8", "127.0.0.1"]).allowed, false);
  assert.equal(allAddressesAllowed([]).allowed, false);
});

test("only the ports the monitor needs are open to it", () => {
  assert.ok(isAllowedPort(443));
  assert.ok(isAllowedPort(43));
  assert.ok(!isAllowedPort(22));
  assert.ok(!isAllowedPort(3306));
  assert.ok(!isAllowedPort(6379));
});

test("refuses hostnames that resolve locally by convention", () => {
  assert.ok(isPlausibleHostname("example.com"));
  assert.ok(isPlausibleHostname("a.b.c.example.co.uk"));
  assert.ok(!isPlausibleHostname("localhost"));
  assert.ok(!isPlausibleHostname("db.internal"));
  assert.ok(!isPlausibleHostname("printer.local"));
  assert.ok(!isPlausibleHostname(""));
  assert.ok(!isPlausibleHostname("has space.com"));
  assert.ok(!isPlausibleHostname("-leading.com"));
});
