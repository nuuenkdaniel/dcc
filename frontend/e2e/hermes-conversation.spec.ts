// Synthetic HTTP only. Parent-owned Chromium gate, not model/DB acceptance.
import {test,expect} from './authenticated'
import {clarification} from '../../backend/src/mcp/clarification'
import {validConversationView} from '../../backend/src/mcp/conversation-wire'
import {mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import type {Locator,Page} from '@playwright/test'

function contrast(foreground:string,background:string){
  const luminance=(color:string)=>{
    const [r,g,b]=(color.match(/[\d.]+/g)??[]).slice(0,3).map(Number).map(c=>{const s=c/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4})
    return .2126*r!+.7152*g!+.0722*b!
  }
  const a=luminance(foreground),b=luminance(background)
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)
}
async function capture(page:Page,width:number,state:string){
  if(!process.env.DCC_HERMES_CAPTURE_DIR)return
  const directory=resolve(process.env.DCC_HERMES_CAPTURE_DIR)
  await mkdir(directory,{recursive:true})
  const path=join(directory,`hermes-${width}-${state}.png`)
  await page.screenshot({path,fullPage:true,animations:'disabled'})
  console.log(`HERMES_POLISH_CAPTURE ${path}`)
}
async function controlsStayThemedAndContained(form:Locator){
  const bounds=(await form.boundingBox())!
  const controls=form.locator('button:visible, summary:visible')
  for(const control of await controls.all()){
    const box=(await control.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);expect(box.x+box.width).toBeLessThanOrEqual(bounds.x+bounds.width+1)
    const style=await control.evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,color:s.color,border:s.borderStyle,radius:s.borderRadius}})
    expect(style.background).not.toBe('rgb(239, 239, 239)');expect(style.background).not.toBe('rgb(240, 240, 240)')
    expect(style.background).not.toBe('rgba(0, 0, 0, 0)');expect(style.border).toBe('solid');expect(style.radius).not.toBe('0px')
    expect(contrast(style.color,style.background)).toBeGreaterThanOrEqual(4.5)
  }
  const actions=form.locator('.hermes-actions')
  if(await actions.count()){
    expect(await actions.evaluate(el=>parseFloat(getComputedStyle(el).gap))).toBeGreaterThanOrEqual(8)
    const boxes=await actions.locator('button:visible').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom}}))
    for(let i=1;i<boxes.length;i++){
      const a=boxes[i-1]!,b=boxes[i]!
      expect(b.x>=a.right+7.5||b.y>=a.bottom+7.5).toBe(true)
    }
  }
}
for(const viewport of [{width:1280,height:800},{width:360,height:480},{width:390,height:844}]){
  test(`inline clarification + verified receipt at ${viewport.width}px`,async({page})=>{
    await page.setViewportSize(viewport)
    await page.route('**/api/v1/hermes/action-capabilities',route=>route.fulfill({json:{productActions:true,conversation:true,workspaceOwner:'a'.repeat(64)}}))
    let original='',rootKey='',turns=0,answering=false
    let releaseAnswer!:()=>void
    const answerGate=new Promise<void>(resolve=>{releaseAnswer=resolve})
    await page.route('**/api/v1/hermes/conversation',async route=>{
      const b=route.request().postDataJSON();turns++
      if(b.op==='start'){
        original=b.prompt;rootKey=b.key
        const reply={version:1,rootKey,turnKey:rootKey,expiresAt:Date.now()+86400000,questions:1,original,question:{...clarification('task_topics'),id:'b'.repeat(64)},receipt:{version:1,key:rootKey,outcome:'question',line:'Details needed',verified:0,expected:null,targets:[]}}
        expect(validConversationView(reply)).toBe(true);return route.fulfill({json:reply})
      }
      expect(b.op).toBe('answer');expect(b.rootKey).toBe(rootKey);expect(b.parentKey).toBe(rootKey);expect(b.questionId).toBe('b'.repeat(64));expect(b.answer).toBe('Lectures; practice problems; review')
      answering=true;await answerGate
      const reply={version:1,rootKey,turnKey:b.key,expiresAt:Date.now()+86400000,questions:1,receipt:{version:1,key:b.key,outcome:'complete',line:'Added 3/3 tasks · 2026-11-07',verified:3,expected:3,targets:['Lectures','practice problems','review'].map((title,i)=>({kind:'task',id:`synthetic-cse-${i}`,action:'added',title:`CSE354: ${title}`,date:'2026-11-07',state:'applied',verification:'verified',before:{},after:{title:`CSE354: ${title}`,date:'2026-11-07',completed:false}}))}}
      expect(validConversationView(reply)).toBe(true);return route.fulfill({json:reply})
    })
    try{
    await page.goto('/')
    const box=page.getByRole('textbox',{name:'Ask Hermes about tasks, projects, or calendar'})
    await expect(box).toHaveAttribute('id','hermes-conversation-input');await expect(box).toBeEnabled();await box.fill('I have an exam coming up for CSE354 I need to study 3 chunks today can you put that in my tasks using specific topics');await box.press('Enter')
    await expect(page.getByText(clarification('task_topics').question)).toBeVisible()
    const form=page.locator('.hermes-conversation'),wording=page.getByText(clarification('task_topics').question)
    const questionBox=(await wording.boundingBox())!,inputBox=(await box.boundingBox())!
    expect(questionBox.y+questionBox.height).toBeLessThanOrEqual(inputBox.y)
    const questionStyle=await wording.evaluate(el=>{const s=getComputedStyle(el),panel=getComputedStyle(el.closest('.hermes-question-panel')!);return {color:s.color,background:panel.backgroundColor,size:parseFloat(s.fontSize),line:parseFloat(s.lineHeight)}})
    expect(questionStyle.size).toBeGreaterThanOrEqual(15);expect(questionStyle.line/questionStyle.size).toBeGreaterThanOrEqual(1.5)
    expect(contrast(questionStyle.color,questionStyle.background)).toBeGreaterThanOrEqual(4.5)
    await expect(page.getByText('Question 1 of 3',{exact:true})).toBeVisible()
    await expect(form.getByText(/Answers stay linked/)).toHaveCount(0)
    const originalDetails=form.locator('.hermes-original-request')
    await expect(originalDetails).toHaveJSProperty('open',false)
    await expect(page.getByText('Original request: '+original)).toBeHidden()
    await originalDetails.locator('summary').click();await expect(page.getByText('Original request: '+original)).toBeVisible()
    await originalDetails.locator('summary').click()
    const send=form.getByRole('button',{name:'Send answer',exact:true})
    await expect(send).toBeDisabled()
    await controlsStayThemedAndContained(form)
    await box.fill('Lectures; practice problems; review')
    await expect(send).toBeEnabled()
    await capture(page,viewport.width,'question')
    await box.focus();await box.press('Tab')
    await expect(send).toBeFocused()
    await expect.poll(()=>send.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid')
    await expect.poll(()=>send.evaluate(el=>parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(2)
    await send.hover();await expect.poll(()=>send.evaluate(el=>getComputedStyle(el).filter)).not.toBe('none')
    await controlsStayThemedAndContained(form)
    await box.press('Enter')
    await expect.poll(()=>answering).toBe(true)
    await expect(send).toBeDisabled();await expect(box).toBeEnabled()
    await expect(form.getByRole('button',{name:'Stop waiting'})).toBeVisible()
    expect(await send.evaluate(el=>Number(getComputedStyle(el).opacity))).toBeLessThan(1)
    await controlsStayThemedAndContained(form)
    await capture(page,viewport.width,'waiting')
    releaseAnswer()
    await expect(page.getByText('Added 3/3 tasks · 2026-11-07')).toBeVisible();await expect(box).toHaveValue('')
    await expect(page.getByText(clarification('task_topics').question)).toHaveCount(0)
    await controlsStayThemedAndContained(form)
    await capture(page,viewport.width,'complete')
    const view=page.locator('.hermes-receipt summary');await view.click()
    await expect(page.getByText('added: CSE354: review',{exact:true})).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    expect((await view.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await page.getByRole('button',{name:'Dismiss',exact:true}).click();await expect(page.getByText('Added 3/3 tasks · 2026-11-07')).toHaveCount(0)
    expect(turns).toBe(2)
    }finally{releaseAnswer()}
  })
}
