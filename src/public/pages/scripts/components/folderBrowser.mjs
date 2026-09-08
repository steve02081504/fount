/**
 * 通用文件夹 / 文件选择器对话框组件。
 *
 * 用法：
 *   import { openFolderBrowser } from '/scripts/components/folderBrowser.mjs'
 *   openFolderBrowser({
 *     browse: (path, workspace) => api.browseMachine(machine, path, workspace),
 *     onSelect: async path => { /* 选中路径后做什么 *​/ },
 *     dirsOnly: true,
 *     initialWorkspace: store.workspace?.path || '',
 *     onError: error => showToastI18n('error', 'util.folderBrowser.error', { error: String(error.message || error) }),
 *   })
 */
import { openDialogFromTemplate } from '../features/templates.mjs'

/* ---------------- 状态 ---------------- */

/** 当前打开的对话框。 */
let dialog = null
/** 当前显示的可选条目 {name, path, isDirectory, isFile}。 */
let entries = []
/** 过滤后的可选条目（键盘导航 / 回车使用）。 */
let filtered = []
/** 高亮下标（对应 filtered）。 */
let highlight = 0
/** 后端返回的快速访问项（根视图分组）。 */
let quickAccess = []
/** 当前视图路径（与输入框值比对，区分「过滤词」与「当前目录路径」）。 */
let viewPath = ''
/** 输入框当前是否处于「编辑路径」状态（目录部分已偏离当前视图，高亮取消、回车跳转）。 */
let navigating = false
/** 是否仅显示文件夹（隐藏文件）。 */
let dirsOnly = false
/** 浏览请求序号（防止陈旧结果覆盖新导航状态）。 */
let browseSequence = 0

/**
 * 目录数据源（打开时注入）。
 * @param {string} path - 目录路径（空 = 根视图）。
 * @param {string} workspace - 根视图快速访问的工作区路径。
 * @returns {Promise<{path: string, entries: Array<object>, quickAccess?: Array<object>}>} 目录内容。
 */
let browse = async () => ({ path: '', entries: [], quickAccess: [] })
/**
 * 选中当前路径回调（打开时注入）。
 * @param {string} path - 选定的路径。
 * @returns {void|Promise<void>} 选中处理结果（可异步）。
 */
let onSelect = () => {}
/**
 * 出错处理（打开时注入）。
 * @param {Error} error - 错误。
 * @returns {void}
 */
let onError = () => {}

/* ---------------- 对话框生命周期 ---------------- */

/**
 * 打开文件夹 / 文件选择器对话框。
 * @param {object} options - 配置。
 * @param {(path: string, workspace?: string) => Promise<{path: string, entries: Array<{name: string, path: string, isDirectory: boolean, isFile: boolean}>, quickAccess?: Array<{name: string, path: string, isDirectory: boolean}>}>} options.browse - 目录数据源（path 空 = 根视图）。
 * @param {(path: string) => void|Promise<void>} [options.onSelect] - 选中当前路径回调。
 * @param {boolean} [options.dirsOnly=false] - 仅显示文件夹（隐藏文件）。
 * @param {string} [options.initialWorkspace=''] - 根视图快速访问的工作区路径。
 * @param {(error: Error) => void} [options.onError] - 出错处理（默认忽略）。
 * @returns {Promise<void>} 对话框打开完成。
 */
export async function openFolderBrowser(options) {
	browse = options.browse
	onSelect = options.onSelect || (() => {})
	onError = options.onError || (() => {})
	dirsOnly = Boolean(options.dirsOnly)
	try {
		dialog = await openDialogFromTemplate('folder_browser', {}, {
			/**
			 * 绑定浏览操作并加载根目录。
			 * @param {HTMLDialogElement} dialogElement - 已打开的对话框。
			 * @returns {Promise<void>} 根目录加载完成。
			 */
			onReady: dialogElement => {
				dialogElement.querySelector('#folder-go-button').addEventListener('click', () => {
					void openEntries(dialogElement.querySelector('#folder-path-input').value, dialogElement)
				})
				const input = dialogElement.querySelector('#folder-path-input')
				input.addEventListener('input', () => {
					highlight = 0
					renderList(dialogElement)
				})
				input.addEventListener('keydown', event => {
					if (navigating) {
						// 编辑路径状态：方向键不移动选中，回车跳转到输入路径
						if (event.key === 'ArrowDown' || event.key === 'ArrowUp') return
						if (event.key === 'Enter') {
							event.preventDefault()
							void openEntries(event.currentTarget.value, dialogElement)
						}
						return
					}
					if (event.key === 'ArrowDown') {
						event.preventDefault()
						if (!filtered.length) return
						highlight = Math.min(highlight + 1, filtered.length - 1)
						renderList(dialogElement)
					}
					else if (event.key === 'ArrowUp') {
						event.preventDefault()
						if (!filtered.length) return
						highlight = Math.max(highlight - 1, 0)
						renderList(dialogElement)
					}
					else if (event.key === 'Enter') {
						event.preventDefault()
						const target = filtered[highlight]
						if (target) enterEntry(target, dialogElement)
						else void openEntries(event.currentTarget.value, dialogElement)
					}
				})
				dialogElement.querySelector('#folder-select-button').addEventListener('click', () => {
					dialogElement.close()
					void Promise.resolve(onSelect(dialogElement.querySelector('#folder-path-input').value)).catch(onError)
				})
				// 先弹框显示加载占位，数据到达后再渲染（根视图含慢速的后端快速访问构建）
				showStatus(dialogElement, 'util.folderBrowser.loading')
				void openEntries('', dialogElement, options.initialWorkspace || '')
			},
		})
	}
	catch (error) {
		dialog = null
		onError(error)
	}
}

/**
 * 列出目录内容。
 * @param {string} path - 目录路径。
 * @param {HTMLDialogElement} [dialogElement] - 对话框（缺省用当前打开的）。
 * @param {string} [workspaceParam] - 根视图快速访问的工作区路径。
 * @returns {Promise<void>}
 */
async function openEntries(path, dialogElement = dialog, workspaceParam = '') {
	if (!dialogElement) return
	const seq = ++browseSequence
	try {
		const data = await browse(path, workspaceParam)
		if (seq !== browseSequence) return
		quickAccess = data.quickAccess || []
		viewPath = data.path
		entries = !data.path ? [...quickAccess, ...data.entries] : data.entries
		highlight = 0
		dialogElement.querySelector('#folder-path-input').value = data.path
		renderList(dialogElement)
	}
	catch (error) {
		if (seq !== browseSequence) return
		onError(error)
		showStatus(dialogElement, 'util.folderBrowser.error')
	}
}

/**
 * 在条目容器中显示状态占位（加载中 / 出错，data-i18n 文案 + daisyUI loading ring）。
 * @param {HTMLDialogElement} dialogElement - 对话框。
 * @param {string} i18nKey - i18n 键（`util.folderBrowser.loading` / `util.folderBrowser.error`）。
 * @returns {void}
 */
function showStatus(dialogElement, i18nKey) {
	const container = dialogElement.querySelector('#folder-entries')
	container.replaceChildren()
	const status = document.createElement('div')
	status.className = 'folder-browser-status'
	const spinner = document.createElement('span')
	spinner.className = 'loading loading-ring loading-sm'
	status.append(spinner)
	const label = document.createElement('span')
	label.dataset.i18n = i18nKey
	status.append(label)
	container.append(status)
}

/**
 * 进入条目：目录则打开，非仅目录模式下点选文件即选中（键盘 Enter 与鼠标单击/双击共用）。
 * @param {{name: string, path: string, isDirectory: boolean, isFile?: boolean}} entry - 条目。
 * @param {HTMLDialogElement} dialogElement - 对话框。
 * @returns {void}
 */
function enterEntry(entry, dialogElement) {
	if (entry.isDirectory) void openEntries(entry.path)
	else if (!dirsOnly && entry.isFile) {
		dialogElement.close()
		void Promise.resolve(onSelect(entry.path)).catch(onError)
	}
}

/**
 * 渲染条目列表（基于输入框过滤词；高亮项滚动可见，根视图快速访问分组）。
 * @param {HTMLDialogElement} [dialogElement] - 对话框（缺省用当前打开的）。
 * @returns {void}
 */
function renderList(dialogElement = dialog) {
	if (!dialogElement) return
	const input = dialogElement.querySelector('#folder-path-input')
	const container = dialogElement.querySelector('#folder-entries')
	const raw = input.value
	// 编辑路径状态：输入含路径分隔符，且目录部分（最后一个 / 或 \ 之前）已偏离当前视图路径 → 取消选中，回车跳转
	const lastSep = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
	const dirPart = lastSep === -1 ? '' : raw.slice(0, lastSep)
	navigating = lastSep !== -1 && raw !== viewPath && dirPart !== viewPath
	const term = navigating || raw === viewPath ? '' : raw.split(/[\\/]/).pop().trim()
	const baseEntries = dirsOnly ? entries.filter(entry => entry.isDirectory || entry.path === viewPath) : entries
	const shown = term
		? baseEntries.filter(entry => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(entry.name))
		: baseEntries
	filtered = shown
	// 编辑路径状态下取消选中（回车跳转而非进入选中项）；否则恢复高亮
	highlight = navigating ? -1 : shown.length ? Math.min(Math.max(highlight, 0), shown.length - 1) : -1
	container.replaceChildren()
	if (!shown.length) {
		const empty = document.createElement('div')
		empty.className = 'folder-browser-empty'
		empty.dataset.i18n = 'util.folderBrowser.noMatch'
		container.append(empty)
		return
	}
	const grouped = !term && !viewPath && quickAccess.length > 0
	const quickSet = new Set(quickAccess.map(item => item.path))
	const quick = grouped ? shown.filter(entry => quickSet.has(entry.path)) : []
	const rest = grouped ? shown.filter(entry => !quickSet.has(entry.path)) : []
	/**
	 * 渲染单个条目按钮（高亮项滚动可见）。
	 * @param {{name: string, path: string, isDirectory: boolean}} entry - 条目。
	 * @returns {void}
	 */
	const appendEntry = entry => {
		const row = document.createElement('button')
		row.type = 'button'
		row.className = 'folder-browser-entry' + (filtered[highlight] === entry ? ' active' : '')
		// 目录/文件名是用户数据，跳过语种轮换的脚本检查（路径含简体汉字在 ja/en 轮换时误报）
		row.setAttribute('user-content', '')
		row.textContent = (entry.isDirectory ? '📁 ' : '📄 ') + entry.name
		/**
		 * 进入目录（单击 / 双击）；非仅目录模式下点选文件即选中。
		 * @returns {void}
		 */
		const enter = () => enterEntry(entry, dialogElement)
		row.addEventListener('click', enter)
		row.addEventListener('dblclick', enter)
		container.append(row)
		if (filtered[highlight] === entry) row.scrollIntoView({ block: 'nearest' })
	}
	/**
	 * 渲染分组标题（data-i18n 随语种切换自动更新）。
	 * @param {string} key - i18n 键。
	 * @returns {void}
	 */
	const appendGroup = key => {
		const heading = document.createElement('div')
		heading.className = 'folder-browser-group'
		heading.dataset.i18n = key
		container.append(heading)
	}
	if (grouped) {
		if (quick.length) {
			appendGroup('util.folderBrowser.quickAccess')
			quick.forEach(appendEntry)
		}
		if (rest.length) {
			appendGroup('util.folderBrowser.roots')
			rest.forEach(appendEntry)
		}
	}
	else shown.forEach(appendEntry)
}

/* ---------------- 全局样式注入 ---------------- */

{
	const link = document.createElement('link')
	link.rel = 'stylesheet'
	link.href = new URL('./folderBrowser.css', import.meta.url).href
	document.head.prepend(link)
}
