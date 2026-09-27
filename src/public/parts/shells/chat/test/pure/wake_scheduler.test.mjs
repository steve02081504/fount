/* global Deno */
/**
 * wakeScheduler 纯测试：单调序号唤醒调度（空闲开始、重复开始、mark/release 待触发判定、快照观察的竞态、合并、丢弃、键独立）。
 */
import { assertEquals } from 'jsr:@std/assert'

import { createWakeScheduler } from '../../src/reply/wakeScheduler.mjs'

Deno.test('wakeScheduler tryBegin succeeds when idle', () => {
	const scheduler = createWakeScheduler()
	assertEquals(scheduler.tryBegin('k'), true)
	assertEquals(scheduler.isRunning('k'), true)
})

Deno.test('wakeScheduler double tryBegin fails', () => {
	const scheduler = createWakeScheduler()
	assertEquals(scheduler.tryBegin('k'), true)
	assertEquals(scheduler.tryBegin('k'), false)
	assertEquals(scheduler.isRunning('k'), true)
})

Deno.test('wakeScheduler mark then release reports pending', () => {
	const scheduler = createWakeScheduler()
	scheduler.tryBegin('k')
	scheduler.mark('k')
	assertEquals(scheduler.release('k'), true, '未观察到的唤醒应报告 pending')
	assertEquals(scheduler.isRunning('k'), false)
})

Deno.test('wakeScheduler observe with snapshot taken after mark clears pending', () => {
	const scheduler = createWakeScheduler()
	scheduler.tryBegin('k')
	scheduler.mark('k')
	const snap = scheduler.snapshot()
	scheduler.observe('k', snap)
	assertEquals(scheduler.release('k'), false, '读取前已 mark 并被观察到，不应补触发')
})

Deno.test('wakeScheduler observe with snapshot taken before mark does NOT clear pending', () => {
	const scheduler = createWakeScheduler()
	scheduler.tryBegin('k')
	const snap = scheduler.snapshot()
	scheduler.mark('k')
	scheduler.observe('k', snap)
	assertEquals(scheduler.release('k'), true, '读取期间到达的唤醒必须补触发（竞态回归）')
})

Deno.test('wakeScheduler multiple marks collapse', () => {
	const scheduler = createWakeScheduler()
	scheduler.tryBegin('k')
	scheduler.mark('k')
	scheduler.mark('k')
	scheduler.mark('k')
	assertEquals(scheduler.release('k'), true, '多次唤醒合并为最多补一次')
})

Deno.test('wakeScheduler multiple marks all observed clear pending', () => {
	const scheduler = createWakeScheduler()
	scheduler.tryBegin('k')
	scheduler.mark('k')
	scheduler.mark('k')
	const snap = scheduler.snapshot()
	scheduler.observe('k', snap)
	assertEquals(scheduler.release('k'), false)
})

Deno.test('wakeScheduler discard clears running and pending', () => {
	const scheduler = createWakeScheduler()
	scheduler.tryBegin('k')
	scheduler.mark('k')
	scheduler.discard('k')
	assertEquals(scheduler.isRunning('k'), false)
	assertEquals(scheduler.tryBegin('k'), true, 'discard 后应可重新开始')
	scheduler.mark('k')
	scheduler.observe('k', scheduler.snapshot())
	assertEquals(scheduler.release('k'), false, 'discard 后唤醒状态不应残留')
})

Deno.test('wakeScheduler independent keys are independent', () => {
	const scheduler = createWakeScheduler()
	scheduler.tryBegin('a')
	const snapA = scheduler.snapshot()
	scheduler.observe('a', snapA)
	scheduler.mark('b')
	assertEquals(scheduler.release('a'), false, 'a 无未观察唤醒')
	assertEquals(scheduler.release('b'), true, 'b 有未观察唤醒')
})
