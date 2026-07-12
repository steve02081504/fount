import { httpError } from '../../../../../../../scripts/http_error.mjs'

import { resolveAgentCharPartName } from './entity.mjs'
import { resolveChatRecipient } from './recipient.mjs'
import { resolveOperatorEntityHash } from './replica.mjs'

/**
 * 解析 chat 操作 acting entity（operator 或本机托管 agent）。
 * @param {string} username replica 登录名
 * @param {string | undefined | null} actingEntityHash 缺省 = operator
 * @returns {Promise<{ kind: 'user'|'agent', entityHash: string, charname?: string }>} acting 主体
 */
export async function resolveChatActor(username, actingEntityHash) {
	const entityHash = await resolveChatRecipient(username, actingEntityHash)
	const operator = (await resolveOperatorEntityHash(username))?.toLowerCase() || null
	if (operator && entityHash === operator)
		return { kind: 'user', entityHash }

	const fs = await import('node:fs')
	const path = await import('node:path')
	const { getUserDictionary } = await import('../../../../../../../server/auth/index.mjs')
	const charname = resolveAgentCharPartName(username, entityHash, getUserDictionary, fs, path)
	if (!charname) throw httpError(403, 'invalid actingEntityHash')
	return { kind: 'agent', entityHash, charname }
}
