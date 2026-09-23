import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXTRA_RDAP_SERVERS, findRdapBase, hasStatus, normaliseStatus, parseRdapDomain,
  parseWhois, publishesExpiry, RdapError, rdapUrlFor, whoisHostFor,
  type BootstrapFile,
} from "../src/rdap.ts";

// Shaped after a real Verisign response for example.com.
const VERISIGN = {
  objectClassName: "domain",
  ldhName: "EXAMPLE.COM",
  status: ["client delete prohibited", "client transfer prohibited"],
  events: [
    { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
    { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" },
    { eventAction: "last changed", eventDate: "2026-08-14T07:01:44Z" },
  ],
  nameservers: [
    { objectClassName: "nameserver", ldhName: "A.IANA-SERVERS.NET" },
    { objectClassName: "nameserver", ldhName: "B.IANA-SERVERS.NET" },
  ],
  entities: [
    {
      objectClassName: "entity",
      handle: "376",
      roles: ["registrar"],
      vcardArray: [
        "vcard",
        [
          ["version", {}, "text", "4.0"],
          ["fn", {}, "text", "RESERVED-Internet Assigned Numbers Authority"],
        ],
      ],
    },
  ],
  secureDNS: { delegationSigned: true },
};

test("reads the fields that matter from an RDAP response", () => {
  const record = parseRdapDomain(VERISIGN);
  assert.equal(record.domain, "example.com");
  assert.equal(record.expiresAt?.toISOString(), "2027-08-13T04:00:00.000Z");
  assert.equal(record.registeredAt?.toISOString(), "1995-08-14T04:00:00.000Z");
  assert.equal(record.lastChangedAt?.toISOString(), "2026-08-14T07:01:44.000Z");
  assert.deepEqual(record.nameservers, ["a.iana-servers.net", "b.iana-servers.net"]);
  assert.equal(record.registrar, "RESERVED-Internet Assigned Numbers Authority");
  assert.equal(record.dnssec, true);
});

test("matches statuses across RDAP and EPP spellings", () => {
  const record = parseRdapDomain(VERISIGN);
  assert.ok(hasStatus(record.statuses, "clientTransferProhibited"));
  assert.ok(hasStatus(record.statuses, "client transfer prohibited"));
  assert.ok(!hasStatus(record.statuses, "clientHold"));
  assert.equal(normaliseStatus("Client Transfer Prohibited"), "clienttransferprohibited");
});

test("copes with a registry that publishes no expiry event", () => {
  const record = parseRdapDomain({
    ldhName: "SIDN.NL",
    events: [{ eventAction: "registration", eventDate: "1999-01-01T00:00:00Z" }],
  });
  assert.equal(record.expiresAt, null);
  assert.equal(record.registeredAt?.getUTCFullYear(), 1999);
});

test("survives missing, empty and malformed sections", () => {
  const record = parseRdapDomain({});
  assert.equal(record.domain, null);
  assert.equal(record.expiresAt, null);
  assert.deepEqual(record.statuses, []);
  assert.deepEqual(record.nameservers, []);
  assert.equal(record.registrar, null);
  assert.equal(record.dnssec, false);

  const messy = parseRdapDomain({
    events: [{ eventAction: "expiration", eventDate: "not a date" }, "junk", null],
    nameservers: ["junk", null, { ldhName: 42 }],
    entities: [null, { roles: ["registrar"] }],
  });
  assert.equal(messy.expiresAt, null);
  assert.deepEqual(messy.nameservers, []);
});

test("rejects a response that is not an object", () => {
  assert.throws(() => parseRdapDomain("nope"), RdapError);
  assert.throws(() => parseRdapDomain(null), RdapError);
});

const BOOTSTRAP: BootstrapFile = {
  publication: "2026-09-16T00:00:00Z",
  services: [
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
    [["uk"], ["http://rdap.nominet.uk/uk/", "https://rdap.nominet.uk/uk/"]],
    [["org"], ["https://rdap.publicinterestregistry.org/rdap"]],
  ],
};

test("finds a registry in the bootstrap file", () => {
  assert.equal(findRdapBase(BOOTSTRAP, "com"), "https://rdap.verisign.com/com/v1/");
  assert.equal(findRdapBase(BOOTSTRAP, "COM"), "https://rdap.verisign.com/com/v1/");
});

test("prefers HTTPS when a registry lists both", () => {
  assert.equal(findRdapBase(BOOTSTRAP, "uk"), "https://rdap.nominet.uk/uk/");
});

test("adds the trailing slash a base URL needs", () => {
  assert.equal(findRdapBase(BOOTSTRAP, "org"), "https://rdap.publicinterestregistry.org/rdap/");
});

test("falls back to the table of registries missing from the bootstrap", () => {
  assert.equal(findRdapBase(BOOTSTRAP, "de"), EXTRA_RDAP_SERVERS.de);
  assert.equal(findRdapBase(null, "io"), EXTRA_RDAP_SERVERS.io);
  assert.equal(findRdapBase(BOOTSTRAP, "zz"), null);
});

test("builds the query URL for a domain", () => {
  assert.equal(rdapUrlFor("Example.COM", BOOTSTRAP), "https://rdap.verisign.com/com/v1/domain/example.com");
  assert.equal(rdapUrlFor("example.zz", BOOTSTRAP), null);
  assert.equal(rdapUrlFor("nodots", BOOTSTRAP), null);
});

test("knows which registries publish no expiry date", () => {
  assert.ok(!publishesExpiry("de"));
  assert.ok(!publishesExpiry("nl"));
  assert.ok(publishesExpiry("com"));
  assert.ok(publishesExpiry("co.uk".split(".").pop()!));
});

test("reads a WHOIS response", () => {
  const text = [
    "Domain Name: EXAMPLE.COM",
    "Registrar: Example Registrar, Inc.",
    "Domain Status: clientTransferProhibited https://icann.org/epp#clientTransferProhibited",
    "Domain Status: clientDeleteProhibited https://icann.org/epp#clientDeleteProhibited",
    "Name Server: NS1.EXAMPLE.COM",
    "Name Server: NS2.EXAMPLE.COM",
    "Registry Expiry Date: 2027-08-13T04:00:00Z",
    ">>> Last update of whois database: 2026-09-20T12:00:00Z <<<",
  ].join("\n");

  const record = parseWhois(text);
  assert.equal(record.expiresAt?.toISOString(), "2027-08-13T04:00:00.000Z");
  assert.equal(record.registrar, "Example Registrar, Inc.");
  assert.deepEqual(record.nameservers, ["ns1.example.com", "ns2.example.com"]);
  assert.deepEqual(record.statuses, ["clientTransferProhibited", "clientDeleteProhibited"]);
});

test("reads the other date labels registries use", () => {
  for (const label of ["Expiration Date", "expires", "paid-till", "Valid until"]) {
    const record = parseWhois(`${label}: 2027-01-15T00:00:00Z`);
    assert.equal(
      record.expiresAt?.toISOString(),
      "2027-01-15T00:00:00.000Z",
      `should read "${label}"`,
    );
  }
});

test("reports an unknown date as unknown rather than guessing", () => {
  const record = parseWhois("Domain Name: EXAMPLE.DE\nStatus: connect\n");
  assert.equal(record.expiresAt, null);
  assert.deepEqual(record.statuses, ["connect"]);
});

test("names the conventional WHOIS host", () => {
  assert.equal(whoisHostFor("COM"), "com.whois-servers.net");
});
