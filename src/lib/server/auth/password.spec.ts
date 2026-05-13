import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
	it('verifies the original password and rejects another password', async () => {
		expect.assertions(3);

		const hash = await hashPassword('correct horse battery staple');

		expect(hash).toMatch(/^scrypt\$/);
		expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
		expect(await verifyPassword('wrong password', hash)).toBe(false);
	});
});
