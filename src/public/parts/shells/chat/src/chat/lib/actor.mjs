import { httpError } from '../../../../../../../scripts/http_error.mjs'

import { resolveAgentCharPartName } from './entity.mjs'
import { resolveChatRecipient } from './recipient.mjs'
import { resolveOperatorEntityHash } from './replica.mjs'

/**
 * 解析 chat 操作实体（operator 或本机托管 agent）。
 * @param {string} username replica 登录名
 * @param {string | undefined | null} entityHash 缺省 = operator
 * @returns {Promise<{ entityHash: string, charname?: string }>} 操作实体
 */
export async function resolveChatEntity(username, entityHash) {
	const resolved = await resolveChatRecipient(username, entityHash)
	const operator = (await resolveOperatorEntityHash(username))?.toLowerCase() || null
	if (operator && resolved === operator)
		return { entityHash: resolved }

	const fs = await import('node:fs')
	const path = await import('node:path')
	const { getUserDictionary } = await import('../../../../../../../server/auth/index.mjs')
	const charname = resolveAgentCharPartName(username, resolved, getUserDictionary, fs, path)
	if (!charname) throw httpError(403, 'invalid entityHash')
	return { entityHash: resolved, charname }
}
