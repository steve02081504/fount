/**
 * 【文件】localPlugins.mjs — 群级本机插件名单（节点私有）
 * 【职责】读写 `groups/{id}/local_plugins.json`；仅影响本机 replica 上的 char 生成，不入 DAG、不联邦。
 * 【关联】resolvePart、partConfig、groupLifecycle、timeSliceParts。
 */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { writeJsonAtomicSynced } from 'npm:@steve02081504/fount-p2p/dag/storage'

import { localPluginsPath } from '../lib/paths.mjs'

/**
 * 读取本机启用的插件名列表；文件不存在则空数组。
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @returns {Promise<string[]>} 插件名
 */
export async function getLocalPluginNames(replicaUsername, groupId) {
	try {
		const raw = JSON.parse(await readFile(localPluginsPath(replicaUsername, groupId), 'utf8'))
		return Array.isArray(raw) ? raw.map(name => String(name)).filter(Boolean) : []
	}
	catch {
		return []
	}
}

/**
 * 覆写本机插件名单。
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string[]} names 插件名列表
 * @returns {Promise<void>}
 */
export async function setLocalPluginNames(replicaUsername, groupId, names) {
	const path = localPluginsPath(replicaUsername, groupId)
	await mkdir(dirname(path), { recursive: true })
	await writeJsonAtomicSynced(path, [...new Set(names.map(name => String(name)).filter(Boolean))])
}

/**
 * 追加本机插件。
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} pluginname 插件名
 * @returns {Promise<void>}
 */
export async function addLocalPlugin(replicaUsername, groupId, pluginname) {
	const name = String(pluginname || '').trim()
	if (!name) return
	const list = await getLocalPluginNames(replicaUsername, groupId)
	if (!list.includes(name)) list.push(name)
	await setLocalPluginNames(replicaUsername, groupId, list)
}

/**
 * 移除本机插件。
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} pluginname 插件名
 * @returns {Promise<void>}
 */
export async function removeLocalPlugin(replicaUsername, groupId, pluginname) {
	const name = String(pluginname || '').trim()
	if (!name) return
	const list = await getLocalPluginNames(replicaUsername, groupId)
	await setLocalPluginNames(replicaUsername, groupId, list.filter(n => n !== name))
}
