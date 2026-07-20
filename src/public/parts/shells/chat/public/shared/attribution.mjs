/**
 * 【文件】public/shared/attribution.mjs
 * 【职责】浏览器侧消息归因推导（与后端 chat/lib/attribution 语义对齐）。
 * 【原理】importedFrom 存在 → attributionMismatch；供 Hub 消息头警告与人物卡使用。
 */

/**
 * @typedef {{
 *   trusted: boolean,
 *   mismatch: boolean,
 *   reason: null | 'imported_resign',
 *   claimedDisplayName?: string | null,
 *   claimedEntityHash?: string | null,
 *   claimedSenderPubKeyHash?: string | null,
 *   signerEntityHash?: string | null,
 *   signerPubKeyHash?: string | null,
 *   importedFrom?: object | null,
 * }} MessageAttribution
 */

/**
 * @param {object | null | undefined} content 消息 content
 * @param {{ sender?: string, signerEntityHash?: string | null }} [line] 行信息
 * @returns {MessageAttribution} 归因
 */
export function deriveMessageAttribution(content, line = {}) {
	const importedFrom = content?.importedFrom && typeof content.importedFrom === 'object'
		? content.importedFrom
		: null
	if (!importedFrom) 
		return {
			trusted: true,
			mismatch: false,
			reason: null,
			claimedDisplayName: content?.displayName ? String(content.displayName) : null,
			claimedEntityHash: null,
			claimedSenderPubKeyHash: null,
			signerEntityHash: line.signerEntityHash || null,
			signerPubKeyHash: line.sender ? String(line.sender).toLowerCase() : null,
			importedFrom: null,
		}
	

	return {
		trusted: false,
		mismatch: true,
		reason: 'imported_resign',
		claimedDisplayName: content?.displayName ? String(content.displayName) : null,
		claimedEntityHash: importedFrom.sourceEntityHash
			? String(importedFrom.sourceEntityHash).toLowerCase()
			: null,
		claimedSenderPubKeyHash: importedFrom.sourceSenderPubKeyHash
			? String(importedFrom.sourceSenderPubKeyHash).toLowerCase()
			: null,
		signerEntityHash: importedFrom.signerEntityHash
			? String(importedFrom.signerEntityHash).toLowerCase()
			: line.signerEntityHash || null,
		signerPubKeyHash: importedFrom.signerPubKeyHash
			? String(importedFrom.signerPubKeyHash).toLowerCase()
			: line.sender ? String(line.sender).toLowerCase() : null,
		importedFrom,
	}
}

/**
 * @param {object} message Hub 消息行
 * @returns {MessageAttribution} 归因
 */
export function attributionFromHubMessage(message) {
	return deriveMessageAttribution(message?.content, {
		sender: message?.sender || message?.authorPubKeyHash,
		signerEntityHash: message?.extension?.attribution?.signerEntityHash
			|| message?.content?.importedFrom?.signerEntityHash
			|| null,
	})
}
