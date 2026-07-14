/**
 * write-path 钩子计数（fixtures 与测试共用 globalThis）。
 * @returns {{
 *   addCalls: object[],
 *   afterCalls: object[],
 *   beforeSendCalls: object[],
 *   reset: () => void,
 * }} 计数器
 */
export function writePathHookState() {
	const key = '__fount_write_path_hook_state__'
	if (!globalThis[key]) 
		globalThis[key] = {
			addCalls: [],
			afterCalls: [],
			beforeSendCalls: [],
			/**
			 * 清空计数。
			 * @returns {void}
			 */
			reset() {
				this.addCalls.length = 0
				this.afterCalls.length = 0
				this.beforeSendCalls.length = 0
			},
		}
	
	return globalThis[key]
}
