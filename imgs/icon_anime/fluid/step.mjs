/**
 * 单 tick 流体编排：空气标记 → 气体 → 风抬升 → 粒子 → 液体。
 *
 * 场景 / 测试调用此函数（或各子步）。
 * `labelAirRegions` 仅在 `world.airDirty`（材质 / LIQ_DRAW 占用变化）时运行。
 * `stepLiquid` 在粒子 / 抬升再次弄脏自由液体拓扑时于 tick 中途重新标记。
 */

import { labelAirRegions, stepGas } from './gas.mjs'
import { stepLiquid } from './liquid.mjs'
import { liftLiquidByWind, stepParticles } from './particles.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/** 空操作冲击处理器（模块级 — 避免每 tick 闭包分配）。 */
const NOOP_HIT = () => { /* airborne until land / expire-deposit */ }

/**
 * 推进完整流体栈一个 tick。
 * @param {FluidWorld} world 流体世界
 * @param {{
 *   time?: number,
 *   seed?: number,
 *   forceWind?: number,
 *   driveUx?: Float32Array,
 *   driveUy?: Float32Array,
 *   onHit?: (world: FluidWorld, x: number, y: number, mat: number, particle: import('./particles.mjs').ParticleView, wet: boolean, state: unknown) => void,
 *   state?: unknown,
 *   beforeParticles?: () => void,
 * }} [opts] 气体驱动 + 粒子冲击 + 可选降雨注入
 * @returns {void}
 */
export const stepFluid = (world, opts = {}) => {
	if (world.airDirty) labelAirRegions(world)
	stepGas(world, opts)
	liftLiquidByWind(world)
	opts.beforeParticles?.()
	stepParticles(world, opts.onHit || NOOP_HIT, opts.state)
	stepLiquid(world)
}
