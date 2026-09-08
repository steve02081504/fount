import { makeStaticChar } from '../shared/static_char.mjs'
/**
 * 角色 API 类型别名。
 * @typedef {import('../../../../../../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 */
/**
 * code shell 前端测试用角色：第二个角色，用于验证角色切换。
 * @type {CharAPI_t}
 */
export default makeStaticChar({
	name: 'testAgent',
	description: 'code shell 前端测试用测试代理角色',
	reply: '我是 testAgent，角色切换验证。',
})
