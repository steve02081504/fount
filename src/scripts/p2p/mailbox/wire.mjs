import {
	ingestMailboxGive,
	ingestMailboxPut,
	respondMailboxWant,
} from './deliver_or_store.mjs'
import { parseMailboxGive, parseMailboxPut, parseMailboxWant } from './parse.mjs'

/**
 * @typedef {{ replicaUsername?: string }} MailboxWireContext
 */

/**
 * @param {MailboxWireContext} ctx 入站上下文
 * @param {{ on: (name: string, handler: (payload: unknown, peerId: string) => void) => void, send: (name: string, payload: unknown, peerId: string | null) => void }} wire Trystero 适配器
 * @returns {void}
 */
export function attachMailboxWire(ctx, wire) {
	wire.on('mailbox_put', (payload, peerId) => {
		const put = parseMailboxPut(payload)
		if (!put.ok) return
		void ingestMailboxPut(ctx, put.value, peerId).catch(err => console.error('mailbox: put ingest failed', err))
	})

	wire.on('mailbox_want', (payload, peerId) => {
		const want = parseMailboxWant(payload)
		if (!want.ok) return
		void respondMailboxWant(ctx, want.value, (giveWire, targetPeerId) => {
			try {
				wire.send('mailbox_give', giveWire, targetPeerId)
			}
			catch { /* disconnected */ }
		}, peerId).catch(err => console.error('mailbox: want failed', err))
	})

	wire.on('mailbox_give', payload => {
		const give = parseMailboxGive(payload)
		if (!give.ok) return
		void ingestMailboxGive(ctx, give.value).catch(err => console.error('mailbox: give ingest failed', err))
	})
}
