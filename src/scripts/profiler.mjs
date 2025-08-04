import { AsyncLocalStorage } from 'node:async_hooks'

import { getMemoryUsage } from './gc.mjs'

const defaultProfilerStack = []
const asyncLocalStorage = new AsyncLocalStorage()
function getProfilerStack() {
	return asyncLocalStorage.getStore() ?? defaultProfilerStack
}

function startProfile() {
	getProfilerStack().push({
		startTime: new Date(),
		startMemory: getMemoryUsage(),
		exclusiveTime: 0,
		exclusiveMemory: 0
	})
}

/**
 * 结束最近一次的性能分析，并计算相关指标。
 * @returns {{
 *   startTime: Date,
 *   totalTimeInMs: number,
 *   exclusiveTimeInMs: number,
 *   totalMemoryChangeInMB: number,
 *   exclusiveMemoryChangeInMB: number
 * }}
 */
function endProfile() {
	const profilerStack = getProfilerStack()

	const endTime = new Date()
	const endMemory = getMemoryUsage()

	const currentFrame = profilerStack.pop()
	const { startTime, startMemory } = currentFrame

	const totalTimeInMs = endTime - startTime
	const totalMemoryChange = endMemory - startMemory

	currentFrame.exclusiveTime += totalTimeInMs
	currentFrame.exclusiveMemory += totalMemoryChange

	profilerStack.forEach(parentFrame => {
		parentFrame.exclusiveTime -= totalTimeInMs
		parentFrame.exclusiveMemory -= totalMemoryChange
	})

	return {
		startTime,
		totalTimeInMs,
		exclusiveTimeInMs: currentFrame.exclusiveTime,
		totalMemoryChangeInMB: totalMemoryChange / 1024 / 1024,
		exclusiveMemoryChangeInMB: currentFrame.exclusiveMemory / 1024 / 1024
	}
}

export function doProfile(fn) {
	return asyncLocalStorage.run([...getProfilerStack()], async () => {
		startProfile()
		await fn()
		return endProfile()
	})
}
