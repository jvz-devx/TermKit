export function createApiClient(baseUrl, cookieHeader) {
	return {
		get: (path) => requestJson(baseUrl, cookieHeader, 'GET', path),
		post: (path, body) => requestJson(baseUrl, cookieHeader, 'POST', path, body),
		put: (path, body) => requestJson(baseUrl, cookieHeader, 'PUT', path, body),
		delete: (path) => requestJson(baseUrl, cookieHeader, 'DELETE', path),
		download: async (path) => {
			const response = await fetch(new URL(path, baseUrl), {
				headers: { cookie: cookieHeader }
			});
			await assertResponse(response, path);
			return Buffer.from(await response.arrayBuffer());
		},
		upload: async (path, name, data) => {
			const form = new FormData();
			form.append('file', new Blob([data]), name);
			const response = await fetch(new URL(path, baseUrl), {
				method: 'POST',
				headers: { cookie: cookieHeader, origin: new URL(baseUrl).origin },
				body: form
			});
			await assertResponse(response, path);
			return response.json();
		}
	};
}

async function requestJson(baseUrl, cookieHeader, method, path, body) {
	const response = await fetch(new URL(path, baseUrl), {
		method,
		headers: {
			cookie: cookieHeader,
			origin: new URL(baseUrl).origin,
			...(body === undefined ? {} : { 'content-type': 'application/json' })
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	await assertResponse(response, path);
	return response.json();
}

async function assertResponse(response, path) {
	if (response.ok) return;
	const body = await response.text().catch(() => '<unreadable>');
	throw new Error(`${path} returned ${response.status} ${response.statusText}: ${body}`);
}

export async function createSshCredential(api) {
	const { credential } = await api.post('/api/credentials', {
		name: 'Smoke SSH password',
		kind: 'password',
		username: 'smoke',
		secret: 'smoke-password'
	});
	return credential;
}

export async function createRdpCredential(api) {
	const { credential } = await api.post('/api/credentials', {
		name: 'Smoke RDP password',
		kind: 'password',
		username: 'saved-rdp-user',
		secret: 'saved-rdp-password'
	});
	return credential;
}

export async function createVncCredential(api) {
	const { credential } = await api.post('/api/credentials', {
		name: 'Smoke VNC password',
		kind: 'password',
		username: 'saved-vnc-user',
		secret: 'saved-vnc-password'
	});
	return credential;
}

export async function createFtpCredential(api) {
	const { credential } = await api.post('/api/credentials', {
		name: 'Smoke FTP password',
		kind: 'password',
		username: 'ftp-smoke',
		secret: 'ftp-smoke-password'
	});
	return credential;
}

export async function createHost(api, input) {
	const { host } = await api.post('/api/hosts', input);
	return host;
}
