/**
 * 纯测试：动画生命周期、退场边界、缩放迁移、帧尺寸。
 */
/* global Deno */
import { assert, assertEquals, assertGreater } from 'jsr:@std/assert'

import { MAT, addLiquid, spawnParticle, idx } from '../fluid/index.mjs'
import {
	createAnimState, resizeAnimState, enter, hold, exit, renderGrid,
	ICON_W, ICON_H, ICON_PACK_H, ICON_BASE_ROWS, ICON_BASE_X0, ICON_BASE_X1,
	maxBodyD, maxPillarH,
} from '../index.mjs'

Deno.test('layout: ICON_W matches packed bitmap', () => {
	assertEquals(ICON_W, 42)
	assertEquals(ICON_PACK_H, 20)
	assertEquals(ICON_H, 23)
})

Deno.test('createAnimState: fixed seed + size', () => {
	const first = createAnimState({ width: 60, height: 30, seed: 1 })
	const second = createAnimState({ width: 60, height: 30, seed: 1 })
	assertEquals([...first.terrain.surface], [...second.terrain.surface])
	assertEquals(first.width, 60)
	assertEquals(first.height, 30)
})

Deno.test('enter: reaches full icon', () => {
	const state = createAnimState({ width: 50, height: 28, seed: 3 })
	let frames = 0
	for (const _ of enter(state)) frames++
	assertGreater(frames, 10)
	assertEquals(state.baseBot, ICON_BASE_X1 - ICON_BASE_X0)
	assertEquals(state.pillars, maxPillarH)
	assertEquals(state.bodyReach, maxBodyD)
})

Deno.test('exit: ends when icon gone without draining rain wait', () => {
	const state = createAnimState({ width: 50, height: 28, seed: 5 })
	for (const _ of enter(state));
	// inject leftover liquid + particles
	addLiquid(state.world, state.world.ox + 10, 10, 1)
	spawnParticle(state.world, state.world.ox + 5, 2, 0, 0.5, 40)
	const beforeParticles = state.world.particles.count
	assertGreater(beforeParticles, 0)

	let frames = 0
	let last = ''
	for (const frame of exit(state)) {
		frames++
		last = frame
	}
	assertGreater(frames, 5)
	// icon progress cleared
	assertEquals(state.baseBot, 0)
	assertEquals(state.pillars, 0)
	assertEquals(state.bodyReach, -1)
	// final frame is empty grid of exact size
	const lines = last.split('\n')
	assertEquals(lines.length, state.height)
	assertEquals(lines[0].replace(/\x1b\[[\d;]*m/g, '').length, state.width)
	// exit must be shorter than old 90-frame drain budget
	assert(frames < 90 + maxBodyD + maxPillarH * 2 + (ICON_BASE_X1 - ICON_BASE_X0))
})

Deno.test('hold: yields at least one frame', () => {
	const state = createAnimState({ width: 48, height: 26, seed: 8 })
	const gen = hold(state)
	const first = gen.next()
	assertEquals(first.done, false)
	assert(typeof first.value === 'string')
	gen.return?.()
})

Deno.test('hold: pillars leave AIR so liquid passes the jet columns', () => {
	const state = createAnimState({ width: 48, height: 26, seed: 8 })
	const gen = hold(state)
	assertEquals(gen.next().done, false)

	const { world, iconOx, iconOy } = state
	// Three :: pillars at local x 16/20/24, mid-height of the jet
	for (const lx of [16, 20, 24]) {
		const x = iconOx + lx
		const y = iconOy + 8
		assertEquals(world.mat[idx(world, x, y)], MAT.AIR)
		assertEquals(world.mat[idx(world, x + 1, y)], MAT.AIR)
		assertGreater(addLiquid(world, x, y, 0.8), 0.7)
	}
	gen.return?.()
})

Deno.test('hold: BODY impact leaves no pooled liquid in the silhouette', () => {
	const state = createAnimState({ width: 48, height: 26, seed: 8 })
	const gen = hold(state)
	assertEquals(gen.next().done, false)

	const { world } = state
	let bodyCells = 0
	for (let y = 0; y < world.worldH; y++)
		for (let x = 0; x < world.worldW; x++)
			if (world.mat[idx(world, x, y)] === MAT.BODY) {
				assertEquals(addLiquid(world, x, y, 1), 0)
				bodyCells++
			}
	assertGreater(bodyCells, 0)

	// Drop a particle onto a body cell — after a frame it must not leave fill in BODY
	let bodyX = -1, bodyY = -1
	for (let y = 0; y < world.worldH && bodyX < 0; y++)
		for (let x = 0; x < world.worldW; x++)
			if (world.mat[idx(world, x, y)] === MAT.BODY) {
				bodyX = x
				bodyY = y
				break
			}
	spawnParticle(world, bodyX + 0.2, bodyY - 1.2, 0, 0.8, 40)
	const { value: frame } = gen.next()
	assertEquals(world.liq[idx(world, bodyX, bodyY)], 0)
	assert(typeof frame === 'string')
	gen.return?.()
})

Deno.test('hold: pool liquid leaks to the next base slab', () => {
	const state = createAnimState({ width: 48, height: 26, seed: 8 })
	const gen = hold(state)
	assertEquals(gen.next().done, false)

	const { world, iconOx, iconOy } = state
	const upper = iconOy + ICON_BASE_ROWS[0]
	const lower = iconOy + ICON_BASE_ROWS[1]
	const x = iconOx + ICON_BASE_X0 + 12
	assertEquals(world.mat[idx(world, x, upper)], MAT.POOL)
	assertEquals(world.mat[idx(world, x, lower)], MAT.POOL)

	addLiquid(world, x, upper, 1)
	for (let i = 0; i < 12; i++) gen.next()

	assertGreater(world.liq[idx(world, x, lower)], 0.05)
	gen.return?.()
})

Deno.test('resizeAnimState: preserves terrain and weathers only newly exposed soil', () => {
	const state = createAnimState({ width: 50, height: 28, seed: 11 })
	state.baseBot = state.baseTop = ICON_BASE_X1 - ICON_BASE_X0
	state.pillars = maxPillarH
	state.bodyReach = maxBodyD
	state.frame = 40
	addLiquid(state.world, state.world.ox + 8, 12, 0.8)
	const oldTerrain = state.terrain
	const oldIconOx = state.iconOx
	const oldIconOy = state.iconOy

	resizeAnimState(state, { width: 70, height: 36 })
	assertEquals(state.width, 70)
	assertEquals(state.height, 36)
	assertEquals(state.seed, 11)
	assertEquals(state.pillars, maxPillarH)
	assertEquals(state.frame, 40)
	assertEquals(state.terrain.surface.length, state.world.worldW)

	const dx = state.iconOx - oldIconOx
	const dy = state.iconOy - oldIconOy
	for (let x = 0; x < oldTerrain.worldW; x++)
		assertEquals(state.terrain.surface[x + dx], oldTerrain.surface[x] + dy)
	for (let y = 0; y < oldTerrain.worldH; y++)
		for (let x = 0; x < oldTerrain.worldW; x++)
			assertEquals(
				state.terrain.solid[(y + dy) * state.world.worldW + x + dx],
				oldTerrain.solid[y * oldTerrain.worldW + x],
			)

	let wetAddedSoil = 0
	for (let y = 0; y < state.world.worldH; y++)
		for (let x = 0; x < state.world.worldW; x++) {
			const fromOld = x >= dx && x < dx + oldTerrain.worldW &&
				y >= dy && y < dy + oldTerrain.worldH
			const i = idx(state.world, x, y)
			if (!fromOld && state.terrain.solid[i] && state.world.moisture[i] > 0)
				wetAddedSoil++
		}
	assertGreater(wetAddedSoil, 0)
})

Deno.test('renderGrid: fixed height/width', () => {
	const width = 10
	const height = 4
	const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => null))
	grid[1][2] = { ch: 'x', fg: '\x1b[31m' }
	const text = renderGrid(grid, width, height)
	const lines = text.split('\n')
	assertEquals(lines.length, height)
	const plain = lines.map(l => l.replace(/\x1b\[[\d;]*m/g, ''))
	for (const line of plain) assertEquals(line.length, width)
})

Deno.test('lightFalloff: center bright, edge zero, soft circle', async () => {
	const { lightFalloff, LIGHT_RADIUS } = await import('../compose.mjs')
	assertEquals(lightFalloff(0, 0), 1)
	assertEquals(lightFalloff(LIGHT_RADIUS, 0), 0)
	assertEquals(lightFalloff(0, LIGHT_RADIUS), 0)
	assert(lightFalloff(3, 0) > lightFalloff(8, 0))
	// Aspect: one cell in y ≈ two cells in x visually
	assertEquals(lightFalloff(4, 0) > 0, true)
	assert(Math.abs(lightFalloff(4, 0) - lightFalloff(0, 2)) < 1e-9)
})

Deno.test('light gesture: quick release → ripple; hold → torch fade', async () => {
	const {
		createLightGesture, lightPointer, tickLightGesture, sampleLight,
		rippleFalloff, TORCH_DELAY, TORCH_FADE, RIPPLE_SPEED, RIPPLE_LIFE,
	} = await import('../gesture/light.mjs')
	const { lightFalloff } = await import('../compose.mjs')

	// Soft ring: peak on wavefront, quiet at centre for a large radius
	assert(rippleFalloff(0, 0, 8) < 0.05)
	assert(rippleFalloff(8, 0, 8) > 0.9)
	assertEquals(rippleFalloff(20, 0, 8), 0)

	const click = createLightGesture()
	lightPointer(click, { x: 12, y: 7, left: true })
	tickLightGesture(click)
	assertEquals(click.torch, false)
	lightPointer(click, { x: 12, y: 7, left: false })
	assertEquals(click.down, false)
	assertEquals(click.ripples.length, 1)
	assertEquals(click.ripples[0].x, 12)
	tickLightGesture(click) // age → 1 → ring at RIPPLE_SPEED
	const ring = sampleLight(click, 12 + RIPPLE_SPEED, 7, lightFalloff)
	assertEquals(ring.ambient, 0)
	assert(ring.lift > 0.5)

	for (let index = 0; index < RIPPLE_LIFE; index++) tickLightGesture(click)
	assertEquals(click.ripples.length, 0)

	const torchGesture = createLightGesture()
	lightPointer(torchGesture, { x: 5, y: 4, left: true })
	for (let index = 0; index < TORCH_DELAY; index++) tickLightGesture(torchGesture)
	assertEquals(torchGesture.torch, true)
	assertEquals(torchGesture.ripples.length, 0)
	assert(torchGesture.torchBlend > 0 && torchGesture.torchBlend < 1)
	const fadingIn = sampleLight(torchGesture, 5, 4, lightFalloff)
	assert(fadingIn.ambient > 0)
	assert(fadingIn.lift > 0 && fadingIn.lift < 1)

	for (let index = 0; index < TORCH_FADE; index++) tickLightGesture(torchGesture)
	assertEquals(torchGesture.torchBlend, 1)
	const torch = sampleLight(torchGesture, 5, 4, lightFalloff)
	assertEquals(torch.ambient, 1)
	assertEquals(torch.lift, 1)
	const dimFar = sampleLight(torchGesture, 5 + 40, 4, lightFalloff)
	assertEquals(dimFar.ambient, 1)
	assertEquals(dimFar.lift, 0)

	lightPointer(torchGesture, { x: 8, y: 4, left: true })
	assertEquals(torchGesture.x, 8)
	lightPointer(torchGesture, { x: 8, y: 4, left: false })
	assertEquals(torchGesture.down, false)
	assertEquals(torchGesture.torch, false)
	assertEquals(torchGesture.ripples.length, 0)
	assertEquals(torchGesture.torchBlend, 1)
	tickLightGesture(torchGesture)
	assert(torchGesture.torchBlend < 1 && torchGesture.torchBlend > 0)
	const fadingOut = sampleLight(torchGesture, 8, 4, lightFalloff)
	assert(fadingOut.ambient > 0 && fadingOut.ambient < 1)
	for (let index = 0; index < TORCH_FADE; index++) tickLightGesture(torchGesture)
	assertEquals(torchGesture.torchBlend, 0)
	assertEquals(sampleLight(torchGesture, 8, 4, lightFalloff).ambient, 0)
})

Deno.test('consumeStdin: SGR left/right press/drag/release + Ctrl+C', async () => {
	const { consumeStdin } = await import('../player.mjs')
	const events = []
	let aborted = false
	/**
	 * @returns {void}
	 */
	const abort = () => { aborted = true }
	/**
	 * @param {{ x: number, y: number, left?: boolean, right?: boolean }} ev 指针事件
	 * @returns {void}
	 */
	const onPointer = (ev) => { events.push(ev) }
	/**
	 * @param {string} ascii ASCII 字符串
	 * @returns {Uint8Array} 编码结果
	 */
	const encode = (ascii) => Uint8Array.from(ascii, c => c.charCodeAt(0))
	const handlers = { abort, onPointer }
	let carry = ''
	carry = consumeStdin(carry, encode('\x1b[<0;5;8M'), handlers)
	assertEquals(carry, '')
	assertEquals(events.at(-1), { x: 4, y: 7, left: true })
	carry = consumeStdin(carry, encode('\x1b[<32;12;9M'), handlers)
	assertEquals(events.at(-1), { x: 11, y: 8, left: true })
	carry = consumeStdin(carry, encode('\x1b[<0;12;9m'), handlers)
	assertEquals(events.at(-1), { x: 11, y: 8, left: false })
	// Right press / drag / release
	carry = consumeStdin(carry, encode('\x1b[<2;6;4M'), handlers)
	assertEquals(events.at(-1), { x: 5, y: 3, right: true })
	carry = consumeStdin(carry, encode('\x1b[<34;10;5M'), handlers)
	assertEquals(events.at(-1), { x: 9, y: 4, right: true })
	carry = consumeStdin(carry, encode('\x1b[<2;10;5m'), handlers)
	assertEquals(events.at(-1), { x: 9, y: 4, right: false })
	// Wheel ignored
	const n = events.length
	consumeStdin('', encode('\x1b[<64;1;1M'), handlers)
	assertEquals(events.length, n)
	// Middle ignored
	consumeStdin('', encode('\x1b[<1;2;2M'), handlers)
	assertEquals(events.length, n)
	// Split CSI across chunks
	carry = consumeStdin('', encode('\x1b[<0;3;5'), handlers)
	assert(carry.length > 0)
	carry = consumeStdin(carry, encode('M'), handlers)
	assertEquals(carry, '')
	assertEquals(events.at(-1), { x: 2, y: 4, left: true })
	consumeStdin('', Uint8Array.of(0x03), handlers)
	assertEquals(aborted, true)
})

Deno.test('wind gesture: stroke speed + clockwise vortex + release clear', async () => {
	const {
		createWindGesture, windPointer, tickWindGesture, fillWindDrive,
		VORTEX_DELAY, STILL_EPS, VORTEX_MAX,
	} = await import('../gesture/wind.mjs')
	const { createWorld, scratch } = await import('../fluid/world.mjs')
	const world = createWorld({ width: 40, height: 24, margin: 4, bottomExtra: 2 })
	const n = world.worldW * world.worldH
	const driveUx = scratch(world, 'tUx', n, Float32Array)
	const driveUy = scratch(world, 'tUy', n, Float32Array)
	const gesture = createWindGesture()

	// Fast rightward drag → positive ux along the stroke
	windPointer(gesture, { x: 10, y: 8, right: true })
	tickWindGesture(gesture) // arm at rest
	windPointer(gesture, { x: 10 + STILL_EPS + 4, y: 8, right: true })
	tickWindGesture(gesture)
	assert(gesture.strokes.length >= 1)
	assert(gesture.strokes.at(-1).ux > 0.5)
	fillWindDrive(gesture, world, driveUx, driveUy)
	const mid = (8 + world.oy) * world.worldW + (12 + world.ox)
	assert(driveUx[mid] > 0.2)

	// Long still → tornado: clockwise top + net updraft
	const vortexGesture = createWindGesture()
	windPointer(vortexGesture, { x: 20, y: 10, right: true })
	for (let index = 0; index < VORTEX_DELAY + 20; index++) tickWindGesture(vortexGesture)
	assertEquals(vortexGesture.vortexOn, true)
	assert(vortexGesture.strength > 1.5)
	assert(vortexGesture.strength <= VORTEX_MAX)
	fillWindDrive(vortexGesture, world, driveUx, driveUy)
	const top = (8 + world.oy) * world.worldW + (20 + world.ox)
	const core = (10 + world.oy) * world.worldW + (20 + world.ox)
	assert(driveUx[top] > 0.2, 'clockwise: above centre → +ux')
	assert(driveUy[core] < -1, 'updraft at core')

	// Drag while vortex on → centre follows; stop reforms
	windPointer(vortexGesture, { x: 28, y: 10, right: true })
	tickWindGesture(vortexGesture)
	assertEquals(vortexGesture.vortexOn, true)
	assertEquals(vortexGesture.x, 28)
	tickWindGesture(vortexGesture) // still at new spot → regenerate path
	assertEquals(vortexGesture.vortexOn, true)

	windPointer(vortexGesture, { x: 28, y: 10, right: false })
	assertEquals(vortexGesture.down, false)
	assertEquals(vortexGesture.vortexOn, false)
	fillWindDrive(vortexGesture, world, driveUx, driveUy)
	assertEquals(driveUx[top], 0)
})

Deno.test('stepGas: pointer drive accelerates local gas', async () => {
	const { createWorld, labelAirRegions, stepGas, scratch } = await import('../fluid/index.mjs')
	const world = createWorld({ width: 30, height: 16, margin: 2, bottomExtra: 1 })
	labelAirRegions(world)
	const n = world.worldW * world.worldH
	const driveUx = scratch(world, 'dUx', n, Float32Array)
	const driveUy = scratch(world, 'dUy', n, Float32Array)
	const cx = world.ox + 15
	const cy = 6
	const cell = cy * world.worldW + cx
	driveUx[cell] = 2.0
	for (let i = 0; i < 12; i++)
		stepGas(world, { time: i, seed: 0, forceWind: 0, driveUx, driveUy })
	assert(world.gasUx[cell] > 0.6)
})

Deno.test('composeFrame: light yields truecolor near cursor', async () => {
	const { composeFrame } = await import('../compose.mjs')
	const { lightPointer, tickLightGesture, TORCH_DELAY, TORCH_FADE } = await import('../gesture/light.mjs')
	const state = createAnimState({ width: 40, height: 20, seed: 9 })
	for (const _ of enter(state));
	lightPointer(state.light, { x: 20, y: 10, left: true })
	for (let i = 0; i < TORCH_DELAY; i++) tickLightGesture(state.light)
	const lit = composeFrame(state)
	assert(lit.includes('\x1b[38;2;'))
	lightPointer(state.light, { x: 20, y: 10, left: false })
	// Fade-out keeps truecolor until torchBlend reaches 0.
	assert(composeFrame(state).includes('\x1b[38;2;'))
	for (let i = 0; i < TORCH_FADE; i++) tickLightGesture(state.light)
	assertEquals(state.light.torchBlend, 0)
	const dark = composeFrame(state)
	assertEquals(dark.includes('\x1b[38;2;'), false)

	// Quick click → ripple truecolor without staying as a torch
	lightPointer(state.light, { x: 15, y: 8, left: true })
	lightPointer(state.light, { x: 15, y: 8, left: false })
	assertEquals(state.light.torch, false)
	assert(state.light.ripples.length >= 1)
	tickLightGesture(state.light)
	const rippled = composeFrame(state)
	assert(rippled.includes('\x1b[38;2;'))
})

Deno.test('sim frame from enter has correct dimensions', () => {
	const state = createAnimState({ width: 55, height: 30, seed: 2 })
	const gen = enter(state)
	const { value } = gen.next()
	const lines = value.split('\n')
	assertEquals(lines.length, 30)
	const plain0 = lines[0].replace(/\x1b\[[\d;]*m/g, '')
	assertEquals(plain0.length, 55)
	gen.return?.()
})
