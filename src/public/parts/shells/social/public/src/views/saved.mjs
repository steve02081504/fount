import { formatHashShort } from '/parts/shells:chat/shared/entityHash.mjs'
import { formatSocialPostHref } from '../../shared/runUri.mjs'
import { formatActionKey } from '../lib/actionKey.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { renderAvatarHtml } from '../lib/display.mjs'
import { runSocialWrite } from '../lib/socialWrite.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { socialState } from '../state.mjs'

/** @type {'all' | 'unfiled' | string} */
let savedFilter = 'all'
let savedQuery = ''
let savedSearchBound = false
/** @type {object | null} */
let savedCache = null

/**
 * 关闭收藏帖模态框。
 * @returns {void}
 */
export function closeSaveModal() {
	socialState.pendingSave = null
	document.getElementById('saveModal')?.classList.add('hidden')
}

/**
 * 打开收藏帖模态框并填充文件夹选项。
 * @param {string} entityHash 作者
 * @param {string} postId 帖子
 * @param {HTMLElement} button 按钮
 * @returns {Promise<void>}
 */
export async function openSaveModal(entityHash, postId, button) {
	socialState.pendingSave = { entityHash, postId, button }
	const modal = document.getElementById('saveModal')
	const select = document.getElementById('saveFolderSelect')
	if (!modal || !select) return
	select.innerHTML = `<option value="">${escapeHtml(geti18n('social.saved.unfiled'))}</option>`
	modal.classList.remove('hidden')
	const savedData = await socialApi('/saved-posts').catch(() => ({ folders: {} }))
	socialState.savedFoldersCache = savedData.folders || {}
	for (const [folderId, folder] of Object.entries(socialState.savedFoldersCache)) {
		const option = document.createElement('option')
		option.value = folderId
		option.textContent = folder.name || folderId
		select.appendChild(option)
	}
}

/**
 * 确认收藏当前帖子到选定文件夹。
 * @returns {Promise<void>}
 */
export async function confirmSaveModal() {
	if (!socialState.pendingSave) return
	const folderId = document.getElementById('saveFolderSelect')?.value || undefined
	const { button } = socialState.pendingSave
	const prevText = button.textContent
	button.textContent = geti18n('social.actions.saved')
	try {
		await runSocialWrite('save', () => socialApi('/saved-posts/add', {
			method: 'POST',
			body: JSON.stringify({
				entityHash: socialState.pendingSave.entityHash,
				postId: socialState.pendingSave.postId,
				folderId: folderId || undefined,
			}),
		}))
		closeSaveModal()
	}
	catch {
		button.textContent = prevText
	}
}

/**
 * @param {string | undefined} name 展示名
 * @param {string} entityHash entityHash
 * @returns {string} 作者展示名
 */
function savedAuthorLabel(name, entityHash) {
	return name || formatHashShort(entityHash, { headLen: 8, tailLen: 0 })
}

/**
 * @param {string | undefined} preview 预览
 * @param {string} postId 帖子 id
 * @returns {string} 预览文本
 */
function savedPreviewLabel(preview, postId) {
	return preview || `${postId.slice(0, 8)}…`
}

/**
 * @param {object} ref 收藏引用
 * @param {string} [folderId] 文件夹
 * @param {string} [folderName] 文件夹名（搜索结果角标）
 * @returns {HTMLElement} 行节点
 */
function buildSavedRow(ref, folderId, folderName) {
	const actionKey = formatActionKey(ref.entityHash, ref.postId)
	const author = savedAuthorLabel(ref.authorName, ref.entityHash)
	const row = document.createElement('article')
	row.className = 'saved-row'
	row.innerHTML = `
		<a href="${escapeHtml(formatSocialPostHref(ref.entityHash, ref.postId))}" class="saved-link">
			${renderAvatarHtml(ref.entityHash, { name: author }, 'saved-row-avatar')}
			<span class="saved-link-body">
				<strong class="saved-author">${escapeHtml(author)}</strong>
				<span class="saved-preview">${escapeHtml(savedPreviewLabel(ref.preview, ref.postId))}</span>
				${folderName ? `<span class="saved-folder-badge">${escapeHtml(folderName)}</span>` : ''}
			</span>
		</a>
		<button type="button" class="saved-row-action" data-remove-saved="${escapeHtml(actionKey)}"${folderId ? ` data-saved-folder="${escapeHtml(folderId)}"` : ''} aria-label="${escapeHtml(geti18n('social.saved.remove'))}">
			<span class="s-ic s-ic-bookmark-off" aria-hidden="true"></span>
		</button>
	`
	return row
}

/**
 * @param {string} title 标题
 * @param {number} count 数量
 * @param {{ folderId?: string, emptyKey?: string }} [opts] 选项
 * @returns {HTMLElement} 分区
 */
function buildSavedSection(title, count, opts = {}) {
	const section = document.createElement('section')
	section.className = 'saved-section'
	const actions = opts.folderId
		? `
			<div class="saved-folder-actions">
				<button type="button" class="saved-icon-btn" data-rename-folder="${escapeHtml(opts.folderId)}" aria-label="${escapeHtml(geti18n('social.saved.renameFolder'))}" title="${escapeHtml(geti18n('social.saved.renameFolder'))}">
					<span class="s-ic s-ic-edit" aria-hidden="true"></span>
				</button>
				<button type="button" class="saved-icon-btn saved-icon-btn-danger" data-delete-folder="${escapeHtml(opts.folderId)}" aria-label="${escapeHtml(geti18n('social.saved.deleteFolder'))}" title="${escapeHtml(geti18n('social.saved.deleteFolder'))}">
					<span class="s-ic s-ic-delete" aria-hidden="true"></span>
				</button>
			</div>
		`
		: ''
	section.innerHTML = `
		<div class="saved-section-header">
			<div class="saved-section-title-wrap">
				<span class="s-ic ${opts.folderId ? 's-ic-folder' : 's-ic-bookmark'} saved-section-icon" aria-hidden="true"></span>
				<h3 class="saved-section-title">${escapeHtml(title)}</h3>
				<span class="saved-count">${count}</span>
			</div>
			${actions}
		</div>
	`
	const list = document.createElement('div')
	list.className = 'saved-section-list'
	if (!count && opts.emptyKey) {
		const empty = document.createElement('div')
		empty.className = 'saved-section-empty'
		empty.textContent = geti18n(opts.emptyKey)
		list.appendChild(empty)
	}
	section.appendChild(list)
	return section
}

/**
 * @param {object} data 收藏结构
 * @returns {number} 总数
 */
function totalSavedCount(data) {
	let n = (data.unfiled || []).length
	for (const folder of Object.values(data.folders || {}))
		n += (folder.posts || []).length
	return n
}

/**
 * @param {object} ref 引用
 * @param {string} query 小写查询
 * @returns {boolean} 是否匹配
 */
function matchesSavedQuery(ref, query) {
	if (!query) return true
	const haystack = [ref.preview, ref.authorName, ref.entityHash].filter(Boolean).join('\n').toLowerCase()
	return haystack.includes(query)
}

/**
 * 绑定搜索框（幂等）。
 * @returns {void}
 */
function bindSavedSearch() {
	if (savedSearchBound) return
	const panel = document.getElementById('savedPanel')
	if (!panel) return
	savedSearchBound = true
	panel.addEventListener('input', event => {
		const input = event.target
		if (!(input instanceof HTMLInputElement) || input.id !== 'savedSearchInput') return
		savedQuery = input.value.trim()
		renderSavedPanel()
	})
}

/**
 * 切换文件夹筛选。
 * @param {string} filter `all` | `unfiled` | folderId
 * @returns {void}
 */
export function setSavedFilter(filter) {
	savedFilter = filter
	renderSavedPanel()
}

/**
 * 用缓存数据重绘收藏面板。
 * @returns {void}
 */
export function renderSavedPanel() {
	const data = savedCache
	const panel = document.getElementById('savedPanel')
	if (!data || !panel) return

	const folders = data.folders || {}
	const unfiled = data.unfiled || []
	const folderEntries = Object.entries(folders)
	const total = totalSavedCount(data)
	const hasFolders = folderEntries.length > 0

	if (savedFilter !== 'all' && savedFilter !== 'unfiled' && !folders[savedFilter])
		savedFilter = 'all'
	if (!total) savedQuery = ''

	panel.replaceChildren()

	if (!total && !hasFolders) {
		panel.innerHTML = `
			<div class="saved-empty">
				<span class="s-ic s-ic-bookmark saved-empty-icon" aria-hidden="true"></span>
				<p class="saved-empty-title">${escapeHtml(geti18n('social.empty.saved'))}</p>
				<p class="saved-empty-hint">${escapeHtml(geti18n('social.saved.emptyHint'))}</p>
			</div>
		`
		return
	}

	const query = savedQuery.toLowerCase()

	if (total) {
		const toolbar = document.createElement('div')
		toolbar.className = 'saved-toolbar'
		toolbar.innerHTML = `
			<div class="feed-search-wrap saved-search-wrap">
				<span class="s-ic s-ic-search search-icon" aria-hidden="true"></span>
				<input type="search" id="savedSearchInput" class="feed-search-input" value="${escapeHtml(savedQuery)}" placeholder="${escapeHtml(geti18n('social.saved.searchPlaceholder'))}" autocomplete="off" />
			</div>
		`
		panel.appendChild(toolbar)
	}

	const tabs = document.createElement('div')
	tabs.className = 'saved-folder-tabs'
	tabs.setAttribute('role', 'tablist')
	const tabSpecs = [
		{ id: 'all', label: geti18n('social.saved.all'), count: total },
		{ id: 'unfiled', label: geti18n('social.saved.unfiled'), count: unfiled.length },
		...folderEntries.map(([folderId, folder]) => ({
			id: folderId,
			label: folder.name || folderId,
			count: (folder.posts || []).length,
		})),
	]
	for (const tab of tabSpecs) {
		const button = document.createElement('button')
		button.type = 'button'
		button.className = `saved-folder-tab${savedFilter === tab.id ? ' active' : ''}`
		button.dataset.savedFilter = tab.id
		button.setAttribute('role', 'tab')
		button.setAttribute('aria-selected', savedFilter === tab.id ? 'true' : 'false')
		button.innerHTML = `
			<span class="saved-folder-tab-label">${escapeHtml(tab.label)}</span>
			<span class="saved-folder-tab-count">${tab.count}</span>
		`
		tabs.appendChild(button)
	}
	panel.appendChild(tabs)

	const listHost = document.createElement('div')
	listHost.className = 'saved-list'
	panel.appendChild(listHost)

	/**
	 * @param {object[]} refs 引用
	 * @param {string | undefined} folderId 文件夹
	 * @param {string} [folderName] 角标名
	 * @returns {object[]} 过滤后
	 */
	const filterRefs = (refs, folderId, folderName) => {
		const out = []
		for (const ref of refs || []) {
			if (!matchesSavedQuery(ref, query)) continue
			out.push({ ref, folderId, folderName })
		}
		return out
	}

	if (query) {
		/** @type {{ ref: object, folderId?: string, folderName?: string }[]} */
		const hits = []
		if (savedFilter === 'all' || savedFilter === 'unfiled')
			hits.push(...filterRefs(unfiled, undefined, geti18n('social.saved.unfiled')))
		for (const [folderId, folder] of folderEntries) {
			if (savedFilter !== 'all' && savedFilter !== folderId) continue
			hits.push(...filterRefs(folder.posts, folderId, folder.name || folderId))
		}
		if (!hits.length) {
			listHost.innerHTML = `
				<div class="saved-empty saved-empty-compact">
					<span class="s-ic s-ic-search saved-empty-icon" aria-hidden="true"></span>
					<p>${escapeHtml(geti18n('social.saved.searchEmpty'))}</p>
				</div>
			`
			return
		}
		for (const hit of hits)
			listHost.appendChild(buildSavedRow(hit.ref, hit.folderId, savedFilter === 'all' ? hit.folderName : undefined))
		return
	}

	/**
	 * @param {string} title 标题
	 * @param {object[]} refs 引用
	 * @param {{ folderId?: string }} [opts] 选项
	 */
	const appendSection = (title, refs, opts = {}) => {
		const section = buildSavedSection(title, refs.length, {
			folderId: opts.folderId,
			emptyKey: 'social.saved.folderEmpty',
		})
		const sectionList = section.querySelector('.saved-section-list')
		for (const ref of refs)
			sectionList?.appendChild(buildSavedRow(ref, opts.folderId))
		listHost.appendChild(section)
	}

	if (savedFilter === 'all') {
		for (const [folderId, folder] of folderEntries)
			appendSection(folder.name || folderId, folder.posts || [], { folderId })
		appendSection(geti18n('social.saved.unfiled'), unfiled)
		return
	}

	if (savedFilter === 'unfiled') {
		appendSection(geti18n('social.saved.unfiled'), unfiled)
		return
	}

	const folder = folders[savedFilter]
	if (folder)
		appendSection(folder.name || savedFilter, folder.posts || [], { folderId: savedFilter })
}

/**
 * 加载并渲染收藏帖与文件夹视图。
 * @returns {Promise<void>}
 */
export async function loadSaved() {
	bindSavedSearch()
	const createButton = document.getElementById('createFolderButton')
	if (createButton) {
		const label = geti18n('social.saved.createFolder')
		createButton.setAttribute('aria-label', label)
		createButton.setAttribute('title', label)
	}
	const data = await socialApi('/saved-posts')
	savedCache = data
	socialState.savedFoldersCache = data.folders || {}
	renderSavedPanel()
}
