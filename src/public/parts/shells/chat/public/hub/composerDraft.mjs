/**
 * 【文件】public/hub/composerDraft.mjs
 * 【职责】频道草稿的防抖写入、切频道恢复与发送后清空。
 * 【原理】localStorage key = `fount.chat.draft:{groupId}:{channelId}`；
 *   存 { text, content_warning, sensitive_media }（不存大体积 buffer）；
 *   debounce 500ms 写入；切频道时 load；发送成功后 clear。
 */

const DRAFT_DEBOUNCE_MS = 500

/** @type {ReturnType<typeof setTimeout> | null} */
let draftTimer = null

/**
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {string} localStorage 草稿键名
 */
function draftKey(groupId, channelId) {
	return `fount.chat.draft:${groupId}:${channelId}`
}

/**
 * 保存草稿（防抖）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {{ text: string, content_warning?: string, sensitive_media?: boolean }} draft 草稿内容
 * @returns {void}
 */
export function saveDraft(groupId, channelId, draft) {
	if (!groupId || !channelId) return
	if (draftTimer) clearTimeout(draftTimer)
	draftTimer = setTimeout(() => {
		draftTimer = null
		try {
			const payload = { text: draft.text || '' }
			if (draft.content_warning) payload.content_warning = draft.content_warning
			if (draft.sensitive_media) payload.sensitive_media = true
			if (!payload.text && !payload.content_warning && !payload.sensitive_media)
				localStorage.removeItem(draftKey(groupId, channelId))
			else
				localStorage.setItem(draftKey(groupId, channelId), JSON.stringify(payload))
		}
		catch { /* localStorage 满了静默忽略 */ }
	}, DRAFT_DEBOUNCE_MS)
}

/**
 * 加载草稿到 DOM 控件。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
export function loadDraft(groupId, channelId) {
	if (!groupId || !channelId) return
	try {
		const raw = localStorage.getItem(draftKey(groupId, channelId))
		if (!raw) return
		const draft = JSON.parse(raw)
		const input = document.getElementById('message-input')
		if (input instanceof HTMLTextAreaElement && draft.text) {
			input.value = draft.text
			input.dispatchEvent(new Event('input', { bubbles: true }))
		}
		const cw = document.getElementById('content-warning')
		if (cw instanceof HTMLInputElement && draft.content_warning)
			cw.value = draft.content_warning
		const sm = document.getElementById('sensitive-media')
		if (sm instanceof HTMLInputElement && draft.sensitive_media)
			sm.checked = true
		if (draft.content_warning || draft.sensitive_media) {
			const extras = document.getElementById('composer-extras')
			if (extras) extras.hidden = false
		}
	}
	catch { /* JSON 解析失败忽略 */ }
}

/**
 * 清除草稿（发送成功后调用）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
export function clearDraft(groupId, channelId) {
	if (!groupId || !channelId) return
	if (draftTimer) {
		clearTimeout(draftTimer)
		draftTimer = null
	}
	try {
		localStorage.removeItem(draftKey(groupId, channelId))
	}
	catch { /* empty */ }
}

/**
 * 在 composer 输入、CW、sensitive 变化时接线草稿自动保存。
 * @param {() => { groupId: string | null, channelId: string | null }} getCtx 获取当前频道上下文
 * @returns {void}
 */
export function wireDraftAutoSave(getCtx) {
	/**
	 * @returns {{ text: string, content_warning: string, sensitive_media: boolean }} 草稿字段快照
	 */
	const readFields = () => {
		const input = document.getElementById('message-input')
		const cw = document.getElementById('content-warning')
		const sm = document.getElementById('sensitive-media')
		return {
			text: input instanceof HTMLTextAreaElement ? input.value : '',
			content_warning: cw instanceof HTMLInputElement ? cw.value.trim() : '',
			sensitive_media: sm instanceof HTMLInputElement ? sm.checked : false,
		}
	}

	/**
	 * @returns {void}
	 */
	const onDraftChange = () => {
		const { groupId, channelId } = getCtx()
		if (groupId && channelId) saveDraft(groupId, channelId, readFields())
	}

	document.getElementById('message-input')?.addEventListener('input', onDraftChange)
	document.getElementById('content-warning')?.addEventListener('input', onDraftChange)
	document.getElementById('sensitive-media')?.addEventListener('change', onDraftChange)
}
