import path from 'node:path'

import { getNodeDir } from './node/instance.mjs'

/**
 * @returns {string} P2P mailbox store-and-forward JSONL
 */
export function mailboxStorePath() {
	return path.join(getNodeDir(), 'mailbox', 'store.jsonl')
}
