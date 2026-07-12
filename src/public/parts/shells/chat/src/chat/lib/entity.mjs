import { sha256TextHex } from '../../../../../../../scripts/p2p/crypto.mjs'
import {
	encodeEntityHash,
	isEntityHash128,
	parseEntityHash,
} from '../../../../../../../scripts/p2p/entity_id.mjs'
import { isHex64, normalizeHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { getNodeHash } from '../../../../../../../scripts/p2p/node/identity.mjs'

/** agent subject 前缀（与 Chat 角色路径绑定）。 */
export const AGENT_SUBJECT_PREFIX = 'fount:chat:agent:'

/**
 * @param {string} charPartPath 角色 part 路径，如 `chars/MyChar`
 * @returns {string} 64 位 agent subjectHash
 */
export function agentSubjectHash(charPartPath) {
	const slug = String(charPartPath || '').trim().replace(/^\/+/, '').replace(/\\/g, '/')
	return sha256TextHex(`${AGENT_SUBJECT_PREFIX}${slug}`)
}

/**
 * @param {string} nodeHash 节点 hash
 * @param {string} charPartPath 角色 part 路径
 * @returns {string} agent entityHash
 */
export function agentEntityHash(nodeHash, charPartPath) {
	return encodeEntityHash(nodeHash, agentSubjectHash(charPartPath))
}

/**
 * @param {object} member 物化成员行
 * @param {string} [member.pubKeyHash] 用户成员签名公钥 hash
 * @param {string} [member.agentEntityHash] agent 成员 entityHash
 * @param {string} [member.homeNodeHash] 所属节点 hash
 * @param {string} [member.memberKind] user | agent
 * @returns {string | null} entityHash；无法派生时为 null
 */
export function memberEntityHash(member) {
	if (member?.memberKind === 'agent') {
		const agentHash = String(member.agentEntityHash || '').trim().toLowerCase()
		return isEntityHash128(agentHash) ? agentHash : null
	}
	const subject = normalizeHex64(member?.pubKeyHash || '')
	const node = normalizeHex64(member?.homeNodeHash || '')
	if (!isHex64(subject) || !isHex64(node)) return null
	return encodeEntityHash(node, subject)
}

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

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 agent entityHash
 * @param {(username: string) => string} getUserDictionary 用户目录解析
 * @param {import('node:fs')} fs 文件系统
 * @param {import('node:path')} path 路径模块
 * @returns {string | null} 角色 part 名
 */
export function resolveAgentCharPartName(replicaUsername, entityHash, getUserDictionary, fs, path) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return null
	const nodeHash = getNodeHash()
	if (parsed.nodeHash !== nodeHash) return null
	const charsRoot = path.join(getUserDictionary(replicaUsername), 'chars')
	if (!fs.existsSync(charsRoot)) return null
	for (const ent of fs.readdirSync(charsRoot, { withFileTypes: true })) {
		if (!ent.isDirectory()) continue
		const partPath = `chars/${ent.name}`
		if (agentEntityHash(nodeHash, partPath) === parsed.entityHash)
			return ent.name
	}
	return null
}
