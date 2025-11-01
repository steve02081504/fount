import { AsyncLocalStorage } from 'node:async_hooks'

import { getMemoryUsage } from './gc.mjs'

const defaultProfilerStack = []
const asyncLocalStorage = new AsyncLocalStorage()
/**
 * 获取当前的性能分析器堆栈。
 * @returns {object[]} 性能分析器堆栈。
 */
function getProfilerStack() {
	return asyncLocalStorage.getStore() ?? defaultProfilerStack
}

/**
 * 开始一个新的性能分析帧。
 */
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
 * }} 性能分析结果。
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

/**
 * 执行一个函数并对其进行性能分析。
 * @param {Function} fn - 要进行性能分析的函数。
 * @returns {Promise<any>} 一个解析为性能分析结果的承诺。
 */
export function doProfile(fn) {
	return asyncLocalStorage.run([...getProfilerStack()], async () => {
		startProfile()
		await fn()
		return endProfile()
	})
}
