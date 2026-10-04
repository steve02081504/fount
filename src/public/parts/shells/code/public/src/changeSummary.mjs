/** 根据文件操作工具写入的结构化编辑摘要生成文件变更卡片。 */
import { geti18n } from '/scripts/i18n/index.mjs'

import { openFileTab } from './explorer.mjs'
import { store } from './store.mjs'

/** @type {{anchor: HTMLElement, element: HTMLElement}|null} */
let activePreview = null

/** 移除文件行失去悬停或卸载后的预览。 @returns {void} */
function hideActivePreview() {
	activePreview?.element.remove()
	activePreview?.anchor.removeAttribute('aria-describedby')
	activePreview = null
}

/**
 * @param {object} entry - Session entry.
 * @returns {boolean} Whether the entry is one of the file-writing tool logs.
 */
export function isFileEditEntry(entry) {
	return entry?.name === 'file-operations.replace-file' || entry?.name === 'file-operations.override-file'
}

/**
 * 读取工具条目携带的编辑摘要（`file-operations` 插件在 `extension.pluginData` 里写入的形状）。
 * @param {object} entry - Persisted tool entry.
 * @returns {{path: string, added: number, removed: number, diff: string, target: object|null}|null} Parsed edit.
 */
function fileEditFromEntry(entry) {
	if (entry?.role !== 'tool' || !isFileEditEntry(entry)) return null
	const edit = entry.extension?.pluginData?.['file-operations']?.edit
	if (!edit?.path) return null
	return { ...edit, target: entry.extension.executionTarget || null }
}

/**
 * @param {HTMLElement} anchor - Hovered file row.
 * @param {{path: string, diffs: string[]}} edit - Aggregated edits.
 * @returns {HTMLElement} Floating diff preview.
 */
function showDiffPreview(anchor, edit) {
	hideActivePreview()
	const preview = document.createElement('div')
	preview.className = 'code-change-preview'
	preview.setAttribute('role', 'tooltip')
	preview.id = `code-change-preview-${crypto.randomUUID()}`
	const heading = document.createElement('div')
	heading.className = 'code-change-preview-heading'
	heading.setAttribute('user-content', '')
	heading.textContent = edit.path
	const body = document.createElement('pre')
	body.className = 'code-change-preview-body'
	body.setAttribute('prompt-content', '')
	const diff = edit.diffs.filter(Boolean).join('\n\n').split('\n').slice(0, 180)
	if (diff.length === 1 && !diff[0]) body.textContent = geti18n('code.explorer.noDiff')
	else body.append(...diff.map(line => {
		const span = document.createElement('span')
		span.className = `code-change-preview-line ${line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'remove' : ''}`
		span.textContent = line
		return span
	}))
	preview.append(heading, body)
	const landmark = document.querySelector('main') || document.body
	landmark.appendChild(preview)
	const rect = anchor.getBoundingClientRect()
	preview.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - preview.offsetWidth - 8))}px`
	preview.style.top = `${Math.max(8, Math.min(rect.bottom + 4, innerHeight - preview.offsetHeight - 8))}px`
	anchor.setAttribute('aria-describedby', preview.id)
	activePreview = { anchor, element: preview }
	return preview
}

/**
 * @param {object} edit - File edit parsed from a tool entry.
 * @returns {{workspace: object, path: string}|null} An editor target when it belongs to a known workspace.
 */
function editorTarget(edit) {
	const target = edit.target
	const workspace = target
		? store.workspaces.find(w => String(w.machine ?? '0') === String(target.machine) && w.path === target.workdir)
		: store.workspace
	if (!workspace) return null
	/**
	 * @param {string} value - File path.
	 * @returns {string} Slash-normalized path.
	 */
	const normalize = value => String(value).replaceAll('\\', '/').replace(/\/$/, '')
	const root = normalize(workspace.path)
	const path = normalize(edit.path)
	const windows = /^[A-Za-z]:\//.test(root) || root.startsWith('//')
	const contained = windows ? path.toLowerCase().startsWith(`${root.toLowerCase()}/`) : path.startsWith(`${root}/`)
	const relative = contained ? path.slice(root.length + 1) : path
	if (!relative || relative.startsWith('/') || /^[A-Za-z]:/.test(relative) || relative.split('/').includes('..')) return null
	return { workspace, path: relative }
}

/**
 * @param {object[]} entries - Current session entries.
 * @returns {HTMLElement|null} Change summary card, if edits were logged.
 */
export function createChangeSummary(entries) {
	hideActivePreview()
	const edits = entries.map(fileEditFromEntry).filter(Boolean)
	if (!edits.length) return null
	const files = new Map()
	for (const edit of edits) {
		const key = `${edit.target?.machine || ''}\0${edit.target?.workdir || ''}\0${edit.path}`
		const record = files.get(key) || { ...edit, added: 0, removed: 0, diffs: [] }
		record.added += edit.added
		record.removed += edit.removed
		if (edit.diff) record.diffs.push(edit.diff)
		files.set(key, record)
	}
	const card = document.createElement('details')
	card.className = 'code-change-summary'
	card.open = true
	const head = document.createElement('summary')
	head.textContent = geti18n('code.explorer.editedFiles', { count: files.size })
	card.appendChild(head)
	const list = document.createElement('div')
	list.className = 'code-change-files'
	for (const edit of files.values()) {
		const row = document.createElement('button')
		row.type = 'button'
		row.className = 'code-change-file'
		const path = document.createElement('span')
		path.className = 'code-change-path'
		path.setAttribute('user-content', '')
		path.textContent = edit.path
		const counts = document.createElement('span')
		counts.className = 'code-change-counts'
		counts.setAttribute('aria-hidden', 'true')
		const add = document.createElement('span')
		add.className = 'code-editor-added'
		add.textContent = `+${edit.added}`
		const remove = document.createElement('span')
		remove.className = 'code-editor-removed'
		remove.textContent = `−${edit.removed}`
		counts.append(add, remove)
		row.append(path, counts)
		let preview = null
		/** 显示当前文件行的差异预览。 */
		const show = () => { if (!preview) preview = showDiffPreview(row, edit) }
		/** 隐藏当前文件行的差异预览。 */
		const hide = () => { if (activePreview?.anchor === row) hideActivePreview(); preview = null }
		row.addEventListener('mouseenter', show)
		row.addEventListener('mouseleave', hide)
		row.addEventListener('focus', show)
		row.addEventListener('blur', hide)
		row.addEventListener('click', hide)
		const destination = editorTarget(edit)
		if (destination) row.addEventListener('click', () => void openFileTab(destination.workspace, destination.path))
		else row.disabled = true
		list.appendChild(row)
	}
	card.appendChild(list)
	return card
}
