/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

import { base, build, files, version } from '$service-worker';

const worker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (globalThis.self));

const CACHE = `termkit-${version}`;
const OFFLINE_URL = `${base}/offline.html`;
const ASSETS = [...build, ...files];

worker.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(ASSETS);
			await worker.skipWaiting();
		})()
	);
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await worker.clients.claim();
		})()
	);
});

worker.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);
	if (url.origin !== worker.location.origin) return;
	const pathname = stripBase(url.pathname);
	if (pathname.startsWith('/api/')) return;

	if (ASSETS.includes(url.pathname)) {
		event.respondWith(cacheFirst(event.request, url.pathname));
		return;
	}

	if (event.request.mode === 'navigate') {
		event.respondWith(networkWithOfflineFallback(event.request));
	}
});

/**
 * @param {Request} request
 * @param {string} cacheKey
 */
async function cacheFirst(request, cacheKey) {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(cacheKey);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok) await cache.put(cacheKey, response.clone());
	return response;
}

/** @param {Request} request */
async function networkWithOfflineFallback(request) {
	try {
		return await fetch(request);
	} catch {
		const cache = await caches.open(CACHE);
		const response = await cache.match(OFFLINE_URL);
		if (response) return response;
		throw new Error('offline fallback was not cached');
	}
}

/** @param {string} pathname */
function stripBase(pathname) {
	if (!base || !pathname.startsWith(base)) return pathname;
	return pathname.slice(base.length) || '/';
}
