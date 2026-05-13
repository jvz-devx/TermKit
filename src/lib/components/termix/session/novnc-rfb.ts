// @ts-expect-error noVNC publishes browser ESM without declarations for @novnc/novnc.
import RFB from '@novnc/novnc';

export type RfbClient = {
	viewOnly: boolean;
	focusOnClick: boolean;
	clipViewport: boolean;
	dragViewport: boolean;
	scaleViewport: boolean;
	resizeSession: boolean;
	showDotCursor: boolean;
	addEventListener(type: string, listener: EventListener): void;
	addEventListener(
		type: 'credentialsrequired',
		listener: (event: CustomEvent<{ types?: string[] }>) => void
	): void;
	addEventListener(
		type: 'securityfailure',
		listener: (event: CustomEvent<{ status?: number; reason?: string }>) => void
	): void;
	disconnect(): void;
	focus(): void;
	sendCredentials(credentials: { username?: string; password?: string }): void;
};

export type RfbConstructor = new (
	target: HTMLElement,
	url: string,
	options?: { shared?: boolean; credentials?: { username?: string; password?: string } }
) => RfbClient;

export default RFB as RfbConstructor;
