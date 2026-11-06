// Installed frontend Playwright only. No test runner/server/Chrome downloads.
import {createRequire} from 'node:module'
import type {Browser,BrowserContext,Page} from '../../../frontend/node_modules/@playwright/test/index.js'
import type {IntentSummary} from '../../src/mcp/request-controller.js'
const {chromium,expect}=createRequire(new URL('../../../frontend/package.json',import.meta.url))('@playwright/test') as typeof import('../../../frontend/node_modules/@playwright/test/index.js')
export {expect}
export type TimerDocument={version:number;focusMinutes:number;breakMinutes:number;updatedAt:number;timer:{phase:string;running:boolean;sessionStarted?:boolean;sessionRemainingMs:number;activeMiniId:string|null;miniTimers:{id:string;name:string;duration:number;remainingMs:number}[]};receipts:Record<string,{fingerprint:string;result:unknown}>}
export const ORIGIN='http://127.0.0.1:18534'
export const SUBMISSION='dcc.tell-hermes.submission.v1'
export class JourneyBrowser {
  readonly acks=new Map<string,unknown>()
  constructor(readonly browser:Browser,readonly context:BrowserContext,readonly page:Page){}
  static async open(){
    const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']})
    try{
      const context=await browser.newContext({baseURL:ORIGIN,serviceWorkers:'block'})
      await context.route('**/*',route=>new URL(route.request().url()).origin===ORIGIN?route.continue():route.abort('blockedbyclient'))
      const page=await context.newPage();page.setDefaultTimeout(12000)
      const driver=new JourneyBrowser(browser,context,page)
      page.on('request',request=>{
        if(new URL(request.url()).pathname!=='/api/v1/hermes/timer-bridge'||request.method()!=='POST')return
        const body=request.postDataJSON() as {ack?:{result?:{id?:string}}}
        if(body.ack?.result?.id)driver.acks.set(body.ack.result.id,body.ack.result)
      })
      await page.goto('/');await driver.login();return driver
    }catch(error){await browser.close();throw error}
  }
  async login(){
    await this.page.getByLabel('Username',{exact:true}).fill('synthetic-qa')
    await this.page.getByLabel('Password',{exact:true}).fill('synthetic-isolated-qa-only')
    await this.page.getByRole('button',{name:'Sign in',exact:true}).click()
    await expect(this.page.getByRole('button',{name:'Home',exact:true})).toBeVisible()
    await this.page.getByRole('button',{name:'Home',exact:true}).click()
    await expect.poll(()=>this.locks()).toBe(1)
  }
  async timer():Promise<TimerDocument>{return this.page.evaluate(()=>JSON.parse(sessionStorage.getItem('dcc.focus-timer.tab.v1')??'null'))}
  async locks(){return this.page.evaluate(async()=>{const id=sessionStorage.getItem('dcc.hermes.tab.v1');return (await navigator.locks.query()).held?.filter(lock=>lock.name==='dcc-timer-tab:'+id).length??0})}
  async submit(prompt:string){
    await this.page.getByRole('button',{name:'Home',exact:true}).click()
     const input=this.page.getByRole('textbox',{name:'Ask Hermes about tasks, projects, or calendar'})
    await expect(this.page.locator('#tell-hermes-status')).not.toContainText('MCP actions are unavailable')
     await expect(input).toBeEnabled();await input.fill(prompt)
    const response=this.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/hermes/actions'&&r.request().postDataJSON()?.prompt===prompt,{timeout:125000})
    await input.press('Enter')
    const http=await response
    if(http.status()!==200)throw Error('QA browser action HTTP status')
    const body=await http.json() as {summary:IntentSummary}
    if(body.summary.phase!=='completed'||body.summary.pending!==0)throw Error('QA browser incomplete action')
    await expect(input).toBeEnabled()
    await expect.poll(()=>this.page.evaluate(()=>JSON.parse(localStorage.getItem('dcc.tell-hermes.submission.v1')??'null')?.settled)).toBe(true)
    const sent=http.request().postDataJSON() as {key:string;prompt:string;tabId:string}
    return {...sent,summary:body.summary}
  }
  async replay(key:string,prompt:string,tabId:string){
    const response=await this.context.request.post(ORIGIN+'/api/v1/hermes/actions',{headers:{Origin:ORIGIN},data:{key,prompt,tabId},timeout:125000})
    if(response.status()!==200)throw Error('QA replay HTTP status')
    return (await response.json() as {summary:IntentSummary}).summary
  }
  async advancing(){
    const before=await this.timer(),started=Date.now()
    await expect.poll(async()=>(await this.timer()).timer.sessionRemainingMs,{timeout:5000}).toBeLessThan(before.timer.sessionRemainingMs-600)
    const after=await this.timer(),elapsed=Date.now()-started,delta=before.timer.sessionRemainingMs-after.timer.sessionRemainingMs
    if(delta<600||delta>elapsed+1500||after.timer.activeMiniId!==before.timer.activeMiniId||after.timer.phase!==before.timer.phase)throw Error('QA elapsed/session identity')
  }
  async manualPauseResume(){
    await this.page.getByRole('button',{name:'Focus',exact:true}).click()
    await this.page.getByRole('button',{name:'Pause session',exact:true}).click()
    const paused=await this.timer(),start=Date.now()
    await expect.poll(()=>Date.now()-start).toBeGreaterThan(800)
    if((await this.timer()).timer.sessionRemainingMs!==paused.timer.sessionRemainingMs)throw Error('QA paused clock changed')
    await this.page.getByRole('button',{name:'Resume session',exact:true}).click()
    await this.advancing()
  }
  async cloneDenied(){
    const opened=this.context.waitForEvent('page')
    await this.page.evaluate(()=>{window.open('/pomodoro','_blank')})
    const clone=await opened
    try{
      await expect(clone.getByText(/Another tab owns this timer/).first()).toBeVisible()
      const original=await this.page.evaluate(()=>sessionStorage.getItem('dcc.hermes.tab.v1'))
      if(await clone.evaluate(()=>sessionStorage.getItem('dcc.hermes.tab.v1'))!==original)throw Error('QA clone did not copy tab')
      const before=await clone.evaluate(()=>sessionStorage.getItem('dcc.focus-timer.tab.v1'))
      await expect(clone.getByRole('button',{name:'Reset session',exact:true})).toBeDisabled()
      if(await clone.evaluate(()=>sessionStorage.getItem('dcc.focus-timer.tab.v1'))!==before)throw Error('QA clone mutated clock')
      if(await this.locks()!==1)throw Error('QA clone ownership contention')
    }finally{await clone.close()}
  }
  async reloadProof(){
    const before=await this.timer()
    await this.page.reload();await expect.poll(()=>this.locks()).toBe(1)
    const after=await this.timer()
    if(JSON.stringify(after.receipts)!==JSON.stringify(before.receipts)||after.version!==before.version||after.timer.running!==before.timer.running||after.timer.miniTimers.length!==before.timer.miniTimers.length)throw Error('QA reload receipt/state mismatch')
    await this.page.getByRole('button',{name:'Focus',exact:true}).click()
    await expect(this.page.getByRole('button',{name:'Start session',exact:true})).toBeEnabled()
  }
  async close(){await this.browser.close()}
}
