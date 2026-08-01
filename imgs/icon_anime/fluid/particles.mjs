/**
 * 雨/溅射粒子与气体阻力——SoA 池，每帧无对象分配。
 * 强局地风可悬浮/轨道液滴并抬升自由液体水洼。
 * 过期空中质量回存网格（或世界边缘 sink）——
 * 粒子是储水器，非质量泄漏。
 */

import { MAT, LIQ_DRAW, LIQ_FULL, isLiquidBarrier } from './mat.mjs'
import { markAirIfDrawCrossed } from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld
 * @typedef {{
 *   x: Float32Array, y: Float32Array,
 *   vx: Float32Array, vy: Float32Array,
 *   life: Float32Array, amt: Float32Array,
 *   count: number,
 * }} ParticlePool
 */

/** 粒子速度向局地气体混合（水平）。 */
export const GAS_DRAG = 0.22
/** 静风时垂直气体耦合（重力仍主导）。 */
export const GAS_DRAG_Y = 0.06
/** |gas| 超过此值开始将垂直阻力提升至 GAS_DRAG。 */
export const GAS_DRAG_Y_BOOST_FROM = 0.35
/** |gas| 跨度，垂直阻力在此内升至满 GAS_DRAG。 */
export const GAS_DRAG_Y_BOOST_SPAN = 1.2
/** 水洼上 gas uy（y↓）低于此值则舀起液体升空。 */
export const WIND_LIFT_UY = -0.65
/** 每帧舀取质量 ∝ |uy| · rate。 */
export const WIND_LIFT_RATE = 0.22
/** 单格每帧抬升自由液体质量上限。 */
export const WIND_LIFT_MAX = 0.4
/** 强上升气流中液滴寿命的软刷新。 */
export const WIND_HOLD_LIFE = 36

const GRAVITY = 0.12
const MAX_VY = 1.15
const PARTICLE_CAP = 1200

/**
 * 分配空粒子 SoA 池。
 * @param {number} [cap=PARTICLE_CAP] 容量
 * @returns {ParticlePool} 池
 */
export const createParticlePool = (cap = PARTICLE_CAP) => ({
	x: new Float32Array(cap),
	y: new Float32Array(cap),
	vx: new Float32Array(cap),
	vy: new Float32Array(cap),
	life: new Float32Array(cap),
	amt: new Float32Array(cap),
	count: 0,
})

/**
 * 清空粒子池。
 * @param {ParticlePool} pool 粒子池
 * @returns {void}
 */
export const clearParticlePool = (pool) => {
	pool.count = 0
}

/**
 * 池内粒子水质量总和。
 * @param {ParticlePool} pool 粒子池
 * @returns {number} amt 总量
 */
export const totalParticleWater = (pool) => {
	let t = 0
	for (let i = 0; i < pool.count; i++) t += pool.amt[i]
	return t
}

/**
 * 向池压入一粒子（满则跳过）。
 * @param {ParticlePool} pool 粒子池
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} vx 水平速度
 * @param {number} vy 垂直速度
 * @param {number} life 剩余帧
 * @param {number} amt 水质量
 * @returns {number} 写入索引，满则 -1
 */
const pushParticle = (pool, x, y, vx, vy, life, amt) => {
	const i = pool.count
	if (i >= pool.x.length) return -1
	pool.x[i] = x
	pool.y[i] = y
	pool.vx[i] = vx
	pool.vy[i] = vy
	pool.life[i] = life
	pool.amt[i] = amt
	pool.count = i + 1
	return i
}

/**
 * 未超上限时生成雨/溅射粒子。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} vx 水平速度
 * @param {number} vy 垂直速度
 * @param {number} [life=40] 剩余帧
 * @param {number} [amt=0.4] 水质量
 * @returns {void}
 */
export const spawnParticle = (world, x, y, vx, vy, life = 40, amt = 0.4) => {
	pushParticle(world.particles, x, y, vx, vy, life, amt)
}

/**
 * 为下一步排队溅射粒子。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} vx 水平速度
 * @param {number} vy 垂直速度
 * @param {number} [life=18] 剩余帧
 * @param {number} [amt=0.25] 水质量
 * @returns {number} 待处理索引，满则 -1
 */
export const queueSplash = (world, x, y, vx, vy, life = 18, amt = 0.25) =>
	pushParticle(world.pendingSplash, x, y, vx, vy, life, amt)

/**
 * 垂直阻力向气体：静风弱耦合；风暴/涡旋强耦合。
 * @param {number} gux gas ux
 * @param {number} guy gas uy
 * @returns {number} [GAS_DRAG_Y, GAS_DRAG] 内混合系数
 */
export const verticalGasDrag = (gux, guy) => {
	const speed2 = gux * gux + guy * guy
	if (speed2 <= GAS_DRAG_Y_BOOST_FROM * GAS_DRAG_Y_BOOST_FROM) return GAS_DRAG_Y
	const speed = Math.sqrt(speed2)
	const t = Math.min(1, (speed - GAS_DRAG_Y_BOOST_FROM) / GAS_DRAG_Y_BOOST_SPAN)
	return GAS_DRAG_Y + (GAS_DRAG - GAS_DRAG_Y) * t
}

/**
 * 尝试存入一格；返回已存增量。
 * @param {FluidWorld} world 流体世界
 * @param {number} px 列
 * @param {number} py 行
 * @param {number} left 剩余质量
 * @returns {number} 已存
 */
const tryDepositCell = (world, px, py, left) => {
	const { worldW: W, worldH: H, mat, liq } = world
	if (px < 0 || py < 0 || px >= W || py >= H) return 0
	const i = py * W + px
	if (isLiquidBarrier(mat[i])) return 0
	if (mat[i] !== MAT.AIR && mat[i] !== MAT.POOL) return 0
	const room = LIQ_FULL - liq[i]
	if (room <= 0) return 0
	const take = Math.min(left, room)
	const before = liq[i]
	liq[i] += take
	markAirIfDrawCrossed(world, before, liq[i])
	return take
}

/**
 * 将粒子质量存入 `(x, y)` 附近网格。优先 AIR / POOL；
 * 无处落地时在世界边缘_sink。返回已沉积（或_sink）质量。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} amt 水质量
 * @returns {number} 已计入质量
 */
export const depositParticleMass = (world, x, y, amt) => {
	if (amt <= 0) return 0
	const { worldW: W, worldH: H } = world
	const cx = Math.max(0, Math.min(W - 1, x | 0))
	const cy = Math.max(0, Math.min(H - 1, y | 0))

	let left = amt
	left -= tryDepositCell(world, cx, cy, left)
	if (left > 1e-8 && cy + 1 < H) left -= tryDepositCell(world, cx, cy + 1, left)
	if (left > 1e-8 && cy > 0) left -= tryDepositCell(world, cx, cy - 1, left)
	if (left > 1e-8) left -= tryDepositCell(world, cx - 1, cy, left)
	if (left > 1e-8) left -= tryDepositCell(world, cx + 1, cy, left)
	// Remainder leaves through world edge / impermeable bed — intentional sink.
	return amt
}

/**
 * 可变粒子视图，供碰撞处理（字段在 SoA 中）。
 * @typedef {{ x: number, y: number, vx: number, vy: number, life: number, amt: number }} ParticleView
 */

/**
 * 带气体阻力推进粒子；固体/湿格调用 `onHit`。
 * 寿命耗尽将质量回存网格而非删除。
 * @param {FluidWorld} world 流体世界
 * @param {(world: FluidWorld, x: number, y: number, mat: number, particle: ParticleView, wet: boolean, state: unknown) => void} onHit 碰撞回调
 * @param {unknown} [state] 动画/调用方状态，转发给 onHit
 * @returns {void}
 */
export const stepParticles = (world, onHit, state) => {
	const live = world.particles
	const pending = world.pendingSplash
	const { worldW: W, worldH: H, gasUx, gasUy, mat, liq } = world
	const cap = live.x.length

	// Drain splash queue into the live pool; overflow deposits so mass is not lost.
	let pi = 0
	for (; pi < pending.count && live.count < cap; pi++) {
		const dst = live.count++
		live.x[dst] = pending.x[pi]
		live.y[dst] = pending.y[pi]
		live.vx[dst] = pending.vx[pi]
		live.vy[dst] = pending.vy[pi]
		live.life[dst] = pending.life[pi]
		live.amt[dst] = pending.amt[pi]
	}
	for (; pi < pending.count; pi++)
		depositParticleMass(world, pending.x[pi], pending.y[pi], pending.amt[pi])
	pending.count = 0

	let write = 0
	const view = { x: 0, y: 0, vx: 0, vy: 0, life: 0, amt: 0 }

	for (let i = 0; i < live.count; i++) {
		const px = live.x[i]
		const py = live.y[i]
		let pvx = live.vx[i]
		let pvy = live.vy[i]
		let life = live.life[i] - 1
		const amt = live.amt[i]

		const gx = px | 0
		const gy = py | 0
		if (gx >= 0 && gy >= 0 && gx < W && gy < H) {
			const gi = gy * W + gx
			const gux = gasUx[gi]
			const guy = gasUy[gi]
			const speed2 = gux * gux + guy * guy
			const dragY = verticalGasDrag(gux, guy)
			pvx += (gux - pvx) * GAS_DRAG
			pvy += (guy - pvy) * dragY
			// Held in a strong updraft: keep the droplet alive for orbiting.
			if (guy < WIND_LIFT_UY && speed2 > 1)
				life = Math.max(life, Math.min(WIND_HOLD_LIFE, life + 1))
		}
		pvy = Math.min(MAX_VY, pvy + GRAVITY)

		if (life <= 0) {
			depositParticleMass(world, px, py, amt)
			continue
		}

		const nx = px + pvx
		const ny = py + pvy

		if (nx < 0 || nx >= W || ny >= H)
			// World-edge sink — mass leaves the domain intentionally.
			continue

		if (ny < 0) {
			live.x[write] = nx
			live.y[write] = ny
			live.vx[write] = pvx
			live.vy[write] = pvy
			live.life[write] = life
			live.amt[write] = amt
			write++
			continue
		}

		const cx = nx | 0
		const cy = ny | 0

		const cell = cy * W + cx
		const m = mat[cell]
		const wet = liq[cell] >= LIQ_DRAW

		if (m === MAT.AIR && !wet) {
			live.x[write] = nx
			live.y[write] = ny
			live.vx[write] = pvx
			live.vy[write] = pvy
			live.life[write] = life
			live.amt[write] = amt
			write++
			continue
		}

		view.x = nx
		view.y = ny
		view.vx = pvx
		view.vy = pvy
		view.life = life
		view.amt = amt
		onHit(world, cx, cy, m, view, wet, state)
	}

	live.count = write
}

/**
 * 自由液体 AIR 格上强上升气体将质量舀入空中粒子。
 * 湿格阻挡气体占据，抽吸从上方空气格采样。
 * @param {FluidWorld} world 流体世界
 * @returns {number} 抬升总质量
 */
export const liftLiquidByWind = (world) => {
	// After stepGas: skip full-grid scoop when no cell has strong updraft.
	// NaN (gas not stepped) → always scan so direct gasUy fixtures still work.
	const up = world.maxUpdraft
	if (up === up && up > WIND_LIFT_UY) return 0

	const { worldW: W, worldH: H, mat, liq, gasUx, gasUy, particles } = world
	let lifted = 0

	for (let y = 1; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (mat[i] !== MAT.AIR || liq[i] < LIQ_DRAW) continue

			const above = i - W
			// Prefer air above; fall back to this cell's gas if somehow present.
			let gux = gasUx[above]
			let guy = gasUy[above]
			if (mat[above] !== MAT.AIR || liq[above] >= LIQ_DRAW) {
				gux = gasUx[i]
				guy = gasUy[i]
			}
			if (guy > WIND_LIFT_UY) continue

			const scoop = Math.min(
				WIND_LIFT_MAX,
				liq[i],
				(WIND_LIFT_UY - guy) * WIND_LIFT_RATE - guy * 0.08,
			)
			if (scoop < 0.04) continue
			if (particles.count >= particles.x.length) return lifted

			const before = liq[i]
			liq[i] -= scoop
			markAirIfDrawCrossed(world, before, liq[i])
			const spawnY = mat[above] === MAT.AIR && liq[above] < LIQ_DRAW ? y - 0.35 : y - 0.15
			pushParticle(
				particles,
				x + 0.5,
				spawnY,
				gux * 0.85,
				Math.min(-0.35, guy * 0.9),
				WIND_HOLD_LIFE,
				scoop,
			)
			lifted += scoop
		}

	return lifted
}
