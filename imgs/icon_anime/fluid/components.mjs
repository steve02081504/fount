/**
 * 连通分量泛洪标注核心。
 * 气区 / 液体分量共用同一 BFS；调用方提供 accept + 可选聚合钩子。
 */

import { ORTHO_DX, ORTHO_DY } from '../hash.mjs'

import { floodClear, floodPush, scratch } from './world/index.mjs'

/** @typedef {import('./world/index.mjs').FluidWorld} FluidWorld */

/**
 * @typedef {{
 *   id: number,
 *   cells: number,
 *   sumDepth: number,
 *   depthMean: number,
 * }} ComponentStats
 */

/**
 * 从池取出或新建分量统计对象。
 * @param {ComponentStats[]} pool 空闲列表
 * @param {number} id 分量 id
 * @returns {ComponentStats} 统计
 */
const takeStats = (pool, id) => {
	const stats = pool.pop() || { id: 0, cells: 0, sumDepth: 0, depthMean: 0 }
	stats.id = id
	stats.cells = 0
	stats.sumDepth = 0
	stats.depthMean = 0
	return stats
}

/** `labelComponents` 返回壳。 */
const LABEL_OUT = {
	/** @type {(ComponentStats | undefined)[]} */
	components: /** @type {(ComponentStats | undefined)[]} */[],
	nextId: 1,
	seedComponentId: 0,
}

/**
 * 正交连通分量标注。
 * `labels` 写分量 id（0 = 未接受 / 未标注）；分量 id 从 1 起稠密。
 * @param {FluidWorld} world 流体世界
 * @param {{
 *   accept: (world: FluidWorld, cell: number, x: number, y: number) => boolean,
 *   labels: Int32Array,
 *   onCell?: (world: FluidWorld, cell: number, x: number, y: number, id: number, stats: ComponentStats) => void,
 *   seedCells?: { x: number, y: number }[],
 *   seedPairs?: Int32Array,
 *   seedPairCount?: number,
 *   startId?: number,
 *   poolKey?: string,
 * }} opts 选项
 * @returns {{
 *   components: (ComponentStats | undefined)[],
 *   nextId: number,
 *   seedComponentId: number,
 * }} 分量表、下一可用 id、边界播种分量 id（0 = 无）
 */
export const labelComponents = (world, opts) => {
	const { worldW: W, worldH: H } = world
	const { accept, labels, onCell } = opts
	const poolKey = opts.poolKey ?? 'componentPool'
	const pool = /** @type {ComponentStats[]} */ world.scratch[poolKey] ??= []
	const listKey = `${poolKey}List`
	/** @type {(ComponentStats | undefined)[]} */
	const components = /** @type {(ComponentStats | undefined)[]} */ world.scratch[listKey] ??= []

	components.length = 0
	let next = opts.startId ?? 1
	let seedComponentId = 0

	/**
	 * 若仍为未标注且可接受，播种入该分量。
	 * @param {number} x 列
	 * @param {number} y 行
	 * @param {number} id 分量 id
	 * @param {ComponentStats} stats 统计
	 * @returns {void}
	 */
	const seed = (x, y, id, stats) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return
		const cell = y * W + x
		if (labels[cell] || !accept(world, cell, x, y)) return
		labels[cell] = id
		stats.cells++
		onCell?.(world, cell, x, y, id, stats)
		floodPush(world, x, y)
	}

	/**
	 * BFS 扩展直至耗尽。
	 * @param {number} id 分量 id
	 * @param {ComponentStats} stats 统计
	 * @returns {void}
	 */
	const flood = (id, stats) => {
		for (let qi = 0; qi < world.floodLen; qi += 2) {
			const x = world.floodQ[qi]
			const y = world.floodQ[qi + 1]
			for (let o = 0; o < 4; o++)
				seed(x + ORTHO_DX[o], y + ORTHO_DY[o], id, stats)
		}
	}

	/**
	 * 完成分量：深度均值、登记非空、空统计回池。
	 * @param {number} id 分量 id
	 * @param {ComponentStats} stats 统计
	 * @returns {ComponentStats | null} 非空分量，或 null
	 */
	const finish = (id, stats) => {
		stats.depthMean = stats.cells > 0 ? stats.sumDepth / stats.cells : 0
		if (stats.cells > 0) {
			components[id] = stats
			return stats
		}
		pool.push(stats)
		return null
	}

	/**
	 * 从单点启动一个新分量。
	 * @param {number} x 列
	 * @param {number} y 行
	 * @returns {ComponentStats | null} 新分量，若点不可接受则 null
	 */
	const startAt = (x, y) => {
		const cell = y * W + x
		if (labels[cell] || !accept(world, cell, x, y)) return null
		const id = next++
		const stats = takeStats(pool, id)
		floodClear(world)
		seed(x, y, id, stats)
		flood(id, stats)
		return finish(id, stats)
	}

	const seedPairCount = opts.seedPairCount | 0
	if (seedPairCount > 0 && opts.seedPairs) {
		const id = next++
		const stats = takeStats(pool, id)
		floodClear(world)
		const pairs = opts.seedPairs
		for (let i = 0; i < seedPairCount; i++)
			seed(pairs[i * 2], pairs[i * 2 + 1], id, stats)
		flood(id, stats)
		if (finish(id, stats)) seedComponentId = id
	}
	else if (opts.seedCells?.length) {
		const id = next++
		const stats = takeStats(pool, id)
		floodClear(world)
		for (const { x, y } of opts.seedCells)
			seed(x, y, id, stats)
		flood(id, stats)
		if (finish(id, stats)) seedComponentId = id
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++)
			startAt(x, y)

	LABEL_OUT.components = components
	LABEL_OUT.nextId = next
	LABEL_OUT.seedComponentId = seedComponentId
	return LABEL_OUT
}

/**
 * 归还分量统计对象到池。
 * @param {FluidWorld} world 世界
 * @param {(ComponentStats | undefined)[]} components 分量表
 * @param {string} [poolKey='componentPool'] 池键
 * @returns {void}
 */
export const recycleComponents = (world, components, poolKey = 'componentPool') => {
	const pool = /** @type {ComponentStats[]} */ world.scratch[poolKey] ??= []
	for (let id = 1; id < components.length; id++) {
		const c = components[id]
		if (c) pool.push(c)
	}
}

/**
 * 确保长度 n 的 Int32 标签缓冲并清零。
 * @param {FluidWorld} world 世界
 * @param {string} key scratch 键
 * @param {number} n 长度
 * @returns {Int32Array} 标签
 */
export const clearLabels = (world, key, n) => {
	const labels = scratch(world, key, n, Int32Array)
	labels.fill(0)
	return labels
}
