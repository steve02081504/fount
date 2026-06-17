import { randomBytes } from 'node:crypto'

import { nodeHashFromSeed } from '../entity/node_hash.mjs'
import { userEntityHashFromPubKeyHex } from '../entity_id.mjs'
import { isHex64 } from '../hexIds.mjs'
import { normalizeMailboxSettings } from '../mailbox/settings.mjs'

import { emitNodeChange } from './instance.mjs'
import { readNodeJsonSync, writeNodeJsonSync } from './storage.mjs'

const NODE_SEED_HEX_RE = /^[0-9a-f]{64}$/iu
const NODE_JSON = 'node'

/**
 * @returns {object} 节点配置磁盘对象
 */
function loadNodeFile() {
	return readNodeJsonSync(NODE_JSON) || {}
}

/**
 * @param {object} patch 部分字段
 * @returns {object} 合并后写盘
 */
function saveNodeFile(patch) {
	const data = { ...loadNodeFile(), ...patch }
	writeNodeJsonSync(NODE_JSON, data)
	emitNodeChange('node-config-changed', { patch })
	return data
}

/**
 * @returns {string} 64 hex 节点种子
 */
export function ensureNodeSeed() {
	const data = loadNodeFile()
	const existing = String(data.nodeSeedHex || '').trim().toLowerCase()
	if (NODE_SEED_HEX_RE.test(existing)) return existing
	const nodeSeedHex = randomBytes(32).toString('hex')
	saveNodeFile({ nodeSeedHex })
	return nodeSeedHex
}

/**
 * @returns {string} 本节点 64 hex nodeHash
 */
export function getNodeHash() {
	return nodeHashFromSeed(ensureNodeSeed())
}

/**
 * @returns {{ relayUrls: string[], batterySaver: boolean, mailbox: ReturnType<typeof normalizeMailboxSettings> }} 传输与 mailbox 配置
 */
export function getNodeTransportSettings() {
	const data = loadNodeFile()
	const relayUrls = Array.isArray(data.relayUrls)
		? data.relayUrls.map(url => String(url).trim()).filter(url => url.startsWith('wss://'))
		: []
	const batterySaver = !!data.batterySaver
	const mailbox = normalizeMailboxSettings(data.mailbox || {})
	return { relayUrls, batterySaver, mailbox }
}

/**
 * @param {object} patch 部分字段
 * @returns {ReturnType<typeof getNodeTransportSettings>} 保存后的传输配置
 */
export function saveNodeTransportSettings(patch) {
	const data = loadNodeFile()
	if (patch.batterySaver != null) data.batterySaver = !!patch.batterySaver
	if (patch.relayUrls)
		data.relayUrls = patch.relayUrls.map(url => String(url).trim()).filter(url => url.startsWith('wss://'))
	if (patch.mailbox)
		data.mailbox = normalizeMailboxSettings({ ...data.mailbox, ...patch.mailbox })
	saveNodeFile(data)
	return getNodeTransportSettings()
}

/**
 * 确保 node.json 存在且含 nodeSeed、mailbox 默认值。
 * @returns {ReturnType<typeof getNodeTransportSettings> & { nodeHash: string }} 默认配置与 nodeHash
 */
export function ensureNodeDefaults() {
	ensureNodeSeed()
	const data = loadNodeFile()
	if (!data.mailbox) saveNodeFile({ mailbox: normalizeMailboxSettings({}) })
	return { ...getNodeTransportSettings(), nodeHash: getNodeHash() }
}

/**
 * @param {string} nodeHash 64 hex
 * @param {string} operatorPubKeyHex 64 hex
 * @returns {string | null} operator entityHash
 */
export function operatorEntityHashFromKeys(nodeHash, operatorPubKeyHex) {
	const pub = String(operatorPubKeyHex || '').trim().toLowerCase().replace(/^0x/iu, '')
	if (!isHex64(nodeHash) || !isHex64(pub)) return null
	return userEntityHashFromPubKeyHex(nodeHash, pub)
}
