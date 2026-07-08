/**
 * edit/delete 路径钩子计数（edit/delete/GetCharReply fixtures 与测试共用）。
 * @returns {{
 *   beforeEditCalls: object[],
 *   beforeDeleteCalls: object[],
 *   worldEditCalls: object[],
 *   worldDeleteCalls: object[],
 *   reset: () => void,
 * }} globalThis 上共享的钩子调用计数器
 */
export function editPathHookState() {
	const key = '__fount_edit_path_hook_state__'
	if (!globalThis[key]) 
		globalThis[key] = {
			beforeEditCalls: [],
			beforeDeleteCalls: [],
			worldEditCalls: [],
			worldDeleteCalls: [],
			/** 清空所有钩子调用记录 */
			reset() {
				this.beforeEditCalls.length = 0
				this.beforeDeleteCalls.length = 0
				this.worldEditCalls.length = 0
				this.worldDeleteCalls.length = 0
			},
		}
	
	return globalThis[key]
}
