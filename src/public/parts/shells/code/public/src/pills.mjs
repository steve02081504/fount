/**
 * Pill 选择器：机器 / 工作区 / mode / AI 源 / shell / 角色，含文件夹浏览器与工作区角色推荐。
 */
import { getPartList, runPart } from '/scripts/endpoints/parts.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

import { ensureHistory, removeGhost } from './composer.mjs'
import * as api from './endpoints.mjs'
import { renderMessages } from './messages.mjs'
import { activateDraftForWorkspace, activeTab, refreshAllSessions, renderHomeMenu, renderTabs, saveTabPrefs, startNewSession, tabKeyOf } from './session.mjs'
import { elements, setPref, store, target } from './store.mjs'
import { openDialogFromTemplate, renderTemplate } from './templates.mjs'

/* ---------------- pill 镀铬（模板渲染，boot 中挂载） ---------------- */

/** 角色 pill 菜单底部固定项。 */
const CHAR_MENU_FOOTER = `
<li id="char-switch-item"><button id="char-switch-button" data-i18n="code.char.switch"></button></li>
<li><a id="char-settings-link" data-i18n="code.char.settings" href="#"></a></li>
<li><a data-i18n="code.char.goodAgent" href="https://steve02081504.github.io/fount/blog/" target="_blank" rel="noopener"></a></li>`

/** pill 规格（name 参与 id 拼接；key 为元素引用后缀）。 */
const PILL_SPECS = [
	{ name: 'mode', menuClass: 'w-48' },
	{ name: 'ai-source', menuClass: 'w-64' },
	{ name: 'shell', menuClass: 'w-48', hidden: true },
	{ name: 'machine', menuClass: 'w-64' },
	{ name: 'workspace', menuClass: 'w-64' },
	{ name: 'char', menuClass: 'w-64', footer: CHAR_MENU_FOOTER },
]

/** 挂载全部 pill 下拉（模板渲染）并补全元素引用。 */
export async function mountPillChrome() {
	// hidden / footer 必须始终传入：模板 ${} 表达式引用未定义变量会让 async_eval 抛 ReferenceError
	const pills = await Promise.all(PILL_SPECS.map(spec => renderTemplate('pill_dropdown', { hidden: false, footer: '', ...spec })))
	elements.composerControlsMain.append(pills[0], pills[1], pills[2])
	elements.composerTargets.append(pills[3], pills[4], pills[5])
	/**
	 * 按 id 取元素。
	 * @param {string} id - 元素 id。
	 * @returns {HTMLElement} 元素。
	 */
	const byId = id => document.getElementById(id)
	for (const spec of PILL_SPECS) {
		const key = spec.name === 'ai-source' ? 'aiSource' : spec.name
		elements[`${key}PillWrap`] = byId(`${spec.name}-pill-wrap`)
		elements[`${key}Pill`] = byId(`${spec.name}-pill`)
		elements[`${key}PillLabel`] = byId(`${spec.name}-pill-label`)
		elements[`${key}Menu`] = byId(`${spec.name}-menu`)
	}
	elements.charSwitchButton = byId('char-switch-button')
	elements.charSettingsLink = byId('char-settings-link')
}

/* ---------------- 机器 / shell ---------------- */

/** 渲染机器 pill 下拉。 */
export function renderMachineMenu() {
	elements.machineMenu.replaceChildren(...store.machines.map(machine => {
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'menu-item' + (String(machine.id) === store.machine ? ' active' : '')
		button.textContent = machine.id === '0'
			? geti18n('code.machine.local')
			: `${machine.description || machine.deviceInfo?.hostname || `#${machine.id}`}${machine.isConnected ? '' : ' (' + geti18n('code.machine.offline') + ')'}`
		button.disabled = machine.id !== '0' && !machine.isConnected
		button.addEventListener('click', () => {
			document.activeElement?.blur()
			void selectMachine(String(machine.id))
		})
		li.appendChild(button)
		return li
	}))
}

/** 更新机器 pill 标签。 */
export function renderMachinePillLabel() {
	const machine = store.machines.find(m => String(m.id) === store.machine)
	elements.machinePillLabel.textContent = machine?.id === '0'
		? geti18n('code.machine.local')
		: (machine?.description || machine?.deviceInfo?.hostname || `#${store.machine}`) + (machine?.isConnected === false ? ` (${geti18n('code.machine.offline')})` : '')
}

/**
 * 应用机器变更。
 * @param {string} id - 机器 id。
 * @returns {Promise<void>}
 */
async function selectMachine(id) {
	store.machine = id
	setPref('machine', id)
	await loadShellOptions(id)
	renderShellMenu()
	renderShellPillLabel()
	renderMachinePillLabel()
	renderMachineMenu()
}

/**
 * 加载目标机器 shell 列表，并把选中 shell 默认定为该机器的默认项。
 * @param {string} machine - 机器 id。
 * @returns {Promise<void>}
 */
export async function loadShellOptions(machine) {
	const data = await api.getMachineShells(machine).catch(() => ({ shells: [], default: '' }))
	store.shells = data.shells || []
	store.shell = data.default || store.shells[0] || ''
}

/* ---------------- 工作区 ---------------- */

/** 渲染工作区 pill 下拉（列表 + 浏览/移除）。 */
export function renderWorkspaceMenu() {
	elements.workspaceMenu.replaceChildren()
	const list = store.workspaces
	if (list.length) {
		list.forEach(workspace => {
			const li = document.createElement('li')
			const button = document.createElement('button')
			button.type = 'button'
			button.className = 'menu-item' + (store.workspace?.id === workspace.id ? ' active' : '')
			const name = document.createElement('span')
			name.textContent = workspace.name || workspace.path
			const path = document.createElement('span')
			path.className = 'opacity-60 text-xs'
			path.textContent = workspace.path
			button.append(name, path)
			button.addEventListener('click', () => {
				document.activeElement?.blur()
				void selectWorkspace(workspace.id)
			})
			li.appendChild(button)
			elements.workspaceMenu.appendChild(li)
		})
		const separatorLi = document.createElement('li')
		const separator = document.createElement('div')
		separator.className = 'divider my-1'
		separatorLi.appendChild(separator)
		elements.workspaceMenu.appendChild(separatorLi)
	}
	const browseLi = document.createElement('li')
	const browseBtn = document.createElement('button')
	browseBtn.type = 'button'
	browseBtn.className = 'menu-item'
	browseBtn.textContent = geti18n('code.workspaces.browse')
	browseBtn.addEventListener('click', () => {
		document.activeElement?.blur()
		void openFolderBrowser()
	})
	browseLi.appendChild(browseBtn)
	elements.workspaceMenu.appendChild(browseLi)
	if (store.workspace) {
		const removeLi = document.createElement('li')
		const removeBtn = document.createElement('button')
		removeBtn.type = 'button'
		removeBtn.className = 'menu-item text-error'
		removeBtn.textContent = geti18n('code.workspaces.remove')
		removeBtn.addEventListener('click', () => {
			document.activeElement?.blur()
			void removeCurrentWorkspace()
		})
		removeLi.appendChild(removeBtn)
		elements.workspaceMenu.appendChild(removeLi)
	}
}

/** 更新工作区 pill 标签。 */
export function renderWorkspacePillLabel() {
	elements.workspacePillLabel.textContent = store.workspace?.name || store.workspace?.path || geti18n('code.workspaces.none')
}

/**
 * 选择工作区（标签切换复用；底部 pill 切换后落到该工作区的草稿标签）。
 * @param {string} id - 工作区 id。
 * @param {{fromTabSwitch?: boolean}} [options] - 标签切换内部调用时不激活草稿。
 * @returns {Promise<void>}
 */
export async function selectWorkspace(id, { fromTabSwitch = false } = {}) {
	const workspace = store.workspaces.find(w => w.id === id)
	if (!workspace) return
	// 缓存当前会话，避免工作区切换丢失未保存内容
	const current = activeTab()
	if (current && store.session) store.sessionCache.set(tabKeyOf(current), store.session)
	store.workspace = workspace
	if (workspace.machine !== store.machine) {
		store.machine = String(workspace.machine)
		setPref('machine', store.machine)
		await loadShellOptions(store.machine)
		renderMachinePillLabel()
		renderMachineMenu()
		renderShellMenu()
		renderShellPillLabel()
	}
	setPref('workspace', store.workspace.id)
	store.session = null
	store.historyState.mode = null
	store.historyNav.pos = null
	removeGhost()
	await Promise.all([refreshAllSessions(), refreshProfiles()])
	renderMessages()
	renderWorkspacePillLabel()
	renderWorkspaceMenu()
	renderHomeMenu()
	renderTabs()
	void ensureHistory(store.shellMode ? 'shell' : 'message')
	void applyWorkspaceCharConfig()
	if (!fromTabSwitch) await activateDraftForWorkspace(workspace.id)
}

/** 移除当前工作区。 */
async function removeCurrentWorkspace() {
	if (!store.workspace) return
	const removedId = store.workspace.id
	store.workspaces = store.workspaces.filter(w => w.id !== removedId)
	await api.removeWorkspace(removedId).catch(() => { })
	store.workspace = null
	setPref('workspace', '')
	// 丢弃指向该工作区的标签；活动标签被移除时清空会话视图
	store.tabs = store.tabs.filter(tab => tab.workspaceId !== removedId)
	if (store.activeTabKey && !activeTab()) {
		store.activeTabKey = ''
		store.session = null
	}
	store.dirtyTabKey = ''
	renderWorkspacePillLabel()
	renderWorkspaceMenu()
	renderHomeMenu()
	await Promise.all([refreshAllSessions(), refreshProfiles()])
	renderTabs()
	saveTabPrefs()
	renderMessages()
	if (!store.activeTabKey) await startNewSession()
}

/** 渲染 shell pill 下拉（! 模式）。 */
export function renderShellMenu() {
	elements.shellMenu.replaceChildren(...(store.shells.length ? store.shells : ['']).map(shell => {
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'menu-item' + (shell === store.shell ? ' active' : '')
		button.textContent = shell || geti18n('code.composer.shellDefault')
		// 无可用 shell 时仅留占位项（执行时按目标机器默认 shell）
		button.disabled = !shell
		button.addEventListener('click', () => {
			document.activeElement?.blur()
			store.shell = shell
			// shell 变更后重读原生历史
			store.historyState.mode = null
			void ensureHistory('shell')
			renderShellMenu()
			renderShellPillLabel()
		})
		li.appendChild(button)
		return li
	}))
}

/** 更新 shell pill 标签。 */
export function renderShellPillLabel() {
	elements.shellPillLabel.textContent = store.shell || geti18n('code.composer.shellDefault')
}

/* ---------------- mode / AI 源 ---------------- */

/** 刷新 profile 与 commands。 */
export async function refreshProfiles() {
	if (!store.workspace) {
		store.profiles = [{ name: 'plan', source: 'builtin', description: '' }, { name: 'build', source: 'builtin', description: '' }]
		store.commands = []
	}
	else
		try {
			const data = await api.getProfiles(target())
			store.profiles = data.profiles
			store.commands = data.commands
		}
		catch {
			store.profiles = []
			store.commands = []
		}

	renderModeMenu()
	renderModePillLabel()
}

/** 渲染 mode/profile pill 下拉。 */
export function renderModeMenu() {
	elements.modeMenu.replaceChildren(...store.profiles.map(profile => {
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'menu-item' + (profile.name === store.profile ? ' active' : '')
		button.textContent = profile.name + (profile.source === 'builtin' ? '' : ` (${profile.source})`)
		button.addEventListener('click', () => {
			document.activeElement?.blur()
			store.profile = profile.name
			setPref('profile', store.profile)
			renderModeMenu()
			renderModePillLabel()
		})
		li.appendChild(button)
		return li
	}))
}

/** 更新 mode pill 标签。 */
export function renderModePillLabel() {
	elements.modePillLabel.textContent = store.profile
}

/** Tab 键轮换 mode（溢出归 0），并给出可见反馈。 */
export function cycleMode() {
	if (!store.profiles.length) return
	const index = store.profiles.findIndex(p => p.name === store.profile)
	store.profile = store.profiles[(index + 1) % store.profiles.length]?.name || 'build'
	setPref('profile', store.profile)
	renderModeMenu()
	renderModePillLabel()
	showToastI18n('info', 'code.composer.modeSwitched', { mode: store.profile })
}

/** 刷新 AI 源列表。 */
export async function refreshAiSources() {
	try {
		const data = await api.getAiSources()
		store.aiSources = data.sources
		store.aiDefaults = data.defaults || []
		store.aiHidden = data.hidden || []
	}
	catch {
		store.aiSources = []
		store.aiHidden = []
	}
	renderAiSourceMenu()
	renderAiSourcePillLabel()
}

/**
 * 渲染 AI 源 pill 下拉。
 * @returns {void}
 */
export function renderAiSourceMenu() {
	const visible = store.aiSources.filter(name => !store.aiHidden.includes(name))
	/**
	 * 渲染单个 AI 源菜单项。
	 * @param {string} name - 源名。
	 * @returns {HTMLLIElement} 菜单项。
	 */
	const item = name => {
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'menu-item' + (name === store.aiSource ? ' active' : '')
		button.textContent = name + (store.aiDefaults?.includes(name) ? ' ★' : '')
		button.addEventListener('click', () => {
			document.activeElement?.blur()
			store.aiSource = name
			setPref('aiSource', store.aiSource)
			renderAiSourceMenu()
			renderAiSourcePillLabel()
		})
		li.appendChild(button)
		return li
	}
	/**
	 * 渲染菜单分隔线。
	 * @returns {HTMLLIElement} 分隔行。
	 */
	const separator = () => {
		const li = document.createElement('li')
		const div = document.createElement('div')
		div.className = 'divider my-1'
		li.appendChild(div)
		return li
	}
	elements.aiSourceMenu.replaceChildren(...visible.map(item),
		(() => {
			const li = document.createElement('li')
			const button = document.createElement('button')
			button.type = 'button'
			button.className = 'menu-item' + (!store.aiSource ? ' active' : '')
			button.textContent = geti18n('code.aiSource.charOwn')
			button.addEventListener('click', () => {
				document.activeElement?.blur()
				store.aiSource = ''
				setPref('aiSource', '')
				renderAiSourceMenu()
				renderAiSourcePillLabel()
			})
			li.appendChild(button)
			return li
		})(), separator(),
		(() => {
			const li = document.createElement('li')
			const button = document.createElement('button')
			button.type = 'button'
			button.className = 'menu-item'
			button.textContent = geti18n('code.aiSource.manage')
			button.addEventListener('click', () => {
				document.activeElement?.blur()
				void openAiSourcePanel()
			})
			li.appendChild(button)
			return li
		})())
}

/** 更新 AI 源 pill 标签。 */
export function renderAiSourcePillLabel() {
	elements.aiSourcePillLabel.textContent = store.aiSource || geti18n('code.aiSource.charOwn')
}

/**
 * 渲染 AI 源可见性管理面板。
 * @param {HTMLDialogElement} dialog - 已打开的对话框。
 * @returns {void}
 */
function renderAiSourcePanel(dialog) {
	const list = dialog.querySelector('#ai-source-list')
	list.replaceChildren(...store.aiSources.map(name => {
		const row = document.createElement('label')
		row.className = 'ai-source-row'
		const checkbox = document.createElement('input')
		checkbox.type = 'checkbox'
		checkbox.className = 'checkbox checkbox-sm'
		checkbox.checked = !store.aiHidden.includes(name)
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) store.aiHidden = store.aiHidden.filter(n => n !== name)
			else store.aiHidden = [...store.aiHidden, name]
			api.setAiSourceVisibility(store.aiHidden).then(() => {
				renderAiSourceMenu()
				renderAiSourcePillLabel()
			}).catch(() => { })
		})
		const text = document.createElement('span')
		text.textContent = name
		row.append(checkbox, text)
		return row
	}))
}

/** 打开 AI 源可见性管理面板。 */
async function openAiSourcePanel() {
	try {
		await openDialogFromTemplate('ai_source_panel', {}, { onReady: renderAiSourcePanel })
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/* ---------------- 角色 ---------------- */

/** 更新角色 pill 显示。 */
export function updateCharMenu() {
	elements.charPillLabel.textContent = store.charname || geti18n('code.char.none')
	elements.charSettingsLink.href = `/parts/shells:config/?partpath=${encodeURIComponent('chars/' + (store.charname || ''))}`
}

/** 刷新角色列表。 */
export async function refreshChars() {
	store.chars = await getPartList('chars').catch(() => [])
}

/**
 * 渲染角色切换列表。
 * @param {HTMLDialogElement} dialog - 已打开的对话框。
 * @returns {void}
 */
function renderCharSwitchList(dialog) {
	const list = dialog.querySelector('#char-switch-list')
	list.replaceChildren(...store.chars.map(name => {
		const option = document.createElement('button')
		option.type = 'button'
		option.className = 'char-option hover:bg-base-300/90' + (name === store.charname ? ' active' : '')
		option.textContent = name
		option.addEventListener('click', () => {
			store.charname = name
			setPref('charname', name)
			updateCharMenu()
			renderMessages()
			dialog.close()
		})
		return option
	}))
}

/** 打开角色切换对话框。 */
export async function openCharSwitchDialog() {
	try {
		await openDialogFromTemplate('char_switch', {}, { onReady: renderCharSwitchList })
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/* ---------------- 工作区角色覆盖 / 推荐 ---------------- */

/** 当前角色推荐卡（右下角）与配置（语言切换时按当前语种重建卡片）。 */
let recommendationCard = null
let recommendationSpec = null

/** 仅移除推荐卡 DOM（保留配置，供语言切换重建）。 */
function removeRecommendationCard() {
	recommendationCard?.remove()
	recommendationCard = null
}

/** 收起角色推荐卡（并清除配置，语言切换不再重建）。 */
function dismissCharRecommendation() {
	removeRecommendationCard()
	recommendationSpec = null
}

/** 按当前语种渲染角色推荐卡。 */
export function renderCharRecommendation() {
	removeRecommendationCard()
	const spec = recommendationSpec
	if (!spec?.partname) return
	// 固定悬浮卡片需包裹 `<nav>` 地标（axe region 规则要求内容在地标内）
	const card = document.createElement('nav')
	card.className = 'code-char-recommend hidden border border-primary/40 rounded-box bg-base-100 shadow-xl'
	card.setAttribute('aria-label', geti18n('code.char.recommendAria'))
	const text = document.createElement('div')
	text.className = 'code-char-recommend-text'
	text.setAttribute('user-content', '')
	text.textContent = geti18n('code.char.recommend', { charname: spec.partname })
	const actions = document.createElement('div')
	actions.className = 'code-char-recommend-actions'
	const installBtn = document.createElement('button')
	installBtn.type = 'button'
	installBtn.className = 'btn btn-xs btn-primary'
	installBtn.textContent = geti18n('code.char.recommendInstall')
	installBtn.addEventListener('click', () => void installRecommendedChar(spec))
	const closeBtn = document.createElement('button')
	closeBtn.type = 'button'
	closeBtn.className = 'btn btn-xs btn-ghost'
	closeBtn.textContent = geti18n('code.char.recommendDismiss')
	closeBtn.addEventListener('click', dismissCharRecommendation)
	actions.append(installBtn, closeBtn)
	card.append(text, actions)
	document.body.appendChild(card)
	recommendationCard = card
	requestAnimationFrame(() => card.classList.remove('hidden'))
}

/**
 * 安装工作区推荐角色。
 * @param {{partname: string, install_url?: string}} spec - 推荐配置。
 * @returns {Promise<void>}
 */
async function installRecommendedChar(spec) {
	try {
		await runPart('shells/install', ['install', spec.install_url || spec.partname])
		await refreshChars()
		if (store.chars.includes(spec.partname)) {
			store.charname = spec.partname
			setPref('charname', spec.partname)
			updateCharMenu()
		}
		showToastI18n('success', 'code.char.recommendInstalled', { charname: spec.partname })
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
	finally {
		dismissCharRecommendation()
	}
}

/**
 * 展示右下角角色推荐卡（未安装时）。
 * @param {{partname: string, install_url?: string}} spec - 推荐配置。
 * @returns {void}
 */
function showCharRecommendation(spec) {
	recommendationSpec = spec
	renderCharRecommendation()
}

/** 应用工作区角色配置（已安装自动选中；未安装右下角推荐）。 */
export async function applyWorkspaceCharConfig() {
	if (!store.workspace) return
	const config = await api.getWorkspaceConfig(target()).catch(() => ({}))
	const spec = config.char
	if (!spec?.partname) return
	if (store.chars.includes(spec.partname)) {
		store.charname = spec.partname
		setPref('charname', spec.partname)
		updateCharMenu()
		renderMessages()
	}
	else showCharRecommendation(spec)
}

/* ---------------- 文件夹浏览器 ---------------- */

/** 当前浏览的机器 id。 */
let browseMachineId = '0'
/** @type {HTMLDialogElement|null} 当前打开的浏览对话框。 */
let browseDialog = null

/** 打开文件夹浏览器（当前机器）。 */
export async function openFolderBrowser() {
	browseMachineId = store.machine
	try {
		browseDialog = await openDialogFromTemplate('folder_browser', {}, {
			/**
			 * 绑定浏览操作并加载根目录。
			 * @param {HTMLDialogElement} dialog - 已打开的对话框。
			 * @returns {Promise<void>} 根目录加载完成。
			 */
			onReady: dialog => {
				dialog.querySelector('#folder-go-button').addEventListener('click', () => {
					void openFolderEntries(dialog.querySelector('#folder-path-input').value)
				})
				dialog.querySelector('#folder-path-input').addEventListener('keydown', event => {
					if (event.key === 'Enter') void openFolderEntries(event.currentTarget.value)
				})
				dialog.querySelector('#folder-select-button').addEventListener('click', () => {
					void selectBrowsedFolder(dialog.querySelector('#folder-path-input').value)
				})
				return openFolderEntries('')
			},
		})
	}
	catch (error) {
		browseDialog = null
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/**
 * 列出目录内容。
 * @param {string} path - 目录路径。
 * @returns {Promise<void>}
 */
async function openFolderEntries(path) {
	const dialog = browseDialog
	if (!dialog) return
	try {
		const data = await api.browseMachine(browseMachineId, path)
		dialog.querySelector('#folder-path-input').value = data.path
		dialog.querySelector('#folder-entries').replaceChildren(...data.entries.map(entry => {
			const row = document.createElement('button')
			row.type = 'button'
			row.className = 'code-folder-entry hover:bg-base-300/90'
			row.textContent = (entry.isDirectory ? '📁 ' : '📄 ') + entry.name
			row.addEventListener('click', () => {
				if (entry.isDirectory) void openFolderEntries(entry.path)
			})
			row.addEventListener('dblclick', () => {
				if (entry.isFile) void openFolderEntries(data.path.replace(/[^\\/]+$/, ''))
			})
			return row
		}))
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/**
 * 选定当前目录为工作区。
 * @param {string} path - 目录路径。
 * @returns {Promise<void>}
 */
async function selectBrowsedFolder(path) {
	const dialog = browseDialog
	if (!path || !dialog) return
	const machine = browseMachineId
	const name = path.split(/[\\/]/).filter(Boolean).pop() || path
	const data = await api.addWorkspace({ name, machine, path }).catch(error => {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
		return null
	})
	if (!data) return
	store.workspaces = data.list
	store.workspace = store.workspaces.find(w => w.path === path && w.machine === machine) || null
	renderWorkspacePillLabel()
	renderWorkspaceMenu()
	renderHomeMenu()
	dialog.close()
	await selectWorkspace(store.workspace?.id || '')
}
