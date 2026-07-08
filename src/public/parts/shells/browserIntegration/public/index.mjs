/**
 * 浏览器集成页面的主要客户端逻辑。
 */
import { initTranslations, geti18n, i18nElement } from '/scripts/i18n/index.mjs'
import { mountTemplate, usingTemplates } from '/scripts/features/template.mjs'
import { applyTheme } from '/scripts/theme/index.mjs'
import { showToast, showToastI18n } from '/scripts/features/toast.mjs'

import * as api from './src/endpoints.mjs'

const pagesListDiv = document.getElementById('connected-pages-list'),
	CSPwarning = document.getElementById('csp-warning'),
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
	if (!pages.length) await mountTemplate(pagesListDiv, 'empty_state')
	else await mountTemplate(pagesListDiv, 'page_table', { pages })
}

const RECONNECT_DELAY = 5000
/**
 * 连接到 WebSocket 服务器以接收 UI 更新。
 */
function connectWebSocket() {
	const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const wsUrl = `${wsProtocol}//${window.location.host}/ws/parts/shells:browserIntegration/ui`
	const ws = new WebSocket(wsUrl)

	/**
	 * 收到的 WebSocket 消息事件。
	 * @param {MessageEvent} event - 收到的 WebSocket 消息事件。
	 */
	ws.onmessage = async (event) => {
		try {
			const wireMessage = JSON.parse(event.data)
			if (wireMessage.type === 'pages_update') {
				const pages = wireMessage.payload
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
		await mountTemplate(pagesListDiv, 'error_message')
		setTimeout(connectWebSocket, RECONNECT_DELAY)
	}

	/**
	 * WebSocket 'error' 事件处理程序。
	 * @param {Event} error - WebSocket 错误事件。
	 * @returns {void}
	 */
	ws.onerror = (error) => {
		console.error('UI WebSocket error:', error)
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
		await api.deleteAutoRunScript(scriptId)

		window.dispatchEvent(new CustomEvent('fount-autorun-script-update', {
			detail: { action: 'delete', script: { id: scriptId } }
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
		autorunScriptList.innerHTML = /* html */ '<div class="text-center"><span class="loading loading-dots loading-md"></span></div>'
		const result = await api.getAutoRunScripts()

		if (!result.scripts.length)
			await mountTemplate(autorunScriptList, 'autorun_empty_state')
		else {
			autoRunScriptsCache.clear()
			result.scripts.forEach(script => autoRunScriptsCache.set(script.id, script))
			await mountTemplate(autorunScriptList, 'autorun_script_table', {
				scripts: result.scripts,
			})
		}
	} catch (error) {
		console.error('Failed to load auto-run scripts:', error)
		autorunScriptList.innerHTML = /* html */ `<p class="text-error">${geti18n('browser_integration.error.load_failed', { message: error.message })}</p>`
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

	try {
		const result = await api.addAutoRunScript(scriptData)

		window.dispatchEvent(new CustomEvent('fount-autorun-script-update', {
			detail: {
				action: 'add',
				script: { ...scriptData, id: result.script.id }
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
	const viewButton = e.target.closest('.view-script-btn')
	if (viewButton) {
		e.preventDefault()
		showViewScriptModal(viewButton.dataset.scriptId)
		return
	}

	const deleteButton = e.target.closest('.delete-script-btn')
	if (deleteButton) {
		e.preventDefault()
		handleDeleteScript(deleteButton.dataset.scriptId)
	}
})

/**
 * 获取浏览器名称
 * @returns {String} 浏览器名称
 */
function getBrowserName() {
	const ua = navigator.userAgent.toLowerCase()
	if (ua.includes('edg/')) return 'Edge'
	if (ua.includes('chrome')) return 'Chrome'
	if (ua.includes('firefox')) return 'Firefox'
	if (ua.includes('safari') && !ua.includes('chrome')) return 'Safari'
	if (ua.includes('opr/')) return 'Opera'
	if (ua.includes('trident') || ua.includes('msie')) return 'IE'
	return 'Unknown'
}
/**
 * 应用程序的入口点。
 * @returns {Promise<void>}
 */
async function main() {
	applyTheme()
	usingTemplates('/parts/shells:browserIntegration/templates')
	await initTranslations('browser_integration')

	{
		const pluginMap = {
			Chrome: 'https://chromewebstore.google.com/detail/allow-csp-content-securit/hnojoemndpdjofcdaonbefcfecpjfflh',
			Edge: 'https://microsoftedge.microsoft.com/addons/detail/allow-csp-contentsecuri/blbbcdoaelobkaloeplifnigplpbkmap',
			Firefox: 'https://addons.mozilla.org/en-US/firefox/addon/disable-csp-and-cors/',
		}
		let browserName = getBrowserName()
		if (!pluginMap[browserName]) browserName = 'Chrome'

		// for i18n
		Object.assign(CSPwarning.dataset, {
			browser: browserName, link: pluginMap[browserName]
		})
		i18nElement(CSPwarning)
	}
	scriptUrlInput.value = `${window.location.origin}/virtual_files/parts/shells:browserIntegration/script.user.js`

	copyScriptUrlButton.addEventListener('click', () => {
		navigator.clipboard.writeText(scriptUrlInput.value)
			.then(() => showToastI18n('success', 'browser_integration.copied_message'))
			.catch(e => showToast('error', e.message))
	})

	connectWebSocket()

	await loadAndRenderAutoRunScripts()
}

main()
