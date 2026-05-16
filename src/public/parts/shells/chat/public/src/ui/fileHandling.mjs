import { arrayBufferToBase64 } from '../../../../../../../scripts/p2p/bytes_codec.mjs'
import { handleUIError, normalizeError } from '../utils.mjs'

/**
 * 将服务端返回的明文 base64 转为 Uint8Array。
 * @param {string} b64 base64 明文
 * @returns {Uint8Array} 字节
 */
function b64PlainToU8(b64) {
	const bin = atob(b64)
	const out = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}

/**
 * 拉取并解密单个分块（GSH 在服务端 `KDF(H,"file",fileId)` 完成）。
 * @param {string} gid 群 ID
 * @param {string} fileId 文件 ID
 * @param {object} chunk manifest 项
 * @returns {Promise<Uint8Array | null>} 明文或 null
 */
async function fetchDecryptedChunk(gid, fileId, chunk) {
	const q = new URLSearchParams({ locator: chunk.storageLocator, fileId })
	if (chunk.key_generation != null) q.set('key_generation', String(chunk.key_generation))
	const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(gid)}/chunks?${q}`)
	if (!r.ok) return null
	const body = await r.json()
	if (!body?.data) return null
	return b64PlainToU8(body.data)
}

/**
 * 创建群文件处理函数集。
 * @param {{ groupId: string, showToastI18n: Function, loadMessages: Function }} ctx 上下文
 * @returns {{ uploadGroupFile: Function, downloadGroupFile: Function, fetchGroupFileAsBlob: Function, enqueuePendingFile: Function, pendingFiles: Array }} 文件处理函数集与待发队列
 */
export function createFileHandlers(ctx) {
	const { groupId, showToastI18n, loadMessages } = ctx

	/** 待发附件队列：{id, file}[] */
	const pendingFiles = []

	/**
	 * 上传群文件：明文经认证 HTTP 提交，Deno 侧 GSH 加密落盘（§10.3，无 aes-key）。
	 * @param {File} file 浏览器 File 对象
	 * @returns {Promise<void>}
	 */
	const uploadGroupFile = async (file) => {
		if (!file) return
		try {
			const fileId = crypto.randomUUID()
			const plainB64 = arrayBufferToBase64(await file.arrayBuffer())
			const uploadR = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/chunks`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileId, data: plainB64 }),
			})
			if (!uploadR.ok) {
				handleUIError(new Error(`uploadGroupFile chunk HTTP ${uploadR.status}`), 'chat.group.fileUploadFailed', 'uploadGroupFile chunk')
				return
			}
			const { storageLocator, chunkHash, ivHex, key_generation } = await uploadR.json()
			const evR = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/files`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fileId,
					name: file.name,
					size: file.size,
					mimeType: file.type,
					key_generation,
					chunkManifest: [{ chunkIndex: 0, chunkHash, storageLocator, ivHex }],
				}),
			})
			if (!evR.ok) {
				handleUIError(new Error(`uploadGroupFile files HTTP ${evR.status}`), 'chat.group.fileUploadFailed', 'uploadGroupFile files')
				return
			}
			showToastI18n('success', 'chat.group.fileUploaded')
			await loadMessages()
		}
		catch (e) {
			handleUIError(normalizeError(e), 'chat.group.fileUploadFailed', 'uploadGroupFile')
		}
	}

	/**
	 * 将文件加入待发队列并在 #group-pending-attachments 中生成预览缩略图。
	 * @param {File} file 待附加的文件
	 * @returns {void}
	 */
	function enqueuePendingFile(file) {
		const id = crypto.randomUUID()
		const container = document.getElementById('group-pending-attachments')
		if (!container) return

		const wrap = document.createElement('div')
		wrap.className = 'relative group/thumb'
		wrap.dataset.pendingId = id

		const isImage = file.type.startsWith('image/')
		if (isImage) {
			const img = document.createElement('img')
			img.className = 'w-16 h-16 object-cover rounded border border-base-300'
			img.alt = file.name
			const reader = new FileReader()
			/**
			 * @param {ProgressEvent<FileReader>} e 读取完成事件
			 */
			reader.onload = e => { img.src = String(e.target?.result || '') }
			reader.readAsDataURL(file)
			wrap.appendChild(img)
		}
		else {
			const icon = document.createElement('div')
			icon.className = 'w-16 h-16 flex flex-col items-center justify-center rounded border border-base-300 bg-base-200 text-xs text-center p-1 gap-0.5'
			const clipImg = document.createElement('img')
			clipImg.className = 'w-8 h-8 shrink-0'
			clipImg.src = 'https://api.iconify.design/line-md/attachment.svg'
			clipImg.alt = ''
			const nameSpan = document.createElement('span')
			nameSpan.className = 'truncate w-full text-center'
			nameSpan.textContent = file.name.slice(0, 10)
			icon.appendChild(clipImg)
			icon.appendChild(nameSpan)
			wrap.appendChild(icon)
		}

		const removeBtn = document.createElement('button')
		removeBtn.type = 'button'
		removeBtn.className = 'absolute -top-1 -right-1 btn btn-circle btn-xs btn-error opacity-0 group-hover/thumb:opacity-100 transition-opacity'
		const removeIcon = document.createElement('img')
		removeIcon.src = 'https://api.iconify.design/line-md/close.svg'
		removeIcon.className = 'w-3 h-3'
		removeIcon.alt = ''
		removeBtn.appendChild(removeIcon)
		removeBtn.addEventListener('click', () => {
			const idx = pendingFiles.findIndex(f => f.id === id)
			if (idx !== -1) pendingFiles.splice(idx, 1)
			wrap.remove()
			if (!pendingFiles.length) container.classList.add('hidden')
		})
		wrap.appendChild(removeBtn)
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
			const metaR = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/files/${encodeURIComponent(fileId)}/meta`)
			if (!metaR.ok) {
				handleUIError(new Error(`downloadGroupFile meta HTTP ${metaR.status}`), 'chat.group.fileDownloadFailed', 'downloadGroupFile meta')
				return
			}
			const meta = await metaR.json()
			if (!Array.isArray(meta.chunkManifest) || !meta.chunkManifest.length) {
				handleUIError(new Error('downloadGroupFile: missing manifest'), 'chat.group.fileNoKey', 'downloadGroupFile')
				return
			}

			const { createWriteStream } = await import('https://esm.sh/streamsaver@2.0.6')
			const streamOpts = meta.totalSize != null ? { size: meta.totalSize } : {}
			const fileStream = createWriteStream(fileName || meta.name || fileId, streamOpts)
			const writer = fileStream.getWriter()

			try {
				for (const chunk of meta.chunkManifest) {
					const plain = await fetchDecryptedChunk(groupId, fileId, chunk)
					if (!plain) {
						await writer.abort()
						handleUIError(new Error('downloadGroupFile chunk decrypt failed'), 'chat.group.fileDownloadFailed', 'downloadGroupFile chunk')
						return
					}
					await writer.write(plain)
				}
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
		catch (e) {
			handleUIError(normalizeError(e), 'chat.group.fileDownloadFailed', 'downloadGroupFile')
		}
	}

	/**
	 * 获取并解密群文件，返回 Blob URL（供内联渲染使用）。
	 * @param {string} fileId 文件 ID
	 * @param {string} [mimeType] MIME 类型
	 * @returns {Promise<string | null>} Blob URL；失败时返回 null
	 */
	const fetchGroupFileAsBlob = async (fileId, mimeType) => {
		try {
			const metaR = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/files/${encodeURIComponent(fileId)}/meta`)
			if (!metaR.ok) return null
			const meta = await metaR.json()
			if (!Array.isArray(meta.chunkManifest) || !meta.chunkManifest.length) return null
			const bufs = []
			for (const chunk of meta.chunkManifest) {
				const plain = await fetchDecryptedChunk(groupId, fileId, chunk)
				if (!plain) return null
				bufs.push(plain)
			}
			const total = bufs.reduce((n, b) => n + b.byteLength, 0)
			const merged = new Uint8Array(total)
			let off = 0
			for (const b of bufs) {
				merged.set(b, off)
				off += b.byteLength
			}
			const blob = new Blob([merged], { type: mimeType || meta.mimeType || 'application/octet-stream' })
			return URL.createObjectURL(blob)
		}
		catch (e) {
			handleUIError(normalizeError(e), 'chat.group.fileLoadFailed', 'fetchGroupFileAsBlob')
			return null
		}
	}

	return { uploadGroupFile, downloadGroupFile, fetchGroupFileAsBlob, enqueuePendingFile, pendingFiles }
}
