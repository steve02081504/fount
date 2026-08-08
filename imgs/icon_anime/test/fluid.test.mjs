/**
 * 纯测试：气相区域压强、气体守恒、液压 U 形管、土壤水分。
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

/**
 * 构建带可选液体的密封箱腔体。墙体使用不透水 SEAL。
 * @param {{ fillBottom?: number }} [opts] 填充选项
 * @returns {ReturnType<typeof createWorld>} world
 */
const sealedBox = (opts = {}) => {
	const world = createWorld({ width: 20, height: 16, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let y = 4; y <= 10; y++)
		for (let x = 4; x <= 10; x++) {
			const edge = y === 4 || y === 10 || x === 4 || x === 10
			if (edge) setMat(world, x, y, MAT.SEAL)
		}
	if (opts.fillBottom)
		for (let x = 5; x <= 9; x++)
			for (let y = 10 - opts.fillBottom; y < 10; y++)
				addLiquid(world, x, y, 1)

	return world
}

Deno.test('fluid: open atmosphere region has P_ATM', () => {
	const world = createWorld({ width: 16, height: 12, margin: 2, bottomExtra: 2 })
	labelAirRegions(world)
	const open = world.regions.find(r => r?.openToAtm)
	assert(open)
	assertEquals(open.pressure, P_ATM)
	assertGreater(open.airCells, 0)
})

Deno.test('fluid: RHO_AIR matches ATM_HYDRO scale and stays below RHO_G', () => {
	assertLess(RHO_AIR, RHO_G * 0.1)
	assertAlmostEquals(RHO_AIR, ATM_HYDRO, 0.01)
})

Deno.test('fluid: sealed cavity distinct from atmosphere', () => {
	const world = sealedBox()
	labelAirRegions(world)
	const sealed = world.regions.filter(r => r && !r.openToAtm)
	assertGreater(sealed.length, 0)
	const cell = idx(world, 7, 7)
	assertGreater(world.regionId[cell], 0)
	assert(!world.regions[world.regionId[cell]]?.openToAtm)
})

Deno.test('fluid: sealed cavity hydrostatic stratification around Boyle mean', () => {
	const world = sealedBox()
	labelAirRegions(world)
	const sealed = world.regions.find(r => r && !r.openToAtm)
	assert(sealed)
	assertAlmostEquals(sealed.pressure, P_ATM, 1e-9)
	const yTop = 5
	const yBot = 9
	const pTop = pressureAt(world, 7, yTop)
	const pBot = pressureAt(world, 7, yBot)
	assertAlmostEquals(pBot - pTop, ATM_HYDRO * (yBot - yTop), 1e-9)
	assertAlmostEquals(pTop, sealed.pressure + ATM_HYDRO * (yTop - sealed.yMean), 1e-9)
	assertAlmostEquals(pBot, sealed.pressure + ATM_HYDRO * (yBot - sealed.yMean), 1e-9)
})

Deno.test('fluid: compressing sealed cavity raises pressure', () => {
	const world = sealedBox()
	labelAirRegions(world)
	const before = world.regions.find(r => r && !r.openToAtm)
	assert(before)
	const gas0 = before.gasAmount
	const cells0 = before.airCells

	// fill most of the cavity with liquid → shrink air volume
	for (let x = 5; x <= 9; x++)
		for (let y = 6; y <= 9; y++)
			addLiquid(world, x, y, 1)

	labelAirRegions(world)
	const after = world.regions.find(r => r && !r.openToAtm)
	assert(after)
	assertLess(after.airCells, cells0)
	assertGreater(after.pressure, P_ATM)
	// gas roughly conserved
	assertAlmostEquals(after.gasAmount, gas0, gas0 * 0.35 + 0.5)
})

Deno.test('fluid: total sealed gas conserved across a liquid step', () => {
	const world = sealedBox({ fillBottom: 2 })
	labelAirRegions(world)
	const g0 = totalSealedGas(world)
	stepLiquid(world)
	labelAirRegions(world)
	const g1 = totalSealedGas(world)
	assertAlmostEquals(g1, g0, Math.max(1, g0 * 0.25))
})

Deno.test('fluid: U-tube liquid levels approach equalization under open air', () => {
	const world = createWorld({ width: 30, height: 20, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	// Impermeable U vessel — SEAL so soil absorption cannot drain the wells.
	for (let x = 6; x <= 20; x++) {
		setMat(world, x, 15, MAT.SEAL)
		setMat(world, x, 16, MAT.SEAL)
	}
	for (let y = 6; y <= 15; y++)
		for (const x of [6, 10, 16, 20])
			setMat(world, x, y, MAT.SEAL)

	for (let x = 7; x <= 19; x++)
		setMat(world, x, 14, MAT.SEAL)

	for (let y = 6; y <= 14; y++)
		for (const x of [8, 9, 17, 18])
			world.mat[idx(world, x, y)] = MAT.AIR

	for (let x = 8; x <= 18; x++)
		world.mat[idx(world, x, 14)] = MAT.AIR

	// unequal fill: left high, right low
	for (let y = 10; y <= 14; y++) {
		addLiquid(world, 8, y, 1)
		addLiquid(world, 9, y, 1)
	}
	for (let y = 13; y <= 14; y++) {
		addLiquid(world, 17, y, 1)
		addLiquid(world, 18, y, 1)
	}

	/**
	 * 列中最高液体行，无则 -1。
	 * @param {number} x 列
	 * @returns {number} 行
	 */
	const topY = (x) => {
		for (let y = 0; y < world.worldH; y++)
			if (world.liq[idx(world, x, y)] >= 0.35) return y
		return -1
	}

	const left0 = topY(8)
	const right0 = topY(17)
	assertGreater(right0 - left0, 1)

	for (let i = 0; i < 80; i++) stepLiquid(world)

	const left1 = topY(8)
	const right1 = topY(17)
	assertLess(Math.abs(left1 - right1), Math.abs(left0 - right0))
	assertLess(Math.abs(left1 - right1), 3)
})

Deno.test('fluid: open-air pressure rises with depth', () => {
	const world = createWorld({ width: 16, height: 12, margin: 2, bottomExtra: 2 })
	labelAirRegions(world)
	const sky = pressureAt(world, 8, 1)
	const ground = pressureAt(world, 8, world.worldH - 3)
	assertAlmostEquals(sky, P_ATM + ATM_HYDRO * 1, 1e-9)
	assertGreater(ground, sky)
	assertAlmostEquals(ground - sky, ATM_HYDRO * ((world.worldH - 3) - 1), 1e-9)
})

Deno.test('fluid: pressureAt above open liquid follows air hydrostatic', () => {
	const world = createWorld({ width: 12, height: 10, margin: 1, bottomExtra: 1 })
	addLiquid(world, 5, 5, 1)
	labelAirRegions(world)
	assertAlmostEquals(pressureAt(world, 5, 4), P_ATM + ATM_HYDRO * 4, 1e-9)
})

Deno.test('fluid: liquid column pressure grows with depth', () => {
	const world = createWorld({ width: 14, height: 16, margin: 1, bottomExtra: 1 })
	clearMaterials(world)
	// Open tank: floor + walls
	for (let x = 5; x <= 9; x++) setMat(world, x, 12, MAT.SEAL)
	for (let y = 4; y <= 12; y++) {
		setMat(world, 5, y, MAT.SEAL)
		setMat(world, 9, y, MAT.SEAL)
	}
	for (let y = 7; y <= 11; y++)
		for (let x = 6; x <= 8; x++)
			addLiquid(world, x, y, 1)
	labelAirRegions(world)
	const pTop = liquidPressureAt(world, 7, 7)
	const pBot = liquidPressureAt(world, 7, 11)
	assertGreater(pBot - pTop, RHO_G * 3.5)
})

Deno.test('fluid: deeper orifice vents more mass than shallow', () => {
	/**
	 * @param {number} fillTop 顶部液体行
	 * @returns {number} 多步后侧孔流失的质量
	 */
	const drain = (fillTop) => {
		const world = createWorld({ width: 18, height: 16, margin: 1, bottomExtra: 1 })
		clearMaterials(world)
		for (let x = 4; x <= 10; x++) setMat(world, x, 12, MAT.SEAL)
		for (let y = 3; y <= 12; y++) {
			setMat(world, 4, y, MAT.SEAL)
			setMat(world, 10, y, MAT.SEAL)
		}
		// Side hole at mid height on right wall
		world.mat[idx(world, 10, 9)] = MAT.AIR
		for (let y = fillTop; y <= 11; y++)
			for (let x = 5; x <= 9; x++)
				addLiquid(world, x, y, 1)
		const before = totalGridWater(world)
		for (let i = 0; i < 12; i++) stepLiquid(world)
		// Mass that left through the hole into x>=10 or edge sink
		let outside = 0
		for (let y = 0; y < world.worldH; y++)
			for (let x = 10; x < world.worldW; x++)
				outside += world.liq[idx(world, x, y)]
		const lost = before - totalGridWater(world)
		return outside + lost
	}
	assertGreater(drain(5), drain(9) * 1.15)
})

Deno.test('fluid: sealed over-pressure blocks liquid invasion', () => {
	const world = sealedBox({ fillBottom: 0 })
	labelAirRegions(world)
	// Shrink cavity air by filling most cells → high Boyle P
	for (let x = 5; x <= 9; x++)
		for (let y = 6; y <= 9; y++)
			addLiquid(world, x, y, 1)
	labelAirRegions(world)
	const sealed = world.regions.find(r => r && !r.openToAtm)
	assert(sealed)
	assertGreater(sealed.pressure, P_ATM * 1.5)
	// Leave a thin air pocket at top; try to shove more liquid in from a side breach setup —
	// instead: open a one-cell gap and ensure liquid does not flood the remaining high-P air.
	setMat(world, 4, 5, MAT.AIR)
	const airCell = idx(world, 7, 5)
	assert(world.liq[airCell] < LIQ_DRAW)
	const airBefore = world.liq[airCell]
	for (let i = 0; i < 20; i++) stepLiquid(world)
	// Remaining top air should stay mostly empty under over-pressure (or cavity vents carefully)
	assertLess(world.liq[airCell] - airBefore, 0.85)
})

Deno.test('fluid: BODY rejects free liquid (impact shell, not a pool)', () => {
	const world = createWorld({ width: 16, height: 12, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let x = 5; x <= 10; x++)
		setMat(world, x, 8, MAT.BODY)
	for (let x = 4; x <= 11; x++)
		setMat(world, x, 10, MAT.SEAL)

	assertEquals(addLiquid(world, 7, 8, 1), 0)
	addLiquid(world, 7, 5, 1)
	addLiquid(world, 8, 5, 1)
	for (let i = 0; i < 30; i++) stepLiquid(world)

	assertEquals(world.liq[idx(world, 7, 8)], 0)
	assertEquals(world.liq[idx(world, 8, 8)], 0)
})

Deno.test('fluid: free liquid settles above HORIZON and spreads', () => {
	const world = createWorld({ width: 20, height: 12, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let x = 4; x <= 14; x++) {
		// Saturated topsoil over impermeable bed — sheet flow without seepage loss.
		setMat(world, x, 9, MAT.HORIZON)
		world.moisture[idx(world, x, 9)] = SOIL_CAP
		setMat(world, x, 10, MAT.SEAL)
	}
	addLiquid(world, 8, 8, 1)
	addLiquid(world, 9, 8, 1)
	for (let i = 0; i < 40; i++) stepLiquid(world)

	let groundLiq = 0
	for (let x = 4; x <= 14; x++)
		groundLiq += world.liq[idx(world, x, 8)]
	assertGreater(groundLiq, 0.5)
	let wetCols = 0
	for (let x = 4; x <= 14; x++)
		if (world.liq[idx(world, x, 8)] >= 0.1) wetCols++
	assertGreater(wetCols, 2)
})

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

Deno.test('fluid: global wind varies with time', () => {
	const samples = []
	for (let t = 0; t < 400; t += 5)
		samples.push(globalWindAt(t, 42))
	const min = Math.min(...samples)
	const max = Math.max(...samples)
	assertGreater(max - min, 0.2)
	assert(samples.some(v => v > 0))
	assert(samples.some(v => v < 0))
})

Deno.test('fluid: global wind is autocorrelated, not a sine stack', () => {
	const seed = 42
	const n = 120
	const xs = Array.from({ length: n }, (_, i) => globalWindAt(i, seed))
	// Nearby ticks stay correlated (real wind has persistence)
	let nearDot = 0, nearNormA = 0, nearNormB = 0
	for (let i = 0; i < n - 1; i++) {
		nearDot += xs[i] * xs[i + 1]
		nearNormA += xs[i] * xs[i]
		nearNormB += xs[i + 1] * xs[i + 1]
	}
	const nearCorr = nearDot / Math.sqrt(nearNormA * nearNormB)
	assertGreater(nearCorr, 0.85)

	// Lag-1 second differences are irregular — pure multi-sine is much smoother/periodic
	const secondDiffs = []
	for (let i = 1; i < n - 1; i++)
		secondDiffs.push(xs[i + 1] - 2 * xs[i] + xs[i - 1])
	const mean = secondDiffs.reduce((a, b) => a + b, 0) / secondDiffs.length
	const varD2 = secondDiffs.reduce((a, b) => a + (b - mean) ** 2, 0) / secondDiffs.length
	assertGreater(varD2, 1e-6)

	// Same seed is deterministic; different seed diverges
	assertEquals(globalWindAt(50, seed), globalWindAt(50, seed))
	assert(Math.abs(globalWindAt(50, seed) - globalWindAt(50, seed + 1)) > 1e-4)
})

Deno.test('fluid: wind shear is stronger aloft than near ground', () => {
	const H = 40
	const t = 20
	const seed = 7
	const depthSpan = H - 1
	const aloft = Math.abs(globalWindAt(t, seed) * windShear(2, depthSpan))
	const nearGround = Math.abs(globalWindAt(t, seed) * windShear(H - 3, depthSpan))
	assertGreater(aloft, nearGround)
	assertGreater(aloft / Math.max(1e-6, nearGround), 1.3)
})

Deno.test('fluid: open-air gas field follows forced wind with height shear', () => {
	const world = createWorld({ width: 24, height: 20, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	labelAirRegions(world)
	for (let i = 0; i < 40; i++)
		stepGas(world, { time: i, seed: 1, forceWind: 0.8 })
	const top = Math.abs(gasVelocityAt(world, 12, 2).ux)
	const bot = Math.abs(gasVelocityAt(world, 12, world.worldH - 3).ux)
	assertGreater(top, 0.15)
	assertGreater(top, bot)
})

Deno.test('fluid: wind-tunnel throat is faster than wide section (continuity)', () => {
	const world = createWorld({ width: 36, height: 16, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	// Horizontal duct: floor+ceiling, span 3 in the wide section
	for (let x = 4; x <= 30; x++) {
		setMat(world, x, 4, MAT.SEAL)
		setMat(world, x, 8, MAT.SEAL)
	}
	// Throat at x=16..18: only mid row open (span 1)
	for (let x = 16; x <= 18; x++) {
		setMat(world, x, 5, MAT.SEAL)
		setMat(world, x, 7, MAT.SEAL)
	}

	labelAirRegions(world)
	for (let i = 0; i < 50; i++)
		stepGas(world, { time: i, seed: 0, forceWind: 0.9 })

	const wide = Math.abs(world.gasUx[idx(world, 10, 6)])
	const throat = Math.abs(world.gasUx[idx(world, 17, 6)])
	assertGreater(wide, 0.05)
	assertGreater(throat, wide * 1.15)
})

Deno.test('fluid: Bernoulli — higher speed carries higher dynamic pressure', () => {
	assertGreater(dynamicPressure(1.2), dynamicPressure(0.4))
	assertAlmostEquals(dynamicPressure(2, 0), 0.5 * RHO_AIR * 4, 1e-9)
})

Deno.test('fluid: Bernoulli — tunnel throat has lower static pressure', () => {
	const world = createWorld({ width: 36, height: 16, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let x = 4; x <= 30; x++) {
		setMat(world, x, 4, MAT.SEAL)
		setMat(world, x, 8, MAT.SEAL)
	}
	for (let x = 16; x <= 18; x++) {
		setMat(world, x, 5, MAT.SEAL)
		setMat(world, x, 7, MAT.SEAL)
	}
	labelAirRegions(world)
	for (let i = 0; i < 50; i++)
		stepGas(world, { time: i, seed: 0, forceWind: 0.9 })

	const pWide = staticPressureAt(world, 10, 6)
	const pThroat = staticPressureAt(world, 17, 6)
	assertLess(pThroat, pWide)
})

Deno.test('fluid: Bernoulli ΔP drive reinforces suction into the throat', () => {
	const world = createWorld({ width: 36, height: 16, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let x = 4; x <= 30; x++) {
		setMat(world, x, 4, MAT.SEAL)
		setMat(world, x, 8, MAT.SEAL)
	}
	for (let x = 16; x <= 18; x++) {
		setMat(world, x, 5, MAT.SEAL)
		setMat(world, x, 7, MAT.SEAL)
	}
	labelAirRegions(world)
	for (let i = 0; i < 50; i++)
		stepGas(world, { time: i, seed: 0, forceWind: 0.9 })

	// Upstream of throat should feed into it (positive ux), and throat stays faster than wide.
	assertGreater(world.gasUx[idx(world, 14, 6)], 0.05)
	assertGreater(Math.abs(world.gasUx[idx(world, 17, 6)]), Math.abs(world.gasUx[idx(world, 10, 6)]) * 1.1)
})

Deno.test('fluid: flow stagnates against a solid face', () => {
	const world = createWorld({ width: 24, height: 14, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let y = 2; y <= 10; y++)
		setMat(world, 14, y, MAT.SEAL)
	labelAirRegions(world)
	for (let i = 0; i < 35; i++)
		stepGas(world, { time: i, seed: 0, forceWind: 0.85 })
	const ahead = Math.abs(world.gasUx[idx(world, 13, 6)])
	const free = Math.abs(world.gasUx[idx(world, 8, 6)])
	assertGreater(free, 0.1)
	assertLess(ahead, free * 0.55)
})

Deno.test('fluid: rain particles are dragged by local gas velocity', () => {
	const world = createWorld({ width: 16, height: 12, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	world.gasUx.fill(0.6)
	spawnParticle(world, 8, 2, 0, 0.4, 40, 0.5)
	/** 空操作冲击回调。 */
	const hit = () => { /* no-op */ }
	for (let i = 0; i < 8; i++)
		stepParticles(world, hit)
	assert(world.particles.count > 0)
	assertGreater(world.particles.vx[0], 0.15)
})

Deno.test('fluid: vertical gas drag stays weak in calm air, strong in storms', () => {
	assertAlmostEquals(verticalGasDrag(0.1, 0.1), GAS_DRAG_Y)
	assertAlmostEquals(verticalGasDrag(3, 3), GAS_DRAG, 1e-9)
	assert(verticalGasDrag(1.2, 0) > GAS_DRAG_Y)
	assert(verticalGasDrag(1.2, 0) < GAS_DRAG)
})

Deno.test('fluid: tornado gas keeps rain orbiting aloft', async () => {
	const { paintVortexDrive, VORTEX_RADIUS } = await import('../gesture/wind.mjs')
	const world = createWorld({ width: 28, height: 20, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	const cx = world.ox + 14
	const cy = 8
	paintVortexDrive(cx, cy, 3.2, VORTEX_RADIUS, world, world.gasUx, world.gasUy)

	spawnParticle(world, cx + 4.2, cy, 0, 0.15, 90, 0.45)
	/** 空操作冲击回调（禁止落地）。 */
	const hit = () => { /* no-op — must not land */ }
	let angSpan = 0
	let prev = Math.atan2(world.particles.y[0] - cy, world.particles.x[0] - cx)
	let maxY = world.particles.y[0]
	for (let i = 0; i < 55; i++) {
		stepParticles(world, hit)
		assertGreater(world.particles.count, 0)
		const x = world.particles.x[0] - cx
		const y = world.particles.y[0] - cy
		maxY = Math.max(maxY, world.particles.y[0])
		const ang = Math.atan2(y, x)
		let d = ang - prev
		if (d > Math.PI) d -= Math.PI * 2
		if (d < -Math.PI) d += Math.PI * 2
		angSpan += d
		prev = ang
	}
	assertLess(maxY, cy + 5.5)
	assertGreater(angSpan, 1.2)
})

Deno.test('fluid: upward wind lifts free liquid into particles', () => {
	const world = createWorld({ width: 20, height: 14, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let x = 0; x < world.worldW; x++)
		setMat(world, x, 11, MAT.SEAL)
	const px = world.ox + 10
	const py = 10
	addLiquid(world, px, py, 0.95)
	const puddle = idx(world, px, py)
	const before = world.liq[puddle]
	assertGreater(before, LIQ_DRAW)
	// Wet cells block gas; suction is sampled from the air cell above.
	world.gasUy[idx(world, px, py - 1)] = -2.4
	world.gasUx[idx(world, px, py - 1)] = 0.8

	const lifted = liftLiquidByWind(world)
	assertGreater(lifted, 0.1)
	assertLess(world.liq[puddle], before)
	assertAlmostEquals(world.liq[puddle] + lifted, before, 1e-6)
	assertGreater(world.particles.count, 0)
	assertLess(world.particles.vy[0], -0.3)
	assertGreater(world.particles.amt[0], 0.1)
})

Deno.test('fluid: vortex drive through stepGas suspends rain', async () => {
	const { paintVortexDrive, VORTEX_RADIUS } = await import('../gesture/wind.mjs')
	const { scratch } = await import('../fluid/world.mjs')
	const world = createWorld({ width: 28, height: 18, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	labelAirRegions(world)
	const n = world.worldW * world.worldH
	const driveUx = scratch(world, 'vUx', n, Float32Array)
	const driveUy = scratch(world, 'vUy', n, Float32Array)
	const cx = world.ox + 14
	const cy = 7
	paintVortexDrive(cx, cy, 3.3, VORTEX_RADIUS, world, driveUx, driveUy)
	for (let i = 0; i < 20; i++)
		stepGas(world, { time: i, seed: 0, forceWind: 0, driveUx, driveUy })

	assertLess(world.gasUy[idx(world, cx, cy)], -1.2)

	spawnParticle(world, cx + 3.5, cy + 1, 0, 0.3, 80, 0.4)
	/** 空操作冲击回调。 */
	const hit = () => { /* no-op */ }
	let maxY = world.particles.y[0]
	for (let i = 0; i < 40; i++) {
		stepGas(world, { time: 20 + i, seed: 0, forceWind: 0, driveUx, driveUy })
		stepParticles(world, hit)
		if (!world.particles.count) break
		maxY = Math.max(maxY, world.particles.y[0])
	}
	assertGreater(world.particles.count, 0)
	assertLess(maxY, cy + 6)
})

Deno.test('fluid: vortex rain gathers at the cursor centre', async () => {
	// Tangential+inflow nulls ux on a diagonal; blanket updraft used to make that
	// corridor a hover attractor (upper-right of the cursor). Mean must stay near centre.
	const { paintVortexDrive, VORTEX_RADIUS } = await import('../gesture/wind.mjs')
	const { scratch } = await import('../fluid/world.mjs')
	const world = createWorld({ width: 36, height: 22, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	labelAirRegions(world)
	const n = world.worldW * world.worldH
	const driveUx = scratch(world, 'vUx', n, Float32Array)
	const driveUy = scratch(world, 'vUy', n, Float32Array)
	const cx = world.ox + 16.5
	const cy = 10.5
	/** 空操作冲击回调。 */
	const hit = () => { /* no-op */ }

	for (let i = 0; i < 36; i++) {
		const a = i / 36 * Math.PI * 2
		spawnParticle(world, cx + Math.cos(a) * 5, cy + Math.sin(a) * 3, 0, 0.15, 220, 0.35)
	}

	for (let t = 0; t < 90; t++) {
		driveUx.fill(0)
		driveUy.fill(0)
		paintVortexDrive(cx, cy, 3.3, VORTEX_RADIUS, world, driveUx, driveUy)
		stepGas(world, { time: t, seed: 0, forceWind: 0, driveUx, driveUy })
		stepParticles(world, hit)
	}

	assertGreater(world.particles.count, 8)
	let sx = 0
	let sy = 0
	for (let i = 0; i < world.particles.count; i++) {
		sx += world.particles.x[i]
		sy += world.particles.y[i]
	}
	const mx = sx / world.particles.count
	const my = sy / world.particles.count
	const dist = Math.hypot(mx - cx, my - cy)
	assertLess(dist, 2.2, `rain mean (${mx.toFixed(2)}, ${my.toFixed(2)}) drifted from cursor (${cx}, ${cy}) by ${dist.toFixed(2)}`)
	assertLess(Math.abs(mx - cx), 1.6)
	assertLess(Math.abs(my - cy), 1.6)
})

Deno.test('fluid: particle life expiry deposits mass into the grid', () => {
	const world = createWorld({ width: 16, height: 12, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let x = 0; x < world.worldW; x++)
		setMat(world, x, 10, MAT.SEAL)
	spawnParticle(world, 8, 5, 0, 0, 1, 0.55)
	const before = totalWorldWater(world)
	assertAlmostEquals(before, 0.55, 1e-6)
	/** 空操作冲击回调。 */
	const hit = () => { /* no-op */ }
	stepParticles(world, hit)
	assertEquals(world.particles.count, 0)
	assertAlmostEquals(totalWorldWater(world), before, 1e-5)
	assertGreater(totalGridWater(world), 0.5)
})

Deno.test('fluid: cell aspect shapes diagonal settle weights, not depth', () => {
	const world = createWorld({ width: 8, height: 8, margin: 0, bottomExtra: 0 })
	assertEquals(CELL_ASPECT, 2)
	assertAlmostEquals(gravityDepth(world, 0, 3) - gravityDepth(world, 0, 1), 2, 1e-9)
	const s = Math.SQRT1_2
	applyGravityToWorld(world, { gx: s, gy: s, mag: PARTICLE_GRAVITY })
	const down = gravitySettleWeights(world)
	assertGreater(down.n, 2)
	let best = 0
	for (let i = 1; i < down.n; i++)
		if (down.w[i] > down.w[best]) best = i
	assertEquals(Math.abs(down.dx[best]), 1)
	assertEquals(Math.abs(down.dy[best]), 1)
	// Ortho face weights stay for soil / free-surface semantics.
	const faces = gravityDownWeights(world)
	for (let i = 0; i < faces.n; i++)
		assertEquals(faces.dx[i] === 0 || faces.dy[i] === 0, true)
})

Deno.test('fluid: particle deposit imparts liquid momentum', () => {
	const world = createWorld({ width: 12, height: 10, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	depositParticleMass(world, 5, 5, 0.4, 0.8, -0.3)
	const i = idx(world, 5, 5)
	assertGreater(world.liq[i], 0.35)
	assertGreater(world.liqVx[i], 0.5)
	assertLess(world.liqVy[i], -0.1)
})

Deno.test('fluid: free-surface sheet wets dry neighbors slower (surface tension)', () => {
	const world = createWorld({ width: 14, height: 10, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	for (let x = 3; x <= 9; x++)
		setMat(world, x, 8, MAT.SEAL)
	addLiquid(world, 6, 7, 1)
	stepLiquid(world)
	const dryTook = world.liq[idx(world, 5, 7)] + world.liq[idx(world, 7, 7)]
	// Full sheet both sides ≈ 0.5; dry frac keeps first-tick wetting well below that.
	assertGreater(dryTook, 0.05)
	assertLess(dryTook, 0.25 * ST_DRY_FRAC * 2 + 0.08)
	assertGreater(world.liq[idx(world, 6, 7)], 0.55)
})

Deno.test('fluid: stepFluid runs gas then liquid in one tick', () => {
	const world = createWorld({ width: 20, height: 14, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let x = 4; x <= 14; x++) {
		setMat(world, x, 10, MAT.HORIZON)
		world.moisture[idx(world, x, 10)] = SOIL_CAP
		setMat(world, x, 11, MAT.SEAL)
	}
	addLiquid(world, 9, 9, 1)
	stepFluid(world, { time: 0, seed: 1, forceWind: 0.5 })
	assertGreater(Math.abs(gasVelocityAt(world, 10, 3).ux), 0.05)
	assertGreater(world.liq[idx(world, 9, 9)] + world.liq[idx(world, 8, 9)] + world.liq[idx(world, 10, 9)], 0.3)
})

Deno.test('fluid: condensed phases share cell volume (liq+melt ≤ LIQ_FULL)', () => {
	const world = createWorld({ width: 10, height: 10, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	const i = idx(world, 4, 4)
	world.liq[i] = 0.7
	world.melt[i] = 0.7
	world.temp[i] = 0.8
	stepLiquid(world)
	assertLess(world.liq[i] + world.melt[i], LIQ_FULL + 1e-3)
})

Deno.test('fluid: melt add displaces water instead of stacking past LIQ_FULL', () => {
	const world = createWorld({ width: 10, height: 10, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	addLiquid(world, 5, 5, 1)
	const stored = addMelt(world, 5, 5, 1, 0.9)
	assertGreater(stored, 0.5)
	const i = idx(world, 5, 5)
	assertLess(world.liq[i] + world.melt[i], LIQ_FULL + 1e-3)
	let neighbors = 0
	for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
		neighbors += world.liq[idx(world, 5 + dx, 5 + dy)]
	assertGreater(neighbors + world.liq[i], 0.01)
})

Deno.test('fluid: melt column builds hydrostatic pressure like water', () => {
	const world = createWorld({ width: 8, height: 10, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	for (let y = 3; y <= 6; y++)
		addMelt(world, 3, y, 1, 0.85)
	labelAirRegions(world)
	const pTop = condensedPressureAt(world, 3, 3)
	const pBot = condensedPressureAt(world, 3, 6)
	assertGreater(pBot - pTop, 1.5)
})

Deno.test('fluid: liquid inertia moves mass along velocity without pressure head', () => {
	const world = createWorld({ width: 12, height: 8, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	for (let x = 2; x <= 9; x++)
		setMat(world, x, 6, MAT.SEAL)
	// Two-deep column so the lower cell is submerged (sheet inertia allowed).
	for (const x of [3, 4, 5]) {
		addLiquid(world, x, 4, 1)
		addLiquid(world, x, 5, 1)
	}
	const i = idx(world, 4, 5)
	world.liqVx[i] = 2.5
	world.liqVy[i] = 0
	const right0 = world.liq[idx(world, 5, 5)]
	stepLiquid(world)
	assertGreater(world.liq[idx(world, 5, 5)] + world.liq[idx(world, 6, 5)], right0 + 0.05)
})

Deno.test('fluid: high-visc melt inertia is weaker than water', () => {
	const waterMove = inertiaMove(2.5, 0, 1, 0, 1, 1, WATER_VISC)
	const lavaMove = inertiaMove(2.5, 0, 1, 0, 1, 1, viscOf(rhoOf(SUBSTANCE.ROCK, 0.05)))
	assertGreater(waterMove, lavaMove)
	assertGreater(waterMove / Math.max(1e-6, lavaMove), 1.2)
})

Deno.test('fluid: gas projection reduces open-field divergence', () => {
	const world = createWorld({ width: 16, height: 14, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	// Solid frame so Neumann boundary can absorb flux (pure free expansion is not projectable).
	for (let x = 0; x < world.worldW; x++) {
		setMat(world, x, 0, MAT.SEAL)
		setMat(world, x, world.worldH - 1, MAT.SEAL)
	}
	for (let y = 0; y < world.worldH; y++) {
		setMat(world, 0, y, MAT.SEAL)
		setMat(world, world.worldW - 1, y, MAT.SEAL)
	}
	labelAirRegions(world)
	world.gasGeomDirty = true
	const { worldW: W, worldH: H } = world
	const n = W * H
	const cx = (W - 1) / 2
	const cy = (H - 1) / 2
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			const r2 = (x - cx) * (x - cx) + (y - cy) * (y - cy)
			const amp = Math.exp(-r2 / 8)
			world.gasUx[cell] = (x - cx) * 0.45 * amp
			world.gasUy[cell] = (y - cy) * 0.45 * amp
		}
	/**
	 * @param {ReturnType<typeof createWorld>} w world
	 * @returns {number} mean |div|
	 */
	const meanAbsDiv = (w) => {
		const blocked = new Uint8Array(n)
		fillBlocked(w, blocked)
		let sum = 0
		let count = 0
		for (let y = 1; y < H - 1; y++)
			for (let x = 1; x < W - 1; x++) {
				const cell = y * W + x
				if (blocked[cell]) continue
				const du = 0.5 * (w.gasUx[cell + 1] - w.gasUx[cell - 1])
					+ 0.5 * (w.gasUy[cell + W] - w.gasUy[cell - W])
				sum += Math.abs(du)
				count++
			}
		return count ? sum / count : 0
	}
	const before = meanAbsDiv(world)
	assertGreater(before, 0.05)
	stepGas(world, { time: 0, seed: 0, forceWind: 0, holdVelocity: true })
	const after = meanAbsDiv(world)
	assertLess(after, before * 0.85)
})

Deno.test('fluid: hot air column drives buoyant updraft vs cold', () => {
	const world = createWorld({ width: 12, height: 12, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	labelAirRegions(world)
	for (let y = 2; y <= 9; y++) {
		world.temp[idx(world, 3, y)] = 0.9
		world.temp[idx(world, 8, y)] = T_AMB
	}
	stepGas(world, { time: 0, seed: 0, forceWind: 0 })
	const hotAlong = world.gasUx[idx(world, 3, 5)] * world.gravity.gx
		+ world.gasUy[idx(world, 3, 5)] * world.gravity.gy
	const coldAlong = world.gasUx[idx(world, 8, 5)] * world.gravity.gx
		+ world.gasUy[idx(world, 8, 5)] * world.gravity.gy
	// Against gravity ⇒ more negative along ĝ for hot air.
	assertLess(hotAlong, coldAlong - 0.02)
})

Deno.test('fluid: steam flash heats neighboring air', () => {
	const world = createWorld({ width: 10, height: 10, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	addMelt(world, 4, 5, 1, 0.9)
	addLiquid(world, 4, 4, 0.8)
	// Place water onto melt cell to force flash.
	world.liq[idx(world, 4, 5)] = 0.5
	labelAirRegions(world)
	stepThermal(world)
	assertEquals(world.liq[idx(world, 4, 5)], 0)
	assertGreater(world.temp[idx(world, 4, 4)] + world.temp[idx(world, 4, 5)], T_AMB + 0.05)
})

Deno.test('fluid: sealed bubble rises continuously through melt', () => {
	const world = createWorld({ width: 10, height: 12, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	// Seal walls.
	for (let y = 2; y <= 9; y++) {
		setMat(world, 2, y, MAT.SEAL)
		setMat(world, 7, y, MAT.SEAL)
	}
	for (let x = 2; x <= 7; x++) {
		setMat(world, x, 2, MAT.SEAL)
		setMat(world, x, 9, MAT.SEAL)
	}
	// Melt column with a sealed air pocket near the bottom.
	for (let y = 4; y <= 8; y++)
		for (let x = 3; x <= 6; x++)
			if (!(x >= 4 && x <= 5 && y >= 7 && y <= 8))
				addMelt(world, x, y, 1, 0.85)
	labelAirRegions(world)
	const sealed = world.regions.filter(r => r && !r.openToAtm)
	assertGreater(sealed.length, 0)
	/**
	 * @returns {number} bubble centroid depth
	 */
	const bubbleDepth = () => {
		let sum = 0
		let w = 0
		for (let y = 3; y <= 8; y++)
			for (let x = 3; x <= 6; x++) {
				const cell = idx(world, x, y)
				const rid = world.regionId[cell]
				if (!rid) continue
				const region = world.regions[rid]
				if (!region || region.openToAtm) continue
				if (world.melt[cell] >= LIQ_DRAW) continue
				sum += gravityDepth(world, x, y)
				w++
			}
		return w ? sum / w : 0
	}
	const d0 = bubbleDepth()
	let melt0 = 0
	for (let i = 0; i < world.melt.length; i++) melt0 += world.melt[i]
	for (let t = 0; t < 40; t++) {
		stepBubbles(world)
		if (world.airDirty) labelAirRegions(world)
	}
	const d1 = bubbleDepth()
	let melt1 = 0
	for (let i = 0; i < world.melt.length; i++) melt1 += world.melt[i]
	assertAlmostEquals(melt1, melt0, 1e-3)
	assertLess(d1, d0 - 0.15)
})
