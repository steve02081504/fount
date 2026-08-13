/**
 * 测试内核 viewer：WS 扇出。
 */
import { randomUUID } from 'node:crypto'

/**
 * @typedef {object} Viewer
 * @property {string} id
 * @property {import('npm:ws').WebSocket} ws
 * @property {boolean} watch
 * @property {string | null} jobId
 * @property {'stream' | 'multi' | 'overview'} mode
 */

/**
 * Viewer 集合。
 */
export class ViewerHub {
	/** 空集合。 */
	constructor() {
		/** @type {Map<string, Viewer>} */
		this.viewers = new Map()
	}

	/**
	 * @param {import('npm:ws').WebSocket} ws 连接
	 * @param {object} spec 声明
	 * @param {boolean} [spec.watch] 是否计入 watch 引用
	 * @param {'stream' | 'multi' | 'overview'} [spec.mode] 显示模式
	 * @returns {Viewer} viewer
	 */
	add(ws, { watch = false, mode = 'overview' } = {}) {
		const viewer = { id: randomUUID(), ws, watch, jobId: null, mode }
		this.viewers.set(viewer.id, viewer)
		return viewer
	}

	/**
	 * @param {string} id viewer id
	 * @returns {Viewer | undefined} 被移除的 viewer
	 */
	remove(id) {
		const viewer = this.viewers.get(id)
		this.viewers.delete(id)
		return viewer
	}

	/**
	 * @returns {number} 当前 viewer 数
	 */
	size() {
		return this.viewers.size
	}

	/**
	 * @returns {number} watch 连接数
	 */
	watchCount() {
		let n = 0
		for (const viewer of this.viewers.values())
			if (viewer.watch) n++
		return n
	}

	/**
	 * @param {string} id viewer id
	 * @param {object} event 事件
	 * @returns {void}
	 */
	send(id, event) {
		const viewer = this.viewers.get(id)
		if (!viewer || viewer.ws.readyState !== 1) return
		viewer.ws.send(JSON.stringify(event))
	}

	/**
	 * 按订阅发送：overview/watch 收全部；job 订阅只收自己的 job。
	 * @param {object} event 事件
	 * @returns {void}
	 */
	broadcast(event) {
		const raw = JSON.stringify(event)
		for (const viewer of this.viewers.values()) {
			if (viewer.ws.readyState !== 1) continue
			if (viewer.mode === 'overview' || viewer.watch) {
				viewer.ws.send(raw)
				continue
			}
			if (event.jobId && viewer.jobId === event.jobId)
				viewer.ws.send(raw)
			else if (!event.jobId && (event.type === 'idle' || event.type === 'snapshot'))
				viewer.ws.send(raw)
		}
	}
}
