/**
 * 【文件】src/chat/lib/userGroups.mjs
 * 【职责】用户群列表索引：扫描 `shells/chat/groups/` 目录汇总可见群 ID。
 * 【关联】group/queries.enumerateJoinedFederatedGroups、session/crud、public hub groupNav。
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { shellChatRoot } from './paths.mjs'
import { rethrowUnlessEnoentOrEnotdir } from './utils.mjs'

/**
 * 枚举当前用户聊天 shell 数据下出现过的所有会话/群 ID。
 * @param {string} username 用户名
 * @returns {Promise<string[]>} 去重后的群组 ID 列表
 */
export async function listUserGroups(username) {
	const root = shellChatRoot(username)
	const ids = new Set()
	try {
		const base = join(root, 'groups')
		const ents = await readdir(base, { withFileTypes: true })
		for (const d of ents)
			if (d.isDirectory()) ids.add(d.name)
	}
	catch (e) {
		rethrowUnlessEnoentOrEnotdir(e)
	}
	return [...ids]
}
