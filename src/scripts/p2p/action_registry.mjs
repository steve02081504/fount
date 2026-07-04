/**
 * 基于 room.makeAction(name) 的通用 action 注册表。
 */

export class ActionRegistry {
	/** @type {Map<string, { send: Function, get: Function }>} */
	#entries = new Map()

	/**
	 * @param {{ makeAction: (name: string) => [Function, Function] }} room
	 */
	constructor(room) {
		this.room = room
	}

	/**
	 * @param {string | string[]} names
	 * @returns {ActionRegistry}
	 */
	register(names) {
		const list = Array.isArray(names) ? names : [names]
		for (const name of list)
			this.#ensureEntry(name)
		return this
	}

	/**
	 * @param {string} name
	 * @returns {{ send: Function, get: Function }}
	 */
	#ensureEntry(name) {
		let entry = this.#entries.get(name)
		if (!entry) {
			const [send, get] = this.room.makeAction(name)
			entry = { send, get }
			this.#entries.set(name, entry)
		}
		return entry
	}

	/**
	 * @param {string} name
	 * @returns {Function}
	 */
	sender(name) {
		return this.#ensureEntry(name).send
	}

	/**
	 * @param {string} name
	 * @returns {Function}
	 */
	receiver(name) {
		return this.#ensureEntry(name).get
	}

	/**
	 * @param {string} name
	 * @param {unknown} payload
	 * @param {string | null} [peerId]
	 * @returns {void}
	 */
	send(name, payload, peerId = null) {
		void this.sender(name)(payload, peerId)
	}

	/**
	 * @param {string} name
	 * @param {(payload: unknown, peerId: string) => void} handler
	 * @returns {ActionRegistry}
	 */
	on(name, handler) {
		this.receiver(name)(handler)
		return this
	}
}

/**
 * @param {{ makeAction: (name: string) => [Function, Function] }} room
 * @returns {ActionRegistry}
 */
export function createActionRegistry(room) {
	return new ActionRegistry(room)
}
