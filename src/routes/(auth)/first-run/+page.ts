import type { PageLoad } from './$types';
import { getMicrosoftAuthAvailability } from '$lib/remotes/auth.remote';

export const load: PageLoad = async () => {
	return {
		microsoftAuth: await getMicrosoftAuthAvailability().run()
	};
};
