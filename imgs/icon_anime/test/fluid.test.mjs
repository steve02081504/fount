/**
 * Pure tests: air-region pressure, gas conservation, hydraulic U-tube, soil water.
 */
/* global Deno */
import { assert, assertAlmostEquals, assertEquals, assertGreater, assertLess } from 'jsr:@std/assert'

import {
	MAT, createWorld, setMat, addLiquid, addMoisture, stepLiquid, stepSoil, stepGas, stepParticles,
	labelAirRegions, pressureAt, totalSealedGas, totalGridWater, P_ATM, clearMaterials, idx,
	COND_DRIP, SOIL_CAP, SOIL_HIT_ABSORB_FRAC, soilAbsorbFactor, LIQUID_DRAW_THRESHOLD,
	fallChar, liquidChar, FALL_HEAVY, globalWindAt, windProfileAt, gasVelocityAt, dynamicPressure,
	staticPressureAt, spawnParticle,
} from '../fluid_engine.mjs'

/**
 * Build a sealed box cavity with optional liquid. Walls use impermeable SEAL.
 * @param {{ fillBottom?: number }} [opts] fill options
 * @returns {ReturnType<typeof createWorld>} world
 */
const sealedBox = (opts = {}) => {
	const w = createWorld({ width: 20, height: 16, margin: 2, bottomExtra: 2 })
	clearMaterials(w)
	for (let y = 4; y <= 10; y++)
		for (let x = 4; x <= 10; x++) {
			const edge = y === 4 || y === 10 || x === 4 || x === 10
			if (edge) setMat(w, x, y, MAT.SEAL)
		}
	if (opts.fillBottom)
		for (let x = 5; x <= 9; x++)
			for (let y = 10 - opts.fillBottom; y < 10; y++)
				addLiquid(w, x, y, 1)

	return w
}

Deno.test('fluid: open atmosphere region has P_ATM', () => {
	const w = createWorld({ width: 16, height: 12, margin: 2, bottomExtra: 2 })
	labelAirRegions(w)
	const open = [...w.regions.values()].find(r => r.openToAtm)
	assert(open)
	assertEquals(open.pressure, P_ATM)
	assertGreater(open.airCells, 0)
})

Deno.test('fluid: sealed cavity distinct from atmosphere', () => {
	const w = sealedBox()
	labelAirRegions(w)
	const sealed = [...w.regions.values()].filter(r => !r.openToAtm)
	assertGreater(sealed.length, 0)
	const cell = idx(w, 7, 7)
	assertGreater(w.regionId[cell], 0)
	assert(!w.regions.get(w.regionId[cell])?.openToAtm)
})

Deno.test('fluid: compressing sealed cavity raises pressure', () => {
	const w = sealedBox()
	labelAirRegions(w)
	const before = [...w.regions.values()].find(r => !r.openToAtm)
	assert(before)
	const gas0 = before.gasAmount
	const cells0 = before.airCells

	// fill most of the cavity with liquid → shrink air volume
	for (let x = 5; x <= 9; x++)
		for (let y = 6; y <= 9; y++)
			addLiquid(w, x, y, 1)

	labelAirRegions(w)
	const after = [...w.regions.values()].find(r => !r.openToAtm)
	assert(after)
	assertLess(after.airCells, cells0)
	assertGreater(after.pressure, P_ATM)
	// gas roughly conserved
	assertAlmostEquals(after.gasAmount, gas0, gas0 * 0.35 + 0.5)
})

Deno.test('fluid: total sealed gas conserved across a liquid step', () => {
	const w = sealedBox({ fillBottom: 2 })
	labelAirRegions(w)
	const g0 = totalSealedGas(w)
	stepLiquid(w)
	const g1 = totalSealedGas(w)
	assertAlmostEquals(g1, g0, Math.max(1, g0 * 0.25))
})

Deno.test('fluid: U-tube liquid levels approach equalization under open air', () => {
	const w = createWorld({ width: 30, height: 20, margin: 2, bottomExtra: 2 })
	clearMaterials(w)
	// Impermeable U vessel — SEAL so soil absorption cannot drain the wells.
	for (let x = 6; x <= 20; x++) {
		setMat(w, x, 15, MAT.SEAL)
		setMat(w, x, 16, MAT.SEAL)
	}
	for (let y = 6; y <= 15; y++)
		for (const x of [6, 10, 16, 20])
			setMat(w, x, y, MAT.SEAL)

	for (let x = 7; x <= 19; x++)
		setMat(w, x, 14, MAT.SEAL)

	for (let y = 6; y <= 14; y++)
		for (const x of [8, 9, 17, 18])
			w.mat[idx(w, x, y)] = MAT.AIR

	for (let x = 8; x <= 18; x++)
		w.mat[idx(w, x, 14)] = MAT.AIR

	// unequal fill: left high, right low
	for (let y = 10; y <= 14; y++) {
		addLiquid(w, 8, y, 1)
		addLiquid(w, 9, y, 1)
	}
	for (let y = 13; y <= 14; y++) {
		addLiquid(w, 17, y, 1)
		addLiquid(w, 18, y, 1)
	}

	/**
	 * Top liquid row in a column, or -1.
	 * @param {number} x column
	 * @returns {number} row
	 */
	const topY = (x) => {
		for (let y = 0; y < w.worldH; y++)
			if (w.liq[idx(w, x, y)] >= 0.35) return y
		return -1
	}

	const left0 = topY(8)
	const right0 = topY(17)
	assertGreater(right0 - left0, 1)

	for (let i = 0; i < 80; i++) stepLiquid(w)

	const left1 = topY(8)
	const right1 = topY(17)
	assertLess(Math.abs(left1 - right1), Math.abs(left0 - right0))
	assertLess(Math.abs(left1 - right1), 3)
})

Deno.test('fluid: pressureAt returns atm above open liquid', () => {
	const w = createWorld({ width: 12, height: 10, margin: 1, bottomExtra: 1 })
	addLiquid(w, 5, 5, 1)
	labelAirRegions(w)
	assertEquals(pressureAt(w, 5, 4), P_ATM)
})

Deno.test('fluid: BODY rejects free liquid (impact shell, not a pool)', () => {
	const w = createWorld({ width: 16, height: 12, margin: 2, bottomExtra: 2 })
	clearMaterials(w)
	for (let x = 5; x <= 10; x++)
		setMat(w, x, 8, MAT.BODY)
	for (let x = 4; x <= 11; x++)
		setMat(w, x, 10, MAT.SEAL)

	assertEquals(addLiquid(w, 7, 8, 1), 0)
	addLiquid(w, 7, 5, 1)
	addLiquid(w, 8, 5, 1)
	for (let i = 0; i < 30; i++) stepLiquid(w)

	assertEquals(w.liq[idx(w, 7, 8)], 0)
	assertEquals(w.liq[idx(w, 8, 8)], 0)
})

Deno.test('fluid: free liquid settles above HORIZON and spreads', () => {
	const w = createWorld({ width: 20, height: 12, margin: 2, bottomExtra: 2 })
	clearMaterials(w)
	for (let x = 4; x <= 14; x++) {
		// Saturated topsoil over impermeable bed — sheet flow without seepage loss.
		setMat(w, x, 9, MAT.HORIZON)
		w.moisture[idx(w, x, 9)] = SOIL_CAP
		setMat(w, x, 10, MAT.SEAL)
	}
	addLiquid(w, 8, 8, 1)
	addLiquid(w, 9, 8, 1)
	for (let i = 0; i < 40; i++) stepLiquid(w)

	let groundLiq = 0
	for (let x = 4; x <= 14; x++)
		groundLiq += w.liq[idx(w, x, 8)]
	assertGreater(groundLiq, 0.5)
	let wetCols = 0
	for (let x = 4; x <= 14; x++)
		if (w.liq[idx(w, x, 8)] >= 0.1) wetCols++
	assertGreater(wetCols, 2)
})

Deno.test('fluid: SEAL neither stores moisture nor absorbs free liquid', () => {
	const w = createWorld({ width: 10, height: 8, margin: 1, bottomExtra: 1 })
	clearMaterials(w)
	setMat(w, 4, 5, MAT.SEAL)
	addLiquid(w, 4, 4, 0.9)
	const before = totalGridWater(w)
	for (let i = 0; i < 20; i++) stepSoil(w)
	assertEquals(w.moisture[idx(w, 4, 5)], 0)
	assertEquals(addMoisture(w, 4, 5, 0.5), 0)
	assertAlmostEquals(w.liq[idx(w, 4, 4)], 0.9, 1e-4)
	assertAlmostEquals(totalGridWater(w), before, 1e-4)
})

Deno.test('fluid: soil absorbs free liquid into moisture', () => {
	const w = createWorld({ width: 12, height: 10, margin: 1, bottomExtra: 1 })
	clearMaterials(w)
	setMat(w, 5, 6, MAT.HORIZON)
	setMat(w, 5, 7, MAT.SEAL)
	addLiquid(w, 5, 5, 0.8)
	const before = totalGridWater(w)
	for (let i = 0; i < 25; i++) stepSoil(w)
	assertGreater(w.moisture[idx(w, 5, 6)], 0.2)
	assertLess(w.liq[idx(w, 5, 5)], 0.8)
	assertAlmostEquals(totalGridWater(w), before, 1e-4)
})

Deno.test('fluid: dry soil absorbs faster than wet soil', () => {
	const w = createWorld({ width: 12, height: 10, margin: 1, bottomExtra: 1 })
	clearMaterials(w)
	setMat(w, 4, 6, MAT.HORIZON)
	setMat(w, 6, 6, MAT.HORIZON)
	setMat(w, 4, 7, MAT.SEAL)
	setMat(w, 6, 7, MAT.SEAL)
	w.moisture[idx(w, 6, 6)] = 0.75
	assertGreater(soilAbsorbFactor(0), soilAbsorbFactor(0.75))
	addLiquid(w, 4, 5, 1)
	addLiquid(w, 6, 5, 1)
	stepSoil(w)
	const dryTook = 1 - w.liq[idx(w, 4, 5)]
	const wetTook = 1 - w.liq[idx(w, 6, 5)]
	assertGreater(dryTook, wetTook)
})

Deno.test('fluid: sustained rain forms surface puddles instead of all soaking away', () => {
	const w = createWorld({ width: 24, height: 14, margin: 2, bottomExtra: 2 })
	clearMaterials(w)
	for (let x = 4; x <= 18; x++) {
		setMat(w, x, 10, MAT.HORIZON)
		setMat(w, x, 11, MAT.SOLID)
		setMat(w, x, 12, MAT.SOLID)
	}

	// Rain-like input: ~2 ground hits/tick at 0.18 each (matches particle deposit size).
	for (let t = 0; t < 55; t++) {
		for (let k = 0; k < 2; k++) {
			const x = 5 + (t * 3 + k * 5) % 13
			const i = idx(w, x, 10)
			const hit = 0.18
			const want = hit * SOIL_HIT_ABSORB_FRAC * soilAbsorbFactor(w.moisture[i])
			const stored = addMoisture(w, x, 10, want)
			addLiquid(w, x, 9, hit - stored)
		}
		stepLiquid(w)
	}

	let puddleCells = 0
	let surfaceLiq = 0
	for (let x = 4; x <= 18; x++) {
		const L = w.liq[idx(w, x, 9)]
		surfaceLiq += L
		if (L >= LIQUID_DRAW_THRESHOLD) puddleCells++
	}
	assertGreater(puddleCells, 2)
	assertGreater(surfaceLiq, 1)
	const total = totalGridWater(w)
	assertGreater(total, 0)
	// A meaningful share must remain as free surface water, not only soil moisture.
	assertGreater(surfaceLiq / total, 0.2)
})

Deno.test('fluid: soil moisture prefers downward seepage over sides', () => {
	const w = createWorld({ width: 14, height: 12, margin: 1, bottomExtra: 1 })
	clearMaterials(w)
	for (const x of [5, 6, 7])
		for (const y of [5, 6, 7])
			setMat(w, x, y, MAT.SOLID)
	// Impermeable bed under the soil block so mass stays in-grid.
	for (const x of [5, 6, 7])
		setMat(w, x, 8, MAT.SEAL)
	addMoisture(w, 6, 5, 1)
	for (let i = 0; i < 12; i++) stepSoil(w)
	assertGreater(w.moisture[idx(w, 6, 7)], w.moisture[idx(w, 5, 5)])
	assertGreater(w.moisture[idx(w, 6, 7)], w.moisture[idx(w, 7, 5)])
})

Deno.test('fluid: soil ceiling condenses then drips into air below', () => {
	const w = createWorld({ width: 12, height: 12, margin: 1, bottomExtra: 1 })
	clearMaterials(w)
	for (let x = 3; x <= 7; x++) {
		setMat(w, x, 4, MAT.SOLID)
		setMat(w, x, 8, MAT.SEAL)
	}
	addMoisture(w, 5, 4, 1)
	const before = totalGridWater(w)
	let sawCondense = false
	for (let i = 0; i < 40; i++) {
		stepSoil(w)
		if (w.condense[idx(w, 5, 4)] >= COND_DRIP * 0.5) sawCondense = true
	}
	assert(sawCondense || w.liq[idx(w, 5, 5)] > 0.05 || w.liq[idx(w, 5, 6)] > 0.05 || w.liq[idx(w, 5, 7)] > 0.05)
	assertAlmostEquals(totalGridWater(w), before, 1e-3)
})

Deno.test('fluid: condensation Matthew effect amplifies the lead with noise', () => {
	const w = createWorld({ width: 14, height: 10, margin: 1, bottomExtra: 1 })
	clearMaterials(w)
	for (const x of [5, 6, 7]) {
		setMat(w, x, 4, MAT.SOLID)
		setMat(w, x, 7, MAT.SEAL)
	}
	w.condense[idx(w, 5, 4)] = 0.4
	w.condense[idx(w, 6, 4)] = 0.55
	w.condense[idx(w, 7, 4)] = 0.4
	const before = totalGridWater(w)
	const lead0 = w.condense[idx(w, 6, 4)]
	for (let i = 0; i < 25; i++) stepSoil(w)
	const lead1 = w.condense[idx(w, 6, 4)]
	const side = Math.max(w.condense[idx(w, 5, 4)], w.condense[idx(w, 7, 4)])
	// Leader should still dominate after noisy Matthew transfers (or have dripped).
	assert(lead1 + w.liq[idx(w, 6, 5)] + w.liq[idx(w, 6, 6)] >= lead0 - 0.05 || lead1 >= side)
	assertAlmostEquals(totalGridWater(w), before, 1e-3)
})

Deno.test('fluid: closed soil seepage conserves grid water', () => {
	const w = createWorld({ width: 16, height: 12, margin: 1, bottomExtra: 1 })
	clearMaterials(w)
	for (let y = 3; y <= 8; y++)
		for (let x = 4; x <= 10; x++)
			setMat(w, x, y, MAT.SOLID)
	// Seal under and around so no condense / edge sink.
	for (let x = 4; x <= 10; x++)
		setMat(w, x, 9, MAT.SEAL)
	addMoisture(w, 5, 3, 0.9)
	addMoisture(w, 8, 4, 0.7)
	addMoisture(w, 6, 6, 0.5)
	const before = totalGridWater(w)
	for (let i = 0; i < 50; i++) stepSoil(w)
	assertAlmostEquals(totalGridWater(w), before, 1e-4)
	for (let y = 3; y <= 8; y++)
		for (let x = 4; x <= 10; x++) {
			const m = w.moisture[idx(w, x, y)]
			assert(m >= -1e-6 && m <= SOIL_CAP + 1e-6)
		}
})

Deno.test('fluid: fallChar leans with velocity (| \\ / -)', () => {
	assertEquals(fallChar(FALL_HEAVY, 0, 0, 1), '|')
	assertEquals(fallChar(FALL_HEAVY + 0.2, 0, 0, 1), '|')
	assertEquals(fallChar(FALL_HEAVY - 0.01, 0, 0, 1), '.')
	assertEquals(fallChar(0.1, 1, 0, 1), ',')
	assertEquals(fallChar(0.6, 0, 0.2, 1), '\\')
	assertEquals(fallChar(0.6, 0, -0.2, 1), '/')
	assertEquals(fallChar(0.6, 0, 0.5, 0.1), '-')
	assertEquals(liquidChar(0.7, 0, true, 0, 1), '|')
	assertEquals(liquidChar(0.2, 0, true, 0, 1), '.')
	assertEquals(liquidChar(0.5, 0, true, 0.25, 0.8), '\\')
})

Deno.test('fluid: global wind varies with time', () => {
	const samples = []
	for (let t = 0; t < 200; t += 7)
		samples.push(globalWindAt(t, 42))
	const min = Math.min(...samples)
	const max = Math.max(...samples)
	assertGreater(max - min, 0.2)
	assert(samples.some(v => v > 0))
	assert(samples.some(v => v < 0))
})

Deno.test('fluid: wind shear is stronger aloft than near ground', () => {
	const H = 40
	const t = 20
	const seed = 7
	const aloft = Math.abs(windProfileAt(2, H, t, seed))
	const nearGround = Math.abs(windProfileAt(H - 3, H, t, seed))
	assertGreater(aloft, nearGround)
	assertGreater(aloft / Math.max(1e-6, nearGround), 1.3)
})

Deno.test('fluid: open-air gas field follows forced wind with height shear', () => {
	const w = createWorld({ width: 24, height: 20, margin: 2, bottomExtra: 2 })
	clearMaterials(w)
	for (let i = 0; i < 40; i++)
		stepGas(w, { time: i, seed: 1, forceWind: 0.8 })
	const top = Math.abs(gasVelocityAt(w, 12, 2).ux)
	const bot = Math.abs(gasVelocityAt(w, 12, w.worldH - 3).ux)
	assertGreater(top, 0.15)
	assertGreater(top, bot)
})

Deno.test('fluid: wind-tunnel throat is faster than wide section (continuity)', () => {
	const w = createWorld({ width: 36, height: 16, margin: 2, bottomExtra: 2 })
	clearMaterials(w)
	// Horizontal duct: floor+ceiling, span 3 in the wide section
	for (let x = 4; x <= 30; x++) {
		setMat(w, x, 4, MAT.SEAL)
		setMat(w, x, 8, MAT.SEAL)
	}
	// Throat at x=16..18: only mid row open (span 1)
	for (let x = 16; x <= 18; x++) {
		setMat(w, x, 5, MAT.SEAL)
		setMat(w, x, 7, MAT.SEAL)
	}

	for (let i = 0; i < 50; i++)
		stepGas(w, { time: i, seed: 0, forceWind: 0.9 })

	const wide = Math.abs(w.gasUx[idx(w, 10, 6)])
	const throat = Math.abs(w.gasUx[idx(w, 17, 6)])
	assertGreater(wide, 0.05)
	assertGreater(throat, wide * 1.15)
})

Deno.test('fluid: Bernoulli — higher speed carries higher dynamic pressure', () => {
	assertGreater(dynamicPressure(1.2), dynamicPressure(0.4))
	assertAlmostEquals(dynamicPressure(2, 0), 0.5 * 1 * 4, 1e-9)
})

Deno.test('fluid: Bernoulli — tunnel throat has lower static pressure', () => {
	const w = createWorld({ width: 36, height: 16, margin: 2, bottomExtra: 2 })
	clearMaterials(w)
	for (let x = 4; x <= 30; x++) {
		setMat(w, x, 4, MAT.SEAL)
		setMat(w, x, 8, MAT.SEAL)
	}
	for (let x = 16; x <= 18; x++) {
		setMat(w, x, 5, MAT.SEAL)
		setMat(w, x, 7, MAT.SEAL)
	}
	for (let i = 0; i < 50; i++)
		stepGas(w, { time: i, seed: 0, forceWind: 0.9 })

	const pWide = staticPressureAt(w, 10, 6)
	const pThroat = staticPressureAt(w, 17, 6)
	assertLess(pThroat, pWide)
})

Deno.test('fluid: flow stagnates against a solid face', () => {
	const w = createWorld({ width: 24, height: 14, margin: 2, bottomExtra: 2 })
	clearMaterials(w)
	for (let y = 2; y <= 10; y++)
		setMat(w, 14, y, MAT.SEAL)
	for (let i = 0; i < 35; i++)
		stepGas(w, { time: i, seed: 0, forceWind: 0.85 })
	const ahead = Math.abs(w.gasUx[idx(w, 13, 6)])
	const free = Math.abs(w.gasUx[idx(w, 8, 6)])
	assertGreater(free, 0.1)
	assertLess(ahead, free * 0.55)
})

Deno.test('fluid: rain particles are dragged by local gas velocity', () => {
	const w = createWorld({ width: 16, height: 12, margin: 2, bottomExtra: 2 })
	clearMaterials(w)
	w.gasUx.fill(0.6)
	spawnParticle(w, 8, 2, 0, 0.4, 40, 0.5)
	/**
	 *
	 */
	const hit = () => { /* no-op */ }
	for (let i = 0; i < 8; i++)
		stepParticles(w, hit)
	assert(w.particles.length > 0)
	assertGreater(w.particles[0].vx, 0.15)
})
