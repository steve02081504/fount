/**
 * MLS 插件占位：>200 人私密频道可选用 npm:ts-mls 等；与 mailbox_batch 二选一，不混用。
 * 接入点：客户端在 isPrivate && members>200 时选用本模块或拒绝建频道。
 */
export const MLS_PLUGIN_ID = 'mls-stub'

/**
 * @returns {boolean}
 */
export function isMlsAvailable() {
	return false
}
