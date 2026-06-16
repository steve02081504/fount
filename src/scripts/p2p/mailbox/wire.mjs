import {
	ingestMailboxGive,
	ingestMailboxPut,
	respondMailboxWant,
} from './deliver_or_store.mjs'
import { parseMailboxGive, parseMailboxPut, parseMailboxWant } from './parse.mjs'

/**
 * 用户级联邦房间挂载 mailbox_put / want / give（P2P 层处理，不经 Part handler_registry）。
 * @param {string} username replica
 * @param {{ on: (name: string, handler: (payload: unknown, peerId: string) => void) => void, send: (name: string, payload: unknown, peerId: string | null) => void }} wire Trystero 房间 wire
 * @returns {void}
 */
export function attachMailboxWire(username, wire) {
	wire.on('mailbox_put', (payload, peerId) => {
		const put = parseMailboxPut(payload)
		if (!put) return
		void ingestMailboxPut(username, put).catch(err => console.error('mailbox: put ingest failed', err))
	})

	wire.on('mailbox_want', (payload, peerId) => {
		const want = parseMailboxWant(payload)
		if (!want) return
		void respondMailboxWant(username, want, (giveWire, targetPeerId) => {
			try {
				wire.send('mailbox_give', giveWire, targetPeerId)
			}
			catch { /* disconnected */ }
		}, peerId).catch(err => console.error('mailbox: want failed', err))
	})

	wire.on('mailbox_give', payload => {
		const give = parseMailboxGive(payload)
		if (!give) return
		void ingestMailboxGive(username, give).catch(err => console.error('mailbox: give ingest failed', err))
	})
}
