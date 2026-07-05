/**
 * 基于 room.makeAction(name) 的通用 action 注册表。
 */

/**
 * P2P 房间 action 注册表，封装 makeAction 的 send/receive 对。
 */
export class ActionRegistry {
	/** @type {Map<string, { send: Function, get: Function }>} */
	#entries = new Map()

	/**
	 * @param {{ makeAction: (name: string) => [Function, Function] }} room 提供 makeAction 的房间对象
	 */
	constructor(room) {
		this.room = room
	}

	/**
	 * 预注册一个或多个 action 名称。
	 * @param {string | string[]} names action 名称或名称列表
	 * @returns {ActionRegistry} 当前实例（链式调用）
	 */
	register(names) {
		const list = Array.isArray(names) ? names : [names]
		for (const name of list)
			this.#ensureEntry(name)
		return this
	}

	/**
	 * 获取或创建指定 action 的 send/get 条目。
	 * @param {string} name action 名称
	 * @returns {{ send: Function, get: Function }} send 与 get 函数对
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
	 * 获取指定 action 的发送函数。
	 * @param {string} name action 名称
	 * @returns {Function} 发送函数
	 */
	sender(name) {
		return this.#ensureEntry(name).send
	}

	/**
	 * 获取指定 action 的接收注册函数。
	 * @param {string} name action 名称
	 * @returns {Function} 接收注册函数
	 */
	receiver(name) {
		return this.#ensureEntry(name).get
	}

	/**
	 * 向指定 peer 发送 action 载荷。
	 * @param {string} name action 名称
	 * @param {unknown} payload 载荷
	 * @param {string | null} [peerId] 目标 peer；null 表示广播
	 * @returns {void}
	 */
	send(name, payload, peerId = null) {
		void this.sender(name)(payload, peerId)
	}

	/**
	 * 注册 action 入站 handler。
	 * @param {string} name action 名称
	 * @param {(payload: unknown, peerId: string) => void} handler 入站回调
	 * @returns {ActionRegistry} 当前实例（链式调用）
	 */
	on(name, handler) {
		this.receiver(name)(handler)
		return this
	}
}

/**
 * 创建 ActionRegistry 实例。
 * @param {{ makeAction: (name: string) => [Function, Function] }} room 提供 makeAction 的房间对象
 * @returns {ActionRegistry} 新注册表
 */
export function createActionRegistry(room) {
	return new ActionRegistry(room)
}
