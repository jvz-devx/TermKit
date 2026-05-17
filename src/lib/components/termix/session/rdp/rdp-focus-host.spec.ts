import { describe, expect, it, vi } from 'vitest';
import { createRdpFocusHost } from './rdp-focus-host';

describe('RDP focus host action', () => {
	it('wires and unwires focus host events', () => {
		const onPointerDown = vi.fn();
		const onFocus = vi.fn();
		const onKeydown = vi.fn();
		const node = new EventTarget() as HTMLElement;
		const action = createRdpFocusHost({ onPointerDown, onFocus, onKeydown });

		const result = action(node);
		node.dispatchEvent(new Event('pointerdown'));
		node.dispatchEvent(new Event('focus'));
		node.dispatchEvent(new Event('keydown'));

		expect(onPointerDown).toHaveBeenCalledOnce();
		expect(onFocus).toHaveBeenCalledOnce();
		expect(onKeydown).toHaveBeenCalledOnce();

		result?.destroy?.();
		node.dispatchEvent(new Event('pointerdown'));
		expect(onPointerDown).toHaveBeenCalledOnce();
	});
});
