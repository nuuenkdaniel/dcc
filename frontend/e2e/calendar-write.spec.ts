import {test,expect} from './authenticated'
test('a durable create appears immediately, posts automatically, and survives a stale snapshot',async({page})=>{
  await page.route('**/api/v1/auth/session',r=>r.fulfill({json:{authenticated:true,configured:true}}))
  await page.route('**/api/v1/calendar/snapshot',r=>r.fulfill({json:{calendars:[{id:'fixture',name:'Test calendar'}],events:[],lastSuccess:new Date().toISOString()}}))
  let submitted=0,refreshes=0,release!:()=>void
  await page.route('**/api/v1/calendar/refresh',r=>{refreshes++;return r.fulfill({json:{status:'synced'}})})
  await page.route('**/api/v1/calendar/changes',async r=>{submitted++;await new Promise<void>(resolve=>release=resolve);return r.fulfill({json:{saved:true}})})
  await page.goto('/')
  await expect.poll(()=>refreshes).toBeGreaterThanOrEqual(1)
  const initialRefreshes=refreshes
  await page.getByRole('button',{name:'New event',exact:true}).click()
 await page.setViewportSize({width:375,height:900})
 await page.getByLabel('Event title',{exact:true}).fill('Offline test event')
 await page.screenshot({path:'test-results/calendar-editor-mobile.png',fullPage:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.getByRole('button',{name:'Save event',exact:true}).click()
  await expect(page.locator('.schedule-event').getByText('Offline test event',{exact:true})).toBeVisible()
  await expect.poll(()=>submitted).toBe(1)
  await expect(page.getByRole('status').filter({hasText:'Syncing'})).toBeVisible()
  release()
  await expect.poll(()=>refreshes).toBeGreaterThan(initialRefreshes)
  await expect(page.getByRole('status').filter({hasText:'Awaiting calendar confirmation'})).toBeVisible()
  await page.waitForTimeout(100)
  await expect(page.locator('.schedule-event').getByText('Offline test event',{exact:true})).toBeVisible()
})

test('an awaiting-confirmation write reloads visibly and requests a bounded refresh with no repost',async({page})=>{
 await page.route('**/api/v1/auth/session',r=>r.fulfill({json:{authenticated:true,configured:true}}))
 await page.route('**/api/v1/calendar/snapshot',r=>r.fulfill({json:{calendars:[{id:'fixture',name:'Test calendar'}],events:[],lastSuccess:new Date().toISOString(),coverageStart:'2026-01-01T00:00:00.000Z',coverageEnd:'2027-01-01T00:00:00.000Z'}}))
 let posts=0,refreshes=0
 await page.route('**/api/v1/calendar/refresh',r=>{refreshes++;return r.fulfill({json:{status:'synced'}})})
 await page.route('**/api/v1/calendar/changes',r=>{posts++;return r.fulfill({json:{saved:true}})})
 await page.goto('/')
 await page.getByRole('button',{name:'New event',exact:true}).click()
 await page.getByLabel('Event title',{exact:true}).fill('Awaiting confirmation')
 await page.getByRole('button',{name:'Save event',exact:true}).click()
 await expect.poll(()=>posts).toBe(1)
 await expect(page.locator('.schedule-event').getByText('Awaiting confirmation',{exact:true})).toBeVisible()
 await page.reload()
 await expect(page.locator('.schedule-event').getByText('Awaiting confirmation',{exact:true})).toBeVisible()
 await expect.poll(()=>refreshes).toBeGreaterThanOrEqual(2)
 await page.waitForTimeout(150)
 expect(posts).toBe(1)
 expect(refreshes).toBeLessThanOrEqual(3)
})

test('a successful write refreshes and converges without a calendar worker or duplicate event',async({page})=>{
 await page.route('**/api/v1/auth/session',r=>r.fulfill({json:{authenticated:true,configured:true}}))
 let change:{id:string;calendarId:string;title:string;start:string;end:string;allDay:boolean;description:string;location:string}|undefined
 let authoritative=false
 await page.route('**/api/v1/calendar/changes',r=>{change=r.request().postDataJSON() as typeof change;return r.fulfill({json:{saved:true}})})
 await page.route('**/api/v1/calendar/refresh',r=>{if(change)authoritative=true;return r.fulfill({json:{status:'synced'}})})
 await page.route('**/api/v1/calendar/snapshot',r=>r.fulfill({json:{calendars:[{id:'fixture',name:'Test calendar'}],events:authoritative&&change?[{...change,id:'confirmed',uid:`${change.id}@daymark`,mutationId:change.id}]:[],lastSuccess:new Date().toISOString(),coverageStart:'2026-01-01T00:00:00.000Z',coverageEnd:'2027-01-01T00:00:00.000Z'}}))
 await page.goto('/')
 await page.getByRole('button',{name:'New event',exact:true}).click()
 await page.getByLabel('Event title',{exact:true}).fill('Converged event')
 await page.getByRole('button',{name:'Save event',exact:true}).click()
 await expect(page.locator('.schedule-event').getByText('Converged event',{exact:true})).toBeVisible()
 await expect(page.locator('.pending-calendar')).toHaveCount(0)
 await expect(page.locator('.schedule-event').getByText('Converged event',{exact:true})).toHaveCount(1)
})

test('an offline create survives reload and posts exactly once when online',async({page})=>{
  await page.route('**/api/v1/auth/session',r=>r.fulfill({json:{authenticated:true,configured:true}}))
  await page.route('**/api/v1/calendar/snapshot',r=>r.fulfill({json:{calendars:[{id:'fixture',name:'Test calendar'}],events:[],lastSuccess:new Date().toISOString()}}))
  await page.route('**/api/v1/calendar/changes',r=>r.abort())
  await page.goto('/')
  await page.getByRole('button',{name:'New event',exact:true}).click()
  await page.getByLabel('Event title',{exact:true}).fill('Offline test event')
  await page.getByRole('button',{name:'Save event',exact:true}).click()
  await expect(page.locator('.schedule-event').getByText('Offline test event',{exact:true})).toBeVisible()
  await page.reload()
  await expect(page.locator('.schedule-event').getByText('Offline test event',{exact:true})).toBeVisible()
  let submitted=0
  await page.unroute('**/api/v1/calendar/changes')
  await page.route('**/api/v1/calendar/changes',r=>{submitted++;return r.fulfill({json:{saved:true}})})
  await page.evaluate(()=>window.dispatchEvent(new Event('online')))
  await expect.poll(()=>submitted).toBe(1)
  await page.waitForTimeout(100)
  await expect(page.locator('.schedule-event').getByText('Offline test event',{exact:true})).toBeVisible()
})

test('the serialized flush does not race or drop a new change added in flight',async({page})=>{
 await page.route('**/api/v1/auth/session',r=>r.fulfill({json:{authenticated:true,configured:true}}))
 await page.route('**/api/v1/calendar/snapshot',r=>r.fulfill({json:{calendars:[{id:'fixture',name:'Test calendar'}],events:[],lastSuccess:new Date().toISOString()}}))
 let release!:()=>void
 const submitted:string[]=[]
 await page.route('**/api/v1/calendar/changes',async r=>{submitted.push((r.request().postDataJSON() as {title:string}).title);if(submitted.length===1)await new Promise<void>(resolve=>release=resolve);return r.fulfill({json:{saved:true}})})
 await page.goto('/')
 for(const title of ['First in flight','Second queued']){
  await page.getByRole('button',{name:'New event',exact:true}).click()
  await page.getByLabel('Event title',{exact:true}).fill(title)
  await page.getByRole('button',{name:'Save event',exact:true}).click()
  await expect(page.locator('.schedule-event').getByText(title,{exact:true})).toBeVisible()
 }
 await page.evaluate(()=>window.dispatchEvent(new Event('online')))
 await expect.poll(()=>submitted).toEqual(['First in flight'])
 release()
 await expect.poll(()=>submitted).toEqual(['First in flight','Second queued'])
 await expect(page.locator('.schedule-event').getByText('First in flight',{exact:true})).toBeVisible()
 await expect(page.locator('.schedule-event').getByText('Second queued',{exact:true})).toBeVisible()
})

test('conflicting queued edits are retained and not retried silently',async({page})=>{
 await page.route('**/api/v1/auth/session',r=>r.fulfill({json:{authenticated:true,configured:true}}))
 await page.route('**/api/v1/calendar/snapshot',r=>r.fulfill({json:{calendars:[{id:'fixture',name:'Test calendar'}],events:[],lastSuccess:new Date().toISOString()}}))
 let attempts=0
 await page.route('**/api/v1/calendar/changes',r=>{attempts++;return r.fulfill({status:409,json:{error:'changed'}})})
 await page.goto('/')
 await page.getByRole('button',{name:'New event',exact:true}).click()
 await page.getByLabel('Event title',{exact:true}).fill('Conflicting test draft')
 await page.getByRole('button',{name:'Save event',exact:true}).click()
 await expect(page.locator('.pending-calendar').getByText('Changed in Nextcloud.',{exact:false})).toBeVisible()
 await page.reload()
 await expect(page.locator('.schedule-event').getByText('Conflicting test draft',{exact:true})).toBeVisible()
 await page.evaluate(()=>window.dispatchEvent(new Event('online')))
 await expect.poll(()=>attempts).toBe(1)
 await page.getByRole('button',{name:'Discard draft',exact:true}).click()
 await expect(page.getByText('Conflicting test draft',{exact:true})).toHaveCount(0)
})

test('all-day exclusive dates and an occurrence edit project correctly',async({page})=>{
 const localDate=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
 const today=new Date(),tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1)
 const day=localDate(today),next=localDate(tomorrow)
 const events=[
  {id:'first',uid:'series',recurrenceId:`${day}T13:00:00Z`,calendarId:'fixture',etag:'one',title:'First occurrence',start:`${day}T13:00:00.000Z`,end:`${day}T14:00:00.000Z`,allDay:false,location:'',description:''},
  {id:'second',uid:'series',recurrenceId:`${day}T15:00:00Z`,calendarId:'fixture',etag:'two',title:'Second occurrence',start:`${day}T15:00:00.000Z`,end:`${day}T16:00:00.000Z`,allDay:false,location:'',description:''},
 ]
 await page.route('**/api/v1/auth/session',r=>r.fulfill({json:{authenticated:true,configured:true}}))
 await page.route('**/api/v1/calendar/snapshot',r=>r.fulfill({json:{calendars:[{id:'fixture',name:'Test calendar'}],events,lastSuccess:new Date().toISOString()}}))
 await page.route('**/api/v1/calendar/changes',r=>r.abort())
 await page.goto('/')

 await page.getByRole('button',{name:'New event',exact:true}).click()
 await page.getByLabel('Event title',{exact:true}).fill('All-day hold')
 await page.getByLabel('All day',{exact:true}).check()
 await page.getByLabel('Starts',{exact:true}).fill(day)
 await page.getByLabel('Ends (exclusive date)',{exact:true}).fill(next)
 await page.getByRole('button',{name:'Save event',exact:true}).click()
 await expect(page.locator('.schedule-event').getByText('All-day hold',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:new Intl.DateTimeFormat('en',{weekday:'long',month:'long',day:'numeric'}).format(tomorrow),exact:true}).click()
 await expect(page.locator('.schedule-event').getByText('All-day hold',{exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:new Intl.DateTimeFormat('en',{weekday:'long',month:'long',day:'numeric'}).format(today),exact:true}).click()

 await page.locator('.schedule-event').filter({hasText:'First occurrence'}).getByText('First occurrence',{exact:true}).click()
 await page.locator('.schedule-event').filter({hasText:'First occurrence'}).getByRole('button',{name:'Edit event'}).click()
 await page.getByLabel('Event title',{exact:true}).fill('Edited occurrence')
 await page.getByRole('button',{name:'Save event',exact:true}).click()
 await expect(page.locator('.schedule-event').getByText('Edited occurrence',{exact:true})).toBeVisible()
 await expect(page.locator('.schedule-event').getByText('Second occurrence',{exact:true})).toBeVisible()

})
