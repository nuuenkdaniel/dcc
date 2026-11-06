// Real composer/keyboard/fetch handling; synthetic API only, no model/provider/PG.
import {test,expect} from './authenticated'
import type {Route} from '@playwright/test'
const ACTIVE='dcc.tell-hermes.submission.v1',HISTORY='dcc.tell-hermes.retained.v1'

for(const failure of ['http500','rejected','uncertain','network','timeout'] as const)test(`failed composer remains deletable without retry: ${failure}`,async({page})=>{
 const requests:{key:string;prompt:string;tabId?:string}[]=[]
 let held:Route|undefined
 if(failure==='timeout')await page.addInitScript(()=>{
  // Shorten only the production composer's deadline. Native AbortSignal/fetch
  // still deliver the timeout; other auth/API clocks are unchanged. No sleeps.
  const timeout=AbortSignal.timeout
  AbortSignal.timeout=ms=>timeout.call(AbortSignal,ms===180000?200:ms)
 })
 await page.route('**/api/v1/hermes/action-capabilities',route=>route.fulfill({json:{productActions:true}}))
 await page.route('**/api/v1/hermes/actions',route=>{
  requests.push(route.request().postDataJSON())
  if(requests.length===1){
   if(failure==='timeout'){held=route;return}
   if(failure==='network')return route.abort('failed')
   if(failure==='http500')return route.fulfill({status:500,json:{message:'Synthetic failure'}})
   return route.fulfill({json:{message:'Synthetic receipt',summary:failure==='uncertain'?{phase:'uncertain',effects:[],pending:1,reads:[]}:{phase:'completed',outcome:'rejected',effects:[{tool:'create_task',state:'rejected'}],pending:0,reads:[]}}})
  }
  return route.fulfill({json:{message:'Synthetic receipt',summary:{phase:'completed',outcome:'no_effects_recorded',effects:[],pending:0,reads:[]}}})
 })
 await page.goto('/')
 const input=page.getByRole('textbox',{name:'Ask Hermes about tasks, projects, or calendar'})
 await expect(page.locator('#tell-hermes-status')).not.toContainText('MCP actions are unavailable')
 await input.fill('Original failed synthetic request');await input.press('Enter')
 await expect.poll(()=>requests.length).toBe(1)
 await expect(input).toBeEditable()
 await expect.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]').length,HISTORY)).toBe(1)
 const old=requests[0]!,retained=await page.evaluate(key=>localStorage.getItem(key),HISTORY)
 expect(JSON.parse(retained!)[0]).toMatchObject({key:old.key,prompt:old.prompt,mode:'actions'})
 expect(await page.evaluate(key=>localStorage.getItem(key),ACTIVE)).toBeNull()
 await expect(page.getByText('Previous requests are retained separately;',{exact:false})).toBeVisible()
 if(held){
  await expect.poll(()=>held!.request().failure()?.errorText).toMatch(/ERR_ABORTED|ERR_FAILED/)
  try{await held.abort('failed')}catch{expect(held.request().failure()).not.toBeNull()}
 }
 await input.press('Enter') // Same failed text is NOT a hidden retry/new write.
 await expect(page.getByRole('button',{name:/Send as new request/})).toBeVisible()
 expect(requests).toHaveLength(1)
 await input.press('Control+A');await input.press('Backspace')
 await expect(input).toHaveValue('') // Exact reported "cannot delete" regression.
 await input.type('Different draft; no submit yet');expect(requests).toHaveLength(1)
 await page.reload()
 await expect(input).toBeEditable();expect(requests).toHaveLength(1)
 expect(await page.evaluate(key=>localStorage.getItem(key),HISTORY)).toBe(retained)
 await expect(page.locator('#tell-hermes-status')).not.toContainText('MCP actions are unavailable')
 await input.fill('Deliberate fresh synthetic request')
 expect(requests).toHaveLength(1)
 await input.press('Enter');await expect.poll(()=>requests.length).toBe(2)
 await expect.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null')?.settled,ACTIVE)).toBe(true)
 expect(requests[1]!.key).not.toBe(old.key)
 expect(await page.evaluate(key=>localStorage.getItem(key),HISTORY)).toBe(retained)
})

for(const mode of ['legacy','tasks','actions'] as const)test(`old ${mode} receipt never traps text when actions are disabled or restored`,async({page})=>{
 const old={key:'synthetic_old_receipt_01',prompt:'Old interrupted request',mode,settled:false}
 await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:ACTIVE,value:old})
 let available=false
 const requests:{key:string;prompt:string}[]=[]
 await page.route('**/api/v1/hermes/action-capabilities',route=>route.fulfill({json:{productActions:available}}))
 await page.route('**/api/v1/hermes/actions',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{message:'Synthetic receipt',summary:{phase:'completed',outcome:'no_effects_recorded',effects:[],pending:0,reads:[]}}})})
 await page.goto('/')
 const input=page.getByRole('textbox',{name:'Ask Hermes about tasks, projects, or calendar'})
 await expect(page.locator('#tell-hermes-status')).toContainText('MCP actions are unavailable')
 await expect(input).toBeEditable();await input.press('Control+A');await input.press('Backspace');await expect(input).toHaveValue('')
 await input.type('Editable while actions are off');await input.press('Enter');expect(requests).toHaveLength(0)
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]')[0],HISTORY)).toMatchObject(old)
 available=true
 const discovered=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/hermes/action-capabilities')
 await page.evaluate(()=>window.dispatchEvent(new Event('dcc-auth-changed')));await discovered
 await expect(page.locator('#tell-hermes-status')).not.toContainText('MCP actions are unavailable')
 await input.fill('Fresh deliberate request after recovery');expect(requests).toHaveLength(0)
 await input.press('Enter');await expect.poll(()=>requests.length).toBe(1)
 expect(requests[0]!.key).not.toBe(old.key)
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]')[0],HISTORY)).toMatchObject(old)
})
