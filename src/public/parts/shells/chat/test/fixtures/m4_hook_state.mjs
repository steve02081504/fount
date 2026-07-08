/**
 * M4 钩子计数（edit/delete/GetCharReply fixtures 与测试共用）。
 * @returns {{
 *   beforeEditCalls: object[],
 *   beforeDeleteCalls: object[],
 *   worldEditCalls: object[],
 *   worldDeleteCalls: object[],
 *   reset: () => void,
 * }}
 */
export function m4HookState() {
	const key = '__fount_m4_hook_state__'
	if (!globalThis[key]) {
		globalThis[key] = {
			beforeEditCalls: [],
			beforeDeleteCalls: [],
			worldEditCalls: [],
			worldDeleteCalls: [],
			reset() {
				this.beforeEditCalls.length = 0
				this.beforeDeleteCalls.length = 0
				this.worldEditCalls.length = 0
				this.worldDeleteCalls.length = 0
			},
		}
	}
	return globalThis[key]
}
