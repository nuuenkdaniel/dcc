// Dedicated SDK stdio entrypoint. Never import application startup or load env.
import {parseMode,runStdio} from './stdio.js'

try {
  await runStdio(parseMode(process.argv.slice(2)))
} catch {
  process.stderr.write('DCC offline MCP startup failed. Use no arguments or one documented synthetic flag.\n')
  process.exitCode=1
}
