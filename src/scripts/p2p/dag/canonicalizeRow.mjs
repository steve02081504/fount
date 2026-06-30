/**
 * DAG / 时间线签名行入库前的共用 hex 规范化（非权限校验）。
 */
import { isEntityHash128 } from '../entity_id.mjs'
import { assertHex64, HEX_ID_64, normalizeHex64 } from '../hexIds.mjs'
/**
 * @param {Record<string, unknown>} obj 可变对象
 * @param {string} key 字段名
 */
function canonicalizeHexField(obj, key) {
	if (obj[key] == null || obj[key] === '') return
	const normalized = normalizeHex64(obj[key])
	if (!HEX_ID_64.test(normalized))
		throw new Error(`${key} must be 64 hex characters`)
	obj[key] = normalized
}

/**
 * @param {unknown} content 事件 content
 * @param {ReadonlySet<string>} hexKeys content 内 hex64 字段名
 * @param {ReadonlySet<string>} [entityHashKeys] content 内 128 位 entityHash 字段名
 * @returns {object | undefined} 规范化后的 content
 */
export function canonicalizeRowContent(content, hexKeys, entityHashKeys = new Set()) {
	if (!content) return content
	const out = { ...content }
	for (const key of hexKeys)
		canonicalizeHexField(out, key)
	for (const key of entityHashKeys) {
		if (out[key] == null || out[key] === '') continue
		const entityHash = String(out[key]).toLowerCase()
		if (!isEntityHash128(entityHash))
			throw new Error(`${key} must be 128 hex characters`)
		out[key] = entityHash
	}
	if (out.content_ref) {
		const ref = { ...out.content_ref }
		canonicalizeHexField(ref, 'contentHash')
		out.content_ref = ref
	}
	return out
}

/**
 * @param {object} event 签名事件
 * @param {{
 *   prepare?: (event: object) => object,
 *   contentHexKeys?: ReadonlySet<string>,
 *   entityHashKeys?: ReadonlySet<string>,
 * }} [opts] 各域字段集
 * @returns {object} canonical 行
 */
export function canonicalizeSignedRow(event, opts = {}) {
	const out = opts.prepare ? opts.prepare({ ...event }) : { ...event }
	out.id = assertHex64(out.id, 'id')
	out.sender = assertHex64(out.sender, 'sender')
	if (Array.isArray(out.prev_event_ids))
		out.prev_event_ids = out.prev_event_ids.map((id, index) =>
			assertHex64(id, `prev_event_ids[${index}]`),
		)
	const hexKeys = opts.contentHexKeys
	if (out.content && hexKeys?.size)
		out.content = canonicalizeRowContent(out.content, hexKeys, opts.entityHashKeys)
	return out
}
