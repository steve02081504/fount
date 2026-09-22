/**
 * 【文件】src/public/parts/plugins/async-task/registry.mjs
 * 【职责】通用异步任务注册表的纯内存实现：登记后台任务、列出/等待（all|any）、完成后投递通知并即刻释放。
 * 【原理】任意生产者（sub-agent、code-execution）把后台 Promise 交给 registerTask 换取统一 id；任务完成时若尚未被 <await-async> 消费，
 *   就按其所属频道投递完成通知（根频道尝试主动触发角色回复，子代落入待注入队列），随后从注册表删除——已完成任务不留存。
 *   本模块不 import `src/server/**`，只依赖全局 `AbortController` / `crypto`，因此可在 `test/pure` 零 I/O 直接测试。
 * 【数据结构】asyncTask_t；任务表 `Map<id, task>`；频道注册表 `Map<agentKey, args[]>`；待注入通知 `Map<queueKey, entry[]>`。
 * 【关联】prompt.mjs 注入工具说明与通知；handler.mjs 解析 `<list-async>` / `<await-async>`；sub-agent/runtime.mjs 与 code-execution/handler.mjs 注册任务。
 */

/**
 * @typedef {object} asyncTaskOwner_t
 * @property {string} [username] 所属用户
 * @property {string} [charId] 所属角色
 * @property {string} [chatName] 派生该任务的频道名
 * @property {string | null} [parentRunId] 父异步任务 id（根任务为 null）
 */

/**
 * @typedef {object} asyncTask_t
 * @property {string} id 统一异步资源 id
 * @property {string} kind 任务类型（如 `subagent` / `js` / `pwsh`）
 * @property {string} label 人类可读标签（通常为任务预览）
 * @property {asyncTaskOwner_t} owner 归属
 * @property {'running' | 'done' | 'failed'} state 状态
 * @property {unknown} result 任务结果
 * @property {{ name?: string, message: string } | null} error 失败信息
 * @property {number} startedAt 开始时间
 * @property {number | null} finishedAt 结束时间
 * @property {boolean} consumed 是否已被 `<await-async>` 消费（消费后不再投递通知）
 * @property {boolean} notified 是否已投递完成通知
 * @property {Promise<asyncTask_t>} done 完成 Promise（结算为任务自身）
 * @property {object} meta 生产者附加数据
 * @property {(task: asyncTask_t) => string} [format] 自定义完成通知文本
 */

/** 任务注册表（仅内存）。 @type {Map<string, asyncTask_t>} */
const tasks = new Map()

/** 活跃频道注册表：`${username}|${charId}` -> 最近的 chatReplyRequest（最新在前）。 @type {Map<string, object[]>} */
const channelRegistry = new Map()

/** 待注入通知队列：queueKey -> chatLogEntry 队列。 @type {Map<string, object[]>} */
const pendingNotifications = new Map()

/** 统一异步工具是否已由插件 Load 启用。 */
let toolingEnabled = false

/** 任务生命周期通知器（由插件 Load 注入，仅内存；宿主 shell 据此实时刷新任务卡）。 @type {((event: { phase: 'start' | 'settle', task: object }) => void) | null} */
let notifier = null

/**
 * 标记统一异步工具是否可用（由 async-task 插件 Load 置位）。
 * @param {boolean} value 是否启用
 * @returns {void}
 */
export function setAsyncToolingEnabled(value) {
	toolingEnabled = Boolean(value)
}

/**
 * 注入任务生命周期通知器（start / settle 各触发一次）。
 * @param {((event: { phase: 'start' | 'settle', task: object }) => void) | null} fn 通知器
 * @returns {void}
 */
export function setAsyncTaskNotifier(fn) {
	notifier = typeof fn === 'function' ? fn : null
}

/**
 * 构造可序列化的任务视图（不含 `done` / `run` 等不可序列化字段）。
 * @param {asyncTask_t} task 任务
 * @returns {object} 视图
 */
function taskView(task) {
	return {
		id: task.id,
		kind: task.kind,
		label: task.label,
		state: task.state,
		owner: task.owner,
		startedAt: task.startedAt,
		finishedAt: task.finishedAt,
		error: task.error,
		meta: task.meta,
	}
}

/**
 * 触发任务生命周期通知（尽力而为，绝不打断任务本身）。
 * @param {'start' | 'settle'} phase 阶段
 * @param {asyncTask_t} task 任务
 * @returns {void}
 */
function emitTaskEvent(phase, task) {
	if (!notifier) return
	try {
		notifier({ phase, task: taskView(task) })
	}
	catch (error) {
		console.warn('async-task: 生命周期通知失败', error)
	}
}

/**
 * 查询统一异步工具是否可用（未加载 async-task 插件时生产者应拒绝 `async`）。
 * @returns {boolean} 是否可用
 */
export function isAsyncToolingEnabled() {
	return toolingEnabled
}

/**
 * 由请求上下文推导任务归属。
 * @param {object} args chatReplyRequest
 * @returns {asyncTaskOwner_t} 归属
 */
export function ownerFromArgs(args) {
	return {
		username: args?.username,
		charId: args?.char_id,
		chatName: args?.chat_name ?? '',
		parentRunId: args?.extension?.subAgent?.runId ?? null,
	}
}

/**
 * 判断任务是否匹配过滤条件（未给出的字段不参与过滤）。
 * @param {asyncTask_t} task 任务
 * @param {object} [filter] 过滤条件
 * @returns {boolean} 是否匹配
 */
function matchesFilter(task, filter = {}) {
	const owner = task.owner ?? {}
	return (filter.username === undefined || owner.username === filter.username) &&
		(filter.charId === undefined || owner.charId === filter.charId) &&
		(filter.chatName === undefined || owner.chatName === filter.chatName) &&
		(filter.parentRunId === undefined || (owner.parentRunId ?? null) === filter.parentRunId) &&
		(filter.kind === undefined || task.kind === filter.kind) &&
		(filter.state === undefined || task.state === filter.state)
}

/**
 * 规范化错误对象。
 * @param {unknown} error 原始错误
 * @returns {{ name?: string, message: string }} 规范化错误
 */
function normalizeError(error) {
	if (error && typeof error === 'object')
		return { name: /** @type {any} */ error.name, message: /** @type {any} */ error.message ?? String(error) }
	return { message: String(error) }
}

/**
 * 登记一个后台任务。
 *
 * `run` 抛错或返回 rejected Promise 时任务转为 `failed`；无论成败都会在（未被消费时）投递一次通知后从注册表移除。
 * @param {object} options 登记参数
 * @param {string} [options.id] 指定 id（缺省随机生成）
 * @param {string} options.kind 任务类型
 * @param {string} [options.label] 人类可读标签
 * @param {asyncTaskOwner_t} [options.owner] 归属
 * @param {() => Promise<unknown>} options.run 后台执行函数
 * @param {object} [options.meta] 附加数据
 * @param {(task: asyncTask_t) => string} [options.format] 自定义完成通知文本
 * @returns {asyncTask_t} 任务对象
 */
export function registerTask({ id, kind, label = '', owner = {}, run, meta = {}, format }) {
	/** @type {asyncTask_t} */
	const task = {
		id: id ?? crypto.randomUUID(),
		kind,
		label,
		owner,
		state: 'running',
		result: undefined,
		error: null,
		startedAt: Date.now(),
		finishedAt: null,
		consumed: false,
		notified: false,
		done: /** @type {any} */ null,
		meta,
		format,
	}
	tasks.set(task.id, task)
	emitTaskEvent('start', task)
	task.done = Promise.resolve()
		.then(run)
		.then(
			result => finishTask(task, 'done', result, null),
			error => finishTask(task, 'failed', undefined, normalizeError(error)),
		)
	return task
}

/**
 * 结算任务：写入终态，（未被消费时）投递通知，然后从注册表移除。
 * @param {asyncTask_t} task 任务
 * @param {'done' | 'failed'} state 终态
 * @param {unknown} result 结果
 * @param {{ name?: string, message: string } | null} error 错误
 * @returns {asyncTask_t} 任务自身
 */
function finishTask(task, state, result, error) {
	if (task.finishedAt !== null) return task
	task.state = state
	task.result = result
	task.error = error
	task.finishedAt = Date.now()
	if (!task.consumed)
		void deliverNotification(task).catch(err => console.warn('async-task: 完成通知投递失败', err))
	tasks.delete(task.id)
	emitTaskEvent('settle', task)
	return task
}

/**
 * 生成默认完成通知文本。
 * @param {asyncTask_t} task 任务
 * @returns {string} 通知文本
 */
function defaultNotificationText(task) {
	const lines = [
		`[async-task] 后台任务 ${task.id}（类型：${task.kind}）已结束，状态：${task.state}。`,
	]
	if (task.label) lines.push(`任务：${task.label}`)
	if (task.state === 'failed') lines.push(`错误：${task.error?.message ?? '未知错误'}`)
	else lines.push(`结果：\n${truncate(task.result)}`)
	return lines.join('\n')
}

/**
 * 构造通知条目。
 * @param {asyncTask_t} task 任务
 * @returns {object} chatLogEntry 形状
 */
function makeNotificationEntry(task) {
	let text
	try {
		text = task.format ? task.format(task) : defaultNotificationText(task)
	}
	catch {
		text = defaultNotificationText(task)
	}
	return {
		name: 'async-task',
		uid: 'system',
		role: 'system',
		content: text,
		files: [],
	}
}

/**
 * 截断长文本用于通知。
 * @param {unknown} value 值
 * @param {number} [limit] 上限
 * @returns {string} 截断文本
 */
function truncate(value, limit = 4000) {
	const text = typeof value === 'string' ? value : inspectValue(value)
	return text.length > limit ? `${text.slice(0, limit)}\n…（已截断 ${text.length - limit} 字符）` : text
}

/**
 * 把任意结果转为可读文本。
 * @param {unknown} value 值
 * @returns {string} 文本
 */
function inspectValue(value) {
	if (value == null) return ''
	if (typeof value === 'string') return value
	try { return JSON.stringify(value, null, '\t') }
	catch { return String(value) }
}

/**
 * 投递任务完成通知：根任务优先尝试主动触发其所属聊天线程的角色回复，子任务或找不到该线程的活跃频道时落入待注入队列。
 * @param {asyncTask_t} task 任务
 * @returns {Promise<void>}
 */
async function deliverNotification(task) {
	const entry = makeNotificationEntry(task)
	const { username, charId, chatName, parentRunId } = task.owner ?? {}

	if (!parentRunId) {
		const channel = getChannels(username, charId).find(candidate => candidate.chat_name === chatName) ?? null
		if (channel) try {
			const updated = await channel.Update?.() ?? channel
			if (updated?.AddChatLogEntry && updated?.char?.interfaces?.chat?.GetReply) {
				const reply = await updated.char.interfaces.chat.GetReply({
					...updated,
					chat_log: [...updated.chat_log ?? [], entry],
				})
				if (reply) {
					reply.logContextBefore ??= []
					reply.logContextBefore.push(entry)
					await updated.AddChatLogEntry({ name: updated.Charname, ...reply })
					task.notified = true
					return
				}
			}
		}
		catch (error) {
			console.warn('async-task: 主动通知失败，回退待注入队列', error)
		}
	}

	pushPendingNotification({ username, charId, chatName, parentRunId: parentRunId ?? null }, entry)
	task.notified = true
}

/**
 * 读取一个任务（已完成并被回收则返回 undefined）。
 * @param {string} id 任务 id
 * @returns {asyncTask_t | undefined} 任务
 */
export function getTask(id) {
	return tasks.get(id)
}

/**
 * 列出任务（可按归属/类型/状态过滤）。
 * @param {object} [filter] 过滤条件
 * @returns {asyncTask_t[]} 任务列表（按开始时间升序）
 */
export function listTasks(filter = {}) {
	return [...tasks.values()]
		.filter(task => matchesFilter(task, filter))
		.sort((a, b) => a.startedAt - b.startedAt)
}

/**
 * 按归属查询任务：把 owner 的 `username` / `charId` / `chatName` / `parentRunId` 直接展开为过滤条件，
 * 供 shell 或其它 part 做「某线程/某运行进行中的任务」薄封装，避免各自手拼 `listTasks` 过滤对象。
 * 未给出的 owner 字段不参与过滤；根归属（`parentRunId` 为空）只返回根任务。
 * @param {asyncTaskOwner_t} [owner] 归属
 * @param {object} [filter] 额外过滤条件（`kind` / `state`）
 * @returns {asyncTask_t[]} 任务列表（按开始时间升序）
 */
export function listTasksForOwner(owner = {}, filter = {}) {
	return listTasks({
		username: owner.username,
		charId: owner.charId,
		chatName: owner.chatName,
		parentRunId: owner.parentRunId ?? null,
		...filter,
	})
}

/**
 * 等待一个或多个任务：`all` 等全部、`any` 等任一；等待中的任务标记为已消费（不再重复通知）。
 * @param {string[]} ids 任务 id 列表
 * @param {object} [options] 选项
 * @param {'all' | 'any'} [options.mode='all'] 等待模式
 * @param {number | null} [options.timeoutMs=null] 超时毫秒；null 表示不限时
 * @param {AbortSignal} [options.signal] 中断信号
 * @returns {Promise<{ settled: asyncTask_t[], pending: string[], unknown: string[], timedOut: boolean }>} 等待结果
 */
export async function awaitTasks(ids, { mode = 'all', timeoutMs = null, signal } = {}) {
	const unique = [...new Set((ids ?? []).map(String).filter(Boolean))]
	const known = []
	const unknown = []
	for (const id of unique) {
		const task = tasks.get(id)
		if (task) {
			task.consumed = true
			known.push(task)
		}
		else unknown.push(id)
	}
	if (!known.length) return { settled: [], pending: [...unique], unknown, timedOut: false }

	/** @type {Promise<unknown>[]} */
	const waits = known.map(task => Promise.resolve(task.done).then(() => task, () => task))
	const completion = mode === 'any' ? Promise.race(waits) : Promise.all(waits)

	let timedOut = false
	if (timeoutMs === null && !signal)
		await completion
	else {
		/** @type {Promise<unknown>[]} */
		const racers = [completion]
		let timer = null
		if (timeoutMs !== null)
			racers.push(new Promise(resolve => { timer = setTimeout(() => { timedOut = true; resolve(null) }, Math.max(0, timeoutMs)) }))
		if (signal)
			racers.push(new Promise(resolve => {
				if (signal.aborted) resolve(null)
				else signal.addEventListener('abort', () => resolve(null), { once: true })
			}))
		try { await Promise.race(racers) }
		finally { if (timer) clearTimeout(timer) }
	}

	// 等待期间置 consumed 仅为抑制竞态通知；结束后把仍未结算的任务复位，
	// 使其日后完成时仍会投递通知（已结算者保持消费，不再重复通知）。
	for (const task of known)
		if (task.finishedAt === null) task.consumed = false

	const settled = known.filter(task => task.finishedAt !== null)
	const pending = known.filter(task => task.finishedAt === null).map(task => task.id)
	return { settled, pending, unknown, timedOut }
}

/**
 * 注册（或刷新）一个活跃频道。
 *
 * 按用户/角色分桶、桶内按 `chat_name` 去重并保留最近 5 个聊天线程；投递时按 `chat_name` 精确取用，
 * 找不到对应线程的频道则退回该线程的待注入队列（见 `deliverNotification`），故无需按线程建键。
 * @param {string} username 用户
 * @param {string} charId 角色 id
 * @param {object} channel chatReplyRequest 请求上下文
 * @returns {void}
 */
export function registerChannel(username, charId, channel) {
	const key = `${username}|${charId}`
	const channels = channelRegistry.get(key) ?? []
	const deduped = channels.filter(candidate => candidate.chat_name !== channel.chat_name)
	deduped.unshift(channel)
	channelRegistry.set(key, deduped.slice(0, 5))
}

/**
 * 获取某用户/角色的活跃频道（最新在前）。
 * @param {string} username 用户
 * @param {string} charId 角色 id
 * @returns {object[]} 频道列表
 */
export function getChannels(username, charId) {
	return channelRegistry.get(`${username}|${charId}`) ?? []
}

/**
 * 计算待注入队列键：子任务按运行 id 隔离，根任务按聊天线程隔离（避免同一角色不同聊天串台）。
 * @param {asyncTaskOwner_t} target 目标
 * @returns {string} 队列键
 */
export function notificationQueueKey(target) {
	if (target?.parentRunId) return `run|${target.parentRunId}`
	return target?.chatName
		? `root|${target.username}|${target.charId}|${target.chatName}`
		: `root|${target.username}|${target.charId}`
}

/**
 * 存入一条待注入通知（用于父代下次 GetPrompt 注入）。
 * @param {asyncTaskOwner_t} target 目标
 * @param {object} entry chatLogEntry 形状的纯对象
 * @returns {void}
 */
export function pushPendingNotification(target, entry) {
	const key = notificationQueueKey(target)
	const queue = pendingNotifications.get(key) ?? []
	queue.push(entry)
	pendingNotifications.set(key, queue)
}

/**
 * 取走（并清空）某目标的所有待注入通知。
 * @param {asyncTaskOwner_t} target 目标
 * @returns {object[]} 通知列表
 */
export function takePendingNotifications(target) {
	const key = notificationQueueKey(target)
	const queue = pendingNotifications.get(key)
	if (!queue?.length) return []
	pendingNotifications.delete(key)
	return queue
}

/**
 * 清空全部内存状态（仅供测试）。
 * @returns {void}
 */
export function resetAsyncTaskState() {
	tasks.clear()
	channelRegistry.clear()
	pendingNotifications.clear()
	toolingEnabled = false
	notifier = null
}
