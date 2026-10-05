/* global Deno */
import { assertEquals, assertMatch, assertNotMatch } from 'jsr:@std/assert'
import express from 'npm:express'
import request from 'npm:supertest'

import { maskNotFound } from '../../web_server/not_found_mask.mjs'

Deno.test('anonymous remote 404 responses become Cloudflare 500 pages across response formats', async () => {
	const app = express()
	app.use((req, res, next) => {
		if (req.get('Test-User')) req.user = { username: 'tester' }
		if (!req.get('Test-Local')) maskNotFound(res)
		next()
	})
	app.use((req, res) => {
		res.status(req.path === '/success' ? 200 : 404)
		if (req.path === '/json') return res.json({ message: 'secret missing resource' })
		if (req.path === '/end') return res.end('secret missing resource')
		if (req.path === '/headers') {
			res.writeHead(404, { 'Content-Type': 'application/json' })
			return res.end('secret missing resource')
		}
		if (req.path === '/stream') {
			res.write('secret missing resource')
			return res.end('tail')
		}
		return res.send('secret missing resource')
	})
	for (const path of ['/json', '/end', '/stream', '/text', '/headers']) {
		const result = await request(app).get(path).set('Accept', 'application/json')
			.set('Cf-Ray', '0123456789abcdef-HKG').set('X-Forwarded-For', '203.0.113.9')
		assertEquals(result.status, 500)
		assertMatch(result.headers['content-type'], /text\/html/)
		assertMatch(result.text, /Internal server error/)
		assertMatch(result.text, /0123456789abcdef/)
		assertMatch(result.text, /203\.0\.113\.9/)
		assertNotMatch(result.text, /secret missing resource|abcdef-HKG/)
	}
	assertEquals((await request(app).head('/text')).status, 500)
	assertEquals((await request(app).get('/text').set('Test-User', 'yes')).status, 404)
	assertEquals((await request(app).get('/text').set('Test-Local', 'yes')).status, 404)
	assertEquals((await request(app).get('/success')).status, 200)
})
