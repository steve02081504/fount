/**
 * 单帧模拟与软边显示。
 */

import { composeFrame } from '../compose/index.mjs'
import { stepFluid } from '../fluid/step.mjs'
import { scratch, applyGravityToWorld } from '../fluid/world/index.mjs'
import { tickLightGesture } from '../gesture/light.mjs'
import { tickWindGesture, fillWindDrive } from '../gesture/wind.mjs'
import { tickGravity } from '../gravity.mjs'

import { rebuildMaterials, refreshLandGeometry } from './materials.mjs'
import { tickPoolLeaks } from './pool.mjs'

/** @typedef {import('./create.mjs').AnimState} AnimState */
/** @typedef {{ softBase?: boolean, softPillars?: boolean, softBody?: boolean }} SoftOpts */

/**
 * 推进一帧模拟并合成 ANSI 帧。
 * @param {AnimState} state 动画状态
 * @returns {string} ANSI 帧
 */
export const simFrame = (state) => {
	rebuildMaterials(state)
	tickWindGesture(state.wind)
	tickLightGesture(state.light)
	applyGravityToWorld(state.world, tickGravity())
	const { world } = state
	/** @type {Float32Array | undefined} */
	let driveUx
	/** @type {Float32Array | undefined} */
	let driveUy
	if (state.wind.down) {
		const n = world.worldW * world.worldH
		driveUx = scratch(world, 'windDriveUx', n, Float32Array)
		driveUy = scratch(world, 'windDriveUy', n, Float32Array)
		fillWindDrive(state.wind, world, driveUx, driveUy)
	}
	const opts = state.fluidOpts
	opts.time = state.frame
	opts.seed = state.seed
	opts.driveUx = driveUx
	opts.driveUy = driveUy
	stepFluid(world, opts)
	refreshLandGeometry(state)
	tickPoolLeaks(state)
	return composeFrame(state)
}

/**
 * 写软边标志，推进一帧模拟并合成。
 * @param {AnimState} state 动画状态
 * @param {SoftOpts} [soft] 软边选项
 * @returns {Generator<string, void, unknown>} 一帧 ANSI
 */
export function* show(state, soft = {}) {
	state.softBase = !!soft.softBase
	state.softPillars = !!soft.softPillars
	state.softBody = !!soft.softBody
	yield simFrame(state)
	state.frame++
}
