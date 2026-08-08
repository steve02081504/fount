/**
 * 降雨边权重与雨粒子生成。
 */

import { spawnParticle } from '../fluid/particles.mjs'
import { globalWindAt, windShear } from '../fluid/gas.mjs'
import { hash01 } from '../hash.mjs'

/** 四边出雨权重壳（原地写 w，勿跨调用持有）。 */
const RAIN_EDGES = [
	{ nx: 0, ny: -1, w: 0 }, // top
	{ nx: 0, ny: 1, w: 0 }, // bottom
	{ nx: -1, ny: 0, w: 0 }, // left
	{ nx: 1, ny: 0, w: 0 }, // right
]

/**
 * 四边出雨权重（source 角色）。导出供测试。
 * @param {number} gx 单位重力 x
 * @param {number} gy 单位重力 y
 * @returns {{ nx: number, ny: number, w: number }[]} 边权重（模块壳）
 */
export const rainEdgeWeights = (gx, gy) => {
	const edges = RAIN_EDGES
	for (let i = 0; i < 4; i++) {
		const e = edges[i]
		e.w = Math.max(0, -(e.nx * gx + e.ny * gy))
	}
	if (edges[1].w > 0) {
		for (let i = 0; i < 4; i++) edges[i].w = 0
		return edges
	}
	edges[1].w = 0
	if (edges[0].w > 0.5) {
		edges[2].w = Math.max(edges[2].w, 0.12)
		edges[3].w = Math.max(edges[3].w, 0.12)
	}
	return edges
}

/**
 * 按权重随机选边。
 * @param {{ nx: number, ny: number, w: number }[]} edges 边
 * @param {number} u [0,1) 随机
 * @returns {{ nx: number, ny: number, w: number }} 选中边
 */
export const pickRainEdge = (edges, u) => {
	let sum = 0
	for (const e of edges) sum += e.w
	if (sum <= 1e-8) return edges[0]
	let t = u * sum
	for (const e of edges) {
		t -= e.w
		if (t <= 0) return e
	}
	return edges[0]
}

/**
 * 降雨活跃时，从重力「天空」边生成雨粒子。
 * @param {import('./index.mjs').AnimState} state 动画状态
 * @returns {void}
 */
export const spawnRain = (state) => {
	const { world, frame, rainUntil, width, height, seed } = state
	if (frame > rainUntil) return

	const g = world.gravity
	const edges = rainEdgeWeights(g.gx, g.gy)
	const unlock = Math.min(1, frame / Math.max(18, Math.max(width, height) * 0.55))
	const budget = Math.max(1, Math.floor(1 + unlock * 2.5))
	const depthSpan = world.gravityDepthSpan || Math.max(world.worldW, world.worldH)
	const skyWind = globalWindAt(frame, seed) * windShear(0, depthSpan)

	for (let i = 0; i < budget; i++) {
		if (hash01(frame, i + 17) > 0.4 + unlock * 0.4) continue
		const edge = pickRainEdge(edges, hash01(frame, i + 3))
		if (edge.w <= 0) continue

		const span = edge.ny !== 0
			? Math.max(1, Math.floor(width * unlock))
			: Math.max(1, Math.floor(height * unlock))
		const along = (hash01(frame * 3, i) * span) | 0
		const alongJitter = hash01(frame, i + 2) * 0.8
		const alongAxisIsX = edge.ny !== 0
		const spanOrigin = alongAxisIsX
			? world.ox + Math.floor((width - span) / 2)
			: Math.floor((height - span) / 2)
		const normalJitter = hash01(frame, i + 9) * 1.5
		let x
		let y
		if (alongAxisIsX) {
			x = spanOrigin + along + alongJitter
			y = edge.ny < 0 ? -normalJitter : world.worldH + normalJitter
		}
		else {
			x = edge.nx < 0 ? -normalJitter : world.worldW + normalJitter
			y = spanOrigin + along + alongJitter
		}

		const heavy = hash01(frame, i + 11) > 0.45
		const speed = 0.35 + hash01((x | 0) + (y | 0), 1) * 0.4
		const jitter = (hash01(frame, i) - 0.5) * 0.04
		spawnParticle(world, x, y,
			g.gx * speed + skyWind * 0.25 * (1 - Math.abs(g.gx)) + jitter,
			g.gy * speed + (Math.abs(g.gy) < 0.2 ? 0.2 : 0),
			70,
			heavy ? 0.55 + hash01(frame, i + 13) * 0.45 : 0.12 + hash01(frame, i + 13) * 0.32,
		)
	}
}
