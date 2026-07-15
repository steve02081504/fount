/**
 * 【文件】files/contentRefResolve.mjs
 * 【职责】解析消息 `content_ref` 外链 blob：拉取、SHA-256 校验并解码 UTF-8 展示文本。
 * 【原理】storage.getChunk(locator) → hash 比对 → TextDecoder；批量 resolveContentRefsInMessageLines 标注 mismatch。
 * 【数据结构】status: ok|hash_mismatch|unavailable；content_ref { storageLocator, contentHash, alg }。
 * 【关联】storage.mjs、Hub messages/render。
 */
import { createHash } from 'node:crypto'

import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { getStorage } from '../storage.mjs'

const DEFAULT_REF_TEXT_MAX = 512_000

/**
 * 自存储插件拉取 `content_ref` 指向的 blob 并校验 SHA-256；成功则解码 UTF-8 文本。
 * @param {string} username 所有者
 * @param {object} content DAG `message` 的 `content` 对象
 * @param {{ maxChars?: number }} [opts] 解码后最大字符数（防巨包）
 * @returns {Promise<{ status: 'ok', text: string } | { status: 'hash_mismatch' } | { status: 'unavailable' } | null>} 无 `content_ref` 时为 null
 */
export async function resolveMessageContentRef(username, content, opts = {}) {
	const ref = content?.content_ref
	if (!ref) return null
	const loc = String(ref.storageLocator || '').trim()
	const wantHash = String(ref.contentHash || '').trim().toLowerCase()
	if (!loc || !isHex64(wantHash)) return null
	if (String(ref.alg || 'sha256').trim().toLowerCase() !== 'sha256') return { status: 'unavailable' }

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
 * 对折叠后的频道消息行批量解析 `content_ref`。
 * @param {string} username 所有者
 * @param {object[]} lines 消息行
 * @returns {Promise<object[]>} 新数组（可能含 `contentRefResolved` / `contentRefHashMismatch`）
 */
export async function resolveContentRefsInMessageLines(username, lines) {
	if (!lines?.length) return lines || []
	return Promise.all(lines.map(async line => {
		if (line.type !== 'message') return line
		const content = line.content || {}
		if (!content.content_ref) return line

		const res = await resolveMessageContentRef(username, content)
		if (!res) return line
		if (res.status === 'hash_mismatch')
			return { ...line, content: { ...content, contentRefHashMismatch: true } }
		if (res.status !== 'ok') return line

		const next = {
			...content,
			type: 'text',
			content: res.text,
			contentRefResolved: true,
		}
		delete next.content_ref
		return { ...line, content: next }
	}))
}
