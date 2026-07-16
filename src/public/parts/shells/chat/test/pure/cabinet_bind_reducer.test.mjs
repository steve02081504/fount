import { cabinetReducers } from '../../src/chat/dag/reducers/cabinets.mjs'

Deno.test('cabinet_bind / key_update / unbind materialize', () => {
	let state = { cabinets: {} }
	state = cabinetReducers.cabinet_bind(state, {
		sender: 'a'.repeat(64),
		timestamp: 1,
		content: {
			cabinet_id: 'b'.repeat(64),
			name: 'docs',
			write_pubkey: 'c'.repeat(64),
			role_access: { '@everyone': 'ro', admin: 'rw' },
			keyWraps: { ['a'.repeat(64)]: { read: [] } },
		},
	})
	if (state.cabinets['b'.repeat(64)]?.name !== 'docs') throw new Error('bind failed')
	state = cabinetReducers.cabinet_key_update(state, {
		content: {
			cabinet_id: 'b'.repeat(64),
			read_generation: 2,
			keyWraps: { ['d'.repeat(64)]: { read: [{ gen: 2 }] } },
		},
	})
	if (state.cabinets['b'.repeat(64)].read_generation !== 2) throw new Error('key update failed')
	if (!state.cabinets['b'.repeat(64)].keyWraps['d'.repeat(64)]) throw new Error('wrap merge failed')
	state = cabinetReducers.cabinet_unbind(state, { content: { cabinet_id: 'b'.repeat(64) } })
	if (state.cabinets['b'.repeat(64)]) throw new Error('unbind failed')
})
