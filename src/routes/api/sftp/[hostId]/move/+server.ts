import type { RequestHandler } from '@sveltejs/kit';
import { _renameSftpRouteAction } from '../rename/+server';

export const POST: RequestHandler = (event) => _renameSftpRouteAction(event, 'move');
