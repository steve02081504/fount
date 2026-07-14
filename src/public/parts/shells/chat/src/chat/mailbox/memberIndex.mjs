/**
 * 跨群已知成员/节点索引（Mailbox 身份防火墙）。
 */
import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { shellChatRoot } from '../lib/paths.mjs'
import { safeReadJson } from '../lib/fsSafe.mjs'

/** @type {Map<string, { pubKeys: Set<string>, nodeHashes: Set<string>, builtAt: number }>} */
const indexCache = new Map()
const CACHE_TTL_MS = 60_000

/**
 * @param {string} username 用户
 * @returns {Promise<{ pubKeys: Set<string>, nodeHashes: Set<string> }>} 已知身份集
 */
export async function loadKnownMemberIndex(username) {
	const now = Date.now()
	const cached = indexCache.get(username)
	if (cached && now - cached.builtAt < CACHE_TTL_MS)
		return { pubKeys: cached.pubKeys, nodeHashes: cached.nodeHashes }

	const pubKeys = new Set()
	const nodeHashes = new Set()
	const groupsDir = join(shellChatRoot(username), 'groups')
	let names = []
	try {
		await access(groupsDir)
		names = await readdir(groupsDir)
	}
	catch {
		indexCache.set(username, { pubKeys, nodeHashes, builtAt: now })
		return { pubKeys, nodeHashes }
	}

	for (const groupId of names) {
		const snapshot = await safeReadJson(join(groupsDir, groupId, 'snapshot.json'))
		const members = snapshot?.members_record?.members || {}
		for (const [key, row] of Object.entries(members)) {
			const pk = String(key).trim().toLowerCase()
			if (isHex64(pk)) pubKeys.add(pk)
			const home = String(row?.homeNodeHash || '').trim().toLowerCase()
			if (isHex64(home)) nodeHashes.add(home)
		}
	}

	indexCache.set(username, { pubKeys, nodeHashes, builtAt: now })
	return { pubKeys, nodeHashes }
}

/**
 * @param {string} username 用户
 * @param {{ pubKeyHash?: string, nodeHash?: string }} subject 主体
 * @returns {Promise<boolean>} 是否已知
 */
export async function isKnownMailboxSubject(username, subject) {
	const { pubKeys, nodeHashes } = await loadKnownMemberIndex(username)
	const pk = String(subject?.pubKeyHash || '').trim().toLowerCase()
	const node = String(subject?.nodeHash || '').trim().toLowerCase()
	if (pk && pubKeys.has(pk)) return true
	if (node && nodeHashes.has(node)) return true
	return false
}

/**
 * @param {string} username 用户
 * @returns {void}
 */
export function invalidateKnownMemberIndex(username) {
	indexCache.delete(username)
}
