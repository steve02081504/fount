/**
 * 【文件】public/hub/messages/messageActionsUi.mjs
 * 【职责】消息内联编辑与操作条的 UI 原语：按钮模板、编辑区挂载、淡出删除与删除确认阈值。
 * 【原理】`renderActionsBar`、`bindMessageEditArea`、`appendEditArea` 等构建可聚焦的编辑浮层与工具条；提供编辑区 HTML 与动画常量（`EDIT_FADE_MS`），不负责整页消息列表管道。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../../scripts/template、../../src/composerAttachments、../../src/lib/emojiSvg、../../src/ui/composerKeys、../../src/ui/dragAndDrop、../core/domUtils。
 */
import {
	createDocumentFragmentFromHtmlStringNoScriptActivation,
	renderTemplateAsHtmlString,
} from '../../../../../scripts/features/template.mjs'
import { geti18n } from '../../../../../scripts/i18n/index.mjs'
import { handleFilesSelect, renderAttachmentPreview } from '../../src/composerAttachments.mjs'
import { hubActionMenuIcon } from '../../src/lib/emojiSvg.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { bindComposerEditKeys } from '../../src/ui/composerKeys.mjs'
import { addDragAndDropSupport } from '../../src/ui/dragAndDrop.mjs'
/**
 * 消息编辑/反馈/删除动画时长常量。
 */
const EDIT_FADE_MS = 150
const FEEDBACK_COLLAPSE_MS = 200
const DELETE_LINE_THRESHOLD = 30

/**
 * 从 i18n 值（字符串或对象）中提取 title 字符串。
 * @param {string|object|undefined} val geti18n 返回值
 * @returns {string} title 字符串
 */
function extractI18nTitle(val) {
	if (!val) return ''
	if (typeof val === 'string') return val
	if (typeof val === 'object') return String(val.title || val['aria-label'] || '')
	return ''
}

/**
 * 生成操作按钮 HTML。
 * 当有 icon 时使用 title 属性显示 i18n 文本（不替换图标），无图标时用 data-i18n 设置按钮文本。
 * @param {object} opts 按钮选项
 * @param {string} opts.action data-action 值
 * @param {string} [opts.attrs] 额外 HTML 属性
 * @param {string} [opts.icon] 图标 HTML
 * @param {string} [opts.i18nKey] i18n 键（有图标时作 title/tooltip，无图标时作按钮文本）
 * @param {string} [opts.classes] 额外 class
 * @param {string} [opts.label] 无图标时的备用文本
 * @returns {string} 按钮 HTML
 */
export function actionButton({ action, attrs = '', icon = '', i18nKey = '', classes = '', label = '' }) {
	let titleAttr = ''
	let i18nAttr = ''
	if (icon && i18nKey) {
		const raw = geti18n(i18nKey)
		const title = extractI18nTitle(raw)
		if (title) titleAttr = ` title="${escapeHtml(title)}"`
	}
	else if (i18nKey) 
		i18nAttr = ` data-i18n="${i18nKey}"`
	
	const content = icon || escapeHtml(label)
	return `<button type="button" class="btn btn-ghost btn-xs hub-message-action ${classes}" data-action="${action}"${titleAttr}${i18nAttr} ${attrs}>${content}</button>`
}

/**
 * 生成下拉菜单项 HTML，图标和文字标签并排显示。
 * @param {string} action data-action 值
 * @param {string} attrs 额外属性
 * @param {string} icon 图标 HTML
 * @param {string} [i18nKey] 可选 i18n 键（菜单文字）
 * @param {string} [classes] 额外 class
 * @returns {string} 菜单项 HTML
 */
export function menuActionItem(action, attrs, icon, i18nKey = '', classes = '') {
	const labelSpan = i18nKey ? `<span class="hub-menu-label" data-i18n="${i18nKey}"></span>` : ''
	return `<li><button type="button" class="btn btn-ghost btn-xs hub-message-action w-full justify-start gap-2 ${classes}" data-action="${action}" ${attrs}>${icon}${labelSpan}</button></li>`
}

/**
 * 生成带二级菜单的菜单项（Discord 风格折叠子菜单）。
 * @param {string} labelI18nKey 父级标签 i18n 键
 * @param {string} icon 父级图标 HTML
 * @param {string} innerItemsHtml 子级 `<li>` 菜单项
 * @returns {string} 二级菜单 HTML
 */
export function menuSubmenu(labelI18nKey, icon, innerItemsHtml) {
	return `<li class="hub-menu-submenu"><details><summary class="hub-menu-submenu-summary gap-2">${icon}<span class="hub-menu-label" data-i18n="${labelI18nKey}"></span></summary><ul class="p-1">${innerItemsHtml}</ul></details></li>`
}

/**
 * @param {string} inlineHtml 行内主操作按钮
 * @param {string} menuItemsHtml `<li>` 菜单项
 * @param {string} [shiftHtml] Shift 层按钮 HTML
 * @param {{ alwaysVisible?: boolean }} [opts] 显示选项
 * @returns {string} 操作栏 HTML
 */
export async function renderActionsBar(inlineHtml, menuItemsHtml, shiftHtml = '', opts = {}) {
	if (!inlineHtml && !menuItemsHtml && !shiftHtml) return ''
	const menuHtml = menuItemsHtml
		? await renderTemplateAsHtmlString('hub/messages/actions_menu', {
			menuItemsHtml,
			menuIconHtml: hubActionMenuIcon,
		})
		: ''
	const visClass = opts.alwaysVisible
		? 'hub-message-actions--always'
		: 'hub-message-actions--anim'
	const shiftLayerHtml = shiftHtml
		? `<div class="hub-message-actions-shift-buttons flex flex-wrap items-center gap-1">${shiftHtml}</div>`
		: ''
	return renderTemplateAsHtmlString('hub/messages/actions_bar', {
		visClass,
		inlineHtml,
		menuHtml,
		shiftLayerHtml,
	})
}

/**
 * @param {string} inner 编辑区内部 HTML
 * @returns {Promise<string>} 完整编辑区 HTML
 */
export async function editAreaInnerHtml(inner) {
	return renderTemplateAsHtmlString('hub/messages/edit_area', { innerHtml: inner })
}

/**
 * @param {string} originalText 原始正文
 * @param {string} eventId DAG 事件 id
 * @returns {Promise<string>} 频道消息编辑区 HTML
 */
export async function editChannelBodyHtml(originalText, eventId) {
	return renderTemplateAsHtmlString('hub/messages/edit_channel_body', { originalText, eventId })
}

/**
 * 绑定编辑区附件、快捷键与保存/取消。
 * @param {HTMLElement|null} editWrap 编辑区根
 * @param {object} opts 选项
 * @param {() => void|Promise<void>} opts.onSave 保存回调
 * @param {() => void|Promise<void>} opts.onCancel 取消回调
 * @param {Array<object>} [opts.initialFiles] 已有附件
 * @returns {{ selectedFiles: object[], getText: () => string }} 编辑区控制器
 */
export function bindMessageEditArea(editWrap, { onSave, onCancel, initialFiles = [] }) {
	const selectedFiles = [...initialFiles]
	const preview = editWrap?.querySelector('.hub-message-edit-attach-preview')
	const textarea = editWrap?.querySelector('.hub-message-edit-textarea')
	const fileInput = editWrap?.querySelector('.hub-message-edit-file-input')

	/** @returns {Promise<void>} */
	const refreshPreviews = async () => {
		if (!(preview instanceof HTMLElement)) return
		preview.replaceChildren()
		for (let index = 0; index < selectedFiles.length; index++) {
			const element = await renderAttachmentPreview(selectedFiles[index], index, selectedFiles)
			if (element) preview.appendChild(element)
		}
	}
	void refreshPreviews()

	editWrap?.querySelector('.hub-message-edit-upload-button')?.addEventListener('click', () => {
		if (fileInput instanceof HTMLInputElement) fileInput.click()
	})
	fileInput?.addEventListener('change', async event => {
		await handleFilesSelect(event, selectedFiles, preview)
	})

	if (textarea instanceof HTMLTextAreaElement) {
		addDragAndDropSupport(textarea, selectedFiles, preview)
		bindComposerEditKeys(textarea, { onSave, onCancel })
	}

	editWrap?.querySelector('.hub-message-edit-save')?.addEventListener('click', event => {
		event.stopPropagation()
		void onSave()
	})
	editWrap?.querySelector('.hub-message-edit-cancel')?.addEventListener('click', event => {
		event.stopPropagation()
		void onCancel()
	})

	return {
		selectedFiles,
		/** @returns {string} 当前编辑正文 */
		getText: () => textarea instanceof HTMLTextAreaElement ? textarea.value : '',
	}
}

/**
 * @param {HTMLElement|null|undefined} rowElement 消息行
 * @param {string} innerHtml 编辑区 HTML
 * @returns {HTMLElement|null} 插入后的编辑区根节点
 */
export async function appendEditArea(rowElement, innerHtml) {
	if (!rowElement) return null
	const wrapHtml = await renderTemplateAsHtmlString('hub/messages/edit_wrap_shell', {
		innerHtml,
		fadeMs: EDIT_FADE_MS,
	})
	const frag = await createDocumentFragmentFromHtmlStringNoScriptActivation(wrapHtml)
	const editWrap = frag.firstElementChild
	if (!(editWrap instanceof HTMLElement)) return null
	rowElement.appendChild(editWrap)
	requestAnimationFrame(() => { editWrap.style.opacity = '1' })
	return editWrap
}

/**
 * @param {HTMLElement|null|undefined} el 待移除节点
 * @returns {Promise<void>}
 */
export async function removeWithFade(el) {
	if (!el) return
	if (el.classList.contains('hub-message-feedback-reason-area')) {
		el.classList.remove('visible')
		await new Promise(resolve => setTimeout(resolve, FEEDBACK_COLLAPSE_MS))
		el.remove()
		return
	}
	el.style.transition = `opacity ${EDIT_FADE_MS}ms ease-in-out`
	el.style.opacity = '0'
	await new Promise(resolve => setTimeout(resolve, EDIT_FADE_MS))
	el.remove()
}

/**
 * @param {string} text 消息正文
 * @returns {boolean} 是否需确认删除
 */
export function shouldConfirmDelete(text) {
	return text.split('\n').length >= DELETE_LINE_THRESHOLD
}
