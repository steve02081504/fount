/**
 * 【文件】attribution.mjs
 * 【职责】消息密码学归因：区分可信签名消息 vs 导入重签（展示身份与签名者不匹配）。
 * 【原理】importedFrom 存在即视为 attributionMismatch；可选携带 claimed / signer 实体信息。
 * 【关联】channelArchive、hydration、prompt_struct、ChatClient Message、Hub UI。
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
 * 从消息 content / 行推导归因状态。
 * @param {object | null | undefined} content 频道消息 content
 * @param {{ sender?: string, signerEntityHash?: string | null }} [line] 行级签名者信息
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
	

	const claimedEntityHash = importedFrom.sourceEntityHash
		? String(importedFrom.sourceEntityHash).toLowerCase()
		: null
	const claimedSenderPubKeyHash = importedFrom.sourceSenderPubKeyHash
		? String(importedFrom.sourceSenderPubKeyHash).toLowerCase()
		: null
	const signerEntityHash = importedFrom.signerEntityHash
		? String(importedFrom.signerEntityHash).toLowerCase()
		: line.signerEntityHash || null
	const signerPubKeyHash = importedFrom.signerPubKeyHash
		? String(importedFrom.signerPubKeyHash).toLowerCase()
		: line.sender ? String(line.sender).toLowerCase() : null

	return {
		trusted: false,
		mismatch: true,
		reason: 'imported_resign',
		claimedDisplayName: content?.displayName ? String(content.displayName) : null,
		claimedEntityHash,
		claimedSenderPubKeyHash,
		signerEntityHash,
		signerPubKeyHash,
		importedFrom,
	}
}

/**
 * 消息是否可作为可信主人指令（密码学作者 === 声明主人，且无 attribution mismatch）。
 * @param {MessageAttribution} attribution 归因
 * @param {string | null | undefined} authorEntityHash 实际签名作者实体
 * @param {string | null | undefined} declaredOwnerEntityHash agent 声明主人
 * @returns {boolean} 是否可信主人消息
 */
export function isTrustedOwnerAttribution(attribution, authorEntityHash, declaredOwnerEntityHash) {
	const owner = String(declaredOwnerEntityHash || '').trim().toLowerCase()
	const author = String(authorEntityHash || '').trim().toLowerCase()
	if (!owner || !author) return false
	if (!attribution?.trusted || attribution.mismatch) return false
	return author === owner
}
