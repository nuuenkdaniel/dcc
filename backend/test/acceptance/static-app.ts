// Exact built frontend only; no arbitrary directory/environment override.
import {readFile,realpath,readdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {resolve,sep,extname} from 'node:path'
import {createHash} from 'node:crypto'
import type {FastifyInstance} from 'fastify'
export function staticAsset(path:string):string|null{
  if(['/','/login','/pomodoro','/settings','/projects','/prices','/inbox'].includes(path))return 'index.html'
  if(!/^\/assets\/[A-Za-z0-9_-]+\.(js|css|svg|png|woff2?)$(?![\s\S])/.test(path))return null
  return path.slice(1)
}
export async function mountBuiltApp(app:FastifyInstance){
  const root=await realpath(fileURLToPath(new URL('../../../frontend/dist/',import.meta.url)))
  const readAsset=async(name:string)=>{
    const path=await realpath(resolve(root,name))
    if(!path.startsWith(root+sep))throw Error('QA asset escaped root')
    const content=await readFile(path)
    if(content.length>8000000)throw Error('QA asset too large')
    return content
  }
  const index=await readAsset('index.html')
  if(index.length>1000000||!index.toString().includes('/assets/')||index.toString().includes('/src/'))throw Error('QA current built artifact required')
  const digest=createHash('sha256').update('index.html\0').update(index)
  const assetsRoot=await realpath(resolve(root,'assets'))
  if(!assetsRoot.startsWith(root+sep))throw Error('QA assets escaped root')
  const assets=(await readdir(assetsRoot)).sort()
  if(assets.length>100)throw Error('QA asset bound')
  for(const name of assets){if(!staticAsset('/assets/'+name))throw Error('QA unexpected asset');digest.update(name+'\0').update(await readAsset('assets/'+name))}
  app.get('/*',async(request,reply)=>{
    const name=staticAsset(request.url.split('?')[0]??'')
    if(!name)return reply.code(404).send()
    try{
      const content=await readAsset(name)
      const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'}
      return reply.header('Cache-Control','no-store').type(mime[extname(name)]??'application/octet-stream').send(content)
    }catch{return reply.code(404).send()}
  })
  return digest.digest('hex')
}
