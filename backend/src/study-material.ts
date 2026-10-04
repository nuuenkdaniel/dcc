import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'
const exec=promisify(execFile)
export async function extractMaterial(name:string,base64:string){
 if(typeof name!=='string'||name.length>200||typeof base64!=='string'||base64.length>7000000||!/^[-\w .()]+\.(pdf|txt|md)$/i.test(name)||!/^[-A-Za-z0-9+/=\r\n]*$/.test(base64))throw Error('Use a PDF, TXT or Markdown file up to 5 MB, with a simple filename')
 const bytes=Buffer.from(base64,'base64');if(bytes.length>5*1024*1024)throw Error('File is too large')
 let text=''
 if(name.toLowerCase().endsWith('.pdf')){
  if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Not a PDF')
  const root=join(homedir(),'.cache/daymark');await mkdir(root,{recursive:true,mode:0o700});const dir=await mkdtemp(join(root,'extract-'))
  try{const file=join(dir,'input.pdf');await writeFile(file,bytes,{mode:0o600});const result=await exec('pdftotext',['-layout',file,'-'],{timeout:20000,maxBuffer:2000000});const pages=result.stdout.split('\f');if(pages.at(-1)?.trim()==='')pages.pop();if(pages.some(p=>!p.trim()))throw Error('Some PDF pages have no readable text. Supply a text version; scanned pages are not silently skipped.');text=pages.map((p,i)=>`[${name}, PDF page ${i+1}]\n${p}`).join('\n')}
  finally{await rm(dir,{recursive:true,force:true})}
 }else{text=`[${name}]\n`+bytes.toString('utf8')}
 if(!text.trim()||text.length>100000)throw Error('Material is empty or exceeds 100,000 extracted characters. Split it into smaller documents.')
 return {name,text}
}
