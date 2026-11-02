// Test-only observation wrapper. Production CLI has no stderr exit receipts.
import {Writable} from 'node:stream'
import {writeSync} from 'node:fs'
import {deserializeMessage} from '@modelcontextprotocol/sdk/shared/stdio.js'
import {parseMode,runStdio} from '../../src/mcp/stdio.js'

const chunks:Buffer[]=[],signals:string[]=[]
process.on('SIGTERM',()=>{signals.push('SIGTERM')})
process.on('SIGINT',()=>{signals.push('SIGINT')})
process.on('exit',code=>{
  const stdout=Buffer.concat(chunks).toString('utf8')
  const lines=stdout.split('\n')
  let clean=lines.pop()===''
  try{for(const line of lines)deserializeMessage(line)}catch{clean=false}
  writeSync(2,JSON.stringify({fixture:'stdio-exit',code,clean,frames:lines.length,signals})+'\n')
})
const output=new Writable({write(chunk,_encoding,callback){
  chunks.push(Buffer.from(chunk))
  process.stdout.write(chunk,callback)
}})
await runStdio(parseMode(process.argv.slice(2)),{input:process.stdin,output})
