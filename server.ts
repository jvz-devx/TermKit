import { createServer } from 'node:http';
import { env } from 'node:process';
import { handler } from './build/handler.js';
import { createSessionTicketConsumer } from './src/lib/server/ws/ticket-consumer.js';
import { installWebSocketUpgrades } from './src/lib/server/ws/upgrade.js';

const host = env.HOST ?? '0.0.0.0';
const port = Number(env.PORT ?? 3000);

const server = createServer(handler);

installWebSocketUpgrades(server, { tickets: createSessionTicketConsumer() });

server.listen(port, host, () => {
	console.log(`TermixKit listening on http://${host}:${port}`);
});
