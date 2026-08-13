/**
 * 【文件】public/src/ui/groupFileUpload.mjs
 * 【职责】群文件分块上传与解密预览处理器工厂（挂到 Hub 实例）。
 * 【原理】createFileHandlers(hub) 返回选文件、进度、chunk POST；CHUNK_UPLOAD_MAX_BYTES 对齐联邦上限。
 * 【数据结构】hub { groupId, state }、上传进度、file meta。
 * 【关联】federationUpload.mjs、groupFileBlob.mjs、errorHandlers.mjs。
 */
import { sha256HexFromBlob } from '../../shared/digest.mjs'
import { fetchEvfsFile } from '/scripts/endpoints/p2p/evfsMedia.mjs'
import { groupEntityHash } from '../../shared/groupEntityHash.mjs'
import {
	createGroupFileEvent,
	getGroupFileMeta,
	probeChunkHave,
	resumeGroupFileDownload,
	uploadOrRegisterChunk,
} from '../endpoints/groupFiles.mjs'
import { fetchGroupFileAsBlobUrl } from '../groupFileBlob.mjs'
import { convergentChunkHashes } from '../lib/convergentChunk.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { arrayBufferToBase64, FEDERATION_CHUNK_MAX_BYTES } from '../lib/federationUpload.mjs'
import { renderTemplate } from '../templates.mjs'

import { handleError } from '/scripts/features/errorHandlers.mjs'

/**
 * 单块上传明文上限（与联邦 chunk 上限对齐）。
 * @type {number}
 */
export const CHUNK_UPLOAD_MAX_BYTES = FEDERATION_CHUNK_MAX_BYTES

/**
 * 在输入区上方展示上传进度条。
 * @param {string} fileName 文件名
 * @returns {{ set: (percent: number, labelKey?: string) => void, done: () => void, fail: () => void }} 进度控制器
 */
async function createUploadProgress(fileName) {
	const host = document.querySelector('.input-area') || document.body
	let root = document.getElementById('group-file-upload-progress')
	if (!root) {
		root = await renderTemplate('hub/composer/upload_progress', {})
		root.id = 'group-file-upload-progress'
		root.className = 'px-3 py-2 border-t border-base-300 bg-base-200/80 text-sm'
		host.prepend(root)
	}
	const nameElement = root.querySelector('[data-upload-name]')
	const pctElement = root.querySelector('[data-upload-pct]')
	const barElement = root.querySelector('[data-upload-bar]')
	const labelElement = root.querySelector('[data-upload-label]')
	if (nameElement) nameElement.textContent = fileName
	root.hidden = false

	return {
		/**
		 * @param {number} percent 0–100
		 * @param {string} [labelKey] i18n key
		 */
		set(percent, labelKey) {
			const p = Math.max(0, Math.min(100, Math.round(percent)))
			if (barElement instanceof HTMLProgressElement) {
				barElement.value = p
				barElement.max = 100
			}
			if (pctElement) pctElement.textContent = `${p}%`
			if (labelElement && labelKey) labelElement.dataset.i18n = labelKey
		},
		/**
		 * 上传成功，移除进度条 DOM。
		 * @returns {void}
		 */
		done() {
			root.remove()
		},
		/**
		 * 上传失败，移除进度条 DOM。
		 * @returns {void}
		 */
		fail() {
			root.remove()
		},
	}
}

/**
 * 上传单个收敛密文块。
 * @param {string} groupId 群 ID
 * @param {string} partFileId 块 fileId（可含 `:index`）
 * @param {string} plainB64 明文 base64
 * @param {number} byteLength 本块明文字节长度（与 `plainB64` 解码后一致）
 * @param {string} [channelId] 用于 `UPLOAD_FILES` 权限检查的频道 ID
 * @param {'convergent'|'random'} [ceMode] 文件加密模式
 * @returns {Promise<object>} 块 manifest 字段
 */
async function uploadEncryptedChunk(groupId, partFileId, plainB64, byteLength, channelId, ceMode = 'convergent') {
	const channelField = channelId ? { channelId } : {}
	const modeField = { ceMode }
	const plainBuffer = Uint8Array.from(atob(plainB64), char => char.charCodeAt(0))
	const haveBody = ceMode === 'random'
		? { size: byteLength, ...channelField, ...modeField }
		: {
			ciphertextHash: (await convergentChunkHashes(plainBuffer)).ciphertextHash,
			size: byteLength,
			...channelField,
			...modeField,
		}
	const probe = await probeChunkHave(groupId, haveBody)
	if (ceMode !== 'random' && probe?.have && probe.storageLocator)
		return uploadOrRegisterChunk(groupId, { fileId: partFileId, data: plainB64, registerOnly: true, ...channelField, ...modeField })

	return uploadOrRegisterChunk(groupId, { fileId: partFileId, data: plainB64, ...channelField, ...modeField })
}

/**
 * 创建群文件处理函数集。
 * @param {{ groupId: string, showToastI18n: Function, loadMessages: Function, getUploadChannelId?: () => (string|null|undefined) }} hub Hub 上传上下文
 * @returns {{ uploadGroupFile: Function, downloadGroupFile: Function, fetchGroupFileAsBlob: Function, enqueuePendingFile: Function, pendingFiles: Array }} 文件处理函数集与待发队列
 */
export function createFileHandlers(hub) {
	const { groupId, showToastI18n, loadMessages, getUploadChannelId, getCurrentState } = hub

	/** 待发附件队列：{id, file}[] */
	const pendingFiles = []

	/**
	 * 上传群文件：预检 have → 分块收敛加密 → DAG manifest（§10.3）。
	 * @param {File} file 浏览器 File 对象
	 * @param {string | null} [folderId] 目标文件夹 id
	 * @returns {Promise<void>}
	 */
	const uploadGroupFile = async (file, folderId = null) => {
		if (!file) return
		if (!sessionStorage.getItem('fount.chat.convergentWarnShown')) {
			showToastI18n('info', 'chat.group.convergentEncryptWarn')
			sessionStorage.setItem('fount.chat.convergentWarnShown', '1')
		}

		const progress = await createUploadProgress(file.name)
		const uploadChannelId = getUploadChannelId?.() || undefined
		try {
			const modeRaw = String(getCurrentState?.()?.groupSettings?.fileCeMode || 'convergent').trim()
			const ceMode = modeRaw === 'random' ? 'random' : 'convergent'
			progress.set(3, 'chat.hub.file.uploadChecking')
			const fileId = crypto.randomUUID()
			const contentHash = await sha256HexFromBlob(file, CHUNK_UPLOAD_MAX_BYTES)
			const partCount = Math.max(1, Math.ceil(file.size / CHUNK_UPLOAD_MAX_BYTES))
			/** @type {object[]} */
			const parts = []
			let skippedAny = false

			for (let partIndex = 0; partIndex < partCount; partIndex++) {
				const offset = partIndex * CHUNK_UPLOAD_MAX_BYTES
				const slice = file.slice(offset, Math.min(offset + CHUNK_UPLOAD_MAX_BYTES, file.size))
				const sliceBuf = await slice.arrayBuffer()
				const plainB64 = arrayBufferToBase64(sliceBuf)
				const partFileId = partCount === 1 ? fileId : `${fileId}:${partIndex}`
				progress.set(10 + Math.floor((partIndex / partCount) * 55), 'chat.hub.file.uploadingChunk')
				const chunk = await uploadEncryptedChunk(groupId, partFileId, plainB64, sliceBuf.byteLength, uploadChannelId, ceMode)
				if (chunk.have) skippedAny = true
				parts.push({
					index: partIndex,
					partSize: sliceBuf.byteLength,
					contentHash: chunk.contentHash,
					ciphertextHash: chunk.ciphertextHash,
					wrappedKey: chunk.wrappedKey,
					storageLocator: chunk.storageLocator,
					key_generation: chunk.key_generation,
					ceMode: chunk.ceMode || ceMode,
				})
			}

			progress.set(72, 'chat.hub.file.uploadRegistering')
			/** @type {Record<string, unknown>} */
			const manifestBody = {
				fileId,
				name: file.name,
				size: file.size,
				mimeType: file.type,
				contentHash,
				ceMode,
			}
			if (folderId) manifestBody.folderId = folderId
			if (uploadChannelId) manifestBody.channelId = uploadChannelId
			if (partCount === 1) {
				const firstPart = parts[0]
				manifestBody.ciphertextHash = firstPart.ciphertextHash
				manifestBody.wrappedKey = firstPart.wrappedKey
				manifestBody.storageLocator = firstPart.storageLocator
				manifestBody.key_generation = firstPart.key_generation
			}
			else {
				manifestBody.parts = parts
				manifestBody.key_generation = parts[0]?.key_generation
			}

			await createGroupFileEvent(groupId, manifestBody)
			progress.set(100, 'chat.hub.file.uploaded')
			showToastI18n('success', skippedAny ? 'chat.hub.file.skippedDedup' : 'chat.hub.file.uploaded')
			progress.done()
			await loadMessages()
		}
		catch (error) {
			progress.fail()
			handleError('chat.hub.file.uploadFailed')(error)
		}
	}

	/**
	 * 将文件加入待发队列并在 #group-pending-attachments 中生成预览缩略图。
	 * @param {File} file 待附加的文件
	 * @returns {void}
	 */
	async function enqueuePendingFile(file) {
		const id = crypto.randomUUID()
		const container = document.getElementById('group-pending-attachments')
		if (!container) return

		const isImage = file.type.startsWith('image/')
		const wrap = await renderTemplate('hub/composer/pending_attachment', {
			pendingId: id,
			isImage,
			fileName: escapeHtml(file.name),
			fileNameShort: escapeHtml(file.name.slice(0, 10)),
		})

		if (isImage) {
			const img = wrap.querySelector('.pending-thumb-img')
			const reader = new FileReader()
			reader.addEventListener('load', () => {
				if (img instanceof HTMLImageElement) img.src = reader.result || ''
			})
			reader.readAsDataURL(file)
		}

		wrap.querySelector('.pending-remove')?.addEventListener('click', () => {
			const pendingIndex = pendingFiles.findIndex(entry => entry.id === id)
			if (pendingIndex !== -1) pendingFiles.splice(pendingIndex, 1)
			wrap.remove()
			if (!pendingFiles.length) container.classList.add('hidden')
		})
		container.appendChild(wrap)
		container.classList.remove('hidden')
		pendingFiles.push({ id, file })
	}

	/**
	 * 下载并解密群文件到本地磁盘（浏览器下载）。
	 * @param {string} fileId 文件 ID
	 * @param {string} fileName 建议保存的文件名
	 * @returns {Promise<void>}
	 */
	const downloadGroupFile = async (fileId, fileName) => {
		try {
			const meta = await getGroupFileMeta(groupId, fileId)
			const hasParts = Array.isArray(meta.parts) && meta.parts.length
			if (!meta.contentHash || (!hasParts && !meta.storageLocator)) {
				handleError('chat.hub.file.noKey')(new Error('downloadGroupFile: missing blob meta'))
				return
			}
			if (hasParts) await resumeGroupFileDownload(groupId, fileId)

			const fileIdForEvfs = String(meta?.fileId || '').trim()
			const entityHash = groupEntityHash(groupId)
			let plain
			try {
				const { buffer } = await fetchEvfsFile(entityHash, `chat/${fileIdForEvfs}`)
				plain = new Uint8Array(buffer)
			}
			catch (error) {
				handleError('chat.hub.file.downloadFailed')(error)
				return
			}

			const { createWriteStream } = await import('https://esm.sh/streamsaver@2.0.6')
			const fileStream = createWriteStream(
				fileName || meta.name || fileId,
				meta.totalSize != null ? { size: meta.totalSize } : { size: plain.byteLength },
			)
			const writer = fileStream.getWriter()

			try {
				await writer.write(plain)
				await writer.close()
			}
			catch (writeErr) {
				await writer.abort().catch(e => {
					const n = e?.name
					if (n === 'AbortError' || n === 'InvalidStateError' || n === 'TypeError') return
					throw e
				})
				throw writeErr
			}
		}
		catch (error) {
			handleError('chat.hub.file.downloadFailed')(error)
		}
	}

	/**
	 * 获取并解密群文件，返回 Blob URL（供内联渲染使用）。
	 * @param {string} fileId 文件 ID
	 * @param {string} [mimeType] MIME 类型
	 * @returns {Promise<string | null>} Blob URL；失败时返回 null
	 */
	const fetchGroupFileAsBlob = (fileId, mimeType) =>
		fetchGroupFileAsBlobUrl(groupId, fileId).catch(error => {
			handleError('chat.hub.file.loadFailed')(error)
			return null
		})

	return { uploadGroupFile, downloadGroupFile, fetchGroupFileAsBlob, enqueuePendingFile, pendingFiles }
}
