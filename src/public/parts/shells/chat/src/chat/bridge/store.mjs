import { assignShellData, loadShellData } from '../../../../../../../server/setting_loader.mjs'

const BRIDGES_KEY = 'bridges'

/**
 * @returns {{ mappings: Record<string, object>, identityMap: Record<string, string>, entityReverse: Record<string, object> }} 空文档
 */
function emptyBridgesDoc() {
	return { mappings: {}, identityMap: {}, entityReverse: {} }
}

/**
 * @param {string} username replica
 * @returns {object} bridges.json 文档
 */
export function loadBridgesDoc(username) {
	const doc = loadShellData(username, 'chat', BRIDGES_KEY)
	if (!doc || typeof doc !== 'object') return emptyBridgesDoc()
	return {
		mappings: doc.mappings && typeof doc.mappings === 'object' ? doc.mappings : {},
		identityMap: doc.identityMap && typeof doc.identityMap === 'object' ? doc.identityMap : {},
		entityReverse: doc.entityReverse && typeof doc.entityReverse === 'object' ? doc.entityReverse : {},
	}
}

/**
 * @param {string} username replica
 * @param {object} doc bridges 文档
 * @returns {void}
 */
export function saveBridgesDoc(username, doc) {
	assignShellData(username, 'chat', BRIDGES_KEY, doc)
}

/**
 * @param {string} platform 平台名
 * @param {string | number} platformChatId 平台会话 ID
 * @returns {string} 映射键
 */
export function bridgeGroupKey(platform, platformChatId) {
	return `${String(platform)}:${String(platformChatId)}`
}

/**
 * @param {string} platform 平台名
 * @param {string | number} platformUserId 平台用户 ID
 * @returns {string} identity 映射键
 */
export function bridgeIdentityKey(platform, platformUserId) {
	return `${String(platform)}:${String(platformUserId)}`
}
