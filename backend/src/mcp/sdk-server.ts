import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {CallToolRequestSchema,ListToolsRequestSchema,McpError,ErrorCode,type CallToolResult,type Tool} from '@modelcontextprotocol/sdk/types.js'
import {isTool,type ToolName,type Result} from './contracts.js'

// Preserve unknown argument keys until domain validation. The SDK's default
// record parser drops an own __proto__ key; its envelope validation still runs.
const callSchema=CallToolRequestSchema.extend({params:CallToolRequestSchema.shape.params.extend({
  arguments:CallToolRequestSchema.shape.params.shape.arguments.unwrap().valueType.optional(),
})})
type Composition={
  name:string
  instructions:string
  source:'synthetic'|'unconfigured'|'dcc-service'
  tools:()=>Tool[]
  dispatch:(tool:ToolName,args:unknown,metadata?:Record<string,unknown>)=>Promise<Result>
}
// Source-level composition only: SDK owns initialization, framing and lifecycle.
// No client metadata, initialize identity or authInfo is treated as authorization.
export function composeSdkServer(options:Composition):Server {
  const server=new Server({name:options.name,version:'0.1.0'},{capabilities:{tools:{}},instructions:options.instructions})
  server.setRequestHandler(ListToolsRequestSchema,async request=>{
    if(request.params?.cursor!==undefined)throw new McpError(ErrorCode.InvalidParams,'Tool discovery is not paginated')
    return {tools:structuredClone(options.tools())}
  })
  server.setRequestHandler(callSchema,async request=>{
    if(!isTool(request.params.name))throw new McpError(ErrorCode.InvalidParams,'Unknown tool')
    const result=await options.dispatch(request.params.name,request.params.arguments,request.params._meta)
    const envelope={source:options.source,result}
    const response:CallToolResult={content:[{type:'text',text:JSON.stringify(envelope)}],structuredContent:envelope,isError:!['ok','applied','saved'].includes(result.state)}
    return response
  })
  return server
}
