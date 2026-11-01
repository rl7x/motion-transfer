import { createPreviewServer } from '../web/server.mjs';

const server = await createPreviewServer({ port: 4173 });
console.log(`Motion Transfer: ${server.origin}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
