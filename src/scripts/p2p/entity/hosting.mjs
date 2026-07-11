/**
 * 实体托管：本机 agent 扫描（Chat / Social Load 共用）。
 */
import { agentEntityHash } from '../entity_id.mjs'
import { getNodeHash } from '../node/identity.mjs'

/**
 * 扫描 chars 目录枚举本地 agent 实体。
 * @param {string} replicaUsername replica 登录名
 * @param {(username: string) => string} getUserDictionary 用户目录解析
 * @param {import('node:fs')} fs 文件系统
 * @param {import('node:path')} path 路径模块
 * @returns {{ entityHash: string, charPartName: string }[]} agent 实体列表
 */
export function scanLocalAgentEntitiesFromChars(replicaUsername, getUserDictionary, fs, path) {
	const nodeHash = getNodeHash()
	const charsRoot = path.join(getUserDictionary(replicaUsername), 'chars')
	if (!fs.existsSync(charsRoot)) return []
	/** @type {{ entityHash: string, charPartName: string }[]} */
	const agents = []
	for (const ent of fs.readdirSync(charsRoot, { withFileTypes: true })) {
		if (!ent.isDirectory()) continue
		const partPath = `chars/${ent.name}`
		agents.push({
			charPartName: ent.name,
			entityHash: agentEntityHash(nodeHash, partPath),
		})
	}
	return agents
}
