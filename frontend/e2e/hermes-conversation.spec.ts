// Synthetic HTTP only. Parent-owned Chromium gate, not model/DB acceptance.
import {test,expect} from './authenticated'
import {clarification} from '../../backend/src/mcp/clarification'
import {validConversationView} from '../../backend/src/mcp/conversation-wire'
for(const viewport of [{width:1280,height:800},{width:360,height:480}]){
  test(`inline clarification + verified receipt at ${viewport.width}px`,async({page})=>{
    await page.setViewportSize(viewport)
    await page.route('**/api/v1/hermes/action-capabilities',route=>route.fulfill({json:{productActions:true,conversation:true,workspaceOwner:'a'.repeat(64)}}))
    let original='',rootKey='',turns=0
    await page.route('**/api/v1/hermes/conversation',async route=>{
      const b=route.request().postDataJSON();turns++
      if(b.op==='start'){
        original=b.prompt;rootKey=b.key
        const reply={version:1,rootKey,turnKey:rootKey,expiresAt:Date.now()+86400000,questions:1,original,question:{...clarification('task_topics'),id:'b'.repeat(64)},receipt:{version:1,key:rootKey,outcome:'question',line:'Details needed',verified:0,expected:null,targets:[]}}
        expect(validConversationView(reply)).toBe(true);return route.fulfill({json:reply})
      }
      expect(b.op).toBe('answer');expect(b.rootKey).toBe(rootKey);expect(b.parentKey).toBe(rootKey);expect(b.questionId).toBe('b'.repeat(64));expect(b.answer).toBe('Lectures; practice problems; review')
      const reply={version:1,rootKey,turnKey:b.key,expiresAt:Date.now()+86400000,questions:1,receipt:{version:1,key:b.key,outcome:'complete',line:'Added 3/3 tasks · 2026-11-07',verified:3,expected:3,targets:['Lectures','practice problems','review'].map((title,i)=>({kind:'task',id:`synthetic-cse-${i}`,action:'added',title:`CSE354: ${title}`,date:'2026-11-07',state:'applied',verification:'verified',before:{},after:{title:`CSE354: ${title}`,date:'2026-11-07',completed:false}}))}}
      expect(validConversationView(reply)).toBe(true);return route.fulfill({json:reply})
    })
    await page.goto('/')
    const box=page.getByRole('textbox',{name:'Ask Hermes about tasks, projects, or calendar'})
    await expect(box).toHaveAttribute('id','hermes-conversation-input');await expect(box).toBeEnabled();await box.fill('I have an exam coming up for CSE354 I need to study 3 chunks today can you put that in my tasks');await box.press('Enter')
    await expect(page.getByText(clarification('task_topics').question)).toBeVisible()
    await expect(page.getByText('Original request: '+original)).toBeVisible()
    await box.fill('Lectures; practice problems; review');await box.press('Enter')
    await expect(page.getByText('Added 3/3 tasks · 2026-11-07')).toBeVisible();await expect(box).toHaveValue('')
    await expect(page.getByText(clarification('task_topics').question)).toHaveCount(0)
    const view=page.locator('.hermes-receipt summary');await view.click()
    await expect(page.getByText('added: CSE354: review',{exact:true})).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    expect((await view.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await page.getByRole('button',{name:'Dismiss',exact:true}).click();await expect(page.getByText('Added 3/3 tasks · 2026-11-07')).toHaveCount(0)
    expect(turns).toBe(2)
  })
}
