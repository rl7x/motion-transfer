// Reviewed compatibility for the protocol-only extension of the historical
// session host. Both hashes are exact; future host edits require a new review.
// All cartridge/runtime identities and replay fingerprints remain mandatory.
const compatibleHosts = new Map([['af537a7139b286645cde342c331bc931bc52d865b383e9a71a07583a025772f7', '20dbfeb1d051198e811d7a9ba864df7651153ef4e51378998dcb805f8b3e4384']]);

export function legacySessionIdentity(current, saved, requestedProtocol) {
  if (!saved || requestedProtocol || saved.recovery?.protocol || saved.identity?.hostSha256 === current.hostSha256) return current;
  if (compatibleHosts.get(current.hostSha256) !== saved.identity?.hostSha256) return current;
  return { ...current, hostSha256: saved.identity.hostSha256 };
}
