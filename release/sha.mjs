import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const isId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
