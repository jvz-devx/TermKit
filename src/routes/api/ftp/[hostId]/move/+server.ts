import type { RequestHandler } from '@sveltejs/kit';
import { _renameFtpRouteAction } from '../rename/+server';

export const POST: RequestHandler = (event) => _renameFtpRouteAction(event, 'move');
