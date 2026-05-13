import { getRequestEvent, form } from '$app/server';
import { invalid, redirect } from '@sveltejs/kit';
import {
	AuthError,
	createFirstRunAdmin,
	hasAnyUser,
	loginWithPassword,
	logout
} from '$lib/server/auth';

type LoginFields = {
	username: string;
	password: string;
};

type FirstRunFields = LoginFields & {
	confirmPassword: string;
};

function asTrimmedString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function asPassword(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

export const loginForm = form<LoginFields, void>('unchecked', async (data, issue) => {
	const username = asTrimmedString(data.username);
	const password = asPassword(data.password);

	if (!username) invalid(issue.username('Username is required'));
	if (!password) invalid(issue.password('Password is required'));

	try {
		await loginWithPassword(getRequestEvent(), { username, password });
	} catch (error) {
		if (error instanceof AuthError) invalid('Invalid username or password');
		throw error;
	}

	redirect(303, '/hosts');
});

export const firstRunForm = form<FirstRunFields, void>('unchecked', async (data, issue) => {
	const username = asTrimmedString(data.username);
	const password = asPassword(data.password);
	const confirmPassword = asPassword(data.confirmPassword);

	if (await hasAnyUser()) redirect(303, '/login');
	if (!username) invalid(issue.username('Username is required'));
	if (!password) invalid(issue.password('Password is required'));
	if (password !== confirmPassword) invalid(issue.confirmPassword('Passwords do not match'));

	try {
		await createFirstRunAdmin({ username, password });
		await loginWithPassword(getRequestEvent(), { username, password });
	} catch (error) {
		if (error instanceof AuthError) invalid(error.message);
		throw error;
	}

	redirect(303, '/hosts');
});

export const logoutForm = form(async () => {
	await logout(getRequestEvent());
	redirect(303, '/login');
});
