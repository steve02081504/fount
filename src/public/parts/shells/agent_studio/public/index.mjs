/**
 * 【文件】public/index.mjs — agent_studio 页面逻辑
 * 【职责】渲染角色列表/概览、子代理运行、生成记录与生成链、保留策略，以及基准定义的增删改查与运行结果。
 * 【原理】全部 HTTP 经 `./src/endpoints.mjs` 命名导出；列表项经 `renderTemplate` 渲染；文本经 `geti18n` 本地化。
 * 【关联】public/src/endpoints.mjs、public/src/templates.mjs、public/index.html。
 */
import { showToastI18n } from '/scripts/features/toast.mjs'
import { confirmI18n, geti18n, initTranslations, promptI18n } from '/scripts/i18n/index.mjs'
import { applyTheme } from '/scripts/theme/index.mjs'

import {
	createBenchmark,
	deleteBenchmark,
	getBenchmark,
	getCharOverview,
	getGeneration,
	getRetention,
	getRun,
	listBenchmarks,
	listChars,
	listRuns,
	runBenchmark,
	setRetention,
	updateBenchmark,
} from './src/endpoints.mjs'
import { renderTemplate } from './src/templates.mjs'

/** 默认角色头像。 */
const DEFAULT_AVATAR = 'https://api.iconify.design/mdi/robot-outline.svg'
/** 毫秒 / 天。 */
const DAY_MS = 24 * 60 * 60 * 1000

const elements = {
	charList: document.getElementById('charList'),
	charListEmpty: document.getElementById('charListEmpty'),
	charDetailTitle: document.getElementById('charDetailTitle'),
	charDetailDescription: document.getElementById('charDetailDescription'),
	subAgentList: document.getElementById('subAgentList'),
	subAgentEmpty: document.getElementById('subAgentEmpty'),
	generationList: document.getElementById('generationList'),
	generationEmpty: document.getElementById('generationEmpty'),
	generationDetail: document.getElementById('generationDetail'),
	generationPrompt: document.getElementById('generationPrompt'),
	generationResponse: document.getElementById('generationResponse'),
	retentionPrompt: document.getElementById('retentionPrompt'),
	retentionConversation: document.getElementById('retentionConversation'),
	retentionSave: document.getElementById('retentionSave'),
	benchmarkList: document.getElementById('benchmarkList'),
	benchmarkEmpty: document.getElementById('benchmarkEmpty'),
	benchmarkDetail: document.getElementById('benchmarkDetail'),
	benchmarkTitle: document.getElementById('benchmarkTitle'),
	benchmarkCasesText: document.getElementById('benchmarkCasesText'),
	runCharSelect: document.getElementById('runCharSelect'),
	runJudgeSource: document.getElementById('runJudgeSource'),
	benchmarkStats: document.getElementById('benchmarkStats'),
	benchmarkResults: document.getElementById('benchmarkResults'),
	benchmarkResultsEmpty: document.getElementById('benchmarkResultsEmpty'),
	newBenchmarkButton: document.getElementById('newBenchmarkButton'),
	saveBenchmarkButton: document.getElementById('saveBenchmarkButton'),
	deleteBenchmarkButton: document.getElementById('deleteBenchmarkButton'),
	runBenchmarkButton: document.getElementById('runBenchmarkButton'),
}

/** @type {Array<{ id: string, info: object | null }>} */
let chars = []
/** @type {string | null} */
let activeCharId = null
/** @type {object[]} */
let benchmarks = []
/** @type {string | null} */
let activeBenchmarkId = null

/**
 * 把毫秒转换为天数（保留两位）。
 * @param {number} ms 毫秒
 * @returns {number} 天数
 */
function msToDays(ms) {
	return Math.round((ms / DAY_MS) * 100) / 100
}

/**
 * 把天数转换为毫秒。
 * @param {string} value 输入值
 * @returns {number} 毫秒
 */
function daysToMs(value) {
	const days = Number(value)
	return Number.isFinite(days) && days > 0 ? days * DAY_MS : 0
}

/**
 * 截断文本。
 * @param {unknown} value 原值
 * @param {number} [max] 最大长度
 * @returns {string} 截断后的文本
 */
function truncate(value, max = 80) {
	const text = String(value ?? '')
	return text.length > max ? text.slice(0, max) + '…' : text
}

/**
 * 取运行状态对应的徽章样式。
 * @param {string} state 状态
 * @returns {string} 徽章类名
 */
function stateBadge(state) {
	if (state === 'running' || state === 'summarizing') return 'badge-info'
	if (state === 'failed' || state === 'terminated') return 'badge-error'
	if (state === 'done') return 'badge-success'
	return 'badge-ghost'
}

/**
 * 渲染角色列表。
 * @returns {Promise<void>}
 */
async function renderCharList() {
	elements.charList.replaceChildren()
	for (const char of chars) {
		const info = char.info ?? {}
		const item = await renderTemplate('char_item', {
			id: char.id,
			avatar: info.avatar || DEFAULT_AVATAR,
			name: info.name || char.id,
			description: info.description || '',
		})
		item.addEventListener('click', () => selectChar(char.id))
		elements.charList.appendChild(item)
	}
	elements.charListEmpty.classList.toggle('hidden', chars.length > 0)
}

/**
 * 渲染子代理运行列表。
 * @param {object[]} runs 运行列表
 * @returns {Promise<void>}
 */
async function renderSubAgents(runs) {
	elements.subAgentList.replaceChildren()
	for (const run of runs || []) {
		const state = run.live?.state || (run.hasError ? 'failed' : 'done')
		const detail = geti18n('agent_studio.run.detail', {
			generations: run.generationIds?.length ?? 0,
			rounds: run.live?.rounds ?? 0,
			roundLimit: run.live?.roundLimit ?? '-',
		})
		const item = await renderTemplate('run_item', {
			runId: run.runId,
			state: geti18n(`agent_studio.run.state.${state}`),
			badgeClass: stateBadge(state),
			detail,
		})
		elements.subAgentList.appendChild(item)
	}
	elements.subAgentEmpty.classList.toggle('hidden', !!runs?.length)
}

/**
 * 渲染生成记录列表。
 * @param {object[]} records 记录摘要
 * @returns {Promise<void>}
 */
async function renderGenerations(records) {
	elements.generationList.replaceChildren()
	for (const record of records || []) {
		const item = await renderTemplate('generation_item', {
			id: record.id,
			preview: truncate(record.charname || record.conversationId || record.id),
			meta: `${record.source || ''} · ${record.model || ''} · ${new Date(record.startedAt || 0).toLocaleString()}`,
			status: record.hasError ? geti18n('agent_studio.generation.error') : geti18n('agent_studio.generation.ok'),
			badgeClass: record.hasError ? 'badge-error' : 'badge-ghost',
		})
		item.addEventListener('click', () => showGeneration(record.id))
		elements.generationList.appendChild(item)
	}
	elements.generationEmpty.classList.toggle('hidden', !!records?.length)
}

/**
 * 显示单条生成记录的输入与回复。
 * @param {string} id 记录 id
 * @returns {Promise<void>}
 */
async function showGeneration(id) {
	const record = await getGeneration(id)
	elements.generationPrompt.textContent = JSON.stringify(record.input ?? null, null, 2)
	const response = record.response
	elements.generationResponse.textContent = typeof response === 'string'
		? response
		: JSON.stringify(response ?? null, null, 2)
	elements.generationDetail.classList.remove('hidden')
}

/**
 * 选择角色并加载概览。
 * @param {string} charId 角色 id
 * @returns {Promise<void>}
 */
async function selectChar(charId) {
	activeCharId = charId
	for (const item of elements.charList.querySelectorAll('.char-item'))
		item.classList.toggle('active', item.dataset.charId === charId)
	elements.generationDetail.classList.add('hidden')
	const overview = await getCharOverview(charId, { limit: 50 })
	elements.charDetailTitle.textContent = overview.char.name || charId
	elements.charDetailDescription.textContent = overview.char.description || ''
	await renderSubAgents(overview.subAgents)
	await renderGenerations(overview.recentGenerations)
}

/**
 * 渲染基准定义列表。
 * @returns {Promise<void>}
 */
async function renderBenchmarkList() {
	elements.benchmarkList.replaceChildren()
	for (const benchmark of benchmarks) {
		const item = await renderTemplate('benchmark_item', {
			id: benchmark.id,
			name: benchmark.name,
			description: benchmark.description || '',
			caseCount: String(benchmark.caseCount ?? 0),
		})
		item.addEventListener('click', () => selectBenchmark(benchmark.id))
		elements.benchmarkList.appendChild(item)
	}
	elements.benchmarkEmpty.classList.toggle('hidden', benchmarks.length > 0)
}

/**
 * 渲染某次基准运行的结果。
 * @param {object} run 运行
 * @returns {Promise<void>}
 */
async function renderRunResults(run) {
	elements.benchmarkStats.textContent = run
		? geti18n('agent_studio.benchmarks.stats', {
			total: run.stats?.total ?? 0,
			empty: run.stats?.empty ?? 0,
			avgLength: run.stats?.avgLength ?? 0,
			avgScore: run.stats?.avgScore ?? '-',
			judged: run.stats?.judged ?? 0,
		})
		: ''
	elements.benchmarkResults.replaceChildren()
	const results = run?.results ?? []
	for (const result of results) {
		const score = result.judge?.score
		const item = await renderTemplate('result_item', {
			caseId: result.caseId,
			status: score == null ? geti18n('agent_studio.benchmarks.notJudged') : String(score),
			badgeClass: score == null ? 'badge-ghost' : 'badge-primary',
			response: truncate(result.response, 500),
			judgeText: result.judge?.reason || '',
		})
		elements.benchmarkResults.appendChild(item)
	}
	elements.benchmarkResultsEmpty.classList.toggle('hidden', results.length > 0)
}

/**
 * 选择基准并加载其定义与最近一次运行。
 * @param {string} id 基准 id
 * @returns {Promise<void>}
 */
async function selectBenchmark(id) {
	activeBenchmarkId = id
	for (const item of elements.benchmarkList.querySelectorAll('.benchmark-item'))
		item.classList.toggle('active', item.dataset.benchmarkId === id)
	const benchmark = await getBenchmark(id)
	elements.benchmarkTitle.textContent = benchmark.name
	elements.benchmarkCasesText.value = JSON.stringify(benchmark.cases ?? [], null, '\t')
	elements.benchmarkDetail.classList.remove('hidden')
	const runs = await listRuns({ benchmarkId: id })
	const latest = runs.length ? await getRun(runs[0].id) : null
	await renderRunResults(latest)
}

/**
 * 刷新基准列表并重新选择当前项。
 * @returns {Promise<void>}
 */
async function reloadBenchmarks() {
	benchmarks = await listBenchmarks()
	await renderBenchmarkList()
	if (activeBenchmarkId && benchmarks.some(benchmark => benchmark.id === activeBenchmarkId))
		await selectBenchmark(activeBenchmarkId)
	else {
		activeBenchmarkId = null
		elements.benchmarkDetail.classList.add('hidden')
	}
}

/**
 * 新建基准定义。
 * @returns {Promise<void>}
 */
async function newBenchmark() {
	const name = promptI18n('agent_studio.benchmarks.newName')
	if (!name) return
	const created = await createBenchmark({ name, description: '', cases: [] })
	await reloadBenchmarks()
	await selectBenchmark(created.id)
}

/**
 * 保存基准定义的用例（从 JSON 文本框解析）。
 * @returns {Promise<void>}
 */
async function saveBenchmarkCases() {
	if (!activeBenchmarkId) return
	const cases = JSON.parse(elements.benchmarkCasesText.value || '[]')
	await updateBenchmark(activeBenchmarkId, { cases })
	await reloadBenchmarks()
}

/**
 * 删除当前基准定义。
 * @returns {Promise<void>}
 */
async function removeBenchmark() {
	if (!activeBenchmarkId || !confirmI18n('agent_studio.benchmarks.deleteConfirm')) return
	await deleteBenchmark(activeBenchmarkId)
	activeBenchmarkId = null
	await reloadBenchmarks()
}

/**
 * 运行当前基准定义。
 * @returns {Promise<void>}
 */
async function runCurrentBenchmark() {
	if (!activeBenchmarkId) return
	if (!elements.runCharSelect.value) {
		showToastI18n('warning', 'agent_studio.benchmarks.selectCharFirst')
		return
	}
	elements.runBenchmarkButton.disabled = true
	try {
		const run = await runBenchmark(activeBenchmarkId, {
			charId: elements.runCharSelect.value,
			judgeAiSource: elements.runJudgeSource.value || undefined,
		})
		await renderRunResults(run)
		showToastI18n('success', 'agent_studio.benchmarks.runDone')
	}
	catch (error) {
		showToastI18n('error', 'agent_studio.alerts.runFailed', { message: error.message })
	}
	finally {
		elements.runBenchmarkButton.disabled = false
	}
}

/**
 * 填充运行用角色下拉框。
 * @returns {void}
 */
function renderRunCharOptions() {
	elements.runCharSelect.replaceChildren()
	for (const char of chars) {
		const option = document.createElement('option')
		option.value = char.id
		option.textContent = char.info?.name || char.id
		elements.runCharSelect.appendChild(option)
	}
	if (activeCharId) elements.runCharSelect.value = activeCharId
}

/**
 * 页面初始化。
 * @returns {Promise<void>}
 */
async function boot() {
	applyTheme()
	await initTranslations('agent_studio')
	elements.retentionSave.addEventListener('click', async () => {
		try {
			await setRetention({
				promptMs: daysToMs(elements.retentionPrompt.value),
				conversationMs: daysToMs(elements.retentionConversation.value),
			})
			showToastI18n('success', 'agent_studio.retention.saved')
		}
		catch (error) {
			showToastI18n('error', 'agent_studio.alerts.saveFailed', { message: error.message })
		}
	})
	elements.newBenchmarkButton.addEventListener('click', () => newBenchmark().catch(error => showToastI18n('error', 'agent_studio.alerts.saveFailed', { message: error.message })))
	elements.saveBenchmarkButton.addEventListener('click', () => saveBenchmarkCases().catch(error => showToastI18n('error', 'agent_studio.alerts.saveFailed', { message: error.message })))
	elements.deleteBenchmarkButton.addEventListener('click', () => removeBenchmark().catch(error => showToastI18n('error', 'agent_studio.alerts.saveFailed', { message: error.message })))
	elements.runBenchmarkButton.addEventListener('click', runCurrentBenchmark)

	try {
		const [charList, retention, benchmarkList] = await Promise.all([
			listChars(),
			getRetention(),
			listBenchmarks(),
		])
		chars = charList
		benchmarks = benchmarkList
		elements.retentionPrompt.value = String(msToDays(retention.promptMs))
		elements.retentionConversation.value = String(msToDays(retention.conversationMs))
		await renderCharList()
		await renderBenchmarkList()
		renderRunCharOptions()
	}
	catch (error) {
		showToastI18n('error', 'agent_studio.alerts.loadFailed', { message: error.message })
	}
}

await boot()
