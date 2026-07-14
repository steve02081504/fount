import {
	isEntityHash128,
} from 'npm:@steve02081504/fount-p2p/core/entity_id'

/**
 * @param {object} member 物化成员行
 * @param {string} [member.entityHash] 实体声明
 * @param {string} [member.agentEntityHash] 旧字段（过渡读）
 * @returns {string | null} entityHash；无法派生时为 null
 */
export function memberEntityHash(member) {
	const declared = String(member?.entityHash || member?.agentEntityHash || '').trim().toLowerCase()
	return isEntityHash128(declared) ? declared : null
}

/**
 * 确保本机 agent 实体身份存在，返回其 entityHash（钥派生，非路径派生）。
 * @param {string} username replica
 * @param {string} charname 角色名（不含 chars/ 前缀亦可）
 * @returns {Promise<string>} 128 hex entityHash
 */
export async function ensureLocalAgentEntityHash(username, charname) {
	const name = String(charname || '').replace(/^chars\//u, '').trim()
	const { ensureAgentEntityIdentity } = await import('./identity.mjs')
	const row = await ensureAgentEntityIdentity(username, name)
	return row.entityHash
}

/**
 * 从 identity.json 解析本地 agent 的 chars 目录名。
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 agent entityHash
 * @param {(username: string) => string} getUserDictionary 用户目录解析
 * @param {import('node:fs')} fs 文件系统
 * @param {import('node:path')} path 路径模块
 * @returns {string | null} 角色 part 名
 */
export function resolveAgentCharPartName(replicaUsername, entityHash, getUserDictionary, fs, path) {
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!isEntityHash128(hash)) return null
	const identityPath = path.join(getUserDictionary(replicaUsername), 'entities', hash, 'identity.json')
	if (!fs.existsSync(identityPath)) return null
	try {
		const row = JSON.parse(fs.readFileSync(identityPath, 'utf8'))
		return row?.charPartName ? String(row.charPartName) : null
	}
	catch {
		return null
	}
}

/**
 * 扫描 entities/{entityHash}/identity.json 枚举本地 agent。
 * @param {string} replicaUsername replica 登录名
 * @param {(username: string) => string} getUserDictionary 用户目录解析
 * @param {import('node:fs')} fs 文件系统
 * @param {import('node:path')} path 路径模块
 * @returns {{ entityHash: string, charPartName: string }[]} agent 实体列表
 */
export function scanLocalAgentEntitiesFromChars(replicaUsername, getUserDictionary, fs, path) {
	const root = path.join(getUserDictionary(replicaUsername), 'entities')
	if (!fs.existsSync(root)) return []
	/** @type {{ entityHash: string, charPartName: string }[]} */
	const agents = []
	for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
		if (!ent.isDirectory()) continue
		const identityPath = path.join(root, ent.name, 'identity.json')
		if (!fs.existsSync(identityPath)) continue
		try {
			const row = JSON.parse(fs.readFileSync(identityPath, 'utf8'))
			if (row?.charPartName && row?.ownerEntityHash)
				agents.push({
					entityHash: String(ent.name).toLowerCase(),
					charPartName: String(row.charPartName),
				})
		}
		catch { /* skip */ }
	}
	return agents
}
