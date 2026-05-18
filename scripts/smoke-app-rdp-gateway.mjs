import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import {
	closeServer,
	errorText,
	listen,
	readJsonBody,
	writeJson,
	writeText
} from './smoke-app-runtime.mjs';

export async function startMockRdpGateway() {
	const provisionerSubject = process.env.GATEWAY_PROVISIONER_SUBJECT ?? 'TermKit';
	const provisionerKey = process.env.GATEWAY_PROVISIONER_KEY ?? 'app-smoke-local-key';
	const appToken = 'app-smoke-gateway-app-token';
	const associationToken = 'app-smoke-gateway-association-token';
	const requests = [];
	const server = createHttpServer(async (request, response) => {
		try {
			const body = await readJsonBody(request);
			const gatewayRequestUrl = new URL(request.url, 'http://127.0.0.1');
			const path = gatewayRequestUrl.pathname;
			requests.push({
				method: request.method,
				path,
				query: gatewayRequestUrl.search,
				authorization: request.headers.authorization,
				headers: request.headers,
				body
			});

			if (request.method !== 'POST') {
				if (request.method === 'GET' && path === '/jet/rdp') {
					writeJson(response, 200, { ok: true });
					return;
				}
				writeText(response, 405, 'Method Not Allowed', 'method not allowed');
				return;
			}

			if (path === '/jet/webapp/app-token') {
				assert(
					request.headers.authorization ===
						`Basic ${Buffer.from(`${provisionerSubject}:${provisionerKey}`).toString('base64')}`,
					'RDP app-token request used the wrong Authorization header'
				);
				assert(body.content_type === 'WEBAPP', 'RDP app-token request used the wrong content type');
				assert(typeof body.subject === 'string' && body.subject, 'RDP app-token subject missing');
				writeText(response, 200, 'OK', appToken);
				return;
			}

			if (path === '/jet/webapp/session-token') {
				assert(
					request.headers.authorization === `Bearer ${appToken}`,
					'RDP session-token request used the wrong Authorization header'
				);
				assert(
					body.content_type === 'ASSOCIATION',
					'RDP session-token request used the wrong content type'
				);
				assert(body.protocol === 'rdp', 'RDP session-token request used the wrong protocol');
				assert(typeof body.session_id === 'string' && body.session_id, 'RDP session id missing');
				writeText(response, 200, 'OK', associationToken);
				return;
			}

			writeText(response, 404, 'Not Found', 'not found');
		} catch (error) {
			writeText(response, 500, 'Internal Server Error', errorText(error));
		}
	});

	await listen(server);
	const address = server.address();
	assert(address && typeof address !== 'string', 'mock RDP Gateway did not bind a TCP port');

	return {
		url: `http://127.0.0.1:${address.port}`,
		requests,
		close: () => closeServer(server)
	};
}
