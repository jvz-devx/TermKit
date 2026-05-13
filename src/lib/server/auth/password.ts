import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const keyLength = 64;

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString('base64url');
	const derivedKey = (await scryptAsync(password, salt, keyLength)) as Buffer;

	return `scrypt$${salt}$${derivedKey.toString('base64url')}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
	const [scheme, salt, expectedKey] = passwordHash.split('$');

	if (scheme !== 'scrypt' || !salt || !expectedKey) {
		return false;
	}

	const expected = Buffer.from(expectedKey, 'base64url');
	const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;

	return expected.length === actual.length && timingSafeEqual(expected, actual);
}
