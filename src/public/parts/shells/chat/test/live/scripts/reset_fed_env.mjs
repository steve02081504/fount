import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const nodeBData = path.join(root, 'node_b_data')

for (const name of ['_node_b_run.log', '_node_b_run.err.log']) {
	const filePath = path.join(root, name)
	if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true })
}

for (const dir of [
	path.join(nodeBData, 'users/nodeb/shells/chat/groups'),
	path.join(nodeBData, 'users/nodeb/shells/chat/files'),
	path.join(nodeBData, 'users/nodeb/shells/chat/blobs'),
	path.join(nodeBData, 'users/nodeb/entities'),
	path.join(nodeBData, 'p2p/chunks'),
]) 
	if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })


for (const file of [
	path.join(nodeBData, 'users/nodeb/shells/chat/blob_refcounts.json'),
]) 
	if (fs.existsSync(file)) fs.rmSync(file, { force: true })


for (const dir of [
	path.join(nodeBData, 'users/nodeb/settings'),
	path.join(nodeBData, 'users/nodeb/shells/chat'),
	path.join(nodeBData, 'p2p'),
]) 
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })


console.log('Federation test artifacts cleaned.')
