import type {Readable,Writable} from 'node:stream'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {MODES,createMcpServer,type Mode} from './server.js'

export function parseMode(args:readonly string[]):Mode {
  if(args.length===0)return 'unconfigured'
  const mode=args[0]?.slice(2)
  if(args.length===1&&args[0]?.startsWith('--')&&mode!=='unconfigured'&&MODES.includes(mode as Mode))return mode as Mode
  throw Error('Use no arguments or exactly one documented synthetic flag')
}

export async function runStdio(mode:Mode='unconfigured',streams:{input:Readable;output:Writable}={input:process.stdin,output:process.stdout}):Promise<void> {
  const server=createMcpServer(mode)
  const transport=new StdioServerTransport(streams.input,streams.output,{maxBufferSize:65536})
  let closing=false
  const stop=()=>{
    if(closing)return
    closing=true
    void server.close().catch(()=>{process.exitCode=1})
  }
  server.onclose=()=>{
    streams.input.off('end',stop)
    streams.input.off('close',stop)
    process.off('SIGINT',stop)
    process.off('SIGTERM',stop)
    streams.input.pause()
  }
  // Never print raw SDK errors, arguments, credentials or stack traces.
  server.onerror=()=>{process.stderr.write('DCC offline MCP transport error.\n')}
  streams.input.once('end',stop)
  streams.input.once('close',stop)
  process.once('SIGINT',stop)
  process.once('SIGTERM',stop)
  try{await server.connect(transport)}catch(error){
    await server.close()
    throw error
  }
}
