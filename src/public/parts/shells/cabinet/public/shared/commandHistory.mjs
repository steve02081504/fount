/**
 * 会话内有界撤销/重做栈。
 */

/**
 * @typedef {{
 *   label: string,
 *   undo: () => Promise<void>,
 *   redo: () => Promise<void>,
 *   discard?: () => Promise<void>,
 * }} HistoryEntry
 */

/**
 * @param {number} [limit=50] 最大深度
 * @returns {{
 *   push: (entry: HistoryEntry) => Promise<void>,
 *   undo: () => Promise<boolean>,
 *   redo: () => Promise<boolean>,
 *   canUndo: () => boolean,
 *   canRedo: () => boolean,
 *   dispose: () => Promise<void>,
 * }} 历史控制器
 */
export function createCommandHistory(limit = 50) {
	/** @type {HistoryEntry[]} */
	const undoStack = []
	/** @type {HistoryEntry[]} */
	const redoStack = []

	/**
	 * @param {HistoryEntry[]} stack 栈
	 * @returns {Promise<void>}
	 */
	async function discardAll(stack) {
		while (stack.length) {
			const entry = stack.pop()
			await entry?.discard?.()
		}
	}

	return {
		/**
		 * @param {HistoryEntry} entry 条目
		 * @returns {Promise<void>}
		 */
		async push(entry) {
			await discardAll(redoStack)
			undoStack.push(entry)
			while (undoStack.length > limit) {
				const dropped = undoStack.shift()
				await dropped?.discard?.()
			}
		},
		/**
		 * @returns {Promise<boolean>} 是否执行
		 */
		async undo() {
			const entry = undoStack.pop()
			if (!entry) return false
			await entry.undo()
			redoStack.push(entry)
			return true
		},
		/**
		 * @returns {Promise<boolean>} 是否执行
		 */
		async redo() {
			const entry = redoStack.pop()
			if (!entry) return false
			await entry.redo()
			undoStack.push(entry)
			return true
		},
		/** @returns {boolean} 可否撤销 */
		canUndo: () => undoStack.length > 0,
		/** @returns {boolean} 可否重做 */
		canRedo: () => redoStack.length > 0,
		/**
		 * @returns {Promise<void>}
		 */
		async dispose() {
			await discardAll(undoStack)
			await discardAll(redoStack)
		},
	}
}
