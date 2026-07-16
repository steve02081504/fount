import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { isKnownSocialTarget } from '../../lib/entityTarget.mjs'

/**
 * @typedef {{ username: string, entityHash: string, charPartName?: string }} SocialApiContext
 */

/**
 * @param {SocialApiContext} apiContext API 上下文
 * @returns {() => { viewerEntityHash: string }} 读侧观看者选项工厂
 */
export function makeViewerOptions(apiContext) {
	return () => ({ viewerEntityHash: apiContext.entityHash })
}

/**
 * @param {string} target 目标
 * @returns {string} 规范化 entityHash
 */
export function normalizeTarget(target) {
	const hash = String(target || '').toLowerCase()
	if (!isEntityHash128(hash)) throw httpError(400, 'invalid entityHash')
	return hash
}

/**
 * @param {SocialApiContext} apiContext 上下文
 * @param {string} target 目标
 * @returns {Promise<string>} 已知社交目标 entityHash
 */
export async function requireKnownTarget(apiContext, target) {
	const hash = normalizeTarget(target)
	if (!await isKnownSocialTarget(apiContext.username, hash))
		throw httpError(400, 'unknown entity')
	return hash
}
