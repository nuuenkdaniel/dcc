// Same reviewed stdlib QA entry/official bootstrap as the core runner. No model
// loop here and no import-time subprocess/network calls.
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import type {TaskBridgeInput} from '../../src/mcp/task-actions.js'
export type SchemaEvidence={model:string;schemaCount:number;schemaSha256:string;schemasUnchanged:boolean}
export class JourneyRuntime {
  calls=0
  readonly evidence:SchemaEvidence[]=[]
  constructor(readonly signal:AbortSignal,readonly maxCalls:10|12=10){
    if(maxCalls!==10&&maxCalls!==12)throw Error('QA call bound configuration')
  }
  private run(script:string,args:string[],input?:TaskBridgeInput,signal?:AbortSignal):Promise<string>{
    return new Promise((resolve,reject)=>{
      const child=spawn('/usr/bin/python3',[fileURLToPath(new URL(script,import.meta.url)),...args],{detached:true,cwd:'/root/.hermes/profiles/daymark-curator',stdio:['pipe','pipe','ignore'],env:{...process.env,HERMES_HOME:'/root/.hermes/profiles/daymark-curator',...(input?{DCC_TASK_CALLBACK_CAPABILITY:input.callbackCapability,DCC_TASK_CALLBACK_EXPIRES_AT:String(input.expiresAt)}:{})}})
      let output='',failed=false
      const kill=(signal:NodeJS.Signals)=>{if(child.pid)try{process.kill(-child.pid,signal)}catch{/* Own group already gone. */}}
      const terminate=()=>{failed=true;kill('SIGTERM')}
      const deadline=setTimeout(terminate,input?105000:15000),hard=setTimeout(()=>kill('SIGKILL'),input?110000:20000)
      const abort=AbortSignal.any([this.signal,...(signal?[signal]:[])])
      abort.addEventListener('abort',terminate,{once:true});if(abort.aborted)terminate()
      child.stdout.on('data',chunk=>{output+=String(chunk);if(Buffer.byteLength(output)>4096)terminate()})
      child.stdin.on('error',()=>{failed=true});child.on('error',()=>{failed=true})
      child.once('close',code=>{
        clearTimeout(deadline);clearTimeout(hard);abort.removeEventListener('abort',terminate);kill('SIGTERM')
        if(failed||code!==0)reject(Error('QA runtime unavailable'));else resolve(output)
      })
      child.stdin.end(input?JSON.stringify({prompt:input.prompt}):undefined)
    })
  }
  async preflight(){if((await this.run('../../deploy/task_action_launcher.py',['--preflight'])).trim()!=='{"status":"runtime_ready"}')throw Error('QA bootstrap unavailable')}
  async invoke(input:TaskBridgeInput,signal:AbortSignal){
    if(this.calls>=this.maxCalls||input.mode!=='product-action'||this.signal.aborted)throw Error('QA call bound')
    this.calls++
    const parsed=JSON.parse(await this.run('./runtime_loopback.py',[],input,signal)) as {status:string;evidence:SchemaEvidence}
    const e=parsed.evidence
    if(parsed.status!=='finished'||e?.model!=='gpt-6-luna'||e.schemaCount!==35||e.schemasUnchanged!==true||!/^[a-f0-9]{64}$/.test(e.schemaSha256)||this.evidence.some(old=>old.schemaSha256!==e.schemaSha256))throw Error('QA schema/model evidence')
    this.evidence.push(e);return {status:'finished'}
  }
}
