/**
 * 【文件】public/shared/messagePermissions.mjs
 * 【职责】消息级删除/编辑门控（零 store/DOM），与 authorizeEvent 的 message_delete / message_edit 对齐。
 * 【原理】调用方解析 authorOwnerEntityHash / isRemote 等后传入；本模块只做布尔判定。
 * 【关联】hub/messages/messageActionsRender.mjs、authorizeEvent.mjs。
 */

/**
 * 当前观看者是否为消息作者所属主人。
 * @param {string | null | undefined} authorOwnerEntityHash 作者成员行的 ownerEntityHash
 * @param {string | null | undefined} viewerEntityHash 观看者 entityHash
 * @returns {boolean} 是否所属主人
 */
export function isManagedByViewer(authorOwnerEntityHash, viewerEntityHash) {
	return !!(authorOwnerEntityHash && viewerEntityHash && authorOwnerEntityHash === viewerEntityHash)
}

/**
 * 是否为本节点发出的角色消息（含所属 agent，哪怕 isRemote）。
 * @param {{ charId?: string | null, authorPubKeyHash?: string | null, isRemote?: boolean }} message 消息摘要
 * @param {{ viewerPubKeyHash?: string | null, viewerEntityHash?: string | null, localCharIds?: string[], authorOwnerEntityHash?: string | null }} options 观看者上下文
 * @returns {boolean} 是否己方角色
 */
export function isOwnCharMessage(message, options) {
	if (!message?.charId) return false
	if (isManagedByViewer(options.authorOwnerEntityHash, options.viewerEntityHash)) return true
	if (message.isRemote) return false
	const localCharIds = options.localCharIds?.length ? options.localCharIds : []
	if (localCharIds.includes(message.charId)) return true
	return !!(options.viewerPubKeyHash && message.authorPubKeyHash
		&& options.viewerPubKeyHash === message.authorPubKeyHash)
}

/**
 * 是否允许删除该消息（对齐 authorizeEvent message_delete）。
 * @param {{ eventId?: string | null, charId?: string | null, authorPubKeyHash?: string | null, isRemote?: boolean }} message 消息摘要
 * @param {{ viewerPubKeyHash?: string | null, viewerEntityHash?: string | null, canManageMessages?: boolean, localCharIds?: string[], authorOwnerEntityHash?: string | null }} options 权限上下文
 * @returns {boolean} 可删除
 */
export function canDeleteMessage(message, options) {
	if (!message?.eventId) return false
	if (isOwnCharMessage(message, options)) return true
	if (isManagedByViewer(options.authorOwnerEntityHash, options.viewerEntityHash)) return true
	if (options.canManageMessages) return true
	return !!(options.viewerPubKeyHash && message.authorPubKeyHash
		&& options.viewerPubKeyHash === message.authorPubKeyHash)
}

/**
 * 是否允许编辑该消息（对齐 authorizeEvent message_edit：作者本人 / 所属主人）。
 * @param {{ eventId?: string | null, charId?: string | null, authorPubKeyHash?: string | null, isRemote?: boolean, hasText?: boolean }} message 消息摘要；hasText 由调用方按 messageShowText 预计算
 * @param {{ viewerPubKeyHash?: string | null, viewerEntityHash?: string | null, localCharIds?: string[], authorOwnerEntityHash?: string | null }} options 权限上下文
 * @returns {boolean} 可编辑
 */
export function canEditMessage(message, options) {
	if (!message?.eventId || !message.hasText) return false
	if (isOwnCharMessage(message, options)) return true
	if (isManagedByViewer(options.authorOwnerEntityHash, options.viewerEntityHash)) return true
	if (!message.charId && options.viewerPubKeyHash && message.authorPubKeyHash
		&& options.viewerPubKeyHash === message.authorPubKeyHash) return true
	return false
}
