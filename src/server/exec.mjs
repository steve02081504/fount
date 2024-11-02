import { exec } from 'child_process'
import { promisify } from 'util'
const PromiseExec = promisify(exec)

export default PromiseExec
export {
	PromiseExec as exec
}
