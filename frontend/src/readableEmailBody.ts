const trailingHorizontalWhitespace=/[\t\p{Zs}]+$/gu

export function readableEmailBody(body:string){
 const lines=body.replace(/\r\n?/g,'\n').split('\n').map(line=>line.replace(trailingHorizontalWhitespace,''))
 let start=0,end=lines.length
 while(lines[start]==='')start++
 while(end>start&&lines[end-1]==='')end--
 const trimmed=lines.slice(start,end)
 return trimmed.filter((line,index)=>line!==''||trimmed[index-1]!=='').join('\n')
}
