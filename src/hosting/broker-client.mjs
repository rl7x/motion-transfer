import { stat } from 'node:fs/promises';
import net from 'node:net';
import { FRAME_LIMIT, JOB_LIMIT } from './constants.mjs';

/** Unix-socket client. This process does not talk to the Docker daemon. */
export function createBrokerClient(socketPath) {
  return {
    async available() {
      try { await stat(socketPath); return true; }
      catch { return false; }
    },
    submit(job) {
      const text = JSON.stringify(job);
      if (Buffer.byteLength(text) > JOB_LIMIT) return Promise.reject(Error('Job exceeds 256 KB'));
      return new Promise((resolve, reject) => {
        const socket = net.connect(socketPath);
        const chunks = [];
        let size = 0;
        socket.on('error', reject);
        socket.on('data', chunk => {
          size += chunk.length;
          if (size > FRAME_LIMIT + 2 * 1024 * 1024) {
            socket.destroy();
            reject(Error('Worker response exceeds output limit'));
            return;
          }
          chunks.push(chunk);
        });
        socket.on('end', () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (payload.frameBase64) {
              payload.frame = Buffer.from(payload.frameBase64, 'base64');
              delete payload.frameBase64;
            }
            resolve(payload);
          } catch (error) { reject(error); }
        });
        socket.end(text);
      });
    },
  };
}
