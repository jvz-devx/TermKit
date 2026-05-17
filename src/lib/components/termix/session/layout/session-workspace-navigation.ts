export function sessionUrl(params: URLSearchParams) {
	const query = params.toString();
	return query ? `/sessions?${query}` : '/sessions';
}

export function toWebSocketUrl(
	path: string,
	location: Pick<Location, 'protocol' | 'host'> = window.location
) {
	const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${protocol}//${location.host}${path}`;
}
