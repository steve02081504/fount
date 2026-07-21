import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { resolveAgentCharPartName } from '../../entity/member.mjs'

import { resolveOperatorEntityHash } from './replica.mjs'

/**
 * 解析 inbox recipient（operator 或本机托管 agent）；无法解析时 throw httpError。
 * @param {string} username replica 登录名
 * @param {string | undefined | null} requestedRecipient 查询/请求体中的 recipientEntityHash
 * @returns {Promise<string>} recipient entityHash（小写）
 */
export async function resolveChatRecipient(username, requestedRecipient) {
	const operator = (await resolveOperatorEntityHash(username))?.toLowerCase() || null
	const requested = String(requestedRecipient || '').trim().toLowerCase()
	if (!requested) {
		if (!operator) throw httpError(403, 'configure federation identity first')
		return operator
	}
	if (operator && requested === operator) return requested
	if (resolveAgentCharPartName(username, requested)) return requested
	throw httpError(403, 'invalid recipientEntityHash')
}
