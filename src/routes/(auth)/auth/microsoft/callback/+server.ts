import type { RequestEvent } from '@sveltejs/kit';
import { completeMicrosoftCallback } from '../_oauth';

export async function GET(event: RequestEvent) {
	return completeMicrosoftCallback(event);
}
