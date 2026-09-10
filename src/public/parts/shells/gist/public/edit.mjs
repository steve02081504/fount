/**
 * gist 编辑页：新建 / 编辑 gist，编辑预览切换、安全等级选择与粘贴危险检测。
 */
import { createMarkdownRichInput } from '/scripts/components/markdownRichInput.mjs'
import { confirmAction } from '/scripts/features/promptDialog.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { geti18n, initTranslations, setElementI18n } from '/scripts/i18n/index.mjs'
import { applyTheme } from '/scripts/theme/index.mjs'

import { scrubHtmlActivePayload } from '/scripts/lib/sanitizeHtml.mjs'

import { detectPasteDanger } from './src/dangerDetect.mjs'
import { createGist, getGist, updateGist } from './src/endpoints.mjs'
import { renderGistContent } from './src/render.mjs'

const VIEW_URL = '/parts/shells:gist/view'
const LIST_URL = '/parts/shells:gist/'

/** @type {string | null} */
let gistId = null
/** @type {'secure'|'trusted'} */
let securityLevel = 'trusted'
/** @type {ReturnType<typeof createMarkdownRichInput> | null} */
let richInput = null
/** @type {boolean} */
let previewMode = false

/**
 * 更新安全等级本地状态与选择器 UI。
 * @param {'secure'|'trusted'} level - 目标安全等级。
 * @returns {void}
 */
function setSecurityLevel(level) {
	securityLevel = level
	const radio = document.querySelector(`input[name="securityLevel"][value="${level}"]`)
	if (radio) radio.checked = true
}

/**
 * 编辑 / 预览切换：预览用当前所选安全等级渲染富文本内容。
 * @returns {void}
 */
function togglePreview() {
	previewMode = !previewMode
	document.getElementById('editor-wrap').hidden = previewMode
	document.getElementById('preview').hidden = !previewMode
	setElementI18n(document.getElementById('preview-toggle'), previewMode ? 'gist.edit.editMode' : 'gist.edit.previewToggle')
	if (previewMode) void renderPreview()
	else richInput.focus()
}

/**
 * 渲染预览（编辑中内容按当前所选安全等级渲染）。
 * @returns {Promise<void>} 渲染完成。
 */
async function renderPreview() {
	await renderGistContent(document.getElementById('preview'), {
		markdown: richInput.value,
		securityLevel,
	})
}

/**
 * 以纯文本形式插入剪贴板文本（execCommand insertText 不解析 HTML）。
 * @param {string} text 待插入文本。
 * @returns {void}
 */
function insertPlainText(text) {
	if (!text.trim()) return
	richInput.focus()
	document.execCommand('insertText', false, text)
	richInput.element.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * 安全档兜底：以纯文本形式插入消杀后的剪贴板内容。
 * @param {string} html 剪贴板 text/html 原文。
 * @returns {void}
 */
function insertSanitizedPaste(html) {
	insertPlainText(scrubHtmlActivePayload(html)?.textContent ?? '')
}

/**
 * 粘贴安全检测：dangerous 内容 + trusted 档时异步询问后再手动插入；
 * 用户选择不信任时切换为 secure 并以纯文本 / 净化内容插入，不再插入原始 HTML。
 * secure 档或纯文本直接放行默认粘贴。
 * @param {ClipboardEvent} event - 粘贴事件。
 * @returns {void}
 */
function handlePaste(event) {
	const html = event.clipboardData?.getData('text/html')
	if (!html) return
	if (securityLevel === 'secure') return
	if (!detectPasteDanger(html)) return
	const plainText = event.clipboardData?.getData('text/plain') ?? ''
	event.preventDefault()
	void (async () => {
		const trust = await confirmAction('gist.edit.pasteDangerPrompt', {
			trust: geti18n('gist.edit.pasteTrust'),
			secure: geti18n('gist.edit.pasteSecure'),
		})
		if (trust) {
			richInput.focus()
			document.execCommand('insertHTML', false, html)
			return
		}
		setSecurityLevel('secure')
		insertPlainText(plainText)
		if (!plainText.trim()) insertSanitizedPaste(html)
	})().catch(handleError('gist.error.generic'))
}

/**
 * 保存 gist：新建或更新后跳查看页；空标题由服务端用 markdown 首行兜底。
 * @returns {Promise<void>} 保存完成。
 */
async function saveGist() {
	const title = document.getElementById('title-input').value.trim()
	const payload = { markdown: richInput.value, title, securityLevel }
	const gist = gistId
		? await updateGist(gistId, payload)
		: await createGist(payload)
	location.href = `${VIEW_URL}?id=${encodeURIComponent(gist.id)}`
}

/**
 * 加载既有 gist（编辑模式沿用其安全等级）。
 * @param {string} id - gist id。
 * @returns {Promise<void>} 加载完成。
 */
async function loadExistingGist(id) {
	const gist = await getGist(id)
	document.getElementById('title-input').value = gist.title || ''
	richInput.value = gist.markdown || ''
	setSecurityLevel(gist.securityLevel === 'secure' ? 'secure' : 'trusted')
}

/**
 * 页面初始化：应用主题、初始化 i18n、初始化编辑器并绑定事件。
 * @returns {Promise<void>} 初始化完成。
 */
async function boot() {
	await initTranslations('gist')
	gistId = new URLSearchParams(location.search).get('id')
	richInput = createMarkdownRichInput(document.getElementById('markdown-editor'), {
		useRegisteredInlineTokens: false,
	})
	document.getElementById('save-button').addEventListener('click', () => { void saveGist().catch(handleError('gist.error.generic')) })
	document.getElementById('preview-toggle').addEventListener('click', togglePreview)
	richInput.element.addEventListener('paste', handlePaste, true)
	for (const radio of document.querySelectorAll('input[name="securityLevel"]'))
		radio.addEventListener('change', () => { if (radio.checked) securityLevel = radio.value })
	if (gistId) await loadExistingGist(gistId)
	else setSecurityLevel('trusted')
	setElementI18n(document.getElementById('preview-toggle'), 'gist.edit.previewToggle')
}

applyTheme()

boot().catch(handleError('gist.error.generic'))
