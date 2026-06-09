/**
 * Mailbox 投递成功后由 Part 消费 envelope（P2P 不解析 DAG）。
 */

/** @typedef {(username: string, records: object[]) => Promise<string[]>} MailboxConsumer */

/**
 * @typedef {{
 *   app: string,
 *   handler: MailboxConsumer,
 * }} MailboxConsumerEntry
 */

/** @type {Map<string, MailboxConsumerEntry>} */
const consumers = new Map()

/**
 * @param {string} consumerId 如 chat/dag
 * @param {string} app 应用名（与 record.app 匹配）
 * @param {MailboxConsumer} handler 返回已交付 record id 列表
 * @returns {void}
 */
export function registerMailboxConsumer(consumerId, app, handler) {
	consumers.set(String(consumerId), { app: String(app), handler })
}

/**
 * @param {string} consumerId 消费者 ID
 * @returns {void}
 */
export function unregisterMailboxConsumer(consumerId) {
	consumers.delete(String(consumerId))
}

/**
 * @param {string} username replica
 * @param {object[]} records mailbox 记录
 * @returns {Promise<string[]>} 所有 consumer 成功交付的 id 并集
 */
export async function dispatchMailboxRecordsToConsumers(username, records) {
	/** @type {Map<string, object[]>} */
	const grouped = new Map()
	for (const row of records) {
		const app = String(row?.app || '')
		if (!app) continue
		const bucket = grouped.get(app) || []
		bucket.push(row)
		grouped.set(app, bucket)
	}
	/** @type {Set<string>} */
	const delivered = new Set()
	for (const { app, handler } of consumers.values()) {
		const scoped = grouped.get(app)
		if (!scoped?.length) continue
		try {
			const ids = await handler(username, scoped)
			for (const id of ids || []) delivered.add(String(id))
		}
		catch (err) {
			console.error('mailbox: consumer batch failed, retry per record', err)
			for (const row of scoped) 
				try {
					const ids = await handler(username, [row])
					for (const id of ids || []) delivered.add(String(id))
				}
				catch (rowErr) {
					console.error('mailbox: consumer record failed', rowErr)
				}
			
		}
	}
	return [...delivered]
}
