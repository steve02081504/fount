/**
 * gist 查看页：渲染正文、安全等级切换、下载 / 分享 / 删除、body 级 md 拖放重渲。
 */
import { uploadToCatbox } from '/scripts/host/catbox.mjs'
import { confirmAction } from '/scripts/features/promptDialog.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { initTranslations, setElementI18n } from '/scripts/i18n/index.mjs'
import { applyTheme } from '/scripts/theme/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { deleteGists, getGist, getSourcePlugins, updateGist } from './src/endpoints.mjs'
import { renderGistContent } from './src/render.mjs'
import { fileNameFromHtmlTitle, renderMarkdownAsStandaloneDocument, downloadHtmlDocument } from './src/standaloneDocument.mjs'

const LIST_URL = '/parts/shells:gist/'
const EDIT_URL = '/parts/shells:gist/edit.html'

/** @type {object | null} */
let gist = null

/**
 * 更新安全等级徽标按钮的文案与配色。
 * @returns {void}
 */
function renderSecurityToggle() {
	const button = document.getElementById('security-toggle')
	button.classList.remove('gist-badge-secure', 'gist-badge-trusted')
	button.classList.add(gist.securityLevel === 'secure' ? 'gist-badge-secure' : 'gist-badge-trusted')
	setElementI18n(button, gist.securityLevel === 'secure' ? 'gist.securityToggle.secure' : 'gist.securityToggle.trusted')
}

/**
 * 渲染 gist 正文与标头。
 * @returns {Promise<void>} 渲染完成。
 */
async function renderGist() {
	document.getElementById('view-title').textContent = gist.title || ''
	renderSecurityToggle()
	await renderGistContent(document.getElementById('content'), gist)
}

/**
 * 安全等级切换：secure→trusted 需确认（警告 XSS 风险），trusted→secure 直接切换。
 * @returns {Promise<void>} 切换完成。
 */
async function toggleSecurity() {
	const targetLevel = gist.securityLevel === 'secure' ? 'trusted' : 'secure'
	if (targetLevel === 'trusted' && !await confirmAction('gist.view.downgradeConfirm')) return
	gist = await updateGist(gist.id, { securityLevel: targetLevel })
	await renderGist()
}

/**
 * 渲染为独立 HTML 并触发下载（始终 trusted 渲染，与安全等级无关）。
 * @returns {Promise<void>} 下载已触发。
 */
async function downloadGist() {
	const html = await renderMarkdownAsStandaloneDocument(gist.markdown)
	downloadHtmlDocument(html, fileNameFromHtmlTitle(html, gist.title || 'gist'))
}

/**
 * 分享到 Litterbox：独立 HTML 上传 → 短链复制到剪贴板并提示。
 * @returns {Promise<void>} 分享完成。
 */
async function shareGist() {
	const html = await renderMarkdownAsStandaloneDocument(gist.markdown)
	const fileName = fileNameFromHtmlTitle(html, gist.title || 'gist')
	const fileId = await uploadToCatbox(html, '1h', fileName)
	await navigator.clipboard.writeText(`https://litter.catbox.moe/${fileId}`)
	showToastI18n('success', 'gist.view.shareCopied')
}

/**
 * 确认后删除 gist 并返回列表。
 * @returns {Promise<void>} 删除完成。
 */
async function deleteGistAction() {
	if (!await confirmAction('gist.view.deleteConfirm')) return
	await deleteGists([gist.id])
	location.href = LIST_URL
}

/**
 * 拖放 md 文件重渲：读取文件文本更新 gist 后重渲染并提示。
 * @param {File} file - 拖入的 md 文件。
 * @returns {Promise<void>} 重渲完成。
 */
async function handleDroppedMarkdown(file) {
	const text = await file.text()
	gist = await updateGist(gist.id, { markdown: text })
	await renderGist()
	showToastI18n('success', 'gist.view.dropRerender')
}

/**
 * body 级拖放接管：仅当拖入 .md/.markdown 文件且落点在正文容器内才处理。
 * @param {DragEvent} event - 拖放事件。
 * @returns {void}
 */
function onDocumentDrop(event) {
	const files = [...event.dataTransfer?.files || []]
	const mdFile = files.find(file => /\.(md|markdown)$/i.test(file.name))
	if (!mdFile) return
	if (!(event.target instanceof Element) || !event.target.closest('[data-gist-drop-zone]')) return
	event.preventDefault()
	void handleDroppedMarkdown(mdFile).catch(handleError('gist.error.generic'))
}

/**
 * 渲染来源插件区：加载匹配 gist.source.type 的插件并调用其 render。
 * @returns {Promise<void>} 渲染完成。
 */
async function renderSourcePlugins() {
	const container = document.getElementById('source-plugins')
	container.replaceChildren()
	const type = gist.source?.type
	if (!type) return
	let plugins = []
	try {
		({ plugins = [] } = await getSourcePlugins())
	} catch {
		return
	}
	const plugin = plugins.find(item => item.id === type)
	if (!plugin?.path) return
	try {
		const mod = await import(plugin.path)
		await mod.default?.render?.({ gist, container })
	}
	catch (error) {
		console.error(`Error rendering gist source plugin ${plugin.path}:`, error)
	}
}

/**
 * 显示「未找到」界面：露出错误区，隐藏正文与操作按钮区。
 * @returns {void}
 */
function showNotFound() {
	document.getElementById('not-found').hidden = false
	document.getElementById('gist-scroll').hidden = true
	document.getElementById('gist-actions').hidden = true
}

/**
 * 读取 gist 并渲染；404 时显示错误区与返回按钮。
 * @param {string} id - gist id。
 * @returns {Promise<void>} 加载完成。
 */
async function loadGist(id) {
	try {
		gist = await getGist(id)
	} catch (error) {
		if (error.status === 404) {
			showNotFound()
			return
		}
		throw error
	}
	await renderGist()
	await renderSourcePlugins()
}

/**
 * 页面初始化：应用主题、初始化 i18n、绑定标头操作并加载 gist。
 * @returns {Promise<void>} 初始化完成。
 */
async function boot() {
	await initTranslations('gist')
	const id = new URLSearchParams(location.search).get('id')
	document.getElementById('back-button').addEventListener('click', () => { location.href = LIST_URL })
	document.getElementById('edit-button').addEventListener('click', () => { location.href = `${EDIT_URL}?id=${encodeURIComponent(id)}` })
	document.getElementById('security-toggle').addEventListener('click', () => { void toggleSecurity().catch(handleError('gist.error.generic')) })
	document.getElementById('download-button').addEventListener('click', () => { void downloadGist().catch(handleError('gist.error.generic')) })
	document.getElementById('share-button').addEventListener('click', () => { void shareGist().catch(handleError('gist.error.generic')) })
	document.getElementById('delete-button').addEventListener('click', () => { void deleteGistAction().catch(handleError('gist.error.generic')) })
	document.addEventListener('dragover', event => { event.preventDefault() })
	document.addEventListener('drop', onDocumentDrop)
	if (!id) {
		showNotFound()
		return
	}
	await loadGist(id)
}

applyTheme()

boot().catch(handleError('gist.error.generic'))
