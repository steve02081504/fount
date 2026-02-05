/**
 * 部件配置页面的主要逻辑。
 */
import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { initTranslations, i18nElement, geti18n, confirmI18n, console } from '/scripts/i18n.mjs'
import { createJsonEditor } from '/scripts/jsonEditor.mjs'
import { getPartDetails } from '/scripts/parts.mjs'
import { svgInliner } from '/scripts/svgInliner.mjs'
import { applyTheme } from '/scripts/theme.mjs'
import { showToastI18n } from '/scripts/toast.mjs'

import { saveConfigData, getConfigData, getPartDisplay } from './src/endpoints.mjs' // 导入 API 模块
import { createPartpathPicker } from '/scripts/partpath_picker.mjs'

const jsonEditorContainer = document.getElementById('jsonEditor')
const partDisplayContainer = document.getElementById('partDisplay')

const partpathDropdown = document.getElementById('partpath-dropdown')
const partpathBreadcrumb = document.getElementById('partpath-breadcrumb')
const partpathMenu = document.getElementById('partpath-menu')
const saveButton = document.getElementById('saveButton')
const saveStatusIcon = document.getElementById('saveStatusIcon')
const disabledIndicator = document.getElementById('disabledIndicator')

let jsonEditor = null
let partpathPicker = null
let activePartPath = ''
let isDirty = false
/**
 * JSON 更新时的回调函数
 * @returns {number} 返回一个数字。
 */
let onJsonUpdate = () => 0

/**
 * 禁用编辑器和保存按钮。
 */
function disableEditorAndSaveButton() {
	if (jsonEditor)
		jsonEditor.updateProps({ readOnly: true, content: { json: {} } })

	disabledIndicator.classList.remove('hidden')
	saveButton.disabled = true
}

/**
 * 加载部件插件。
 * @param {string} partpath - 部件路径。
 * @returns {Promise<void>}
 */
async function loadPartAddons(partpath) {
	partDisplayContainer.innerHTML = ''
	/**
	 * JSON 更新时的回调函数
	 * @returns {number} 返回一个数字。
	 */
	onJsonUpdate = () => 0

	if (!partpath) return

	try {
		const { html, js: displayScript } = await getPartDisplay(partpath)
		await initTranslations() // refresh translations for dynamic content maybe used in part i18n data
		partDisplayContainer.innerHTML = html
		await svgInliner(i18nElement(partDisplayContainer, { skip_report: true }))
		if (displayScript) {
			const eval_result = await async_eval(displayScript, {
				geti18n, partpath,
				parturl: '/parts/' + encodeURIComponent(partpath).replaceAll('%2F', ':'),
				element: partDisplayContainer
			})
			if (eval_result.error) throw eval_result.error
			onJsonUpdate = eval_result.result || (() => 0)
		}
	}
	catch (e) {
		console.error('Error loading or evaluating part addons:', e)
		partDisplayContainer.innerHTML = /* html */ `<div class="text-error">Error loading part display: ${e.message}</div>`
	}
}

/**
 * 加载编辑器。
 * @param {string} partpath - 部件路径。
 * @returns {Promise<void>}
 */
async function loadEditor(partpath) {
	try {
		await loadPartAddons(partpath)
		const partDetailsData = await getPartDetails(partpath)

		if (!jsonEditor)
			jsonEditor = createJsonEditor(jsonEditorContainer, {
				label: geti18n('part_config.editor.jsonEditor'),
				readOnly: true,
				/**
				 * @param {any} updatedContent - 更新后的内容。
				 * @param {any} previousContent - 之前的内容。
				 * @param {object} root0 - 根对象。
				 * @param {any} root0.error - 错误。
				 * @param {any} root0.patchResult - 补丁结果。
				 */
				onChange: (updatedContent, previousContent, { error, patchResult }) => {
					if (error) return
					isDirty = true
					let data
					try { data = jsonEditor.get() || JSON.parse(jsonEditor.get().text) } catch (e) { return }
					onJsonUpdate({
						info: {
							partpath
						},
						data,
						containers: {
							partDisplay: partDisplayContainer,
							jsonEditor: jsonEditorContainer
						},
						editors: {
							json: jsonEditor
						}
					})
				},
				onSave: saveConfig
			})

		if (!partDetailsData || !partDetailsData.supportedInterfaces.includes('config')) {
			disableEditorAndSaveButton()
			isDirty = false
			return
		}
		else {
			disabledIndicator.classList.add('hidden')
			saveButton.disabled = false
			jsonEditor.updateProps({ readOnly: false })
		}

		const data = await getConfigData(partpath)
		jsonEditor.set({ json: data || {} })
		onJsonUpdate({
			info: {
				partpath
			},
			data: data || {},
			containers: {
				partDisplay: partDisplayContainer,
				jsonEditor: jsonEditorContainer
			},
			editors: {
				json: jsonEditor
			}
		})

		isDirty = false
	}
	catch (err) {
		console.error('Failed to load editor:', err)
		disableEditorAndSaveButton()
		showToastI18n('error', 'part_config.alerts.loadEditorFailed', { message: err.message })
	}
}

/**
 * 保存配置。
 * @returns {Promise<void>}
 */
async function saveConfig() {
	if (!activePartPath) {
		showToastI18n('warning', 'part_config.alerts.noPartSelected')
		return
	}

	// Show loading icon and disable button
	saveStatusIcon.src = 'https://api.iconify.design/line-md/loading-loop.svg'
	saveStatusIcon.classList.remove('hidden')
	saveButton.disabled = true

	try {
		const data = jsonEditor.get().json || JSON.parse(jsonEditor.get().text)
		await saveConfigData(activePartPath, data)
		isDirty = false

		saveStatusIcon.src = 'https://api.iconify.design/line-md/confirm-circle.svg'
		showToastI18n('success', 'part_config.alerts.saveConfigSuccess')
	}
	catch (err) {
		showToastI18n('error', 'part_config.alerts.saveConfigFailed', { message: err.message })
		console.error('Failed to save part config:', err)

		saveStatusIcon.src = 'https://api.iconify.design/line-md/emoji-frown.svg'
	}
	// Hide icon and re-enable button after a delay
	setTimeout(() => {
		saveStatusIcon.classList.add('hidden')
		saveButton.disabled = false
	}, 2000) // 2 seconds delay
}

/**
 * 解析 URL 参数。
 * @returns {URLSearchParams} - URL 参数对象。
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
 * 根据 URL 参数预设选择器和加载编辑器。
 * @returns {Promise<void>}
 */
async function initializeFromURLParams() {
	const urlParams = getURLParams()
	const partpath = urlParams.get('partpath')
	if (partpathPicker)
		if (partpath) {
			partpathPicker.setPath(partpath)
			if (partpath !== activePartPath) await loadEditor(activePartPath = partpath)
		}
		else if (activePartPath)
			partpathPicker.setPath(activePartPath)
}

// 初始化
applyTheme()
await initTranslations('part_config')

saveButton.addEventListener('click', saveConfig)

window.addEventListener('beforeunload', event => {
	if (isDirty) {
		event.preventDefault()
		event.returnValue = geti18n('part_config.alerts.beforeUnload')
	}
})

window.addEventListener('popstate', () => {
	initializeFromURLParams()
})

partpathPicker = await createPartpathPicker({
	dropdown: partpathDropdown,
	breadcrumbList: partpathBreadcrumb,
	menu: partpathMenu,
	initialPath: new URLSearchParams(window.location.search).get('partpath') || '',
	/**
	 * 处理部件路径变化。
	 * @param {string} partpath 新选中的部件路径。
	 */
	onChange: async (partpath) => {
		if (partpath === activePartPath) return
		if (isDirty && !confirmI18n('part_config.alerts.unsavedChanges')) {
			if (activePartPath) partpathPicker.setPath(activePartPath)
			return
		}
		updateURLParams(activePartPath = partpath)
		await loadEditor(partpath)
	}
})
initializeFromURLParams()
