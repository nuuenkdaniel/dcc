// Real Chromium clocks/Web Locks/storage, synthetic authenticated HTTP routes.
// These tests do not exercise a model, real SQL, HTTPS callback or provider.
import {test,expect,mockAuthenticatedApi} from './authenticated'
import type {Page} from '@playwright/test'

const readTimer=(page:Page)=>page.evaluate(()=>{
  const raw=sessionStorage.getItem('dcc.focus-timer.tab.v1')
  return raw?JSON.parse(raw):null
})
const ownedLocks=(page:Page)=>page.evaluate(async()=>{
  const id=sessionStorage.getItem('dcc.hermes.tab.v1')
  return (await navigator.locks.query()).held?.filter(lock=>lock.name==='dcc-timer-tab:'+id).length??0
})

async function startThroughMockBridge(page:Page){
  const id='12345678-1234-4234-a234-123456789abc'
  const command={tool:'control_focus_timer',args:{id,operationKey:'dcc_op_'+id,expectedVersion:1,action:'start'}}
  let submission:{key:string;tabId:string}|undefined,acknowledged=false
  let resolveAck:()=>void=()=>{}
  const ack=new Promise<void>(resolve=>{resolveAck=resolve})
  await page.route('**/api/v1/hermes/action-capabilities',route=>route.fulfill({json:{productActions:true}}))
  await page.route('**/api/v1/hermes/actions',async route=>{
    const body=route.request().postDataJSON()
    expect(body.prompt).toBe('Start my Pomodoro focus session')
    expect(body.tabId).toMatch(/^[a-f0-9-]{36}$/)
    submission=body
    await ack
    await route.fulfill({json:{message:'Synthetic browser receipt checked.',summary:{phase:'completed',outcome:'effects_recorded',effects:[{tool:'control_focus_timer',state:'applied',id,version:2}],pending:0,reads:[]}}})
  })
  await page.route('**/api/v1/hermes/timer-bridge',async route=>{
    const body=route.request().postDataJSON()
    if(!submission){expect(body.ack).toBeUndefined();await route.fulfill({json:{commands:[]}});return}
    expect({key:body.key,tabId:body.tabId}).toEqual({key:submission.key,tabId:submission.tabId})
    if(body.ack){
      expect(body.ack).toEqual({nonce:'a'.repeat(64),result:{state:'applied',id,version:2}})
      acknowledged=true;resolveAck()
    }
    await route.fulfill({json:{commands:acknowledged?[]:[{nonce:'a'.repeat(64),expiresAt:Date.now()+60000,command}]}})
  })
  await page.goto('/pomodoro')
  await expect(page.getByRole('button',{name:'Start session',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'Home',exact:true}).click()
  const prompt=page.getByRole('textbox',{name:'Ask Hermes about tasks, projects, or calendar'})
  await expect(prompt).toBeEnabled()
  await prompt.fill('Start my Pomodoro focus session');await prompt.press('Enter')
  await expect(page.locator('#tell-hermes-status')).toHaveText('DCC actions saved.')
  expect(acknowledged).toBe(true)
  const stored=await readTimer(page)
  expect(stored.receipts[command.args.operationKey].result).toEqual({state:'applied',id,version:2})
  await page.getByRole('button',{name:'Focus',exact:true}).click()
  await expect(page.getByRole('button',{name:'Pause session',exact:true})).toBeEnabled()
  await expect.poll(async()=>(await readTimer(page)).timer.sessionRemainingMs).toBeLessThan(stored.timer.sessionRemainingMs)
  return stored
}

test('fresh StrictMode tab acquires real ownership, edits minis, and reacquires after reload',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/pomodoro')
  await expect(page.getByRole('button',{name:'Start session',exact:true})).toBeEnabled()
  await expect.poll(()=>ownedLocks(page)).toBe(1)
  await expect(page.getByText(/Another tab owns this timer/)).toHaveCount(0)
  await page.getByRole('button',{name:'Timer settings'}).click()
  await page.getByLabel('Mini timer name',{exact:true}).fill('Synthetic real-browser mini')
  await page.getByRole('button',{name:'Add mini timer'}).click()
  await expect(page.getByRole('button',{name:'Reorder Synthetic real-browser mini'})).toBeEnabled()
  await page.getByRole('button',{name:'Done',exact:true}).click()
  await page.getByRole('button',{name:'Start session',exact:true}).click()
  const started=await readTimer(page)
  await expect.poll(async()=>(await readTimer(page)).timer.sessionRemainingMs).toBeLessThan(started.timer.sessionRemainingMs)
  await page.reload()
  await expect(page.getByRole('button',{name:'Pause session',exact:true})).toBeEnabled()
  await expect.poll(()=>ownedLocks(page)).toBe(1)
  const reloaded=await readTimer(page)
  expect(reloaded.timer.activeMiniId).toBe(started.timer.activeMiniId)
  expect(reloaded.timer.sessionRemainingMs).toBeLessThan(started.timer.sessionRemainingMs)
  expect(reloaded.timer.miniTimers.map((mini:{name:string})=>mini.name)).toEqual(['Synthetic real-browser mini'])
  await page.route('**/api/v1/auth/login',route=>route.fulfill({json:{authenticated:true,workspaceOwner:'a'.repeat(64)}}))
  await page.evaluate(()=>window.dispatchEvent(new Event('dcc-auth-required')))
  await expect(page.getByLabel('Username',{exact:true})).toBeVisible()
  await expect.poll(()=>ownedLocks(page)).toBe(0)
  const signedOut=await page.evaluate(()=>sessionStorage.getItem('dcc.focus-timer.tab.v1'))
  await page.getByLabel('Username',{exact:true}).fill('synthetic-browser-user')
  await page.getByLabel('Password',{exact:true}).fill('synthetic-browser-password')
  expect(await page.evaluate(()=>sessionStorage.getItem('dcc.focus-timer.tab.v1'))).toBe(signedOut)
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page.getByRole('button',{name:'Pause session',exact:true})).toBeEnabled()
  await expect.poll(()=>ownedLocks(page)).toBe(1)
  expect((await readTimer(page)).timer.activeMiniId).toBe(started.timer.activeMiniId)
  expect(errors).toEqual([])
})

test('mocked Hermes command changes the real browser timer only through originating-tab ACK',async({page})=>{
  await startThroughMockBridge(page)
  await expect.poll(()=>ownedLocks(page)).toBe(1)
})

test('running opener clone is quarantined until original closes; reclaim/reload never double-own its identity',async({page,context})=>{
  await mockAuthenticatedApi(context)
  await startThroughMockBridge(page)
  const popup=context.waitForEvent('page')
  await page.evaluate(()=>{window.open('/pomodoro','_blank')})
  const clone=await popup
  await clone.waitForLoadState('domcontentloaded')
  await expect(clone.getByText(/Another tab owns this timer/).first()).toBeVisible()
  expect(await clone.evaluate(()=>sessionStorage.getItem('dcc.hermes.tab.v1'))).toBe(await page.evaluate(()=>sessionStorage.getItem('dcc.hermes.tab.v1')))
  const raw=await clone.evaluate(()=>sessionStorage.getItem('dcc.focus-timer.tab.v1'))
  expect(raw).not.toBeNull()
  expect(Object.keys(JSON.parse(raw!).receipts)).toHaveLength(1)
  await expect(clone.getByRole('button',{name:/^(Start|Resume) session$/})).toBeDisabled()
  await expect(clone.getByRole('button',{name:'Reset session',exact:true})).toBeDisabled()
  await clone.getByRole('button',{name:'Timer settings'}).click()
  await clone.getByLabel('Mini timer name',{exact:true}).fill('Must not persist in clone')
  await clone.getByRole('button',{name:'Add mini timer'}).click()
  await expect(clone.getByRole('button',{name:'Remove Must not persist in clone'})).toHaveCount(0)
  await clone.getByRole('button',{name:'Done',exact:true}).click()
  const originalRemaining=(await readTimer(page)).timer.sessionRemainingMs
  await expect.poll(async()=>(await readTimer(page)).timer.sessionRemainingMs).toBeLessThan(originalRemaining-800)
  expect(await clone.evaluate(()=>sessionStorage.getItem('dcc.focus-timer.tab.v1'))).toBe(raw)
  await expect.poll(()=>ownedLocks(clone)).toBe(1) // One original holder, never two.
  await page.close()
  await expect.poll(()=>ownedLocks(clone)).toBe(0)
  await clone.getByRole('button',{name:'Retry timer ownership'}).click()
  await expect(clone.getByRole('button',{name:'Pause session',exact:true})).toBeEnabled()
  await expect.poll(()=>ownedLocks(clone)).toBe(1)
  await expect.poll(async()=>(await readTimer(clone)).timer.sessionRemainingMs).toBeLessThan(JSON.parse(raw!).timer.sessionRemainingMs)
  expect((await readTimer(clone)).receipts).toEqual(JSON.parse(raw!).receipts)
  await clone.reload()
  await expect(clone.getByRole('button',{name:'Pause session',exact:true})).toBeEnabled()
  await expect.poll(()=>ownedLocks(clone)).toBe(1)
  expect((await readTimer(clone)).receipts).toEqual(JSON.parse(raw!).receipts)
  await clone.close()
})

test('mocked typed clarification renders a question, unchanged retry reuses key, edited answer gets a fresh key',async({page})=>{
  const requests:{key:string;prompt:string}[]=[]
  await page.route('**/api/v1/hermes/action-capabilities',route=>route.fulfill({json:{productActions:true}}))
  await page.route('**/api/v1/hermes/actions',route=>{
    requests.push(route.request().postDataJSON())
    const questions=requests.length<3?{clarifications:[{reason:'missing_duration',question:'How many minutes should this take?'}]}:{}
    return route.fulfill({json:{message:'Synthetic clarification/read-only answer fixture.',summary:{phase:'completed',outcome:'no_effects_recorded',effects:[],pending:0,reads:[],...questions}}})
  })
  await page.goto('/')
  const prompt=page.getByRole('textbox',{name:'Ask Hermes about tasks, projects, or calendar'})
  await expect(prompt).toBeEnabled()
  await prompt.fill('Create a synthetic event without a duration');await prompt.press('Enter')
  await expect(page.getByText('How many minutes should this take?',{exact:true})).toBeVisible()
  await expect(page.locator('#tell-hermes-status')).not.toContainText(/saved|applied|created/i)
  await expect(prompt).toBeEnabled();await prompt.press('Enter')
  await expect.poll(()=>requests.length).toBe(2)
  expect(requests[1].key).toBe(requests[0].key)
  await expect(prompt).toBeEnabled()
  await prompt.fill('Create a synthetic event lasting 30 minutes');await prompt.press('Enter')
  await expect.poll(()=>requests.length).toBe(3)
  expect(requests[2].key).not.toBe(requests[0].key)
  expect(requests[2].prompt).toContain('30 minutes')
  await expect(prompt).toBeEnabled()
  await expect(page.getByText('How many minutes should this take?',{exact:true})).toHaveCount(0)
  await expect(page.locator('#tell-hermes-status')).not.toContainText(/saved|applied|created/i)
})
