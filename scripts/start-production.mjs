import { validateProductionEnv } from './validate-production-env.mjs';

validateProductionEnv();

const { startTermixServer } = await import('../build/server.js');

await startTermixServer();
