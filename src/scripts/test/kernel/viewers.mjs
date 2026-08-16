/**
 * 测试内核 viewer：WS 扇出。
 */
import { randomUUID } from 'node:crypto'

import { WebSocket } from 'npm:ws'

/**
 * @typedef {object} Viewer
 * @property {string} id
 * @property {import('npm:ws').WebSocket} ws
 * @property {boolean} watch
 * @property {string | null} jobId
 * @property {'stream' | 'multi' | 'overview'} mode
 * @property {number} [lastAheadCount] 上次推送的排队深度
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
		let count = 0
		for (const viewer of this.viewers.values())
			if (viewer.watch) count++
		return count
	}

	/**
	 * 遍历当前 viewer。
	 * @returns {IterableIterator<Viewer>} viewers
	 */
	values() {
		return this.viewers.values()
	}

	/**
	 * @param {string} id viewer id
	 * @param {object} event 事件
	 * @returns {void}
	 */
	send(id, event) {
		const viewer = this.viewers.get(id)
		if (!viewer || viewer.ws.readyState !== WebSocket.OPEN) return
		viewer.ws.send(JSON.stringify(event))
	}

	/**
	 * 按订阅发送：watch 收全部；已认领 job 只收自己的事件；hello 前不收 suite 流。
	 * @param {object} event 事件
	 * @returns {void}
	 */
	broadcast(event) {
		const raw = JSON.stringify(event)
		for (const viewer of this.viewers.values()) {
			if (viewer.ws.readyState !== WebSocket.OPEN) continue
			if (eventBelongsToViewer(viewer, event))
				viewer.ws.send(raw)
		}
	}
}

/**
 * 该 viewer 是否该看到此事件。
 * @param {Viewer} viewer viewer
 * @param {object} event 事件
 * @returns {boolean} 是否发送
 */
export function eventBelongsToViewer(viewer, event) {
	if (viewer.watch) return true
	if (!viewer.jobId) return false
	if (event.jobId === viewer.jobId) return true
	return !event.jobId && event.type === 'idle' && viewer.mode === 'overview'
}
