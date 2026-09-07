import { makeStaticChar } from '../shared/static_char.mjs'
/**
 * 角色 API 类型别名。
 * @typedef {import('../../../../../../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 */
/**
 * code shell 前端测试用角色：仅提供静态回复，不依赖 AI 源。
 * @type {CharAPI_t}
 */
export default makeStaticChar({
	name: 'codeBuddy',
	description: 'code shell 前端测试用编码搭档角色',
})