/**
 * 纯测试：水 / 熔岩字形。
 */
/* global Deno */
import { assert, assertEquals, assertGreater, assertLess } from 'jsr:@std/assert'

import {
	MAT, createWorld, setMat, addLiquid, stepLiquid,
	stepFluid,
	clearMaterials, idx, COND_DRAW, SOIL_CAP, LIQ_DRAW,
	waterChar, liquidChar, lavaChar, pickWaterGlyph, FALL_HEAVY,
	WATER_STILL, WATER_FALL, WATER_HIGH_L, WATER_HIGH_R, WATER_LOW_DL, WATER_LOW_DR,
	addMelt, T_MAX, viscOf, rhoOf, SUBSTANCE, viscGain,
	applyGravityToWorld, PARTICLE_GRAVITY, condenseDripSource,
} from '../fluid/index.mjs'

Deno.test('fluid: condense drip glyph follows gravity, not screen-down', () => {
	const world = createWorld({ width: 10, height: 10, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	setMat(world, 5, 5, MAT.SOLID)
	world.condense[idx(world, 5, 5)] = COND_DRAW + 0.1
	// Default down: drip shows on cell below soil.
	assertEquals(condenseDripSource(world, 5, 6), idx(world, 5, 5))
	assertEquals(condenseDripSource(world, 4, 5), -1)
	// Sideways: drip on the gravity-down neighbor, not screen-below.
	applyGravityToWorld(world, { gx: -1, gy: 0, mag: PARTICLE_GRAVITY })
	assertEquals(condenseDripSource(world, 4, 5), idx(world, 5, 5))
	assertEquals(condenseDripSource(world, 5, 6), -1)
})

Deno.test('fluid: waterChar uses liquid velocity, not wind-scale slant on still pools', () => {
	// Still / near-still → pool glyphs
	assertEquals(waterChar(0.8, 0, 0, 0), pickWaterGlyph(WATER_STILL, 0.8, 0, false))
	assert(WATER_STILL.includes(waterChar(0.9, 0, 0.02, 0)))
	assert(WATER_STILL.includes(liquidChar(0.7, 0, false, 0, 0)))

	// Pure fall by amount
	assertEquals(waterChar(FALL_HEAVY, 0, 0, 1), '|')
	assertEquals(waterChar(FALL_HEAVY + 0.2, 0, 0, 1), '|')
	assert(WATER_FALL.includes(waterChar(0.1, 0, 0, 1)))
	assertEquals(liquidChar(0.7, 0, true, 0, 1), '|')

	// High momentum slant
	assert(WATER_HIGH_R.includes(waterChar(0.8, 0, 0.35, 0.8)))
	assert(WATER_HIGH_L.includes(waterChar(0.8, 0, -0.35, 0.8)))
	assertEquals(waterChar(0.8, 0, 0.7, 0.1), '-')

	// Low momentum diagonal (slow crawl)
	assert(WATER_LOW_DR.includes(waterChar(0.3, 0, 0.12, 0.2)))
	assert(WATER_LOW_DL.includes(waterChar(0.3, 0, -0.12, 0.2)))
})

/**
 * 竖直落柱：顶部落入，底部 SEAL 接住；关岩浆边，避免汇边抹质量。
 * @param {'water' | 'lava'} kind 相
 * @returns {{
 *   step: () => void,
 *   midFallGlyphs: () => string[],
 *   comY: () => number,
 * }} 探测句柄
 */
const freeFallColumn = (kind) => {
	const world = createWorld({ width: 8, height: 22, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	applyGravityToWorld(world, { gx: 0, gy: 1, mag: PARTICLE_GRAVITY })
	for (let x = 0; x < world.worldW; x++)
		setMat(world, x, world.worldH - 1, MAT.SEAL)
	if (kind === 'lava') addMelt(world, 4, 2, 1, T_MAX)
	else addLiquid(world, 4, 2, 1)
	/**
	 * 关曝露，避免底边岩浆注入。
	 * @returns {void}
	 */
	const disarmLavaEdge = () => {
		world.boundary.exposure.fill(0)
	}
	return {
		/**
		 * 推进一步。
		 * @returns {void}
		 */
		step: () => {
			stepFluid(world, { forceWind: 0 })
			disarmLavaEdge()
		},
		/**
		 * 半空（远离源与底）可绘熔岩/水字形。
		 * @returns {string[]} 字形
		 */
		midFallGlyphs: () => {
			const glyphs = []
			for (let y = 5; y <= 12; y++) {
				const i = idx(world, 4, y)
				const amt = kind === 'lava' ? world.melt[i] : world.liq[i]
				if (amt < LIQ_DRAW * 0.4) continue
				const vx = kind === 'lava' ? world.meltVx[i] : world.liqVx[i]
				const vy = kind === 'lava' ? world.meltVy[i] : world.liqVy[i]
				const ch = kind === 'lava'
					? lavaChar(amt, y, vx, vy, true)
					: liquidChar(amt, y, true, vx, vy)
				glyphs.push(ch)
			}
			return glyphs
		},
		/**
		 * 质量加权行心（沿下落方向更深 = 更大）。
		 * @returns {number} 质心行
		 */
		comY: () => {
			let mass = 0
			let moment = 0
			for (let y = 0; y < world.worldH; y++)
				for (let x = 0; x < world.worldW; x++) {
					const i = idx(world, x, y)
					const amt = kind === 'lava' ? world.melt[i] : world.liq[i]
					if (amt <= 1e-8) continue
					mass += amt
					moment += amt * y
				}
			return mass > 0 ? moment / mass : 0
		},
	}
}

Deno.test('fluid: falling lava shows rain-style motion glyphs', () => {
	const col = freeFallColumn('lava')
	let sawFall = false
	for (let t = 0; t < 30; t++) {
		col.step()
		const glyphs = col.midFallGlyphs()
		if (!glyphs.length) continue
		if (glyphs.some(ch => WATER_FALL.includes(ch) || WATER_HIGH_L.includes(ch) || WATER_HIGH_R.includes(ch)
			|| WATER_LOW_DL.includes(ch) || WATER_LOW_DR.includes(ch) || ch === '-')) {
			sawFall = true
			break
		}
	}
	assert(sawFall, 'falling lava must use rain/motion glyphs, not only still pools')
})

Deno.test('fluid: water falls the same drop faster than lava', () => {
	assertGreater(viscOf(rhoOf(SUBSTANCE.ROCK, T_MAX)), viscOf(rhoOf(SUBSTANCE.WATER, 0)))
	assertLess(viscGain(viscOf(rhoOf(SUBSTANCE.ROCK, T_MAX))), viscGain(viscOf(rhoOf(SUBSTANCE.WATER, 0))))
	const water = freeFallColumn('water')
	const lava = freeFallColumn('lava')
	const steps = 12
	for (let t = 0; t < steps; t++) {
		water.step()
		lava.step()
	}
	assertGreater(water.comY(), lava.comY() + 1.5,
		`after ${steps} ticks water COM ${water.comY()} should lead lava ${lava.comY()}`)
})

Deno.test('fluid: standing liquid velocity stays low so glyphs are still marks', () => {
	const world = createWorld({ width: 20, height: 12, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let x = 4; x <= 14; x++) {
		setMat(world, x, 9, MAT.HORIZON)
		world.moisture[idx(world, x, 9)] = SOIL_CAP
		setMat(world, x, 10, MAT.SEAL)
	}
	addLiquid(world, 8, 8, 1)
	addLiquid(world, 9, 8, 1)
	for (let i = 0; i < 40; i++) stepLiquid(world)

	let checked = 0
	for (let x = 4; x <= 14; x++) {
		const i = idx(world, x, 8)
		if (world.liq[i] < 0.1) continue
		checked++
		const speed = Math.hypot(world.liqVx[i], world.liqVy[i])
		assertLess(speed, 0.35)
		const ch = liquidChar(world.liq[i], x, false, world.liqVx[i], world.liqVy[i])
		assert(
			!WATER_HIGH_R.includes(ch) && !WATER_HIGH_L.includes(ch),
			`puddle should not use high-momentum slant, got ${ch}`,
		)
	}
	assertGreater(checked, 0)
})
