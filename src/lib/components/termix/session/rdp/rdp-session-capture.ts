type RdpSessionClipboardBridge = {
	onClipboardPaste(content: unknown): Promise<void>;
};

export type RdpSessionCaptureBackend = {
	Backend: {
		SessionBuilder: {
			prototype?: {
				connect?: (...args: unknown[]) => Promise<RdpSessionClipboardBridge>;
			};
		};
	};
};

type TermixRdpGlobal = typeof globalThis & {
	__termixRdpClipboardCapture?: (session: RdpSessionClipboardBridge) => void;
	__termixRdpSessionCaptureInstalled?: boolean;
};

export function setRdpClipboardCapture(
	handler: ((session: RdpSessionClipboardBridge) => void) | null,
	target: TermixRdpGlobal = globalThis as TermixRdpGlobal
) {
	if (handler) {
		target.__termixRdpClipboardCapture = handler;
		return;
	}

	delete target.__termixRdpClipboardCapture;
}

export function installRdpSessionCapture(
	backend: RdpSessionCaptureBackend,
	target: TermixRdpGlobal = globalThis as TermixRdpGlobal
) {
	if (target.__termixRdpSessionCaptureInstalled) return false;

	const prototype = backend.Backend.SessionBuilder.prototype;
	const originalConnect = prototype?.connect;
	if (!prototype || !originalConnect) return false;

	const wrappedConnect = async function (this: unknown, ...args: unknown[]) {
		const session = await originalConnect.apply(this, args);
		target.__termixRdpClipboardCapture?.(session);
		return session;
	};
	prototype.connect = wrappedConnect;
	target.__termixRdpSessionCaptureInstalled = true;
	return true;
}
