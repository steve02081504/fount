import path from 'node:path'
/**
 * 应用程序的根目录。
 * @type {string}
 */
export const __dirname = path.resolve(import.meta.dirname + '/../../')

/**
 * 应用程序启动时的时间戳。
 * @type {Date}
 */
export const startTime = new Date()
/**
 * 一个占位函数。
 * @returns {void}
 */
export function set_start() { }
