/**
 * 【文件】public/hub/stream/callbacks.mjs
 * 【职责】群 WS 对外回调注册（流结束、频道刷新、编辑删除、生成态）。
 */

/**
 *
 */
export const streamCallbacks = {
	/** @type {(streamId?: string) => Promise<void>} */
	onStreamEnd: async () => { },
	/** @type {(options?: { immediate?: boolean }) => Promise<void>} */
	onChannelRefresh: async () => { },
	/** @type {() => Promise<void>} */
	onThreadChannelRefresh: async () => { },
	/** @type {(targetId: string) => Promise<void>} */
	onMessageEdit: async () => { },
	/** @type {(targetId: string) => Promise<void>} */
	onMessageDelete: async () => { },
	/** @type {(() => void) | null} */
	onGenerationActiveChange: null,
}

/**
 * @param {(streamId?: string) => Promise<void>} handler 流结束回调
 * @returns {void}
 */
export function setGroupStreamEndHandler(handler) {
	streamCallbacks.onStreamEnd = handler ?? (async () => { })
}

/**
 * @param {(options?: { immediate?: boolean }) => Promise<void>} handler 频道增量刷新
 * @returns {void}
 */
export function setGroupChannelRefreshHandler(handler) {
	streamCallbacks.onChannelRefresh = handler ?? (async () => { })
}

/**
 * @param {() => Promise<void>} handler 子线程频道刷新
 * @returns {void}
 */
export function setGroupThreadChannelRefreshHandler(handler) {
	streamCallbacks.onThreadChannelRefresh = handler ?? (async () => { })
}

/**
 * @param {(targetId: string) => Promise<void>} handler message_edit 终稿刷新
 * @returns {void}
 */
export function setGroupMessageEditHandler(handler) {
	streamCallbacks.onMessageEdit = handler ?? (async () => { })
}

/**
 * @param {(targetId: string) => Promise<void>} handler message_delete 移除展示行
 * @returns {void}
 */
export function setGroupMessageDeleteHandler(handler) {
	streamCallbacks.onMessageDelete = handler ?? (async () => { })
}

/**
 * @param {(() => void) | null} handler 流式活跃状态变化
 * @returns {void}
 */
export function setGenerationActiveChangeHandler(handler) {
	streamCallbacks.onGenerationActiveChange = handler ?? null
}

/** @returns {void} 通知生成中 UI */
export function notifyGenerationActiveChange() {
	streamCallbacks.onGenerationActiveChange?.()
}
