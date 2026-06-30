/**
 * 【文件】src/chat/storage.mjs
 * 【职责】按用户 shellData 与群物化设置选择群文件块存储后端（本地目录、S3、联邦多副本或 P2P swarm）。
 * 【原理】loadStorageConfig 读 chat/storage；getStorageForGroup 依 type 与 fileReplicationFactor 在 createLocal/S3/Federated/P2pSwarm 插件间切换；`type: local` 用本地目录，默认/未指定时用 P2P swarm（需 groupId）；getFederatedChunkStorage 独立提供多 S3 回退拉取。
 * 【数据结构】storage 配置 `{ type, s3?, federated? }`、groupSettings.fileReplicationFactor、groupScope.groupId、shellChatRoot 基路径。
 * 【关联】被 DAG 文件读写、联邦 chunks 使用；依赖 scripts/p2p/storage_plugins 与 chat/federation/chunks.mjs。
 */

import {
	createFederatedChunksPlugin,
	createLocalStoragePlugin,
	createS3StoragePlugin,
} from '../../../../../../scripts/p2p/storage_plugins.mjs'
import { loadShellData } from '../../../../../../server/setting_loader.mjs'

import { createFederationSwarmStoragePlugin } from './federation/chunks.mjs'
import { shellChatRoot } from './lib/paths.mjs'

/**
 * @param {unknown} cfg 单条 S3 副本配置
 * @returns {boolean} 是否具备最小凭证
 */
function isValidS3Replica(cfg) {
	return !!(cfg?.bucket && cfg?.accessKeyId && cfg?.secretAccessKey)
}

/**
 * @param {string} username 用户名
 * @returns {{ type: string, s3?: object, federated?: { replicas?: unknown[] } }} 原始配置
 */
function loadStorageConfig(username) {
	const data = loadShellData(username, 'chat', 'storage') || {}
	return {
		type: data.type || 'local',
		s3: data.s3,
		federated: data.federated,
	}
}

/**
 * 返回该用户配置的群文件存储插件（不考虑群 `fileReplicationFactor`）。
 * @param {string} username 用户名
 * @returns {object} 存储插件实例（local / s3 / federated 之一）
 */
export function getStorage(username) {
	return getStorageForGroup(username, {})
}

/**
 * 按群设置与节点配置选择插件；`federated` = 多 S3；`federation_swarm` / 联邦开启 = 邻居复制（§10.2）。
 * @param {string} username 用户名
 * @param {{ fileReplicationFactor?: unknown }} [groupSettings] 物化群设置
 * @param {{ groupId?: string }} [groupScope] 当前群 id（P2P 复制需要）
 * @returns {object} 存储插件
 */
export function getStorageForGroup(username, groupSettings = {}, groupScope = {}) {
	const baseDir = shellChatRoot(username)
	const cfg = loadStorageConfig(username)
	const M = Number(groupSettings.fileReplicationFactor)
	const groupId = groupScope.groupId?.trim() || ''

	if (cfg.type === 's3' && cfg.s3)
		return createS3StoragePlugin(cfg.s3)

	if (cfg.type === 'federated' && cfg.federated) {
		const replicas = Array.isArray(cfg.federated.replicas) ? cfg.federated.replicas : []
		const valid = replicas.filter(isValidS3Replica)
		const cap = Number.isFinite(M) && M > 0 ? Math.floor(M) : valid.length
		const replicaCount = Math.min(Math.max(0, cap), valid.length)
		if (replicaCount >= 1)
			return createFederatedChunksPlugin({ replicas: valid.slice(0, replicaCount) })
	}

	const useFederationSwarm = groupId && (
		cfg.type === 'federation_swarm' ||
		(cfg.type !== 's3' && cfg.type !== 'federated' && cfg.type !== 'local')
	)
	if (useFederationSwarm)
		return createFederationSwarmStoragePlugin(baseDir, username, groupId)

	return createLocalStoragePlugin(baseDir)
}

/**
 * 若节点配置了 `federated` 副本，返回多 S3 插件（与主插件选择无关，供回退拉取）。
 * @param {string} username 用户名
 * @param {{ fileReplicationFactor?: unknown }} [groupSettings] 物化群设置
 * @returns {import('../../../../../../scripts/p2p/storage_plugins.mjs').GroupStoragePlugin | null} 插件或 null
 */
export function getFederatedChunkStorage(username, groupSettings = {}) {
	const cfg = loadStorageConfig(username)
	if (cfg.type !== 'federated' || !cfg.federated) return null
	const replicas = Array.isArray(cfg.federated.replicas) ? cfg.federated.replicas : []
	const valid = replicas.filter(isValidS3Replica)
	const M = Number(groupSettings.fileReplicationFactor)
	const cap = Number.isFinite(M) && M > 0 ? Math.floor(M) : valid.length
	const replicaCount = Math.min(Math.max(0, cap), valid.length)
	if (replicaCount < 1) return null
	return createFederatedChunksPlugin({ replicas: valid.slice(0, replicaCount) })
}
