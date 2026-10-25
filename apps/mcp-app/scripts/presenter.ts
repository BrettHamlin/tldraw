import { startPresenterServer } from '../src/presenter/server'

const service = await startPresenterServer()
console.error(`tldraw presenter MCP: ${service.url}/mcp`)
let stopping = false
async function stop() {
	if (stopping) return
	stopping = true
	await service.close()
}
process.once('SIGINT', () => {
	void stop()
})
process.once('SIGTERM', () => {
	void stop()
})
