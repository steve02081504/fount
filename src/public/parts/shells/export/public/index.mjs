/**
 * 导出 shell 的客户端逻辑。
 */
import { initTranslations } from '/scripts/i18n.mjs'
import { applyTheme } from '/scripts/theme.mjs'
import { showToastI18n } from '/scripts/toast.mjs'
import { createPartpathPicker } from '/scripts/partpath_picker.mjs'
import { getFountJson, exportPart, createShareLink } from './src/endpoints.mjs'

// --- DOM Elements ---
const partpathDropdown = document.getElementById('partpath-dropdown')
const partpathBreadcrumb = document.getElementById('partpath-breadcrumb')
const partpathMenu = document.getElementById('partpath-menu')
const exportButton = document.getElementById('exportButton')
const shareButton = document.getElementById('shareButton')
const exportStatusIcon = document.getElementById('exportStatusIcon')
const shareStatusIcon = document.getElementById('shareStatusIcon')
const disabledIndicator = document.getElementById('disabledIndicator')
const includeDataCheckbox = document.getElementById('includeDataCheckbox')
const dataToggleContainer = document.getElementById('dataToggleContainer')
const shareButtonText = shareButton.querySelector('.text-lg')
const stepPart = document.getElementById('stepPart')
const stepAction = document.getElementById('stepAction')

// --- State ---
let partpathPicker = null
let activePartPath = ''
let fountJson = null

// --- UI State Management ---

/**
 * 根据当前应用程序状态更新整个 UI。
 * 此函数集中了所有 UI 逻辑。
 */
function updateUIState() {
	// Step 1: Update the progress steps
	const currentStep = activePartPath ? 2 : 1
	stepPart.classList.toggle('step-primary', currentStep >= 1)
	stepAction.classList.toggle('step-primary', currentStep >= 2)

	// Step 2: Show/hide the main action area
	const isActionable = !!activePartPath
	disabledIndicator.classList.toggle('hidden', isActionable)

	// Step 3: Show/hide the "include data" toggle if data files exist
	const hasDataFiles = fountJson?.data_files?.length
	dataToggleContainer.classList.toggle('hidden', !hasDataFiles)

	// Step 4: Update the Share Button's text and behavior
	const hasExistingShareLink = !includeDataCheckbox.checked && fountJson?.share_link
	shareButton.toggleAttribute('tabindex', hasExistingShareLink) // Correct use for boolean attributes
	shareButtonText.dataset.i18n = hasExistingShareLink ? 'export.buttons.copyShareLink' : 'export.buttons.generateShareLink'
}

// --- Data & State Changers ---

/**
 * 处理选择特定部件时的逻辑。
 * @param {string | null} partpath - 选定的部件路径。
 */
async function onPartSelected(partpath) {
	activePartPath = partpath || ''
	fountJson = null // Reset before fetching

	updateURLParams(activePartPath)

	if (activePartPath) try {
		fountJson = await getFountJson(activePartPath)
	} catch (err) {
		console.error('Failed to load part details:', err)
		showToastI18n('error', 'export.alerts.loadPartDetailsFailed', { message: err.message })
	}

	updateUIState()
}

// --- Actions ---

/**
 * 处理导出。
 * @returns {Promise<void>}
 */
async function handleExport() {
	if (!activePartPath) return

	const withData = includeDataCheckbox.checked
	setButtonLoading(exportButton, exportStatusIcon, true)

	try {
		const { blob, format } = await exportPart(activePartPath, withData)
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `${activePartPath.split('/').pop()}${withData ? '_with_data' : ''}.${format}`
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
		setButtonState(exportStatusIcon, 'success')
	}
	catch (err) {
		showToastI18n('error', 'export.alerts.exportFailed', { message: err.message })
		console.error('Failed to export part:', err)
		setButtonState(exportStatusIcon, 'error')
	}

	setTimeout(() => setButtonLoading(exportButton, exportStatusIcon, false), 2000)
}

/**
 * 处理共享操作。
 * @param {object} root0 - 根对象。
 * @param {boolean} [root0.copyOnly=false] - 是否仅复制。
 * @param {string | null} [root0.expiration=null] - 过期时间。
 * @returns {Promise<void>}
 */
async function handleShareAction({ copyOnly = false, expiration = null }) {
	if (!activePartPath) return

	const withData = includeDataCheckbox.checked
	setButtonLoading(shareButton, shareStatusIcon, true)

	try {
		let link
		if (copyOnly && fountJson?.share_link)
			// Case 1: Just copy the pre-existing share link
			link = `https://steve02081504.github.io/fount/protocol?url=fount://run/parts/shells:install/install;${fountJson.share_link}`
		else if (expiration)
			// Case 2: Generate a new share link
			link = await createShareLink(activePartPath, expiration, withData)
		else
			throw new Error('Invalid share action call')

		await navigator.clipboard.writeText(link)
		showToastI18n('success', 'export.alerts.shareLinkCopied')
		setButtonState(shareStatusIcon, 'success')
	}
	catch (err) {
		showToastI18n('error', 'export.alerts.shareFailed', { message: err.message })
		console.error('Failed to handle share action:', err)
		setButtonState(shareStatusIcon, 'error')
	}
	finally {
		setTimeout(() => setButtonLoading(shareButton, shareStatusIcon, false), 2000)
	}
}

// --- UI Helpers ---

/**
 * 设置按钮加载状态。
 * @param {HTMLButtonElement} button - 按钮。
 * @param {HTMLElement} icon - 图标。
 * @param {boolean} isLoading - 是否正在加载。
 */
function setButtonLoading(button, icon, isLoading) {
	button.disabled = isLoading
	if (isLoading)
		icon.innerHTML = /* html */ '<img src="https://api.iconify.design/line-md/loading-loop.svg" class="h-6 w-6" />'
	else
		icon.innerHTML = /* html */ ''
}

/**
 * 设置按钮状态。
 * @param {HTMLElement} icon - 图标。
 * @param {'success' | 'error'} state - 状态。
 */
function setButtonState(icon, state) {
	const iconUrl = state === 'success'
		? 'https://api.iconify.design/line-md/confirm-circle.svg'
		: 'https://api.iconify.design/line-md/emoji-frown.svg'
	icon.innerHTML = /* html */ `<img src="${iconUrl}" class="h-6 w-6" />`
}

// --- URL Management ---

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

// --- Initialization ---

/**
 * 从 URL 参数初始化。
 * @returns {Promise<void>}
 */
async function initializeFromURLParams() {
	const urlParams = getURLParams()
	const partpath = urlParams.get('partpath')
	partpathPicker = await createPartpathPicker({
		dropdown: partpathDropdown,
		breadcrumbList: partpathBreadcrumb,
		menu: partpathMenu,
		initialPath: partpath || '',
		onChange: onPartSelected
	})
}

/**
 * 初始化应用程序。
 * @returns {Promise<void>}
 */
async function init() {
	applyTheme()
	await initTranslations('export')

	// Event Listeners
	exportButton.addEventListener('click', handleExport)
	includeDataCheckbox.addEventListener('change', updateUIState)

	shareButton.addEventListener('click', event => {
		if (!fountJson?.share_link || includeDataCheckbox.checked) return
		event.preventDefault()
		handleShareAction({ copyOnly: true })
	})

	document.getElementById('shareMenu').addEventListener('click', event => {
		document.activeElement?.blur?.()
		if (event.target.tagName === 'A' && event.target.dataset.value)
			handleShareAction({ expiration: event.target.dataset.value })
	})

	await initializeFromURLParams()
}

init()
