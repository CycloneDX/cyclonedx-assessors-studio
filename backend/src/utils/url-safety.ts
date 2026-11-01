/**
 * URL safety primitives.
 *
 * Two defenses live here:
 *
 *   1. `isPrivateOrReservedUrl` runs at config time, when an operator
 *      saves a webhook destination. It rejects the submission if the
 *      URL hostname is a literal private IP, localhost, or a cloud
 *      metadata endpoint.
 *
 *   2. `resolveAndAssertPublic` runs at delivery time, right before the
 *      outbound HTTP request. It resolves the hostname through DNS and
 *      fails the delivery when any resolved address falls inside a
 *      private, loopback, link-local, or reserved range. This closes
 *      the gap where a public hostname that passed config-time review
 *      later starts pointing at an internal address (DNS rebinding, an
 *      attacker-controlled record, or operational DNS drift).
 *
 * There is a small TOCTOU window between the DNS check and the actual
 * socket connect. A future iteration can close it by passing a custom
 * `lookup` function into an undici Agent dispatcher so the connect
 * phase sees the same address we just validated. The one-shot check
 * here is still the correct first layer: it denies the easy case and
 * makes the full rebinding attack strictly harder.
 */

import dns from 'node:dns/promises';
import net from 'node:net';

/** Hostnames that are never legitimate webhook targets. */
const RESERVED_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
]);

/** Hostname suffixes reserved for internal networks. */
const RESERVED_HOST_SUFFIXES: readonly string[] = ['.local', '.internal'];

/** Cloud metadata endpoints (IMDS, GCE metadata, Azure IMDS alias). */
const CLOUD_METADATA_HOSTS: ReadonlySet<string> = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.azure.com',
]);

/**
 * Hostname-only checks that do not require DNS resolution. Used both
 * at config time and as a pre-filter before the DNS step at delivery
 * time.
 */
export function isReservedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (RESERVED_HOSTNAMES.has(h)) return true;
  for (const suffix of RESERVED_HOST_SUFFIXES) {
    if (h.endsWith(suffix)) return true;
  }
  if (CLOUD_METADATA_HOSTS.has(h)) return true;
  return false;
}

/**
 * Every special-purpose range that is never a legitimate outbound
 * target (IANA IPv4/IPv6 special-purpose registries). Checked with
 * net.BlockList so CIDR math is done by the runtime, not by regex.
 */
const BLOCKED_V4: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8],         // "this network"
  ['10.0.0.0', 8],        // private
  ['100.64.0.0', 10],     // CGNAT
  ['127.0.0.0', 8],       // loopback
  ['169.254.0.0', 16],    // link-local (cloud metadata)
  ['172.16.0.0', 12],     // private
  ['192.0.0.0', 24],      // IETF protocol assignments
  ['192.0.2.0', 24],      // TEST-NET-1
  ['192.88.99.0', 24],    // 6to4 relay anycast
  ['192.168.0.0', 16],    // private
  ['198.18.0.0', 15],     // benchmarking
  ['198.51.100.0', 24],   // TEST-NET-2
  ['203.0.113.0', 24],    // TEST-NET-3
  ['224.0.0.0', 4],       // multicast
  ['240.0.0.0', 4],       // reserved + broadcast
];
const BLOCKED_V6: ReadonlyArray<[string, number]> = [
  ['::', 128],            // unspecified
  ['::1', 128],           // loopback
  ['::', 96],             // IPv4-compatible (deprecated)
  ['64:ff9b::', 96],      // NAT64 well-known prefix
  ['64:ff9b:1::', 48],    // local-use NAT64
  ['100::', 64],          // discard-only
  ['2001::', 32],         // Teredo
  ['2001:db8::', 32],     // documentation
  ['2002::', 16],         // 6to4
  ['fc00::', 7],          // unique local
  ['fe80::', 10],         // link-local
  ['ff00::', 8],          // multicast
];
const blocklist = new net.BlockList();
for (const [addr, prefix] of BLOCKED_V4) blocklist.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of BLOCKED_V6) blocklist.addSubnet(addr, prefix, 'ipv6');

/** Strips the brackets URL parsing keeps around IPv6 literals ("[::1]"). */
export function normalizeHost(hostname: string): string {
  const h = hostname.toLowerCase();
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
}

/** True for any IPv4 address in a private, loopback, link-local or reserved range. */
export function isPrivateIpv4(address: string): boolean {
  if (!net.isIPv4(address)) return false;
  return blocklist.check(address, 'ipv4');
}

/**
 * True for any IPv6 address in a special-purpose range. IPv4-mapped
 * addresses (::ffff:a.b.c.d) are judged by their embedded IPv4.
 */
export function isPrivateIpv6(address: string): boolean {
  const a = normalizeHost(address);
  if (!net.isIPv6(a)) return false;
  const mapped = a.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(a)) {
    // Hex form of a mapped address: ::ffff:a9fe:a9fe
    const [hi, lo] = a.slice(7).split(':').map((h) => parseInt(h, 16));
    return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return blocklist.check(a, 'ipv6');
}

/** Any-family predicate used downstream. */
export function isPrivateIpAddress(address: string): boolean {
  const a = normalizeHost(address);
  if (net.isIPv4(a)) return isPrivateIpv4(a);
  if (net.isIPv6(a)) return isPrivateIpv6(a);
  return false;
}

export interface UrlSafetyOptions {
  /** Require the URL to use HTTPS. Defaults to true. */
  requireHttps?: boolean;
}

/**
 * Config-time URL safety check. Validates the URL format, the scheme,
 * and rejects obvious internal targets without performing DNS. Returns
 * true when the URL is NOT safe (private or reserved), which matches
 * the call sites that use this as a Zod refinement.
 */
export function isPrivateOrReservedUrl(
  urlString: string,
  options: UrlSafetyOptions = {},
): boolean {
  const requireHttps = options.requireHttps ?? true;
  try {
    const parsed = new URL(urlString);

    if (requireHttps && parsed.protocol !== 'https:') {
      return true;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return true;
    }

    const hostname = normalizeHost(parsed.hostname);
    if (isReservedHostname(hostname)) return true;
    if (net.isIP(hostname) && isPrivateIpAddress(hostname)) return true;

    return false;
  } catch {
    return true;
  }
}

export interface DeliveryTimeCheck {
  /** True when the target URL is safe to fetch. */
  safe: boolean;
  /** Populated when safe is false. */
  reason?: string;
}

/**
 * Delivery-time check. Parses the URL, re-runs the hostname screen,
 * then resolves every address behind the hostname and refuses if any
 * falls in a private or reserved range. A single poisoned answer is
 * enough to block the delivery; we do not want to race the runtime
 * over which address the socket eventually connects to.
 */
export async function resolveAndAssertPublic(
  urlString: string,
  options: UrlSafetyOptions = {},
): Promise<DeliveryTimeCheck> {
  const requireHttps = options.requireHttps ?? true;

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { safe: false, reason: 'Malformed webhook URL' };
  }

  if (requireHttps && parsed.protocol !== 'https:') {
    return { safe: false, reason: 'Webhook URL must use HTTPS' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { safe: false, reason: `Unsupported URL scheme ${parsed.protocol}` };
  }

  const hostname = normalizeHost(parsed.hostname);
  if (isReservedHostname(hostname)) {
    return { safe: false, reason: `Hostname ${hostname} is reserved` };
  }

  // Literal IP in the URL: evaluate directly, skip DNS.
  if (net.isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) {
      return {
        safe: false,
        reason: `Target address ${hostname} is private or reserved`,
      };
    }
    return { safe: true };
  }

  // Resolve both families. A hostname that fails to resolve is treated
  // as unsafe so deliveries error loudly instead of sitting in a
  // network timeout loop.
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { safe: false, reason: `DNS lookup failed: ${message}` };
  }

  if (addresses.length === 0) {
    return { safe: false, reason: 'Hostname resolved to no addresses' };
  }

  for (const entry of addresses) {
    if (isPrivateIpAddress(entry.address)) {
      return {
        safe: false,
        reason: `Hostname ${hostname} resolved to private address ${entry.address}`,
      };
    }
  }

  return { safe: true };
}

/**
 * Creation-time check for user-entered integration URLs: true when the
 * hostname resolves and any answer is private or reserved, so a name like
 * `canary` or `db` that points inside the network is refused when it is
 * saved. A hostname that does not resolve is not refused here (it may not
 * exist yet); safeFetch checks again on every delivery, which is the
 * guard that counts, since DNS can change after saving.
 */
export async function hostnameResolvesToPrivate(urlString: string): Promise<boolean> {
  let hostname: string;
  try {
    hostname = normalizeHost(new URL(urlString).hostname);
  } catch {
    return false;
  }
  if (net.isIP(hostname)) return isPrivateIpAddress(hostname);
  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    return addresses.some((a) => isPrivateIpAddress(a.address));
  } catch {
    return false;
  }
}
