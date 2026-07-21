import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { buildFileManifestFromEnc, encryptPlaintextToParts, vaultWrapDescriptor } from 'npm:@steve02081504/fount-p2p/files/assemble'
import { saveFileManifest, storeManifestParts } from 'npm:@steve02081504/fount-p2p/files/evfs'
import { publicTransferKeyDescriptor } from 'npm:@steve02081504/fount-p2p/files/manifest'
import { publishPublicFile } from 'npm:@steve02081504/fount-p2p/files/public_manifest'

import { getEntityRecoverySecretKey, getRecoveryPubKeyHex } from '../../chat/src/entity/identity.mjs'
import { vaultGroupId } from '../../social/src/federation/namespace.mjs'
import { loadVaultMasterKey } from '../../social/src/vault_crypto/vault.mjs'

import { evfsCabinetIndexPath } from './paths.mjs'

/**
 * @param {object[]} cabinets 柜列表
 * @param {(visibility: string) => boolean} match 可见性谓词
 * @returns {object[]} 发布行
 */
function mapListRows(cabinets, match) {
	return cabinets
		.filter(row => row.type === 'personal' && match(row.visibility?.visibility))
		.map(row => ({
			cabinet_id: row.cabinet_id,
			name: row.name,
			visibility: row.visibility,
			created_at: row.created_at,
		}))
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object[]} cabinets 柜列表
 * @returns {Promise<void>}
 */
export async function publishCabinetLists(username, entityHash, cabinets) {
	const publicRows = mapListRows(cabinets, v => v === 'public')
	const followersRows = mapListRows(cabinets, v => ['followers', 'followers_since', 'selected'].includes(v))

	const recoverySecretKeyHex = await getEntityRecoverySecretKey(username, entityHash)
	const recoveryPubKeyHex = await getRecoveryPubKeyHex(username, entityHash)
	if (recoverySecretKeyHex && recoveryPubKeyHex)
		await publishPublicFile({
			ownerEntityHash: entityHash,
			logicalPath: 'shells/cabinet/cabinets.public.json',
			plaintext: Buffer.from(JSON.stringify({ cabinets: publicRows }), 'utf8'),
			entitySecretKey: Buffer.from(recoverySecretKeyHex, 'hex'),
			entityPubKeyHex: recoveryPubKeyHex,
			name: 'cabinets.public.json',
			mimeType: 'application/json',
		})

	const { masterKey } = await loadVaultMasterKey(username, entityHash)
	const fileId = 'cabinets-followers'
	await storeEvfsManifest(entityHash, {
		logicalPath: 'shells/cabinet/cabinets.followers.json',
		plaintext: Buffer.from(JSON.stringify({ cabinets: followersRows }), 'utf8'),
		name: 'cabinets.followers.json',
		mimeType: 'application/json',
		visibility: 'followers',
		transferKeyDescriptor: vaultTransferKeyFactory(entityHash, fileId, masterKey),
		ceMode: 'random',
		meta: {
			fileId,
			vaultGroupId: vaultGroupId(entityHash),
		},
	})
}

/**
 * 按柜可见性发布索引到 EVFS。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object} cabinet 柜
 * @param {{ version: number, entries: object[] }} index 索引
 * @returns {Promise<object | null>} manifest
 */
export async function publishCabinetIndex(username, entityHash, cabinet, index) {
	const publicEntries = index.entries.filter(entry => !entry.orphaned).map(entry => ({
		id: entry.id,
		name: entry.name,
		kind: entry.kind,
		parent_id: entry.parent_id,
		size: entry.size,
		mime_type: entry.mime_type,
		description: entry.description,
		created: entry.created,
		modified: entry.modified,
		evfs_path: entry.evfs_path ?? null,
		attrs: entry.attrs,
		preview: entry.preview?.url ? { url: entry.preview.url } : undefined,
		encryption: entry.encryption ? { locked: true } : null,
		link: entry.link,
	}))
	return putCabinetEvfsFile(username, entityHash, {
		logical_path: evfsCabinetIndexPath(cabinet.cabinet_id),
		plaintext: Buffer.from(JSON.stringify({ version: index.version, entries: publicEntries }), 'utf8'),
		name: 'index.json',
		mime_type: 'application/json',
		visibility: cabinet.visibility,
	})
}

/**
 * @param {string} entityHash 实体
 * @param {string} fileId 文件 id
 * @param {Buffer} masterKey vault 主钥
 * @returns {(enc: { contentKey: Buffer }) => object} transferKey 工厂
 */
function vaultTransferKeyFactory(entityHash, fileId, masterKey) {
	return enc => vaultWrapDescriptor(entityHash, fileId, enc.contentKey, masterKey)
}

/**
 * @param {string} entityHash 实体
 * @param {{
 *   logicalPath: string,
 *   plaintext: Buffer,
 *   name: string,
 *   mimeType: string,
 *   visibility: string,
 *   transferKeyDescriptor: object | ((enc: { contentKey: Buffer }) => object),
 *   ceMode: 'convergent' | 'random',
 *   meta?: object,
 * }} options 写入参数
 * @returns {Promise<object>} manifest
 */
async function storeEvfsManifest(entityHash, {
	logicalPath,
	plaintext,
	name,
	mimeType,
	visibility,
	transferKeyDescriptor,
	ceMode,
	meta = {},
}) {
	const enc = encryptPlaintextToParts(plaintext, ceMode)
	const descriptor = typeof transferKeyDescriptor === 'function'
		? transferKeyDescriptor(enc)
		: transferKeyDescriptor
	const manifest = buildFileManifestFromEnc({
		ownerEntityHash: entityHash,
		logicalPath,
		plaintext,
		name,
		mimeType,
		ceMode,
		transferKeyDescriptor: descriptor,
		meta: { visibility, ...meta },
	}, enc)
	await storeManifestParts(manifest, enc.parts.map(part => part.raw))
	await saveFileManifest(manifest)
	return manifest
}

/**
 * 按柜可见性写入 EVFS 文件（个人柜 blob）。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {{ logical_path: string, plaintext: Buffer | Uint8Array, name?: string, mime_type?: string, visibility?: object }} options 选项
 * @returns {Promise<object>} manifest
 */
export async function putCabinetEvfsFile(username, entityHash, options) {
	const visibility = String(options.visibility?.visibility || options.visibility || 'private')
	const plaintext = Buffer.from(options.plaintext)
	const logicalPath = options.logical_path
	const name = options.name || logicalPath.split('/').pop()
	const mimeType = options.mime_type || 'application/octet-stream'

	if (visibility === 'public' || visibility === 'unlisted')
		return storeEvfsManifest(entityHash, {
			logicalPath, plaintext, name, mimeType, visibility,
			transferKeyDescriptor: publicTransferKeyDescriptor(),
			ceMode: 'convergent',
		})

	const { masterKey } = await loadVaultMasterKey(username, entityHash)
	const fileId = randomUUID()
	return storeEvfsManifest(entityHash, {
		logicalPath, plaintext, name, mimeType, visibility,
		transferKeyDescriptor: vaultTransferKeyFactory(entityHash, fileId, masterKey),
		ceMode: 'random',
		meta: {
			fileId,
			vaultGroupId: vaultGroupId(entityHash),
			minFollowMs: options.visibility?.minFollowMs,
			allow: options.visibility?.allow,
			except: options.visibility?.except,
		},
	})
}
