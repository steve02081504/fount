/**
 * Pure tests: air-region pressure, gas conservation, hydraulic U-tube.
 */
/* global Deno */
import { assert, assertAlmostEquals, assertEquals, assertGreater, assertLess } from 'jsr:@std/assert'

import {
	MAT, createWorld, setMat, addLiquid, stepLiquid, labelAirRegions,
	pressureAt, totalSealedGas, P_ATM, clearMaterials, idx,
} from '../fluid_engine.mjs'

/**
 * Build a sealed box cavity with optional liquid.
 * @param {{ fillBottom?: number }} [opts] fill options
 * @returns {ReturnType<typeof createWorld>} world
 */
const sealedBox = (opts = {}) => {
	const w = createWorld({ width: 20, height: 16, margin: 2, bottomExtra: 2 })
	clearMaterials(w)
	for (let y = 4; y <= 10; y++)
		for (let x = 4; x <= 10; x++) {
			const edge = y === 4 || y === 10 || x === 4 || x === 10
			if (edge) setMat(w, x, y, MAT.SOLID)
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
	// floor and walls forming a U: wells at x=8 and x=18, bottom y=14..15, tops open
	for (let x = 6; x <= 20; x++) {
		setMat(w, x, 15, MAT.SOLID)
		setMat(w, x, 16, MAT.SOLID)
	}
	for (let y = 6; y <= 15; y++) {
		setMat(w, 6, y, MAT.SOLID)
		setMat(w, 10, y, MAT.SOLID)
		setMat(w, 16, y, MAT.SOLID)
		setMat(w, 20, y, MAT.SOLID)
	}
	// bottom channel open 7..19 at y=14 (carve by not placing solid — already only floor at 15)
	for (let x = 7; x <= 19; x++)
		setMat(w, x, 14, MAT.SOLID)
	// open channel: clear 8-9 and 17-18 and bottom path
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
		setMat(w, x, 10, MAT.SOLID)

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
		setMat(w, x, 9, MAT.HORIZON, 2)
		setMat(w, x, 10, MAT.SOLID)
	}
	addLiquid(w, 8, 8, 1)
	addLiquid(w, 9, 8, 1)
	for (let i = 0; i < 40; i++) stepLiquid(w)

	let groundLiq = 0
	for (let x = 4; x <= 14; x++)
		groundLiq += w.liq[idx(w, x, 8)]
	assertGreater(groundLiq, 0.5)
	// should have spread beyond the two seed columns
	let wetCols = 0
	for (let x = 4; x <= 14; x++)
		if (w.liq[idx(w, x, 8)] >= 0.1) wetCols++
	assertGreater(wetCols, 2)
})
