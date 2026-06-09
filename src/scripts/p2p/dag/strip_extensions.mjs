/**
 * DAG 事件行读盘时剥离的本地扩展键（不得进入验签域 / 联邦 wire）。
 */
import { isPlainObject } from '../wire_ingress.mjs'

/** 落盘后 trusted 读路径仍须剥除的 sidecar 键。 */
export const DAG_EVENT_LOCAL_EXTENSION_KEYS = new Set(['receivedAt', 'isRemote'])

/**
 * @param {unknown} row JSONL 行
 * @returns {object} 剥离扩展键后的副本
 */
export function stripDagEventLocalExtensions(row) {
	if (!isPlainObject(row)) return row
	const out = { ...row }
	for (const key of DAG_EVENT_LOCAL_EXTENSION_KEYS) delete out[key]
	return out
}
