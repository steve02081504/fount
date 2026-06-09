import { assertHex64 } from '../hexIds.mjs'

/**
 * @param {unknown} value 收件人 pubKeyHash
 * @returns {string} 规范化 hex64
 */
export function assertMailboxPubKeyHash(value) {
	return assertHex64(value, 'mailbox.toPubKeyHash')
}

/**
 * @param {unknown} record mailbox 记录
 * @returns {object} 已校验的 record
 */
export function assertMailboxRecordShape(record) {
	if (!record || typeof record !== 'object')
		throw new Error('mailbox.record required')
	assertMailboxPubKeyHash(record.toPubKeyHash)
	return record
}
