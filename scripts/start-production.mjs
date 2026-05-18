import { validateProductionEnv } from './validate-production-env.mjs';
import { runProductionMigrations } from './production-migrations.mjs';

validateProductionEnv();
await runProductionMigrations();

const { startTermixServer } = await import('../build/server.js');

await startTermixServer();
