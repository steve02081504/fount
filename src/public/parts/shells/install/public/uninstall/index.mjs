/**
 * 卸载 shell 的客户端逻辑。
 */
import { initTranslations, geti18n } from '/scripts/i18n.mjs'
import { onServerEvent } from '/scripts/server_events.mjs'
import { applyTheme } from '/scripts/theme.mjs'
import { showToastI18n, setToastContainer, getToastContainer, setDefaultToastDuration } from '/scripts/toast.mjs'
import { uninstallPart as uninstallPartEndpoint } from '../src/endpoints.mjs'
import { createPartpathPicker } from '/scripts/partpath_picker.mjs'

applyTheme()

/**
 * 获取 URL 参数。
 * @returns {URLSearchParams} - URL 参数。
 */
function getURLParams() {
	return new URLSearchParams(window.location.search)
}

/**
 * 更新 URL 参数。
 * @param {string} partpath - 部件路径。
 */
function updateURLParams(partpath) {
	const urlParams = new URLSearchParams()
	if (partpath) urlParams.set('partpath', partpath)
	const newURL = `${window.location.pathname}?${urlParams.toString()}`
	window.history.replaceState(null, null, newURL)
}

/**
 * 卸载部件。
 * @param {string} partpath - 部件路径。
 * @returns {Promise<any>} - 响应数据。
 */
async function uninstallPart(partpath) {
	// Renamed imported function to avoid conflict with this local function
	const response = await uninstallPartEndpoint(partpath)

	if (!response.ok) {
		const data = await response.json().catch(() => null)
		throw new Error(data?.message || geti18n('uninstall.alerts.httpError', { status: response.status }))
	}

	return await response.json()
}

/**
 * 隐藏消息。
 */
function hideMessage() {
	getToastContainer().innerHTML = ''
}

await initTranslations('uninstall')
setToastContainer(document.getElementById('message-container'))
setDefaultToastDuration(0)
const partpathDropdown = document.getElementById('partpath-dropdown')
const partpathBreadcrumb = document.getElementById('partpath-breadcrumb')
const partpathMenu = document.getElementById('partpath-menu')
const urlParams = getURLParams()
const partpath = urlParams.get('partpath')
let activePartpath = partpath || ''
const uninstallMessage = document.getElementById('uninstall-message')
const title = document.getElementById('title')
const confirmButton = document.getElementById('confirm-uninstall')
const cancelButton = document.getElementById('cancel-uninstall')

/**
 * 渲染文本。
 */
function renderTexts() {
	if (!activePartpath) return
	const [type, ...name] = activePartpath.split('/')
	title.textContent = geti18n('uninstall.titleWithName', { type, name: name.join('/') })
	uninstallMessage.textContent = geti18n('uninstall.confirmMessage', { type, name: name.join('/') })
}

/**
 * 设置事件监听器。
 */
function setupEvents() {
	confirmButton.addEventListener('click', async () => {
		if (!activePartpath) return
		hideMessage()
		try {
			await uninstallPart(activePartpath) // success toast will be shown in part-uninstalled event
		}
		catch (error) {
			showToastI18n('error', 'uninstall.alerts.failed', { error: error.message })
		}
	})

	onServerEvent('part-uninstalled', ({ partpath: eventPartpath }) => {
		if (eventPartpath === activePartpath) {
			const [etype, ...ename] = activePartpath.split('/')
			showToastI18n('success', 'uninstall.alerts.success', { type: etype, name: ename.join('/') })
			confirmButton.disabled = true
			cancelButton.dataset.i18n = 'uninstall.buttons.back'
		}
	})

	onServerEvent('part-installed', ({ partpath: eventPartpath }) => {
		if (eventPartpath === activePartpath) {
			confirmButton.disabled = false
			cancelButton.dataset.i18n = 'uninstall.buttons.cancel'
			hideMessage()
		}
	})
}

if (activePartpath) renderTexts()
else title.dataset.i18n = 'uninstall.title'

const picker = await createPartpathPicker({
	dropdown: partpathDropdown,
	breadcrumbList: partpathBreadcrumb,
	menu: partpathMenu,
	initialPath: activePartpath,
	/**
	 * 处理用户选择的部件路径。
	 * @param {string} selectedPath 选中的部件路径。
	 */
	onChange: (selectedPath) => {
		if (!selectedPath) return
		activePartpath = selectedPath
		updateURLParams(activePartpath)
		renderTexts()
		hideMessage()
		confirmButton.disabled = false
		cancelButton.dataset.i18n = 'uninstall.buttons.cancel'
	}
})

if (!activePartpath) {
	activePartpath = picker.getPath()
	if (!activePartpath) {
		title.dataset.i18n = 'uninstall.invalidParamsTitle'
		showToastI18n('error', 'uninstall.alerts.invalidParams')
	} else renderTexts()
}
else if (!picker.isPathValid()) {
	title.dataset.i18n = 'uninstall.invalidParamsTitle'
	showToastI18n('error', 'uninstall.alerts.pathNotFound')
	confirmButton.disabled = true
	updateURLParams(activePartpath)
}

setupEvents()
