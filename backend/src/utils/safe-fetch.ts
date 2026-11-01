/**
 * Outbound HTTP for user-configured URLs (webhooks, chat integrations,
 * standards feeds).
 *
 * Closes the gaps a plain `fetch` leaves open after `resolveAndAssertPublic`:
 *
 *   - Redirects are never followed. A public URL that answers 302 to
 *     http://169.254.169.254/ would otherwise be fetched (security
 *     review X1). Callers see the 3xx status as a failure.
 *   - The socket connects to the exact address that was validated, not
 *     to whatever a second DNS lookup returns (DNS rebinding). TLS still
 *     verifies the certificate against the original hostname (SNI).
 *   - Response bodies are capped, and requests time out.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { isPrivateIpAddress, isReservedHostname, normalizeHost } from './url-safety.js';

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Default 10 s. */
  timeoutMs?: number;
  /** Bytes of response body kept; the rest is discarded. Default 64 KiB. */
  maxResponseBytes?: number;
  /** Default true. */
  requireHttps?: boolean;
}

export interface SafeFetchResponse {
  status: number;
  ok: boolean;
  /** The (possibly truncated) response body as UTF-8. */
  text: string;
  truncated: boolean;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

const defaultResolver: Resolver = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

/** Test seams: a resolver and an address policy can be swapped in. */
export interface SafeFetchPolicy {
  resolve?: Resolver;
  isBlockedAddress?: (address: string) => boolean;
}

/** Parses and checks the URL itself (scheme, credentials, reserved names). */
function parseTargetUrl(urlString: string, requireHttps: boolean): { url: URL; hostname: string } {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new UnsafeUrlError('Malformed URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsafeUrlError(`Unsupported URL scheme ${url.protocol}`);
  }
  if (requireHttps && url.protocol !== 'https:') {
    throw new UnsafeUrlError('URL must use HTTPS');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('Credentials in URLs are not allowed');
  }
  const hostname = normalizeHost(url.hostname);
  if (isReservedHostname(hostname)) {
    throw new UnsafeUrlError('Target hostname is reserved');
  }
  return { url, hostname };
}

type Target = { address: string; family: number };

/** Resolves the host once and refuses it if any answer is blocked. */
async function resolveTarget(hostname: string, resolve: Resolver, isBlocked: (address: string) => boolean): Promise<Target> {
  if (net.isIP(hostname)) {
    if (isBlocked(hostname)) throw new UnsafeUrlError('Target address is private or reserved');
    return { address: hostname, family: net.isIPv6(hostname) ? 6 : 4 };
  }
  let addresses: Target[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new UnsafeUrlError('Target hostname did not resolve');
  }
  if (addresses.length === 0) throw new UnsafeUrlError('Target hostname did not resolve');
  // One poisoned answer blocks the request; we never race the runtime
  // over which address the socket would pick.
  if (addresses.some((a) => isBlocked(a.address))) {
    throw new UnsafeUrlError('Target hostname resolves to a private or reserved address');
  }
  return addresses[0]!;
}

/** A lookup that always answers with the validated address. */
function pinnedLookup(target: Target): LookupFunction {
  return (_host, opts, callback) => {
    if ((opts as { all?: boolean }).all) {
      (callback as unknown as (err: null, addrs: Target[]) => void)(null, [target]);
    } else {
      callback(null, target.address, target.family);
    }
  };
}

/** Collects up to maxBytes of the body, then resolves with the response. */
function collectResponse(
  res: http.IncomingMessage,
  maxBytes: number,
  resolvePromise: (r: SafeFetchResponse) => void,
  reject: (err: Error) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  res.on('data', (chunk: Buffer) => {
    if (size >= maxBytes) {
      truncated = true;
      res.destroy();
      return;
    }
    const room = maxBytes - size;
    chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
    size += Math.min(chunk.length, room);
    if (chunk.length > room) {
      truncated = true;
      res.destroy();
    }
  });
  const finish = (): void => {
    const status = res.statusCode ?? 0;
    resolvePromise({
      status,
      ok: status >= 200 && status < 300,
      text: Buffer.concat(chunks).toString('utf8'),
      truncated,
    });
  };
  res.on('end', finish);
  res.on('close', finish);
  res.on('error', (err) => (truncated ? finish() : reject(err)));
}

export async function safeFetch(
  urlString: string,
  options: SafeFetchOptions = {},
  policy: SafeFetchPolicy = {},
): Promise<SafeFetchResponse> {
  const { url, hostname } = parseTargetUrl(urlString, options.requireHttps ?? true);
  const target = await resolveTarget(hostname, policy.resolve ?? defaultResolver, policy.isBlockedAddress ?? isPrivateIpAddress);

  const maxBytes = options.maxResponseBytes ?? 64 * 1024;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise<SafeFetchResponse>((resolvePromise, reject) => {
    const req = transport.request(
      url,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
        // Pin the connection to the validated address.
        lookup: pinnedLookup(target),
        servername: net.isIP(hostname) ? undefined : hostname,
        timeout: timeoutMs,
      },
      (res) => collectResponse(res, maxBytes, resolvePromise, reject),
    );
    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}
