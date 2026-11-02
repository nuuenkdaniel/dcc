import {createHash} from 'node:crypto'
import {TOOLS,isTool,validateArguments,validResult,type Command,type Result,type OperationState} from './contracts.js'
import {validateServiceArguments,validServiceResult} from './service-contracts.js'

// Supplied by a trusted caller, never extracted from tool arguments or model output.
// Capabilities here are an offline policy seam, NOT authenticated runtime authorization.
export type Context={purpose:'action'|'parser'|'planner'|'extraction'|'read';capabilities:readonly string[]}
export interface Transport {readonly contract?:'dcc-service-v1';execute(command:Command,context?:Context):Promise<unknown>}
type Entry={fingerprint:string;result:Result}
const denied:Result={state:'rejected',code:'forbidden'}
function fingerprint(command:Command){
  return createHash('sha256').update(JSON.stringify([command.tool,Object.fromEntries(Object.entries(command.args).sort(([a],[b])=>a.localeCompare(b)))])).digest('hex')
}
export class Dispatcher {
  private readonly operations=new Map<string,Entry>()
  constructor(private readonly transport?:Transport,private readonly maxOperations=256){
    if(!Number.isSafeInteger(maxOperations)||maxOperations<1||maxOperations>4096)throw Error('Invalid offline operation capacity')
  }
  async dispatch(tool:unknown,input:unknown,context?:Context):Promise<Result> {
    if(!isTool(tool))return {state:'rejected',code:'unknown_tool'}
    const definition=TOOLS[tool]
    if(!context||!['action','parser','planner','extraction','read'].includes(context.purpose)||!Array.isArray(context.capabilities)||!context.capabilities.includes(definition.capability)||definition.write&&context.purpose!=='action')return {...denied}
    const service=this.transport?.contract==='dcc-service-v1'
    const validation=service?validateServiceArguments(tool,input):validateArguments(tool,input)
    if(!validation.valid)return {state:'rejected',code:validation.code}
    const command:Command={tool,args:validation.args}
    const key=command.args.operationKey as string
    if(service){
      // Durable service receipts (and actor binding) are authoritative. Do not
      // mask them with the synthetic instance-local journal after a commit loss.
      try{
        const response=await this.transport!.execute(structuredClone(command),context)
        if(!validServiceResult(command,response))throw Error('Invalid service response')
        return structuredClone(response)
      }catch{return definition.write?{state:'uncertain',operationKey:key}:{state:'rejected',code:'transport_failure'}}
    }
    if(!definition.write&&tool==='get_operation_status'){
      const prior=this.operations.get(key)
      if(prior){
        const status:OperationState=prior.result.state==='ok'?'uncertain':prior.result.state
        return {state:'ok',data:{operationKey:key,status}}
      }
    }
    if(!this.transport)return {state:'rejected',code:'transport_unconfigured'}
    let entry:Entry|undefined
    if(definition.write){
      const hash=fingerprint(command),prior=this.operations.get(key)
      if(prior)return prior.fingerprint===hash?structuredClone(prior.result):{state:'conflict',code:'operation_key_mismatch'}
      // Never evict unresolved or terminal keys: losing them could enable duplicate writes.
      if(this.operations.size>=this.maxOperations)return {state:'rejected',code:'operation_capacity'}
      entry={fingerprint:hash,result:{state:'uncertain',operationKey:key}}
      this.operations.set(key,entry) // Reserve synchronously, before the first await.
    }
    let result:Result
    try {
      // Snapshot both sides so a transport/caller cannot later mutate cached results.
      const response=await this.transport.execute(structuredClone(command),context)
      if(!validResult(command,response))throw Error('Invalid transport response')
      result=structuredClone(response)
    } catch {
      result=definition.write?{state:'uncertain',operationKey:key}:{state:'rejected',code:'transport_failure'}
    }
    if(entry)entry.result=structuredClone(result)
    return result
  }
}
