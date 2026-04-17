import { unlockAchievement } from '../../../../../../pages/scripts/parts.mjs'
import { renderTemplate } from '../../../../../../pages/scripts/template.mjs'
import { geti18n, setLocalizeLogic } from '../../../../../../scripts/i18n.mjs'
import { showToastI18n } from '../../../../../../scripts/toast.mjs'
import { startAvSession as connectAvSession } from '../channels/streaming.mjs'
import { handleUIError, normalizeError } from '../utils.mjs'

/**
 * 绑定群聊输入区、发送/文件/投票/流媒体/书签/新建频道等操作，以及 AV 会话与录音。
 * @param {{
 *   groupId: string,
 *   channelId: string,
 *   signal: AbortSignal,
 *   input: HTMLTextAreaElement | null,
 *   wsClientId: string,
 *   getPendingFiles: () => Array<{ file: File }>,
 *   clearPendingFiles: () => void,
 *   enqueuePendingFile: (f: File) => void,
 *   uploadGroupFile: (f: File) => Promise<void>,
 *   getAvSession: () => object | null,
 *   setAvSession: (s: object | null) => void,
 *   getLastChannelMeta: () => object | null,
 *   getLastChannels: () => Record<string, object>,
 *   loadMessages: () => Promise<void>,
 *   loadBookmarks: () => Promise<void>,
 *   loadState: () => Promise<void>,
 *   hideMentionPopover: () => void,
 *   updateMentionPopover: () => void,
 *   sendTypingBroadcast: () => void,
 * }} ctx 群聊输入条与 AV 相关依赖
 * @returns {{ postMessage: () => Promise<void>, startAvSession: () => Promise<void> }} 发送消息与启动 AV 会话
 */
export function createMessageInputHandlers(ctx) {
	const {
		groupId,
		channelId,
		signal,
		input,
		wsClientId,
		getPendingFiles,
		clearPendingFiles,
		enqueuePendingFile,
		uploadGroupFile,
		getAvSession,
		setAvSession,
		getLastChannelMeta,
		getLastChannels,
		loadMessages,
		loadBookmarks,
		loadState,
		hideMentionPopover,
		updateMentionPopover,
		sendTypingBroadcast,
	} = ctx

	/**
	 * 通过 HTTP 广播封装负载到群内（供流媒体信令等使用）。
	 * @param {object} payload 广播体（与 WS 侧约定一致）
	 * @returns {Promise<void>}
	 */
	const avBroadcast = async payload => {
		await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/broadcast`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ payload }),
		})
	}

	/** 启动或停止 AV 会话（供 av-start 和 streaming-button 共用） */
	const startAvSession = async () => {
		if (getLastChannelMeta()?.type !== 'streaming') {
			showToastI18n('info', 'chat.group.avNeedStreamChannel')
			return
		}
		if (getAvSession()) return
		try {
			const videoLocal = document.getElementById('group-av-local')
			const remoteContainer = document.getElementById('group-av-grid')
			setAvSession(await connectAvSession({
				channelId,
				clientId: wsClientId,
				videoLocal,
				remoteContainer,
				broadcast: avBroadcast,
			}))
		}
		catch (e) {
			handleUIError(normalizeError(e), 'chat.voiceRecording.errorAccessingMicrophone', 'startAvSession')
		}
	}

	document.getElementById('group-av-start')?.addEventListener('click', startAvSession, { signal })

	document.getElementById('group-av-mute')?.addEventListener('click', () => {
		getAvSession()?.toggleMute()
	}, { signal })

	document.getElementById('group-av-swap')?.addEventListener('click', () => {
		document.querySelector('#group-av-grid [data-peer-id="local"]')?.dispatchEvent(
			new MouseEvent('click', { bubbles: true }),
		)
	}, { signal })

	document.getElementById('group-av-stop')?.addEventListener('click', () => {
		getAvSession()?.close()
		setAvSession(null)
	}, { signal })

	/**
	 * 发送当前输入框文本为群聊消息并清空输入。
	 * @returns {Promise<void>}
	 */
	const postMessage = async () => {
		const text = input?.value?.trim()
		const pending = getPendingFiles()
		if (!text && !pending.length) return

		void unlockAchievement('shells/chat', 'first_chat')
		if (pending.some(({ file }) => file?.type?.startsWith?.('image/')))
			void unlockAchievement('shells/chat', 'photo_chat')

		if (text) {
			const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/chat/${encodeURIComponent(channelId)}/message`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					reply: {
						content: text,
						groupChannelId: channelId,
					},
				}),
			})
			if (r.ok && input) {
				input.value = ''
				await loadMessages()
			}
			else if (r.status === 404) {
				handleUIError(new Error('postMessage: chat not loaded (404)'), 'chat.group.chatNotLoaded', 'postMessage')
				return
			}
			else if (r.status === 501) {
				let body = {}
				try {
					body = await r.json()
				}
				catch (e) {
					if (!(e instanceof SyntaxError)) throw e
				}
				handleUIError(new Error(`postMessage HTTP 501 ${JSON.stringify(body)}`), 'chat.group.sendFailed', 'postMessage')
				return
			}
			else {
				handleUIError(new Error(`postMessage HTTP ${r.status}`), 'chat.group.sendFailed', 'postMessage')
				return
			}
		}

		const toUpload = [...getPendingFiles()]
		clearPendingFiles()
		const pendEl = document.getElementById('group-pending-attachments')
		pendEl?.classList.add('hidden')
		if (pendEl) pendEl.innerHTML = ''
		for (const { file } of toUpload)
			await uploadGroupFile(file)
	}

	// ─── 音频录制 ────────────────────────────────────────────────────────────────
	let mediaRecorder = null
	let recordingChunks = []
	let recordingTimer = null

	const recordBtn = document.getElementById('group-record-button')
	/**
	 * 录音按钮空闲态：Iconify 图标 + 可本地化文案。
	 * @param {HTMLButtonElement} btn 录音按钮
	 * @returns {void}
	 */
	const mountRecordButtonIdle = btn => {
		btn.replaceChildren()
		const micImg = document.createElement('img')
		micImg.src = 'https://api.iconify.design/mdi/microphone.svg'
		micImg.className = 'w-4 h-4 shrink-0'
		micImg.alt = ''
		const labelSpan = document.createElement('span')
		labelSpan.dataset.recordLabel = '1'
		btn.append(micImg, labelSpan)
		setLocalizeLogic(btn, () => {
			const span = btn.querySelector('[data-record-label]')
			if (span) span.textContent = geti18n('chat.group.record')
		})
	}
	if (recordBtn) {
		mountRecordButtonIdle(recordBtn)
		recordBtn.addEventListener('click', async () => {
			if (mediaRecorder && mediaRecorder.state === 'recording') {
				mediaRecorder.stop()
				return
			}
			try {
				const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
				recordingChunks = []
				const mimeOk = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('audio/webm')
				mediaRecorder = mimeOk
					? new MediaRecorder(stream, { mimeType: 'audio/webm' })
					: new MediaRecorder(stream)

				/**
				 * @param {BlobEvent} e MediaRecorder 数据分片事件
				 */
				mediaRecorder.ondataavailable = e => {
					if (e.data.size > 0) recordingChunks.push(e.data)
				}

				/**
				 *
				 * @param secs
				 */
				/**
				 * 更新录音中按钮上的停止图标与已录时长。
				 * @param {number} secs 已录制秒数
				 */
				const setRecordingBtnLabel = secs => {
					recordBtn.replaceChildren()
					const stopImg = document.createElement('img')
					stopImg.src = 'https://api.iconify.design/mdi/stop.svg'
					stopImg.className = 'w-4 h-4 shrink-0'
					stopImg.alt = ''
					recordBtn.appendChild(stopImg)
					const timeSpan = document.createElement('span')
					timeSpan.className = 'tabular-nums'
					const m = Math.floor(secs / 60).toString().padStart(2, '0')
					const s = (secs % 60).toString().padStart(2, '0')
					timeSpan.textContent = ` ${m}:${s}`
					recordBtn.appendChild(timeSpan)
				}

				let seconds = 0
				recordingTimer = setInterval(() => {
					seconds++
					setRecordingBtnLabel(seconds)
				}, 1000)
				setRecordingBtnLabel(0)
				recordBtn.classList.add('btn-error')

				/**
				 * 停止录音后组装文件并上传。
				 * @returns {Promise<void>}
				 */
				mediaRecorder.onstop = async () => {
					if (recordingTimer) {
						clearInterval(recordingTimer)
						recordingTimer = null
					}
					mountRecordButtonIdle(recordBtn)
					recordBtn.classList.remove('btn-error')
					stream.getTracks().forEach(t => t.stop())

					const blobType = mediaRecorder?.mimeType || 'audio/webm'
					const blob = new Blob(recordingChunks, { type: blobType })
					const audioFile = new File([blob], `recording-${Date.now()}.webm`, { type: blobType })
					await uploadGroupFile(audioFile)
					recordingChunks = []
					mediaRecorder = null
				}

				mediaRecorder.start()
			}
			catch (e) {
				handleUIError(normalizeError(e), 'chat.voiceRecording.errorAccessingMicrophone', 'MediaRecorder start')
			}
		}, { signal })
	}

	document.getElementById('group-send-button')?.addEventListener('click', postMessage, { signal })
	input?.addEventListener('keydown', e => {
		if (e.key === 'Escape')
			hideMentionPopover()
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault()
			postMessage()
		}
	}, { signal })

	// 文件上传按钮
	document.getElementById('group-file-button')?.addEventListener('click', () => {
		document.getElementById('group-file-input')?.click()
	}, { signal })
	document.getElementById('group-file-input')?.addEventListener('change', async e => {
		const files = Array.from(e.target.files || [])
		for (const f of files) enqueuePendingFile(f)
		e.target.value = ''
	}, { signal })

	// 投票创建按钮
	document.getElementById('group-vote-button')?.addEventListener('click', async () => {
		const question = globalThis.prompt(geti18n('chat.group.votePromptQuestion'), '')
		if (!question?.trim()) return
		const optInput = globalThis.prompt(geti18n('chat.group.votePromptOptions'), geti18n('chat.group.voteOptionDefault'))
		if (!optInput?.trim()) return
		const options = optInput.split(',').map(s => s.trim()).filter(Boolean)
		if (options.length < 2) { showToastI18n('warning', 'chat.group.voteTooFewOptions'); return }
		const deadlineInput = globalThis.prompt(geti18n('chat.group.votePromptDeadline'), '')
		const deadline = deadlineInput ? new Date(deadlineInput).getTime() : null
		const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				type: 'message',
				channelId,
				sender: 'local',
				timestamp: Date.now(),
				content: { kind: 'vote', question, options, deadline, votes: {} },
			}),
		})
		if (!r.ok)
			handleUIError(new Error(`vote create HTTP ${r.status}`), 'chat.group.voteCreateFailed', 'vote create')
		else await loadMessages()
	}, { signal })
	input?.addEventListener('input', () => {
		updateMentionPopover()
		sendTypingBroadcast()
	}, { signal })
	input?.addEventListener('blur', () => {
		globalThis.setTimeout(() => hideMentionPopover(), 180)
	}, { signal })

	document.getElementById('group-streaming-button')?.addEventListener('click', () => {
		// 导航到 streaming 类型频道，或启动已在 streaming 频道中的 AV 会话
		if (getLastChannelMeta()?.type === 'streaming')
			startAvSession().catch(e => {
				handleUIError(normalizeError(e), 'chat.voiceRecording.errorAccessingMicrophone', 'group-streaming-button startAvSession')
			})
		else
			document.getElementById('group-av-panel')?.classList.remove('hidden')
	}, { signal })

	document.getElementById('group-bookmark-add')?.addEventListener('click', async () => {
		const r0 = await fetch('/api/parts/shells:chat/bookmarks')
		if (!r0.ok)
			return handleUIError(new Error(`bookmarks GET HTTP ${r0.status}`), 'chat.group.bookmarkSaveFailed', 'bookmark GET')
		const raw = await r0.json()
		const arr = Array.isArray(raw) ? [...raw] : []
		if (arr.some(e => e.groupId === groupId && e.channelId === channelId)) {
			showToastI18n('info', 'chat.group.bookmarkExists')
			return
		}
		arr.push({
			groupId,
			channelId,
			title: `${getLastChannels()[channelId]?.name || channelId}`,
			href: `#${groupId}:${channelId}`,
		})
		const r = await fetch('/api/parts/shells:chat/bookmarks', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ entries: arr }),
		})
		if (r.ok) {
			showToastI18n('success', 'chat.group.bookmarkAdded')
			await loadBookmarks()
		}
		else handleUIError(new Error(`bookmarks PUT HTTP ${r.status}`), 'chat.group.bookmarkSaveFailed', 'bookmark PUT')
	}, { signal })

	document.getElementById('group-new-channel-button')?.addEventListener('click', async () => {
		const dialog = document.createElement('dialog')
		dialog.className = 'modal modal-open'
		dialog.replaceChildren(await renderTemplate('channel_create_modal', {}))
		document.body.appendChild(dialog)
		dialog.querySelector('#new-channel-cancel')?.addEventListener('click', () => dialog.remove())
		dialog.querySelector('#new-channel-create')?.addEventListener('click', async () => {
			const nameVal = dialog.querySelector('#new-channel-name')?.value?.trim()
			const typeVal = dialog.querySelector('#new-channel-type')?.value || 'text'
			if (!nameVal) return
			dialog.remove()
			const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: nameVal, type: typeVal }),
			})
			if (r.ok) await loadState()
			else handleUIError(new Error(`create channel HTTP ${r.status}`), 'chat.group.createChannelFailed', 'create channel')
		})
	}, { signal })

	return { postMessage, startAvSession }
}
