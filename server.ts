import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { env } from 'node:process';
import { createSessionTicketConsumer } from './src/lib/server/ws/ticket-consumer.js';
import { installWebSocketUpgrades } from './src/lib/server/ws/upgrade.js';

const host = env.HOST ?? '0.0.0.0';
const port = Number(env.PORT ?? 3000);
const handlerModulePath = './handler.js';
const { handler } = (await import(/* @vite-ignore */ handlerModulePath)) as {
	handler: RequestListener;
};

const server = createServer(handler);

installWebSocketUpgrades(server, { tickets: createSessionTicketConsumer() });

server.listen(port, host, () => {
	const address = server.address() as AddressInfo;
	console.log(`TermixKit listening on http://${host}:${address.port}`);
});
