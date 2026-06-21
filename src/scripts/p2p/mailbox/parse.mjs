import { assertHex64 } from '../hexIds.mjs'
import {
	assertMailboxPubKeyHash,
	assertMailboxRecordShape,
} from '../schemas/mailbox_wire.mjs'
import { isPlainObject } from '../wire_ingress.mjs'

/**
 * @param {unknown} payload 载荷
 * @returns {object | null} 解析结果
 */
export function parseMailboxPut(payload) {
	if (!isPlainObject(payload) || !isPlainObject(payload.record)) return null
	try {
		assertMailboxRecordShape(payload.record)
		if (payload.nodeHash != null)
			assertHex64(payload.nodeHash, 'mailbox_put.nodeHash')
		return payload
	}
	catch {
		return null
	}
}

/**
 * @param {unknown} payload 载荷
 * @returns {object | null} 解析结果
 */
export function parseMailboxWant(payload) {
	if (!isPlainObject(payload)) return null
	try {
		return {
			...payload,
			toPubKeyHash: assertMailboxPubKeyHash(payload.toPubKeyHash),
		}
	}
	catch {
		return null
	}
}

/**
 * @param {unknown} payload 载荷
 * @returns {object | null} 解析结果
 */
export function parseMailboxGive(payload) {
	if (!isPlainObject(payload) || !Array.isArray(payload.records)) return null
	try {
		const records = payload.records.map(record => {
			assertMailboxRecordShape(record)
			if (!record.envelope || typeof record.envelope !== 'object')
				throw new Error('mailbox.record.envelope required')
			const app = String(record.app || '').trim()
			if (!app) throw new Error('mailbox.record.app required')
			return record
		})
		return { ...payload, records }
	}
	catch {
		return null
	}
}
