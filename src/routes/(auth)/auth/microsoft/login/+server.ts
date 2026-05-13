import type { RequestEvent } from '@sveltejs/kit';
import { createMicrosoftAuthorizationRedirect } from '../_oauth';

export function GET(event: RequestEvent) {
	return createMicrosoftAuthorizationRedirect(event);
}
