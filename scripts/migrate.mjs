import { runProductionMigrations } from './production-migrations.mjs';

try {
	await runProductionMigrations();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
