/**
 * 纯测试：土壤湿度、凝结与滴落。
 */
/* global Deno */
import { assert, assertAlmostEquals, assertEquals, assertGreater, assertLess } from 'jsr:@std/assert'

import {
	MAT, createWorld, setMat, addLiquid, addMoisture, stepLiquid, stepSoil, stepGas, stepParticles,
	stepFluid, labelAirRegions, pressureAt, liquidPressureAt, condensedPressureAt, totalSealedGas, totalGridWater,
	totalWorldWater, P_ATM, ATM_HYDRO, CELL_ASPECT, gravityDepth, gravityDownWeights,
	clearMaterials, idx, RHO_G, RHO_AIR, LIQ_FULL, cellFill, cellRoom, inertiaMove, WATER_VISC, meltVisc,
	COND_DRIP, COND_DRAW, SOIL_CAP, SOIL_HIT_ABSORB_FRAC, soilAbsorbFactor, LIQ_DRAW,
	waterChar, liquidChar, lavaChar, pickWaterGlyph, FALL_HEAVY,
	WATER_STILL, WATER_FALL, WATER_HIGH_L, WATER_HIGH_R, WATER_LOW_DL, WATER_LOW_DR,
	addMelt, T_MAX, T_AMB, viscOf, rhoOf, SUBSTANCE, viscGain, stepBubbles, stepThermal,
	globalWindAt, windShear, gasVelocityAt, dynamicPressure,
	staticPressureAt, spawnParticle, liftLiquidByWind, verticalGasDrag, GAS_DRAG, GAS_DRAG_Y,
	applyGravityToWorld, PARTICLE_GRAVITY, condenseDripSource, depositParticleMass,
	gravitySettleWeights, ST_DRY_FRAC, fillBlocked, isAirCell,
} from '../fluid/index.mjs'

Deno.test('fluid: SEAL neither stores moisture nor absorbs free liquid', () => {
	const world = createWorld({ width: 10, height: 8, margin: 1, bottomExtra: 1 })
	clearMaterials(world)
	setMat(world, 4, 5, MAT.SEAL)
	addLiquid(world, 4, 4, 0.9)
	const before = totalGridWater(world)
	for (let i = 0; i < 20; i++) stepSoil(world)
	assertEquals(world.moisture[idx(world, 4, 5)], 0)
	assertEquals(addMoisture(world, 4, 5, 0.5), 0)
	assertAlmostEquals(world.liq[idx(world, 4, 4)], 0.9, 1e-4)
	assertAlmostEquals(totalGridWater(world), before, 1e-4)
})

Deno.test('fluid: soil absorbs free liquid into moisture', () => {
	const world = createWorld({ width: 12, height: 10, margin: 1, bottomExtra: 1 })
	clearMaterials(world)
	setMat(world, 5, 6, MAT.HORIZON)
	setMat(world, 5, 7, MAT.SEAL)
	addLiquid(world, 5, 5, 0.8)
	const before = totalGridWater(world)
	for (let i = 0; i < 25; i++) stepSoil(world)
	assertGreater(world.moisture[idx(world, 5, 6)], 0.2)
	assertLess(world.liq[idx(world, 5, 5)], 0.8)
	assertAlmostEquals(totalGridWater(world), before, 1e-4)
})

Deno.test('fluid: dry soil absorbs faster than wet soil', () => {
	const world = createWorld({ width: 12, height: 10, margin: 1, bottomExtra: 1 })
	clearMaterials(world)
	setMat(world, 4, 6, MAT.HORIZON)
	setMat(world, 6, 6, MAT.HORIZON)
	setMat(world, 4, 7, MAT.SEAL)
	setMat(world, 6, 7, MAT.SEAL)
	world.moisture[idx(world, 6, 6)] = 0.75
	assertGreater(soilAbsorbFactor(0), soilAbsorbFactor(0.75))
	addLiquid(world, 4, 5, 1)
	addLiquid(world, 6, 5, 1)
	stepSoil(world)
	const dryTook = 1 - world.liq[idx(world, 4, 5)]
	const wetTook = 1 - world.liq[idx(world, 6, 5)]
	assertGreater(dryTook, wetTook)
})

Deno.test('fluid: sustained rain forms surface puddles instead of all soaking away', () => {
	const world = createWorld({ width: 24, height: 14, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let x = 4; x <= 18; x++) {
		setMat(world, x, 10, MAT.HORIZON)
		setMat(world, x, 11, MAT.SOLID)
		setMat(world, x, 12, MAT.SOLID)
	}

	// Rain-like input: ~2 ground hits/tick at 0.18 each (matches particle deposit size).
	for (let t = 0; t < 55; t++) {
		for (let k = 0; k < 2; k++) {
			const x = 5 + (t * 3 + k * 5) % 13
			const i = idx(world, x, 10)
			const hit = 0.18
			const want = hit * SOIL_HIT_ABSORB_FRAC * soilAbsorbFactor(world.moisture[i])
			const stored = addMoisture(world, x, 10, want)
			addLiquid(world, x, 9, hit - stored)
		}
		stepLiquid(world)
	}

	let puddleCells = 0
	let surfaceLiq = 0
	for (let x = 4; x <= 18; x++) {
		const surfaceAmt = world.liq[idx(world, x, 9)]
		surfaceLiq += surfaceAmt
		if (surfaceAmt >= LIQ_DRAW) puddleCells++
	}
	assertGreater(puddleCells, 2)
	assertGreater(surfaceLiq, 1)
	const total = totalGridWater(world)
	assertGreater(total, 0)
	// A meaningful share must remain as free surface water, not only soil moisture.
	assertGreater(surfaceLiq / total, 0.2)
})

Deno.test('fluid: soil moisture prefers downward seepage over sides', () => {
	const world = createWorld({ width: 14, height: 12, margin: 1, bottomExtra: 1 })
	clearMaterials(world)
	for (const x of [5, 6, 7])
		for (const y of [5, 6, 7])
			setMat(world, x, y, MAT.SOLID)
	// Impermeable bed under the soil block so mass stays in-grid.
	for (const x of [5, 6, 7])
		setMat(world, x, 8, MAT.SEAL)
	addMoisture(world, 6, 5, 1)
	for (let i = 0; i < 12; i++) stepSoil(world)
	assertGreater(world.moisture[idx(world, 6, 7)], world.moisture[idx(world, 5, 5)])
	assertGreater(world.moisture[idx(world, 6, 7)], world.moisture[idx(world, 7, 5)])
})

Deno.test('fluid: soil ceiling condenses then drips into air below', () => {
	const world = createWorld({ width: 12, height: 12, margin: 1, bottomExtra: 1 })
	clearMaterials(world)
	for (let x = 3; x <= 7; x++) {
		setMat(world, x, 4, MAT.SOLID)
		setMat(world, x, 8, MAT.SEAL)
	}
	addMoisture(world, 5, 4, 1)
	const before = totalGridWater(world)
	let sawCondense = false
	for (let i = 0; i < 40; i++) {
		stepSoil(world)
		if (world.condense[idx(world, 5, 4)] >= COND_DRIP * 0.5) sawCondense = true
	}
	assert(sawCondense || world.liq[idx(world, 5, 5)] > 0.05 || world.liq[idx(world, 5, 6)] > 0.05 || world.liq[idx(world, 5, 7)] > 0.05)
	assertAlmostEquals(totalGridWater(world), before, 1e-3)
})

Deno.test('fluid: soil condense retracts when gravity leaves the open underside', () => {
	const world = createWorld({ width: 12, height: 12, margin: 1, bottomExtra: 1 })
	clearMaterials(world)
	// Horizontal soil slab: air below, solid/seal above and around — flip to up removes underside air.
	for (let x = 3; x <= 7; x++) {
		setMat(world, x, 4, MAT.SOLID)
		setMat(world, x, 3, MAT.SEAL)
	}
	world.condense[idx(world, 5, 4)] = 0.7
	world.moisture[idx(world, 5, 4)] = 0.2
	const water0 = totalGridWater(world)
	applyGravityToWorld(world, { gx: 0, gy: -1, mag: PARTICLE_GRAVITY })
	for (let stepIndex = 0; stepIndex < 3; stepIndex++) stepSoil(world)
	assertLess(world.condense[idx(world, 5, 4)], 0.05)
	assertGreater(world.moisture[idx(world, 5, 4)], 0.2)
	assertAlmostEquals(totalGridWater(world), water0, 1e-3)
})

Deno.test('fluid: soil condense / drip follow sideways gravity', () => {
	const world = createWorld({ width: 14, height: 12, margin: 1, bottomExtra: 1 })
	clearMaterials(world)
	// Vertical soil wall with air on the left; gravity pulls left.
	for (let y = 3; y <= 8; y++) {
		setMat(world, 7, y, MAT.SOLID)
		setMat(world, 10, y, MAT.SEAL)
	}
	addMoisture(world, 7, 5, 1)
	applyGravityToWorld(world, { gx: -1, gy: 0, mag: PARTICLE_GRAVITY })
	const before = totalGridWater(world)
	let sawCondenseOrDrip = false
	for (let stepIndex = 0; stepIndex < 120; stepIndex++) {
		stepSoil(world)
		if (world.condense[idx(world, 7, 5)] >= COND_DRAW * 0.5) sawCondenseOrDrip = true
		if (world.liq[idx(world, 6, 5)] > 0.05) sawCondenseOrDrip = true
	}
	assert(sawCondenseOrDrip)
	// Must not keep forming / dripping on the old screen-down face.
	assertAlmostEquals(world.liq[idx(world, 7, 6)], 0, 0.05)
	assertGreater(world.liq[idx(world, 6, 5)], 0.05)
	assertAlmostEquals(totalGridWater(world), before, 1e-3)
})

Deno.test('fluid: soil condense uses weak gravity-projection face', () => {
	// ĝ mostly +x with weak +y (w_y < 0.5) — only the weak face is open air.
	const gx = 0.92
	const gy = Math.sqrt(1 - gx * gx)
	assertLess(gy, 0.5)

	const world = createWorld({ width: 12, height: 12, margin: 1, bottomExtra: 1 })
	clearMaterials(world)
	setMat(world, 5, 5, MAT.SOLID)
	// Seal every ortho face except weak-down (5,6) so reclaim only triggers after ĝ flips.
	setMat(world, 6, 5, MAT.SEAL)
	setMat(world, 4, 5, MAT.SEAL)
	setMat(world, 5, 4, MAT.SEAL)
	applyGravityToWorld(world, { gx, gy, mag: PARTICLE_GRAVITY })

	world.condense[idx(world, 5, 5)] = COND_DRAW + 0.1
	assertEquals(condenseDripSource(world, 5, 6), idx(world, 5, 5))

	world.condense[idx(world, 5, 5)] = COND_DRIP
	const water0 = totalGridWater(world)
	stepSoil(world)
	assertGreater(world.liq[idx(world, 5, 6)], 0.05)
	assertAlmostEquals(world.liq[idx(world, 6, 5)], 0, 1e-6)
	assertAlmostEquals(totalGridWater(world), water0, 1e-3)

	// Still hanging on the weak open underside — no reclaim yet.
	world.condense[idx(world, 5, 5)] = 0.6
	world.moisture[idx(world, 5, 5)] = 0.2
	world.liq[idx(world, 5, 6)] = 0
	const hangWater = totalGridWater(world)
	stepSoil(world)
	assertGreater(world.condense[idx(world, 5, 5)], 0.5)
	assertAlmostEquals(totalGridWater(world), hangWater, 1e-3)

	// Flip ĝ away from the weak face → sealed downs → reclaim into moisture.
	applyGravityToWorld(world, { gx: -gx, gy: -gy, mag: PARTICLE_GRAVITY })
	stepSoil(world)
	assertLess(world.condense[idx(world, 5, 5)], 0.05)
	assertGreater(world.moisture[idx(world, 5, 5)], 0.2)
	assertAlmostEquals(totalGridWater(world), hangWater, 1e-3)
})

Deno.test('fluid: condense reclaim keeps unsunk mass for later ticks', () => {
	const world = createWorld({ width: 8, height: 8, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	// Soil fully sealed — reclaim cannot spill; rest must stay in condense.
	for (let y = 2; y <= 4; y++)
		for (let x = 2; x <= 4; x++)
			setMat(world, x, y, MAT.SEAL)
	setMat(world, 3, 3, MAT.SOLID)
	world.moisture[idx(world, 3, 3)] = SOIL_CAP
	world.condense[idx(world, 3, 3)] = 0.55
	applyGravityToWorld(world, { gx: 0, gy: -1, mag: PARTICLE_GRAVITY })
	const water0 = totalGridWater(world)
	stepSoil(world)
	assertAlmostEquals(world.moisture[idx(world, 3, 3)], SOIL_CAP, 1e-6)
	assertAlmostEquals(world.condense[idx(world, 3, 3)], 0.55, 1e-6)
	assertAlmostEquals(totalGridWater(world), water0, 1e-6)
})

Deno.test('fluid: condensation Matthew effect amplifies the lead with noise', () => {
	const world = createWorld({ width: 14, height: 10, margin: 1, bottomExtra: 1 })
	clearMaterials(world)
	for (const x of [5, 6, 7]) {
		setMat(world, x, 4, MAT.SOLID)
		setMat(world, x, 7, MAT.SEAL)
	}
	world.condense[idx(world, 5, 4)] = 0.4
	world.condense[idx(world, 6, 4)] = 0.55
	world.condense[idx(world, 7, 4)] = 0.4
	const before = totalGridWater(world)
	const lead0 = world.condense[idx(world, 6, 4)]
	for (let i = 0; i < 25; i++) stepSoil(world)
	const lead1 = world.condense[idx(world, 6, 4)]
	const side = Math.max(world.condense[idx(world, 5, 4)], world.condense[idx(world, 7, 4)])
	// Leader should still dominate after noisy Matthew transfers (or have dripped).
	assert(lead1 + world.liq[idx(world, 6, 5)] + world.liq[idx(world, 6, 6)] >= lead0 - 0.05 || lead1 >= side)
	assertAlmostEquals(totalGridWater(world), before, 1e-3)
})

Deno.test('fluid: closed soil seepage conserves grid water', () => {
	const world = createWorld({ width: 16, height: 12, margin: 1, bottomExtra: 1 })
	clearMaterials(world)
	for (let y = 3; y <= 8; y++)
		for (let x = 4; x <= 10; x++)
			setMat(world, x, y, MAT.SOLID)
	// Seal under and around so no condense / edge sink.
	for (let x = 4; x <= 10; x++)
		setMat(world, x, 9, MAT.SEAL)
	addMoisture(world, 5, 3, 0.9)
	addMoisture(world, 8, 4, 0.7)
	addMoisture(world, 6, 6, 0.5)
	const before = totalGridWater(world)
	for (let i = 0; i < 50; i++) stepSoil(world)
	assertAlmostEquals(totalGridWater(world), before, 1e-4)
	for (let y = 3; y <= 8; y++)
		for (let x = 4; x <= 10; x++) {
			const m = world.moisture[idx(world, x, y)]
			assert(m >= -1e-6 && m <= SOIL_CAP + 1e-6)
		}
})
