/**
 * 测试进程标记。display/CLI 不能 import env.mjs（编排器堆快照），但须在导入 i18n 前设置。
 */
import process from 'node:process'

process.env.FOUNT_TEST ??= '1'
