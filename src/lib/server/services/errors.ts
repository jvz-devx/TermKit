export class ServiceValidationError extends Error {
	readonly status = 400;
	readonly issues: string[];

	constructor(issues: string[]) {
		super(issues.join('; '));
		this.name = 'ServiceValidationError';
		this.issues = issues;
	}
}

export class ServiceNotFoundError extends Error {
	readonly status = 404;

	constructor(message = 'Not found') {
		super(message);
		this.name = 'ServiceNotFoundError';
	}
}

export class ServiceUnauthorizedError extends Error {
	readonly status = 401;

	constructor(message = 'Unauthenticated') {
		super(message);
		this.name = 'ServiceUnauthorizedError';
	}
}

export class ServicePayloadTooLargeError extends Error {
	readonly status = 413;
	readonly issues: string[];

	constructor(message = 'Request payload is too large') {
		super(message);
		this.name = 'ServicePayloadTooLargeError';
		this.issues = [message];
	}
}

export class TicketConsumedError extends Error {
	readonly status = 410;

	constructor(message = 'Session ticket has already been used') {
		super(message);
		this.name = 'TicketConsumedError';
	}
}

export class TicketExpiredError extends Error {
	readonly status = 410;

	constructor(message = 'Session ticket has expired') {
		super(message);
		this.name = 'TicketExpiredError';
	}
}

export class TicketInvalidError extends Error {
	readonly status = 404;

	constructor(message = 'Session ticket was not found') {
		super(message);
		this.name = 'TicketInvalidError';
	}
}
