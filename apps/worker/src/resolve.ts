import { lookup } from "node:dns/promises";
import {
  allAddressesAllowed, explainBlock, isAllowedPort, isPlausibleHostname,
} from "@stackkeeper/core";

/**
 * Resolve a hostname and decide whether the worker may connect to it.
 *
 * Order matters. The name is resolved first and every address it returns is
 * judged, because a name under someone else's control can point at anything,
 * including this machine. Connections are then made to the address that was
 * checked, not by passing the name to the socket again, which would leave a
 * gap between the check and the connection for the record to change.
 */

export class BlockedHostError extends Error {
  readonly host: string;

  constructor(host: string, detail: string) {
    super(`Refusing to connect to ${host}: ${detail}`);
    this.name = "BlockedHostError";
    this.host = host;
  }
}

export interface ResolvedTarget {
  readonly host: string;
  readonly addresses: readonly string[];
  readonly port: number;
}

export async function resolveTarget(host: string, port: number): Promise<ResolvedTarget> {
  if (!isAllowedPort(port)) {
    throw new BlockedHostError(host, `port ${port} is not one the monitor may open`);
  }
  if (!isPlausibleHostname(host)) {
    throw new BlockedHostError(host, "that is not a public hostname");
  }

  let addresses: string[];
  try {
    const results = await lookup(host, { all: true, verbatim: true });
    addresses = results.map((entry) => entry.address);
  } catch (error) {
    throw new BlockedHostError(host, `it could not be resolved (${(error as Error).message})`);
  }

  const verdict = allAddressesAllowed(addresses);
  if (!verdict.allowed) {
    throw new BlockedHostError(host, explainBlock(verdict.reason ?? "unparsable"));
  }

  return { host, addresses, port };
}
