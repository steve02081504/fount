import path from 'node:path'
import process from 'node:process'

/**
 * 应用程序的根目录。
 * @type {string}
 */
export const __dirname = path.resolve(import.meta.dirname + '/../../')

/**
 * 应用程序启动时的时间戳。
 * @type {Date}
 */
export const startTime = new Date(process.env.FOUNT_START_TIME ?? Date.now())

/**
 * 脚本加载时的时间戳。
 * @type {Date}
 */
export const baseScriptLoadedTime = new Date()

/**
 * 一个占位函数。
 * @returns {void}
 */
export function set_start() { }
