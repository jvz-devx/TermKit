import type { Action } from 'svelte/action';

export function createRdpFocusHost({
	onPointerDown,
	onFocus,
	onKeydown = () => undefined
}: {
	onPointerDown: () => void;
	onFocus: () => void;
	onKeydown?: () => void;
}): Action<HTMLElement> {
	return (node) => {
		node.addEventListener('pointerdown', onPointerDown);
		node.addEventListener('focus', onFocus);
		node.addEventListener('keydown', onKeydown);

		return {
			destroy() {
				node.removeEventListener('pointerdown', onPointerDown);
				node.removeEventListener('focus', onFocus);
				node.removeEventListener('keydown', onKeydown);
			}
		};
	};
}
