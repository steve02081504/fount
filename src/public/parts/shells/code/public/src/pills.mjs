/**
 * Pill 选择器：机器 / 工作区 / mode / AI 源 / shell / 角色，含文件夹浏览器与工作区角色推荐。
 */
import { getPartList, runPart } from '/scripts/endpoints/parts.mjs'
import { confirmAction } from '/scripts/features/promptDialog.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { openFolderBrowser as openFolderBrowserComponent } from '/scripts/components/folderBrowser.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

import { ensureHistory, removeGhost } from './composer.mjs'
import * as api from './endpoints.mjs'
import { renderMessages } from './messages.mjs'
import { activateDraftForWorkspace, activeTab, refreshAllSessions, renderTabs, saveTabPrefs, startNewSession, tabKeyOf } from './session.mjs'
import { elements, setPref, store, target } from './store.mjs'
import { openDialogFromTemplate, renderTemplate } from './templates.mjs'

/* ---------------- pill 镀铬（模板渲染，boot 中挂载） ---------------- */

/** pill 规格（name 参与 id 拼接；key 为元素引用后缀）。 */
const PILL_SPECS = [
	{ name: 'mode', menuClass: 'w-48' },
	{ name: 'ai-source', menuClass: 'w-64' },
	{ name: 'shell', menuClass: 'w-48', hidden: true },
	{ name: 'machine', menuClass: 'w-64' },
	{ name: 'workspace', menuClass: 'w-64' },
	{ name: 'char', menuClass: 'w-64' },
]

/** 挂载全部 pill 下拉（模板渲染）并补全元素引用。 */
export async function mountPillChrome() {
	// hidden 必须始终传入：模板 ${} 表达式引用未定义变量会让 async_eval 抛 ReferenceError
	const pills = await Promise.all(PILL_SPECS.map(spec => renderTemplate('pill_dropdown', { hidden: false, ...spec })))
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
	elements.charMenu.append(await renderTemplate('char_menu_footer'))
	elements.charSwitchButton = byId('char-switch-button')
	elements.charSettingsLink = byId('char-settings-link')
}

/* ---------------- 菜单项 / 分隔线 ---------------- */

/**
 * 创建菜单项（li > button.menu-item，点击后收起下拉）。
 * @param {string|Array<string|Node>} text - 项文本（字符串或节点数组，用于多段内容）。
 * @param {{active?: boolean, onClick?: () => void, disabled?: boolean, className?: string, i18nKey?: string}} [options] - 行为与样式选项。
 * @returns {HTMLLIElement} 菜单行。
 */
function menuItem(text, { active = false, onClick, disabled = false, className = '', i18nKey = '' } = {}) {
	const listItem = document.createElement('li')
	const button = document.createElement('button')
	button.type = 'button'
	button.className = 'menu-item' + (active ? ' active' : '') + (className ? ` ${className}` : '')
	button.disabled = disabled
	if (i18nKey) button.dataset.i18n = i18nKey
	else if (text != null)
		for (const node of Array.isArray(text) ? text : [text]) button.append(node)
	button.addEventListener('click', () => {
		document.activeElement?.blur()
		onClick?.()
	})
	listItem.appendChild(button)
	return listItem
}

/**
 * 创建菜单分隔线。
 * @returns {HTMLLIElement} 分隔行。
 */
function menuSeparator() {
	const listItem = document.createElement('li')
	const divider = document.createElement('div')
	divider.className = 'divider my-1'
	listItem.appendChild(divider)
	return listItem
}

/* ---------------- 机器 / shell ---------------- */

/**
 * 机器展示名（本机走 i18n，远程用描述 / 主机名，离线附标记）。
 * @param {object} machine - 机器条目。
 * @returns {string} 展示名。
 */
function machineDisplayName(machine) {
	if (!machine) return ''
	if (String(machine.id) === '0') return geti18n('code.machine.local')
	const name = machine.description || machine.deviceInfo?.hostname || `#${machine.id}`
	return machine.isConnected === false ? `${name} (${geti18n('code.machine.offline')})` : name
}

/** 渲染机器 pill 下拉。 */
export function renderMachineMenu() {
	elements.machineMenu.replaceChildren(...store.machines.map(machine =>
		menuItem(machineDisplayName(machine), {
			active: String(machine.id) === store.machine,
			disabled: machine.id !== '0' && !machine.isConnected,
			/**
			 * 选中该机器。
			 * @returns {void}
			 */
			onClick: () => void selectMachine(String(machine.id)),
		})
	))
}

/** 更新机器 pill 标签。 */
export function renderMachinePillLabel() {
	const machine = store.machines.find(m => String(m.id) === store.machine)
	// 机器列表未就绪时保留 `#id` 兜底，避免标签空置（按钮无可访问名称）
	elements.machinePillLabel.textContent = machine ? machineDisplayName(machine) : `#${store.machine}`
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

/* ---------------- 任务完成后的自动电源操作 ---------------- */

/** 从后端刷新待执行电源操作并更新按钮。 */
export async function refreshShutdownState() {
	try {
		const data = await api.getShutdown()
		store.shutdownActions = data.actions || {}
		store.shutdownActive = data.active || 0
	}
	catch {
		store.shutdownActions = {}
		store.shutdownActive = 0
	}
	renderPowerButton()
}

/** 更新电源操作按钮（文案 + 启用态配色）。 */
export function renderPowerButton() {
	const button = elements.powerSettingsButton
	const count = Object.keys(store.shutdownActions || {}).length
	button.textContent = count
		? geti18n('code.power.armedCount', { count })
		: geti18n('code.power.settings.button')
	button.setAttribute('aria-label', count
		? geti18n('code.power.armedAria', { count })
		: geti18n('code.power.settings.aria'))
	button.classList.toggle('btn-warning', count > 0)
	button.classList.toggle('btn-ghost', count === 0)
}

/** 打开「任务完成后的自动操作」设置对话框。 */
export async function openPowerSettings() {
	try {
		await openDialogFromTemplate('power_settings', {}, { onReady: renderPowerSettings })
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/**
 * 渲染设置对话框中的主机行（每台主机独立选择操作）。
 * @param {HTMLDialogElement} dialog - 已打开的对话框。
 * @returns {void}
 */
function renderPowerSettings(dialog) {
	const list = dialog.querySelector('#power-settings-list')
	list.replaceChildren(...store.machines.map(machine => {
		const id = String(machine.id)
		const row = document.createElement('div')
		row.className = 'code-power-row'
		const name = document.createElement('span')
		name.className = 'code-power-row-name'
		// 机器名称为用户动态数据，跳过语种扫描
		name.setAttribute('user-content', '')
		name.textContent = machineDisplayName(machine)
		const select = document.createElement('select')
		select.className = 'select select-sm'
		select.dataset.machineId = id
		select.disabled = id !== '0' && !machine.isConnected
		// 以下拉所在主机的名称作为可访问名称（用户动态数据，跳过语种扫描）
		select.setAttribute('aria-label', machineDisplayName(machine))
		select.setAttribute('user-content', 'aria-label')
		for (const value of ['', 'shutdown', 'sleep', 'restart']) {
			const option = document.createElement('option')
			option.value = value
			// 经 data-i18n 让选项在语种切换时由 i18n 观察器重译（而非一次性 geti18n 快照）
			option.dataset.i18n = value ? `code.power.action.${value}` : 'code.power.action.none'
			select.appendChild(option)
		}
		select.value = store.shutdownActions[id] || ''
		select.addEventListener('change', () => void applyPowerAction(id, select.value))
		row.append(name, select)
		return row
	}))
}

/**
 * 应用某主机的电源操作（空值 = 取消）。
 * @param {string} id - 主机 id。
 * @param {string} action - 操作（shutdown / sleep / restart）或空串。
 * @returns {Promise<void>}
 */
async function applyPowerAction(id, action) {
	try {
		const data = await api.setShutdown(id, action || null)
		store.shutdownActions = data.actions || {}
		store.shutdownActive = data.active || 0
		showToastI18n('info', action ? 'code.power.armedToast' : 'code.power.cancelled')
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
	renderPowerButton()
	syncPowerSelects()
}

/** 将设置对话框内各下拉同步为当前状态（不重建 DOM，避免抢焦点）。 */
function syncPowerSelects() {
	const list = document.getElementById('power-settings-list')
	if (!list) return
	for (const select of list.querySelectorAll('select[data-machine-id]'))
		select.value = store.shutdownActions[select.dataset.machineId] || ''
}

/* ---------------- 工作区 ---------------- */

/** 工作区下拉的搜索词（菜单重渲染时保留，输入框值与焦点不回跳）。 */
let workspaceFilterTerm = ''

/**
 * 工作区按常用程度排序：最近使用优先（lastUsedAt 降序），并列按名称。
 * @param {object} a - 工作区 a。
 * @param {object} b - 工作区 b。
 * @returns {number} 排序结果。
 */
function sortWorkspacesByUsage(a, b) {
	const ta = new Date(a.lastUsedAt || 0).getTime()
	const tb = new Date(b.lastUsedAt || 0).getTime()
	return tb - ta || String(a.name || a.path).localeCompare(String(b.name || b.path))
}

/** 渲染工作区 pill 下拉（搜索框置顶 + 常用程度排序 + 浏览/移除）。 */
export function renderWorkspaceMenu() {
	const menu = elements.workspaceMenu
	// 搜索输入框保持稳定（重建会丢焦点，daisyUI 下拉靠 :focus-within 展开，换元素会关菜单）；
	// 只在首建时插入，其后复用同一元素并同步搜索词
	let search = menu.querySelector('.code-workspace-search input')
	if (!search) {
		const searchItem = document.createElement('li')
		searchItem.className = 'code-workspace-search'
		search = document.createElement('input')
		search.type = 'search'
		search.className = 'input input-sm input-bordered w-full'
		search.addEventListener('input', () => {
			workspaceFilterTerm = search.value
			renderWorkspaceItems()
		})
		searchItem.appendChild(search)
		menu.appendChild(searchItem)
	}
	search.setAttribute('placeholder', geti18n('code.workspaces.search.placeholder'))
	search.setAttribute('aria-label', geti18n('code.workspaces.search.aria-label'))
	search.value = workspaceFilterTerm
	renderWorkspaceItems()
}

/** 重渲染工作区下拉的条目区（保留搜索输入框，聚焦不受影响）。 */
function renderWorkspaceItems() {
	const menu = elements.workspaceMenu
	const searchItem = menu.querySelector('.code-workspace-search')
	// 清掉搜索行之后的所有条目（replaceChildren 会连搜索框一起重建，改用逐项移除）
	while (searchItem?.nextSibling) searchItem.nextSibling.remove()
	const term = workspaceFilterTerm.trim().toLowerCase()
	/**
	 * 工作区是否匹配搜索词（名称 / 路径子串，忽略大小写）。
	 * @param {object} workspace - 工作区。
	 * @returns {boolean} 是否匹配。
	 */
	const matchWorkspace = workspace => !term
		|| (workspace.name || '').toLowerCase().includes(term)
		|| (workspace.path || '').toLowerCase().includes(term)
	const visible = [...store.workspaces].sort(sortWorkspacesByUsage).filter(matchWorkspace)
	if (visible.length) {
		visible.forEach(workspace => {
			const name = document.createElement('span')
			// 工作区名 / 路径为用户数据，跳过语种轮换扫描
			name.setAttribute('user-content', '')
			name.textContent = workspace.name || workspace.path
			const path = document.createElement('span')
			path.className = 'opacity-60 text-xs'
			path.setAttribute('user-content', '')
			path.textContent = workspace.path
			menu.appendChild(menuItem([name, path], {
				active: store.workspace?.id === workspace.id,
				/**
				 * 选中该工作区。
				 * @returns {void}
				 */
				onClick: () => void selectWorkspace(workspace.id),
			}))
		})
		menu.appendChild(menuSeparator())
	}
	menu.appendChild(menuItem('', {
		i18nKey: 'code.workspaces.browse',
		/**
		 * 打开文件夹浏览器。
		 * @returns {void}
		 */
		onClick: () => void openFolderBrowser(),
	}))
	if (store.workspace)
		menu.appendChild(menuItem(geti18n('code.workspaces.remove'), {
			className: 'text-error',
			/**
			 * 移除当前工作区。
			 * @returns {void}
			 */
			onClick: () => void removeCurrentWorkspace(),
		}))
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
	// 记录使用时间（本地即时更新 + 后端持久化），供工作区下拉按常用程度排序
	workspace.lastUsedAt = new Date().toISOString()
	void api.useWorkspace(id).catch(() => { })
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
	renderTabs()
	void ensureHistory(store.shellMode ? 'shell' : 'message')
	void applyWorkspaceCharConfig()
	if (!fromTabSwitch) await activateDraftForWorkspace(workspace.id)
}

/**
 * 移除指定工作区（确认后仅从保存列表移除；磁盘上的会话文件保留）。
 * @param {string} id - 工作区 id。
 * @returns {Promise<void>}
 */
export async function removeWorkspaceById(id) {
	const workspace = store.workspaces.find(w => w.id === id)
	if (!workspace) return
	if (!await confirmAction('code.workspaces.removeConfirm', { name: workspace.name || workspace.path })) return
	// 后端确认删除成功后才更新本地列表；失败则提示并保留现状
	try {
		await api.removeWorkspace(id)
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
		return
	}
	store.workspaces = store.workspaces.filter(w => w.id !== id)
	if (store.workspace?.id === id) {
		store.workspace = null
		setPref('workspace', '')
	}
	// 丢弃指向该工作区的标签；活动标签被移除时清空会话视图
	store.tabs = store.tabs.filter(tab => tab.workspaceId !== id)
	if (store.activeTabKey && !activeTab()) {
		store.activeTabKey = ''
		store.session = null
	}
	store.dirtyTabKey = ''
	renderWorkspacePillLabel()
	renderWorkspaceMenu()
	await Promise.all([refreshAllSessions(), refreshProfiles()])
	renderTabs()
	saveTabPrefs()
	renderMessages()
	if (!store.activeTabKey) await startNewSession()
}

/** 移除当前工作区。 */
async function removeCurrentWorkspace() {
	if (!store.workspace) return
	await removeWorkspaceById(store.workspace.id)
}

/** 渲染 shell pill 下拉（! 模式）。 */
export function renderShellMenu() {
	elements.shellMenu.replaceChildren(...(store.shells.length ? store.shells : ['']).map(shell => menuItem(shell || geti18n('code.composer.shellDefault'), {
		active: shell === store.shell,
		// 无可用 shell 时仅留占位项（执行时按目标机器默认 shell）
		disabled: !shell,
		/**
		 * 应用选中的 shell 并重读原生历史。
		 */
		onClick: () => {
			store.shell = shell
			// shell 变更后重读原生历史
			store.historyState.mode = null
			void ensureHistory('shell')
			renderShellMenu()
			renderShellPillLabel()
		},
	})))
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
	elements.modeMenu.replaceChildren(...store.profiles.map(profile => menuItem(profile.name + (profile.source === 'builtin' ? '' : ` (${profile.source})`), {
		active: profile.name === store.profile,
		/**
		 * 应用选中的 mode。
		 */
		onClick: () => {
			store.profile = profile.name
			setPref('profile', store.profile)
			renderModeMenu()
			renderModePillLabel()
		},
	})))
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
	elements.aiSourceMenu.replaceChildren(
		...visible.map(name => menuItem(name + (store.aiDefaults?.includes(name) ? ' ★' : ''), {
			active: name === store.aiSource,
			/**
			 * 切换选中的 AI 源。
			 */
			onClick: () => {
				store.aiSource = name
				setPref('aiSource', store.aiSource)
				renderAiSourceMenu()
				renderAiSourcePillLabel()
			},
		})),
		menuItem(geti18n('code.aiSource.charOwn'), {
			active: !store.aiSource,
			/**
			 * 使用角色自带的 AI 源。
			 */
			onClick: () => {
				store.aiSource = ''
				setPref('aiSource', '')
				renderAiSourceMenu()
				renderAiSourcePillLabel()
			},
		}),
		menuSeparator(),
		menuItem(geti18n('code.aiSource.manage'), {
			/**
			 * 打开 AI 源管理面板。
			 * @returns {void}
			 */
			onClick: () => void openAiSourcePanel(),
		}),
	)
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
	card.setAttribute('aria-label', geti18n('code.char.recommend.aria'))
	const text = document.createElement('div')
	text.className = 'code-char-recommend-text'
	text.setAttribute('user-content', '')
	text.textContent = geti18n('code.char.recommend.main', { charname: spec.partname })
	const actions = document.createElement('div')
	actions.className = 'code-char-recommend-actions'
	const installBtn = document.createElement('button')
	installBtn.type = 'button'
	installBtn.className = 'btn btn-xs btn-primary'
	installBtn.textContent = geti18n('code.char.recommend.install')
	installBtn.addEventListener('click', () => void installRecommendedChar(spec))
	const closeBtn = document.createElement('button')
	closeBtn.type = 'button'
	closeBtn.className = 'btn btn-xs btn-ghost'
	closeBtn.textContent = geti18n('code.char.recommend.dismiss')
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
		showToastI18n('success', 'code.char.recommend.installed', { charname: spec.partname })
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

/* ---------------- 文件夹浏览器（通用组件薄包装） ---------------- */

/** 打开文件夹浏览器（当前机器；仅显示文件夹，选定即保存为工作区）。 */
export async function openFolderBrowser() {
	await openFolderBrowserComponent({
		/**
		 * 浏览目录数据源。
		 * @param {string} path - 目录路径（空 = 根视图）。
		 * @param {string} workspace - 根视图快速访问的工作区路径。
		 * @returns {Promise<{path: string, entries: Array<object>, quickAccess?: Array<object>}>} 目录内容。
		 */
		browse: (path, workspace) => api.browseMachine(store.machine, path, workspace),
		dirsOnly: true,
		initialWorkspace: store.workspace?.path || '',
		/**
		 * 选定路径为工作区。
		 * @param {string} path - 选定的目录路径。
		 * @returns {Promise<void>}
		 */
		onSelect: async path => {
			if (!path) return
			const machine = store.machine
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
			await selectWorkspace(store.workspace?.id || '')
		},
		/**
		 * 出错处理。
		 * @param {Error} error - 错误。
		 * @returns {void}
		 */
		onError: error => showToastI18n('error', 'code.error.generic', { error: String(error.message || error) }),
	})
}
