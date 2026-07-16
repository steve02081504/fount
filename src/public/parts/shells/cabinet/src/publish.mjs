import { Buffer } from 'node:buffer'

import { buildFileManifestFromEnc, encryptPlaintextToParts, vaultWrapDescriptor } from 'npm:@steve02081504/fount-p2p/files/assemble'
import { saveFileManifest, storeManifestParts } from 'npm:@steve02081504/fount-p2p/files/evfs'
import { publicTransferKeyDescriptor } from 'npm:@steve02081504/fount-p2p/files/manifest'
import { publishPublicFile } from 'npm:@steve02081504/fount-p2p/files/public_manifest'

import { getEntityRecoverySecretKey, getRecoveryPubKeyHex } from '../../chat/src/entity/identity.mjs'
import { vaultGroupId } from '../../social/src/federation/namespace.mjs'
import { loadVaultMasterKey } from '../../social/src/vault_crypto/vault.mjs'

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object[]} cabinets 柜列表
 * @returns {Promise<void>}
 */
export async function publishCabinetLists(username, entityHash, cabinets) {
	const publicRows = cabinets
		.filter(row => row.type === 'personal' && row.visibility?.visibility === 'public')
		.map(row => ({
			cabinet_id: row.cabinet_id,
			name: row.name,
			visibility: row.visibility,
			created_at: row.created_at,
		}))
	const followersRows = cabinets
		.filter(row => row.type === 'personal' && ['followers', 'followers_since'].includes(row.visibility?.visibility))
		.map(row => ({
			cabinet_id: row.cabinet_id,
			name: row.name,
			visibility: row.visibility,
			created_at: row.created_at,
		}))

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
	

	if (followersRows.length) {
		const { masterKey } = await loadVaultMasterKey(username, entityHash)
		const plaintext = Buffer.from(JSON.stringify({ cabinets: followersRows }), 'utf8')
		const enc = encryptPlaintextToParts(plaintext, 'random')
		const fileId = 'cabinets-followers'
		const descriptor = vaultWrapDescriptor(entityHash, fileId, enc.contentKey, masterKey)
		const manifest = buildFileManifestFromEnc({
			ownerEntityHash: entityHash,
			logicalPath: 'shells/cabinet/cabinets.followers.json',
			plaintext,
			name: 'cabinets.followers.json',
			mimeType: 'application/json',
			ceMode: 'random',
			transferKeyDescriptor: descriptor,
			meta: {
				fileId,
				visibility: 'followers',
				vaultGroupId: vaultGroupId(entityHash),
			},
		}, enc)
		await storeManifestParts(manifest, enc.parts.map(part => part.raw))
		await saveFileManifest(manifest)
	}
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

	if (visibility === 'public' || visibility === 'unlisted') {
		const enc = encryptPlaintextToParts(plaintext, 'convergent')
		const manifest = buildFileManifestFromEnc({
			ownerEntityHash: entityHash,
			logicalPath,
			plaintext,
			name,
			mimeType,
			ceMode: 'convergent',
			transferKeyDescriptor: publicTransferKeyDescriptor(),
			meta: { visibility },
		}, enc)
		await storeManifestParts(manifest, enc.parts.map(part => part.raw))
		await saveFileManifest(manifest)
		return manifest
	}

	if (visibility === 'followers' || visibility === 'followers_since') {
		const { masterKey } = await loadVaultMasterKey(username, entityHash)
		const enc = encryptPlaintextToParts(plaintext, 'random')
		const fileId = logicalPath.replace(/\W+/g, '_').slice(-48) || randomish()
		const descriptor = vaultWrapDescriptor(entityHash, fileId, enc.contentKey, masterKey)
		const manifest = buildFileManifestFromEnc({
			ownerEntityHash: entityHash,
			logicalPath,
			plaintext,
			name,
			mimeType,
			ceMode: 'random',
			transferKeyDescriptor: descriptor,
			meta: {
				fileId,
				visibility,
				minFollowMs: options.visibility?.minFollowMs,
				except: options.visibility?.except,
				vaultGroupId: vaultGroupId(entityHash),
			},
		}, enc)
		await storeManifestParts(manifest, enc.parts.map(part => part.raw))
		await saveFileManifest(manifest)
		return manifest
	}

	// selected / private → identity-local random + vault-wrap (owner only via H)
	const { masterKey } = await loadVaultMasterKey(username, entityHash)
	const enc = encryptPlaintextToParts(plaintext, 'random')
	const fileId = logicalPath.replace(/\W+/g, '_').slice(-48) || randomish()
	const descriptor = vaultWrapDescriptor(entityHash, fileId, enc.contentKey, masterKey)
	const manifest = buildFileManifestFromEnc({
		ownerEntityHash: entityHash,
		logicalPath,
		plaintext,
		name,
		mimeType,
		ceMode: 'random',
		transferKeyDescriptor: descriptor,
		meta: {
			fileId,
			visibility,
			allow: options.visibility?.allow,
			except: options.visibility?.except,
			vaultGroupId: vaultGroupId(entityHash),
		},
	}, enc)
	await storeManifestParts(manifest, enc.parts.map(part => part.raw))
	await saveFileManifest(manifest)
	return manifest
}

/**
 * @returns {string} 短 id
 */
function randomish() {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
