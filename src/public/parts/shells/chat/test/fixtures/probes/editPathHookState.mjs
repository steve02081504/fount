/**
 * edit/delete 路径钩子计数。
 */
export const editPathHookState = {
	beforeEditCalls: [],
	beforeDeleteCalls: [],
	worldEditCalls: [],
	worldDeleteCalls: [],
	/** 清空所有钩子调用记录。 */
	reset() {
		this.beforeEditCalls.length = 0
		this.beforeDeleteCalls.length = 0
		this.worldEditCalls.length = 0
		this.worldDeleteCalls.length = 0
	},
}
