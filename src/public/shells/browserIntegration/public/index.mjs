/**
 * 浏览器集成页面的主要客户端逻辑。
 */
import { initTranslations, geti18n } from '../../../scripts/i18n.mjs'
import { renderTemplate, usingTemplates } from '../../../scripts/template.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { showToast, showToastI18n } from '../../../scripts/toast.mjs'

import * as api from './src/endpoints.mjs'

const pagesListDiv = document.getElementById('connected-pages-list'),
	scriptUrlInput = document.getElementById('script-url-input'),
	copyScriptUrlButton = document.getElementById('copy-script-url-button'),
	autorunScriptForm = document.getElementById('autorun-script-form'),
	autorunComment = document.getElementById('autorun-comment'),
	autorunUrlRegex = document.getElementById('autorun-url-regex'),
	autorunScript = document.getElementById('autorun-script'),
	autorunScriptList = document.getElementById('autorun-script-list'),
	viewScriptModal = document.getElementById('view-script-modal'),
	viewScriptModalTitle = document.getElementById('view-script-modal-title'),
	viewScriptModalContent = document.getElementById('view-script-modal-content')

let lastPages = ''
const autoRunScriptsCache = new Map()

/**
 * 渲染已连接页面的列表。
 * @param {Array<object>} pages - 要渲染的页面对象数组。
 * @returns {Promise<void>}
 */
async function renderPages(pages) {
	pagesListDiv.innerHTML = ''
	if (!pages.length) pagesListDiv.appendChild(await renderTemplate('empty_state'))
	else pagesListDiv.appendChild(await renderTemplate('page_table', { pages }))
}

const RECONNECT_DELAY = 5000
/**
 * 连接到 WebSocket 服务器以接收 UI 更新。
 */
function connectWebSocket() {
	const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const wsUrl = `${wsProtocol}//${window.location.host}/ws/shells/browserIntegration/ui`
	const ws = new WebSocket(wsUrl)

	/**
	 * WebSocket 'open' 事件处理程序。
	 */
	ws.onopen = () => {
		console.log('Connected to UI WebSocket.')
	}

	/**
	 * WebSocket 'message' 事件处理程序。
	 * @param {MessageEvent} event - WebSocket 消息事件。
	 */
	ws.onmessage = async (event) => {
		try {
			const msg = JSON.parse(event.data)
			if (msg.type === 'pages_update') {
				const pages = msg.payload
				const newPagesJson = JSON.stringify(pages)
				if (lastPages === newPagesJson) return // Avoid unnecessary re-renders
				lastPages = newPagesJson

				await renderPages(pages)
			}
		}
		catch (error) {
			console.error('Error processing WebSocket message:', error)
			import('https://esm.sh/@sentry/browser').then(Sentry => Sentry.captureException(error))
		}
	}

	/**
	 * WebSocket 'close' 事件处理程序。
	 */
	ws.onclose = async () => {
		console.log(`UI WebSocket disconnected. Reconnecting in ${RECONNECT_DELAY / 1000} seconds...`)
		// Clear the list to show a disconnected/error state
		pagesListDiv.innerHTML = ''
		pagesListDiv.appendChild(await renderTemplate('error_message'))
		setTimeout(connectWebSocket, RECONNECT_DELAY)
	}

	/**
	 * WebSocket 'error' 事件处理程序。
	 * @param {Event} err - WebSocket 错误事件。
	 */
	ws.onerror = (err) => {
		console.error('UI WebSocket error:', err)
		// Don't call ws.close() here, as onclose will be called automatically.
	}
}


/**
 * 显示用于查看自动运行脚本的模态框。
 * @param {string} scriptId - 要查看的脚本的 ID。
 */
function showViewScriptModal(scriptId) {
	const script = autoRunScriptsCache.get(scriptId)
	if (!script) return

	viewScriptModalTitle.textContent = script.comment || geti18n('browser_integration.autorun.view_script_modal_title')
	viewScriptModalContent.textContent = script.script // textContent is safe for displaying code

	viewScriptModal.showModal()
}

/**
 * 处理删除自动运行脚本的逻辑。
 * @param {string} scriptId - 要删除的脚本的 ID。
 * @returns {Promise<void>}
 */
async function handleDeleteScript(scriptId) {
	if (confirm(geti18n('browser_integration.autorun.confirm_delete'))) try {
		// 1. Delete metadata from server
		const deleteResult = await api.deleteAutoRunScript(scriptId)
		if (!deleteResult.success) throw new Error(deleteResult.message)

		// 2. Dispatch event to userscript
		window.dispatchEvent(new CustomEvent('fount-autorun-script-update', {
			detail: {
				action: 'delete',
				script: { id: scriptId } // Only need ID for deletion
			}
		}))

		showToastI18n('success', 'browser_integration.autorun.delete_success')
		loadAndRenderAutoRunScripts()
	} catch (error) {
		showToastI18n('error', 'browser_integration.error.delete_failed', { message: error.message })
	}
}

/**
 * 从服务器加载自动运行脚本并渲染它们。
 * @returns {Promise<void>}
 */
async function loadAndRenderAutoRunScripts() {
	try {
		autorunScriptList.innerHTML = '<div class="text-center"><span class="loading loading-dots loading-md"></span></div>'
		const result = await api.getAutoRunScripts()
		if (!result.success) throw new Error(result.message)

		autorunScriptList.innerHTML = ''
		if (!result.scripts.length)
			autorunScriptList.appendChild(await renderTemplate('autorun_empty_state'))
		else {
			autoRunScriptsCache.clear()
			result.scripts.forEach(script => autoRunScriptsCache.set(script.id, script))
			autorunScriptList.appendChild(await renderTemplate('autorun_script_table', {
				scripts: result.scripts
			}))
		}
	} catch (error) {
		console.error('Failed to load auto-run scripts:', error)
		autorunScriptList.innerHTML = `<p class="text-error">${geti18n('browser_integration.error.load_failed', { message: error.message })}</p>`
	}
}

/**
 * 处理添加新自动运行脚本的表单提交。
 * @param {Event} e - 表单提交事件。
 * @returns {Promise<void>}
 */
async function handleAddScript(e) {
	e.preventDefault()

	const scriptData = {
		comment: autorunComment.value,
		urlRegex: autorunUrlRegex.value,
		script: autorunScript.value,
	}

	// This object is for the userscript (includes the script content)
	const fullScriptPayload = {
		...scriptData,
	}

	try {
		// 1. Save metadata to the server
		const result = await api.addAutoRunScript(scriptData)
		if (!result.success) throw new Error(result.message)

		// The backend returns the metadata including the new ID
		const newId = result.script.id
		fullScriptPayload.id = newId

		// 2. Dispatch event to userscript
		window.dispatchEvent(new CustomEvent('fount-autorun-script-update', {
			detail: {
				action: 'add',
				script: fullScriptPayload
			}
		}))

		showToastI18n('success', 'browser_integration.autorun.add_success')
		autorunScriptForm.reset()
		loadAndRenderAutoRunScripts() // This will re-render the list from the server's metadata
	}
	catch (error) {
		showToastI18n('error', 'browser_integration.error.add_failed', { message: error.message })
	}
}

autorunScriptForm.addEventListener('submit', handleAddScript)

autorunScriptList.addEventListener('click', e => {
	const viewBtn = e.target.closest('.view-script-btn')
	if (viewBtn) {
		e.preventDefault()
		showViewScriptModal(viewBtn.dataset.scriptId)
		return
	}

	const deleteBtn = e.target.closest('.delete-script-btn')
	if (deleteBtn) {
		e.preventDefault()
		handleDeleteScript(deleteBtn.dataset.scriptId)
	}
})


/**
 * 应用程序的入口点。
 * @returns {Promise<void>}
 */
async function main() {
	applyTheme()
	usingTemplates('/shells/browserIntegration/templates')
	await initTranslations('browser_integration')

	scriptUrlInput.value = `${window.location.origin}/shells/browserIntegration/script.user.js`

	copyScriptUrlButton.addEventListener('click', () => {
		navigator.clipboard.writeText(scriptUrlInput.value)
			.then(() => showToastI18n('success', 'browser_integration.copied_message'))
			.catch(e => showToast('error', e.message))
	})

	connectWebSocket()

	await loadAndRenderAutoRunScripts()
}

main()
