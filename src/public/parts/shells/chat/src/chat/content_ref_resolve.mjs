import { createHash } from 'node:crypto'

import { getStorage } from './storage.mjs'

const DEFAULT_REF_TEXT_MAX = 512_000

/**
 * 自存储插件拉取 `content_ref` 指向的 blob 并校验 SHA-256；成功则解码 UTF-8 文本。
 * @param {string} username 所有者
 * @param {object} content DAG `message` / `message_append` 的 `content` 对象
 * @param {{ maxChars?: number }} [opts] 解码后最大字符数（防巨包）
 * @returns {Promise<{ status: 'ok', text: string } | { status: 'hash_mismatch' } | { status: 'unavailable' } | null>} 无 `content_ref` 时为 null
 */
export async function resolveMessageContentRef(username, content, opts = {}) {
	const ref = content?.content_ref
	if (!ref || typeof ref !== 'object') return null
	const loc = typeof ref.storageLocator === 'string' ? ref.storageLocator.trim() : ''
	const wantHash = typeof ref.contentHash === 'string' ? ref.contentHash.trim().toLowerCase() : ''
	if (!loc || !/^[0-9a-f]{64}$/u.test(wantHash)) return null
	const alg = typeof ref.alg === 'string' ? ref.alg.trim().toLowerCase() : 'sha256'
	if (alg !== 'sha256') return { status: 'unavailable' }

	const maxChars = Number(opts.maxChars) > 0 ? Number(opts.maxChars) : DEFAULT_REF_TEXT_MAX

	/** @type {Uint8Array} */
	let raw
	try {
		raw = await getStorage(username).getChunk(loc)
	}
	catch {
		return { status: 'unavailable' }
	}

	const got = createHash('sha256').update(raw).digest('hex').toLowerCase()
	if (got !== wantHash) return { status: 'hash_mismatch' }

	const dec = new TextDecoder('utf8', { fatal: false })
	let text = dec.decode(raw)
	if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…`
	return { status: 'ok', text }
}

/**
 * 对折叠后的频道消息行批量解析 `content_ref`（与 E2E 密文互斥时跳过）。
 * @param {string} username 所有者
 * @param {object[]} lines 消息行
 * @returns {Promise<object[]>} 新数组（可能含 `_contentRefResolved` / `_contentRefHashMismatch`）
 */
export async function resolveContentRefsInMessageLines(username, lines) {
	if (!Array.isArray(lines) || !lines.length) return lines || []
	return Promise.all(lines.map(async line => {
		if (line.type !== 'message') return line
		const c = line.content
		if (!c || typeof c !== 'object' || !c.content_ref) return line
		if (c.gsh && typeof c.gsh === 'object' && c.gsh.scheme === 'gsh') return line
		if (c.e2e && typeof c.e2e === 'object' && c.e2e.encrypted === true) return line

		const res = await resolveMessageContentRef(username, c)
		if (!res) return line
		if (res.status === 'hash_mismatch')
			return { ...line, content: { ...c, _contentRefHashMismatch: true } }
		if (res.status !== 'ok') return line

		const next = { ...c, text: res.text, _contentRefResolved: true }
		delete next.content_ref
		return { ...line, content: next }
	}))
}
