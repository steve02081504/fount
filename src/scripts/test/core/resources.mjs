/**
 * Suite 资源画像：manifest 声明 + 运行时采样基线 + 命名推断（二维：mem × CPU%）。
 */
import { cpus } from 'node:os'

import { MiB } from './concurrency.mjs'

/** serial 编排器的固定基础内存预算（MB）：真正的占用由全局单元池下放。 */
export const SERIAL_BASE_MEM_MB = 200

/** serial 编排器的固定基础 CPU 份额（%）。 */
export const SERIAL_BASE_CPU_PCT = 5

/** 单文件单元内存缺省需求（MB）：无采样与声明时回退。 */
export const DEFAULT_UNIT_MEM_MB = 400

/**
 * suite 资源画像（内存 × CPU%）。
 * @typedef {object} SuiteResources
 * @property {number} memMb  suite 子进程树峰值内存（MB，含 live 多 fount 进程总量）
 * @property {number} cpuPct 调度预算：预期占全机 CPU 的份额（0–100）
 * @property {number} [unitMemMb] 单文件单元内存需求（MB），仅 serial suite 有效
 * @property {number} [unitCpuPct] 单文件单元 CPU 份额（%），仅 serial suite 有效
 */

/**
 * @typedef {import('./manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('./state.mjs').SuiteStateEntry} SuiteStateEntry
 */

/**
 * manifest `resources` 原始字段 → 归一化。
 * @param {object | undefined} raw manifest resources
 * @returns {Partial<SuiteResources>} 部分资源
 */
export function parseManifestResources(raw) {
	if (!raw || typeof raw !== 'object') return {}
	return {
		...Number.isFinite(raw.memMb) && raw.memMb > 0 ? { memMb: Math.floor(raw.memMb) } : {},
		...Number.isFinite(raw.cpuPct) && raw.cpuPct >= 0 ? { cpuPct: Math.min(100, raw.cpuPct) } : {},
		...Number.isFinite(raw.unitMemMb) && raw.unitMemMb > 0 ? { unitMemMb: Math.floor(raw.unitMemMb) } : {},
		...Number.isFinite(raw.unitCpuPct) && raw.unitCpuPct >= 0 ? { unitCpuPct: Math.min(100, raw.unitCpuPct) } : {},
	}
}

/**
 * 按 manifest 路径/名称推断默认资源（无 `resources` 块时的回退）。
 * @param {SuiteDef} suite suite
 * @returns {SuiteResources} 默认资源
 */
export function inferDefaultResources(suite) {
	const { manifestId, name } = suite

	if (name === 'fed_ban') return { memMb: 1600, cpuPct: 45 }
	if (name.startsWith('fed_')) return { memMb: 1400, cpuPct: 35 }
	if (name === 'cross_shell_emoji') return { memMb: 1400, cpuPct: 40 }

	if (manifestId === 'shells/chat' || manifestId === 'shells/social') {
		if (name === 'integration') return { memMb: 1800, cpuPct: 25 }
		if (name === 'frontend') return { memMb: 1200, cpuPct: 30 }
		if (name === 'pure') return { memMb: 600, cpuPct: 12 }
		if (['e2e_single', 'e2e_single_extended', 'ws', 'ws_rpc', 'ws_stream', 'smoke_chat', 'smoke_ai', 'av_relay'].includes(name))
			return { memMb: 900, cpuPct: 22 }
	}

	if (manifestId === 'server' && name === 'live') return { memMb: 500, cpuPct: 20 }

	return { memMb: 400, cpuPct: 15 }
}

/**
 * 合并 manifest 声明、命名默认值与 state 采样基线（全量 footprint）。
 * 有可信采样时用采样（可被 manifest 声明抬高）；无采样才回退命名默认。
 * CPU 基线 < 1% 视为噪声（空闲采样），忽略。
 * serial suite 亦按真实实测占用估算——ETA/时间表需要它。
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @returns {SuiteResources} 估算资源
 */
export function resolveSuiteEstimateResources(suite, entry) {
	const declared = parseManifestResources(suite.resources)
	const defaults = inferDefaultResources(suite)
	const baselineMem = entry?.baselineMemMb > 0 ? entry.baselineMemMb : null
	const baselineCpu = entry?.baselineCpuPct >= 1 ? entry.baselineCpuPct : null
	return {
		memMb: Math.max(declared.memMb ?? 0, baselineMem ?? defaults.memMb),
		cpuPct: Math.max(declared.cpuPct ?? 0, baselineCpu ?? defaults.cpuPct),
	}
}

/**
 * 调度用 suite 资源：serial suite 在资源闸门只占编排器基础位，真实内存/CPU 由
 * 全局单元池按文件下放，避免并发 suite 重复预订整机。
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @returns {SuiteResources} 闸门占用资源
 */
export function resolveSuiteResources(suite, entry) {
	const declared = parseManifestResources(suite.resources)
	if (suiteUsesSerialRunner(suite))
		return {
			memMb: Math.max(declared.memMb ?? 0, SERIAL_BASE_MEM_MB),
			cpuPct: Math.max(declared.cpuPct ?? 0, SERIAL_BASE_CPU_PCT),
		}
	return resolveSuiteEstimateResources(suite, entry)
}

/**
 * 单个 serial 文件 worker 的单元资源需求：实测单文件峰值 > manifest 声明 > 缺省。
 * CPU 默认为整机均分份额，至少 0.1%。
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @returns {SuiteResources} 单元资源
 */
export function resolveSerialUnitResources(suite, entry) {
	const declared = parseManifestResources(suite.resources)
	const memMb = entry?.baselineUnitMemMb > 0
		? entry.baselineUnitMemMb
		: declared.unitMemMb > 0 ? declared.unitMemMb : DEFAULT_UNIT_MEM_MB
	const cpuPct = Math.max(0.1, declared.unitCpuPct ?? 100 / cpus().length)
	return { memMb, cpuPct }
}

/**
 * 将资源画像内存字段转为字节。
 * @param {SuiteResources} resources 资源
 * @returns {number} 字节
 */
export function resourcesMemBytes(resources) {
	return resources.memMb * MiB
}

/**
 * 调度优先级：二维 footprint 较大者优先（BFD 填箱）。
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @returns {number} 排序键
 */
export function suiteSchedulePriority(suite, entry) {
	const r = resolveSuiteResources(suite, entry)
	return Math.max(r.memMb, r.cpuPct)
}

/**
 * suite 是否通过 serial.mjs 在内部并行跑多文件（应下放 CPU/内存预算）。
 * @param {SuiteDef} suite suite
 * @returns {boolean} 是否经 serial.mjs 内部并行多文件
 */
export function suiteUsesSerialRunner(suite) {
	return suite.run.some(arg => String(arg).includes('serial.mjs'))
}
