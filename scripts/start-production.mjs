import { validateProductionEnv } from './validate-production-env.mjs';

validateProductionEnv();

await import('../build/server.js');
