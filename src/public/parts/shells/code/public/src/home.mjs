/**
 * 左上角「工作区 / 对话」两栏弹窗：浏览工作区、打开/删除对话、移除工作区。
 */
import { geti18n } from '/scripts/i18n/index.mjs'
import { svgInliner } from '/scripts/lib/svgInliner.mjs'

import { iconElement, icons } from './icons.mjs'
import { openFolderBrowser, removeWorkspaceById } from './pills.mjs'
import { deleteSessionPermanently, formatSessionTime, openSessionTab, refreshAllSessions } from './session.mjs'
import { store } from './store.mjs'
import { openDialogFromTemplate } from './templates.mjs'

/** 当前打开的弹窗（关闭后置空）。 */
let dialog = null
/** 右栏当前展示的工作区 id。 */
let selectedWorkspaceId = ''

/** 打开工作区 / 对话总览弹窗。 */
export async function openHomePicker() {
	await openDialogFromTemplate('home_picker', {}, {
		/**
		 * 弹窗就绪：初始化选中工作区并挂载浏览/关闭行为。
		 * @param {HTMLDialogElement} dom - 对话框元素。
		 * @returns {void}
		 */
		onReady: dom => {
			dialog = dom
			selectedWorkspaceId = store.workspace?.id || store.workspaces[0]?.id || ''
			dom.querySelector('#home-browse-button').addEventListener('click', () => {
				dom.close()
				void openFolderBrowser()
			})
			dom.querySelector('#home-search').addEventListener('input', renderHomePicker)
			dom.addEventListener('close', () => { dialog = null })
			renderHomePicker()
			void refreshAllSessions().then(refreshHomePicker)
		},
	})
}

/** 弹窗打开时按当前数据重渲染（语言切换 / 数据刷新）。 */
export function refreshHomePicker() {
	if (dialog?.open) renderHomePicker()
}

/**
 * 创建空态行。
 * @param {string} i18nKey - 文案键。
 * @returns {HTMLLIElement} 行。
 */
function emptyRow(i18nKey) {
	const listItem = document.createElement('li')
	listItem.className = 'code-home-empty'
	const span = document.createElement('span')
	span.dataset.i18n = i18nKey
	listItem.appendChild(span)
	return listItem
}

/**
 * 行外壳：主按钮 + 删除按钮。
 * @param {HTMLButtonElement} main - 主按钮。
 * @param {string} deleteAria - 删除按钮 aria-label。
 * @param {() => void} onDelete - 删除回调。
 * @returns {HTMLLIElement} 行。
 */
function rowShell(main, deleteAria, onDelete) {
	const listItem = document.createElement('li')
	listItem.className = 'code-home-row'
	const remove = document.createElement('button')
	remove.type = 'button'
	remove.className = 'code-home-row-delete'
	remove.setAttribute('aria-label', deleteAria)
	remove.appendChild(iconElement(icons.trash, { size: 14 }))
	remove.addEventListener('click', event => {
		event.stopPropagation()
		onDelete()
	})
	listItem.append(main, remove)
	return listItem
}

/**
 * 创建工作区行。
 * @param {object} workspace - 工作区。
 * @returns {HTMLLIElement} 行。
 */
function workspaceRow(workspace) {
	const main = document.createElement('button')
	main.type = 'button'
	main.className = 'code-home-row-main' + (workspace.id === selectedWorkspaceId ? ' active' : '')
	const name = document.createElement('span')
	name.className = 'code-home-row-title'
	name.setAttribute('user-content', '')
	name.textContent = workspace.name || workspace.path
	const path = document.createElement('span')
	path.className = 'code-home-row-sub'
	path.setAttribute('user-content', '')
	path.textContent = workspace.path
	main.append(name, path)
	main.addEventListener('click', () => {
		selectedWorkspaceId = workspace.id
		renderHomePicker()
	})
	return rowShell(main, geti18n('code.workspaces.remove'), () => void removeWorkspaceById(workspace.id).then(() => renderHomePicker()))
}

/**
 * 创建会话行。
 * @param {object} session - 聚合会话摘要。
 * @returns {HTMLLIElement} 行。
 */
function sessionRow(session) {
	const main = document.createElement('button')
	main.type = 'button'
	main.className = 'code-home-row-main'
	const title = document.createElement('span')
	title.className = 'code-home-row-title'
	title.setAttribute('user-content', '')
	title.textContent = session.title || geti18n('code.sessions.untitled')
	const time = document.createElement('span')
	time.className = 'code-home-row-sub'
	time.textContent = formatSessionTime(session.updated || session.created)
	main.append(title, time)
	main.addEventListener('click', () => {
		dialog?.close()
		void openSessionTab(session)
	})
	return rowShell(main, geti18n('code.sessions.delete'), () => void deleteSessionPermanently(session).then(removed => { if (removed) renderHomePicker() }))
}

/** 渲染弹窗两栏内容（搜索词同时过滤工作区与右栏会话）。 */
function renderHomePicker() {
	if (!dialog) return
	const workspaceList = dialog.querySelector('#home-workspace-list')
	const sessionList = dialog.querySelector('#home-session-list')
	if (!store.workspaces.length) {
		workspaceList.replaceChildren(emptyRow('code.home.emptyWorkspaces'))
		sessionList.replaceChildren()
		return
	}
	const term = (dialog.querySelector('#home-search').value || '').trim().toLowerCase()
	/**
	 * 工作区是否匹配搜索词（名称 / 路径子串，忽略大小写）。
	 * @param {object} workspace - 工作区。
	 * @returns {boolean} 是否匹配。
	 */
	const matchWorkspace = workspace => !term
		|| (workspace.name || '').toLowerCase().includes(term)
		|| (workspace.path || '').toLowerCase().includes(term)
	const visibleWorkspaces = store.workspaces.filter(matchWorkspace)
	// 选中项被过滤掉时落到首个可见工作区，右栏始终跟随一个有效工作区
	if (!visibleWorkspaces.some(workspace => workspace.id === selectedWorkspaceId))
		selectedWorkspaceId = visibleWorkspaces[0]?.id || ''
	workspaceList.replaceChildren(...visibleWorkspaces.length
		? visibleWorkspaces.map(workspaceRow)
		: [emptyRow(term ? 'code.home.noMatch' : 'code.home.emptyWorkspaces')])
	const sessions = store.allSessions
		.filter(session => session.workspaceId === selectedWorkspaceId)
		.filter(session => !term || (session.title || '').toLowerCase().includes(term))
	sessionList.replaceChildren(...sessions.length
		? sessions.map(sessionRow)
		: [emptyRow(term ? 'code.home.noMatch' : 'code.workspaces.overviewEmpty')])
	void svgInliner(dialog)
}
