import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	return {
		user: locals.user
			? {
					username: locals.user.username,
					isAdmin: locals.user.isAdmin
				}
			: null
	};
};
