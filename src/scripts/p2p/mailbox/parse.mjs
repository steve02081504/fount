import { assertHex64 } from '../hexIds.mjs'
import {
	assertMailboxPubKeyHash,
	assertMailboxRecordShape,
} from '../schemas/mailbox_wire.mjs'
import { isPlainObject } from '../wire_ingress.mjs'

/**
 * @typedef {import('../schemas/mailbox_wire.mjs').MailboxWireErr} MailboxParseErr
 * @typedef {{ ok: true, value: object }} MailboxParseOk
 * @typedef {MailboxParseOk | MailboxParseErr} MailboxParseResult
 */

/**
 * @param {unknown} payload 载荷
 * @returns {MailboxParseResult} 解析结果
 */
export function parseMailboxPut(payload) {
	if (!isPlainObject(payload))
		return { ok: false, code: 'invalid_payload', field: 'payload' }
	if (!isPlainObject(payload.record))
		return { ok: false, code: 'required', field: 'record' }
	const shape = assertMailboxRecordShape(payload.record)
	if (!shape.ok) return shape
	if (payload.nodeHash != null) 
		try {
			assertHex64(payload.nodeHash, 'mailbox_put.nodeHash')
		}
		catch {
			return { ok: false, code: 'invalid_hex64', field: 'nodeHash' }
		}
	
	return { ok: true, value: payload }
}

/**
 * @param {unknown} payload 载荷
 * @returns {MailboxParseResult} 解析结果
 */
export function parseMailboxWant(payload) {
	if (!isPlainObject(payload))
		return { ok: false, code: 'invalid_payload', field: 'payload' }
	const pubKey = assertMailboxPubKeyHash(payload.toPubKeyHash)
	if (!pubKey.ok)
		return { ok: false, code: pubKey.code, field: 'toPubKeyHash' }
	return { ok: true, value: { ...payload, toPubKeyHash: pubKey.value } }
}

/**
 * @param {unknown} payload 载荷
 * @returns {MailboxParseResult} 解析结果
 */
export function parseMailboxGive(payload) {
	if (!isPlainObject(payload))
		return { ok: false, code: 'invalid_payload', field: 'payload' }
	if (!Array.isArray(payload.records))
		return { ok: false, code: 'required', field: 'records' }
	/** @type {object[]} */
	const records = []
	for (let i = 0; i < payload.records.length; i++) {
		const record = payload.records[i]
		const shape = assertMailboxRecordShape(record)
		if (!shape.ok)
			return { ok: false, code: shape.code, field: `records[${i}].${shape.field}` }
		if (!record.envelope || typeof record.envelope !== 'object')
			return { ok: false, code: 'required', field: `records[${i}].envelope` }
		const app = String(record.app || '').trim()
		if (!app)
			return { ok: false, code: 'required', field: `records[${i}].app` }
		records.push(record)
	}
	return { ok: true, value: { ...payload, records } }
}
