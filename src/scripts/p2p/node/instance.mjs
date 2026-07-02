import path from 'node:path'

import { createFsEntityStore } from '../entity_store.mjs'

import { defaultSignalingRuntimeConfig, resolveSignalingRuntimeConfig } from './signaling_config.mjs'

/** @typedef {{ warn?: (...args: unknown[]) => void, error?: (...args: unknown[]) => void }} NodeLogger */

/** @typedef {import('./signaling_config.mjs').SignalingRuntimeConfig} SignalingRuntimeConfig */

/**
 * @typedef {{
 *   nodeDir: string
 *   entityStore: import('../entity_store.mjs').EntityStore
 *   logger: NodeLogger
 *   signaling: SignalingRuntimeConfig
 * }} NodeRuntime
 */

/** @type {NodeRuntime | null} */
let runtime = null

/** @type {Set<(event: string, payload?: unknown) => void>} */
const changeListeners = new Set()

/** @type {NodeLogger} */
const noopLogger = {
	/**
	 *
	 */
	warn() { },
	/**
	 *
	 */
	error() { },
}

/**
 * @param {{ nodeDir: string, entityStore?: import('../entity_store.mjs').EntityStore, logger?: NodeLogger, signaling?: SignalingRuntimeConfig }} options 节点目录与可选注入
 * @returns {NodeRuntime} 单节点运行时句柄
 */
export function initNode(options) {
	const nodeDir = path.resolve(String(options.nodeDir || '').trim())
	if (!nodeDir) throw new Error('p2p: initNode requires nodeDir')
	const entityStore = options.entityStore ?? createFsEntityStore(path.join(nodeDir, 'entities'))
	runtime = {
		nodeDir,
		entityStore,
		logger: options.logger ?? console,
		signaling: options.signaling ?? resolveSignalingRuntimeConfig(),
	}
	return runtime
}

/**
 * @returns {NodeRuntime} 已初始化的节点运行时
 */
export function getNode() {
	if (!runtime) throw new Error('p2p: node not initialized — call initNode() first')
	return runtime
}

/**
 * @returns {boolean} 是否已调用 initNode
 */
export function isNodeInitialized() {
	return runtime != null
}

/**
 * @returns {SignalingRuntimeConfig} 信令传输策略（未 init 时返回生产默认，不读测试 env）
 */
export function getSignalingRuntimeConfig() {
	return runtime?.signaling ?? defaultSignalingRuntimeConfig()
}

/**
 * @returns {string} 节点数据目录绝对路径
 */
export function getNodeDir() {
	return getNode().nodeDir
}

/**
 * @returns {import('../entity_store.mjs').EntityStore} 注入的 EntityStore
 */
export function getEntityStore() {
	return getNode().entityStore
}

/**
 * @returns {NodeLogger} 节点日志器（未 init 时为 no-op）
 */
export function getNodeLogger() {
	return runtime?.logger ?? noopLogger
}

/**
 * @param {string} event 事件名
 * @param {unknown} [payload] 载荷
 * @returns {void}
 */
export function emitNodeChange(event, payload) {
	for (const listener of changeListeners)
		try { listener(event, payload) }
		catch { /* ignore */ }
}

/**
 * @param {(event: string, payload?: unknown) => void} listener 回调
 * @returns {() => void} 取消订阅
 */
export function onNodeChange(listener) {
	changeListeners.add(listener)
	return () => changeListeners.delete(listener)
}
