import {test,expect} from './authenticated'
import type {Page} from '@playwright/test'
import type {ConversationView} from '../../backend/src/mcp/conversation-wire'

const owner='a'.repeat(64)
const opening='What tasks do I have today?'
function configure(page:Page){
 return page.route('**/api/v1/hermes/action-capabilities',route=>route.fulfill({json:{workspaceOwner:owner,productActions:true,conversation:true,conversationReplyVersion:1,conversationChatVersion:1,conversationContextVersion:1}}))
}
function reply(key:string,text:string,withAction=false):ConversationView{
 return {version:1,chatVersion:1,rootKey:key,turnKey:key,expiresAt:Date.now()+86400000,questions:0,
  assistantReply:{version:1,text},...(withAction?{toolSummary:{version:1,text:'Created 1 task.'}}:{}),
  receipt:{version:1,key,outcome:withAction?'complete':'read-only',line:withAction?'A task was added.':'Read-only effects checked; no writes.',expected:withAction?1:null,verified:withAction?1:0,
   targets:withAction?[{kind:'task',id:'synthetic-task',action:'added',title:'Send the outline',state:'applied',verification:'verified'}]:[]}}
}

test('Hermes home shows replies first, carries context, and preserves the thread across Today and reload',async({page},testInfo)=>{
 await page.setViewportSize({width:1280,height:800})
 await configure(page)
 const requests:Record<string,unknown>[]=[]
 const firstReply='You have **two tasks** today. Start with the **reading**, then review your notes.'
 await page.route('**/api/v1/hermes/conversation',route=>{
  const body=route.request().postDataJSON()
  requests.push(body)
  return route.fulfill({json:requests.length===1?reply(body.key,firstReply):reply(body.key,'I added **“Send the outline”** to your list.',true)})
 })
 await page.goto('/')
 const box=page.getByRole('textbox',{name:'Message Hermes'})
 await expect(box).toBeVisible()
 await expect(page.getByRole('heading',{name:'Daily plan'})).toHaveCount(0)
 await page.getByRole('button',{name:opening,exact:true}).click()
 await expect(box).toHaveValue(opening)
 expect(requests).toHaveLength(0)
 await box.press('Enter')
 await expect(page.getByText('You have two tasks today. Start with the reading, then review your notes.')).toBeVisible()
 await expect(page.locator('.chat-reply strong')).toHaveText(['two tasks','reading'])
 await expect(box).toHaveValue('')
 expect(requests[0]).toMatchObject({op:'start',prompt:opening,chatVersion:1,replyVersion:1,workspaceOwner:owner})
 await expect(page.getByText('Read-only effects checked; no writes.')).toHaveCount(0)
 await box.fill('Add a reminder to send the outline')
 await page.getByRole('button',{name:'Send message'}).click()
 await expect(page.getByText('I added “Send the outline” to your list.')).toBeVisible()
 expect(requests[1]).toMatchObject({chatVersion:1,replyVersion:1,context:{version:1,entries:[
  {role:'user',text:opening},{role:'assistant',text:firstReply},
 ]}})
 await expect(page.getByText('Created 1 task.')).toBeVisible()
 await expect(page.getByText('A task was added.',{exact:true})).toBeHidden()
 await page.getByText('Action details',{exact:true}).click()
 await expect(page.getByText('A task was added.',{exact:true})).toBeVisible()
 await page.getByText('Action details',{exact:true}).click()
 if(process.env.DCC_CHAT_CAPTURE)await page.screenshot({path:testInfo.outputPath('hermes-desktop.png')})
 const navigation=page.getByRole('navigation',{name:'Main navigation'})
 await navigation.getByRole('button',{name:'Today',exact:true}).click()
 await expect(page).toHaveURL(/\/today$/)
 await expect(page.getByRole('heading',{name:'Daily plan'})).toBeVisible()
 await navigation.getByRole('button',{name:'Hermes',exact:true}).click()
 await expect(page.getByText('I added “Send the outline” to your list.')).toBeVisible()
 await page.reload()
 await expect(page.getByText('I added “Send the outline” to your list.')).toBeVisible()
 await expect(page.locator('.chat-reply strong').last()).toHaveText('“Send the outline”')
 expect(requests).toHaveLength(2)
 await page.setViewportSize({width:360,height:690})
 await expect(box).toBeInViewport()
 await expect.poll(async()=>690-((await page.locator('.chat-composer-box').boundingBox())?.y??0)-((await page.locator('.chat-composer-box').boundingBox())?.height??0)).toBeLessThan(48)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 if(process.env.DCC_CHAT_CAPTURE)await page.screenshot({path:testInfo.outputPath('hermes-mobile.png')})
})

test('an interrupted reply is recovered after reload by reading the original request',async({page})=>{
 await page.setViewportSize({width:360,height:690})
 await configure(page)
 let root=''
 let observed!:()=>void,releaseStart!:()=>void
 const started=new Promise<void>(resolve=>{observed=resolve})
 const startGate=new Promise<void>(resolve=>{releaseStart=resolve})
 const requests:string[]=[]
 await page.route('**/api/v1/hermes/conversation',async route=>{
  const body=route.request().postDataJSON()
  requests.push(body.op)
  if(body.op==='start'){
   root=body.key
   observed()
   await startGate
   await route.abort().catch(()=>undefined)
   return
  }
  expect(body.rootKey).toBe(root)
  return route.fulfill({json:reply(root,'Your saved reply is back.')})
 })
 await page.goto('/')
 const box=page.getByRole('textbox',{name:'Message Hermes'})
 await box.fill(opening)
 await box.press('Enter')
 try{
  await started
  await page.reload()
 }finally{releaseStart()}
 await expect(page.getByText('Your saved reply is back.')).toBeVisible()
 expect(requests).toEqual(['start','read'])
})

test('a dropped reply is checked quietly until the original turn finishes',async({page})=>{
 await configure(page)
 const requests:Record<string,unknown>[]=[]
 let releaseRead!:()=>void
 const readGate=new Promise<void>(resolve=>{releaseRead=resolve})
 await page.route('**/api/v1/hermes/conversation',async route=>{
  const body=route.request().postDataJSON()
  requests.push(body)
  if(body.op==='start')return route.abort()
  const {key,clientId}=requests[0]!
  expect(body).toMatchObject({op:'read',rootKey:key,clientId,workspaceOwner:owner})
  const response=reply(String(key),'Your original reply is here.')
  if(requests.length===2){
   await readGate
   delete response.assistantReply
   response.receipt.outcome='uncertain'
  }
  return route.fulfill({json:response})
 })
 await page.goto('/')
 const box=page.getByRole('textbox',{name:'Message Hermes'})
 await box.fill(opening)
 await box.press('Enter')
 try{
  await expect.poll(()=>requests.length).toBe(2)
  await expect(page.getByText('Thinking…',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Check reply'})).toHaveCount(0)
 }finally{releaseRead()}
 await expect(page.getByText('Your original reply is here.')).toBeVisible()
 expect(requests.map(request=>request.op)).toEqual(['start','read','read'])
})

test('a verified no-write failure offers the original message for a manual retry',async({page})=>{
 await configure(page)
 const ids:string[]=[]
 await page.route('**/api/v1/hermes/conversation',route=>{
  const message=route.request().postDataJSON()
  expect(message.op).toBe('start')
  ids.push(message.key)
  if(ids.length>1)return route.fulfill({json:reply(message.key,'Reply delivered.')})
  const response=reply(message.key,'Hermes stopped before attempting any changes.')
  response.receipt.outcome='failed'
  response.receipt.line='Hermes stopped before attempting any changes.'
  return route.fulfill({json:response})
 })
 await page.goto('/')
 const box=page.getByRole('textbox',{name:'Message Hermes'})
 await box.fill(opening)
 await box.press('Enter')
 await page.getByRole('button',{name:'Restore message'}).click()
 await expect(box).toHaveValue(opening)
 expect(ids).toHaveLength(1)
 await box.press('Enter')
 await expect(page.getByText('Reply delivered.')).toBeVisible()
 expect(new Set(ids).size).toBe(2)
})
