import { exec } from 'child_process'
import { promisify } from 'util'
let PromiseExec = promisify(exec)

export default PromiseExec
export {
	PromiseExec as exec
}
