import { createHash, timingSafeEqual } from 'node:crypto';
import { BODY_LIMIT, GLOBAL_ACTIVE_LIMIT, PROMPT_LIMIT, PUBLIC_MODEL, SESSION_JOB_LIMIT } from './constants.mjs';

const RECOVERY_PATHS = new Set(['/api/investigations', '/api/roadster/transfers', '/api/recover']);
const hex = /^[a-f0-9]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hash(value) {
  return createHash('sha256').update(value).digest();
}

function exact(value) {
  return typeof value === 'string' && value.length > 0 && value.length < 256 && !value.includes(',') && !/\s/.test(value);
}

export function createProductionPolicy({
  hosts, origins, trustedProxies = [], inviteCodes = [],
  sessionJobLimit = SESSION_JOB_LIMIT, globalActiveLimit = GLOBAL_ACTIVE_LIMIT,
} = {}) {
  if (!Array.isArray(hosts) || hosts.length < 1 || !hosts.every(exact)) throw Error('Public hosts must be an exact allowlist');
  if (!Array.isArray(origins) || origins.length < 1 || !origins.every(exact)) throw Error('Public origins must be an exact allowlist');
  if (!Array.isArray(trustedProxies) || !trustedProxies.every(exact)) throw Error('Trusted proxies must be an exact allowlist');
  const hostSet = new Set(hosts.map(host => host.toLowerCase()));
  const originSet = new Set(origins.map(origin => origin.toLowerCase()));
  const proxySet = new Set(trustedProxies);
  for (const host of hostSet) {
    if (host === 'localhost' || host.startsWith('localhost:') || host.startsWith('127.') || host === '[::1]' || host.startsWith('[::1]:')) {
      throw Error('Localhost is not a public host');
    }
  }
  for (const origin of originSet) {
    if (origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('[::1]')) throw Error('Localhost is not a public origin');
  }
  const invites = inviteCodes.map(code => {
    if (typeof code !== 'string' || code.length < 8 || code.length > 128) throw Error('Invalid invite code');
    return hash(code);
  });
  return Object.freeze({
    hosts: hostSet, origins: originSet, proxies: proxySet, invites, sessionJobLimit, globalActiveLimit,
  });
}

function header(headers, name) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return null;
  return typeof value === 'string' ? value : '';
}

function remoteAddress(value) {
  if (typeof value !== 'string' || !value) return '';
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

function deny(status, error) {
  return { ok: false, status, error };
}

/**
 * Host and proxy check only. Playback routes stay with the caller; this does
 * not decide which paths exist.
 */
export function checkPublicEdge({ policy, headers = {}, remoteAddress: peer }) {
  if (!policy?.hosts || !policy.origins) throw Error('Production policy is required');
  const address = remoteAddress(peer);
  const forwardedHost = header(headers, 'x-forwarded-host');
  const forwardedProto = header(headers, 'x-forwarded-proto');
  const forwardedFor = header(headers, 'x-forwarded-for');
  const sawForwarded = Boolean(forwardedHost || forwardedProto || forwardedFor);
  const trusted = policy.proxies.has(address);
  if (sawForwarded && !trusted) return deny(403, 'Untrusted proxy headers');
  if (sawForwarded && trusted) {
    if (forwardedProto !== 'https' || !policy.hosts.has(forwardedHost.toLowerCase())) return deny(403, 'Unrecognized public host');
  }
  const host = header(headers, 'host');
  if (!trusted && !policy.hosts.has(host.toLowerCase())) return deny(403, 'Unrecognized public host');
  if (trusted && !sawForwarded && !policy.hosts.has(host.toLowerCase())) return deny(403, 'Unrecognized public host');
  return { ok: true };
}

/**
 * Production admission. Forwarded host and protocol are honored only from an
 * allowlisted proxy, and the resulting public host must still be exact.
 */
export function admitProductionRequest({ policy, headers = {}, remoteAddress: peer, method, path, bodyLength = 0 }) {
  const edge = checkPublicEdge({ policy, headers, remoteAddress: peer });
  if (!edge.ok) return edge;
  const pathname = path.split('?')[0];
  if (RECOVERY_PATHS.has(pathname) || pathname.startsWith('/api/investigations/') || pathname.startsWith('/recovery-projects/')) {
    return deny(403, 'Broad recovery is disabled on the public service');
  }
  if ((pathname === '/api/remixes' || /^\/api\/remixes\/[0-9a-f-]{36}\/cancel$/i.test(pathname)) && method === 'POST') {
    const origin = header(headers, 'origin');
    const type = header(headers, 'content-type').split(';')[0];
    if (!policy.origins.has(origin.toLowerCase())) return deny(403, 'Unrecognized public origin');
    if (type !== 'application/json') return deny(403, 'A same-origin JSON request is required');
    if (bodyLength > BODY_LIMIT) return deny(413, 'Request exceeds 4 KB');
    const code = header(headers, 'x-invite-code');
    if (!acceptInvite(policy, code)) return deny(401, 'Invite required');
    return { ok: true, route: pathname.endsWith('/cancel') ? 'cancel' : 'remix', inviteAccepted: true };
  }
  if (method === 'POST') return deny(403, 'Only bounded remix jobs are accepted');
  if (!['GET', 'HEAD'].includes(method)) return deny(405, 'Method not allowed');
  if (pathname === '/' || pathname === '/index.html' || pathname === '/health' || pathname === '/privacy' || pathname === '/api/remixes/status' || pathname === '/api/catalog') return { ok: true, route: 'status' };
  if (pathname.startsWith('/creator/')) {
    if (pathname.includes('..') || pathname.includes('\\') || pathname.includes('\0')) return deny(404, 'Not found');
    return { ok: true, route: 'creator' };
  }
  if (/^\/api\/remixes\/[0-9a-f-]{36}$/i.test(pathname)) return { ok: true, route: 'job' };
  if (/^\/parents\/[a-f0-9]{64}(?:\/download)?$/.test(pathname)) return { ok: true, route: 'parent' };
  if (/^\/artifacts\/[a-f0-9]{64}(?:\/(?:play\.html|adapter\.js|adapter\.ts|receipt\.json|generation\.json|experiment\.json|rule\.mjs|notices\.txt|download|download\.zip))?$/.test(pathname)) return { ok: true, route: 'artifact' };
  return deny(404, 'Not found');
}

export function acceptInvite(policy, code) {
  if (typeof code !== 'string' || code.length < 8 || code.length > 128 || policy.invites.length === 0) return false;
  const actual = hash(code);
  return policy.invites.some(expected => timingSafeEqual(actual, expected));
}

export function parseRemixBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid remix request');
  const keys = Object.keys(value).sort().join(',');
  if (!['adultConfirmed,idempotencyKey,parentArtifactId,prompt,sessionId','adultConfirmed,experiment,idempotencyKey,parentArtifactId,prompt,sessionId','adultConfirmed,composition,idempotencyKey,parentArtifactId,prompt,sessionId'].includes(keys)) throw Error('Invalid remix request');
  if(value.composition!=null&&!['dash-end-shot','none'].includes(value.composition))throw Error('Unsupported composition');
  if (value.adultConfirmed !== true) throw Error('Remix creation is limited to adults 18 and older');
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > PROMPT_LIMIT) throw Error('Invalid remix prompt');
  if (!hex.test(value.parentArtifactId)) throw Error('Invalid parent artifact');
  if (!uuid.test(value.idempotencyKey) || !uuid.test(value.sessionId)) throw Error('Invalid remix identity');
  if (value.model && value.model !== PUBLIC_MODEL) throw Error('Public traffic uses Standard Muse Spark 1.3');
  return {
    prompt: value.prompt, parentArtifactId: value.parentArtifactId,
    idempotencyKey: value.idempotencyKey.toLowerCase(), sessionId: value.sessionId.toLowerCase(), adultConfirmed: true,
    ...(value.experiment ? {experiment:value.experiment} : {}), ...(value.composition ? {composition:value.composition}:{}), model: PUBLIC_MODEL,
  };
}
