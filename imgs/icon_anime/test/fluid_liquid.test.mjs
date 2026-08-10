/**
 * 纯测试：自由水 / 熔岩液压与体积互斥。
 */
/* global Deno */
import { assert, assertAlmostEquals, assertEquals, assertGreater, assertLess } from 'jsr:@std/assert'

import {
	MAT, createWorld, setMat, addLiquid, stepLiquid,
	stepFluid, labelAirRegions, liquidPressureAt, condensedPressureAt, totalGridWater, P_ATM, CELL_ASPECT, gravityDepth, gravityDownWeights,
	clearMaterials, idx, RHO_G, LIQ_FULL, inertiaMove, WATER_VISC, SOIL_CAP, LIQ_DRAW,
	addMelt, viscOf, rhoOf, SUBSTANCE, stepBubbles, gasVelocityAt,
	applyGravityToWorld, PARTICLE_GRAVITY,
	gravitySettleWeights, ST_DRY_FRAC,
} from '../fluid/index.mjs'

import { sealedBox } from './fluid_helpers.mjs'

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
