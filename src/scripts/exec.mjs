import { exec } from 'node:child_process'
import { promisify } from 'node:util'
const PromiseExec = promisify(exec)

export default PromiseExec
export {
	PromiseExec as exec
}
