// Explicit parent-only real model/browser/HTTP/PG campaign. Outside test globs.
import {Pool,type PoolClient} from 'pg'
import ICAL from 'ical.js'
import {authenticatedRuntimeFixture,validateRuntimeIsolation,type RuntimeIsolation} from '../mcp/authenticated-runtime-fixture.js'
import {createScopedCalendarWriter,buildScopedEventResource,type EventChange} from '../../src/calendar-write.js'
import {ACTION_PATH,TASK_CALLBACK_PATH,type TaskBridge,type TaskBridgeInput} from '../../src/mcp/task-actions.js'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
import {TOOLS} from '../../src/mcp/contracts.js'
import {canonicalJson,RECEIPT_KIND} from '../../src/mcp/service-transport.js'
import {clarification,validClarification} from '../../src/mcp/clarification.js'
import {JourneyRuntime} from './journey-runtime.js'
import {JourneyBrowser,ORIGIN,expect} from './journey-browser.js'
import {mountBuiltApp} from './static-app.js'
import {SyntheticCalendarProvider,calendarConfig,calendars,PROVIDER,hash,EASTERN_ZONE} from './calendar-provider.js'
import type {Snapshot} from '../../src/sync.js'

let stage='approval',seed:number|null=null,assertions=0
const abort=new AbortController(),stop=()=>abort.abort()
process.once('SIGINT',stop);process.once('SIGTERM',stop)
const runtime=new JourneyRuntime(abort.signal)
const measurements:{seed:number;phase:string;calls:number;rows:number;puts:number;artifactSha256:string;timerVersion?:number;timerReceiptCount?:number;providerBodySha256?:string;providerEtag?:string}[]=[]
const timerEvidence:{seed:number;version:number;remainingMs:number;running:boolean;phase:string;receiptCount:number}[]=[]
let providerEvidence:{resources:{pathHash:string;bodySha256:string;etag:string}[];puts:{code:number;pathHash:string;ifMatch?:string;ifNoneMatch?:string;bodySha256?:string;etag?:string}[]}={resources:[],puts:[]}
function check(value:unknown):asserts value{if(!value||abort.signal.aborted)throw Error('QA journey assertion');assertions++}

async function main(){
  check(process.argv.length===2&&process.env.DCC_QA_JOURNEYS_APPROVED==='synthetic-browser-calendar-model'&&process.env.DCC_QA_RUNTIME_APPROVED==='synthetic-loopback-model')
  check(!Object.keys(process.env).some(k=>k.startsWith('PG')||['DATABASE_URL','NODE_OPTIONS','NODE_EXTRA_CA_CERTS'].includes(k)))
  const database=process.env.DCC_QA_DATABASE??'',user=process.env.DCC_QA_PG_USER??''
  check(/^dcc_qa_[a-z0-9_]{1,48}$(?![\s\S])/.test(database)&&/^[a-z_][a-z0-9_]{0,62}$(?![\s\S])/.test(user))
  const pool=new Pool({host:'127.0.0.1',port:18533,database,user,password:'synthetic-isolated-qa-only',ssl:false,max:6,connectionTimeoutMillis:5000,statement_timeout:5000,options:'-c search_path=public'})
  pool.on('error',()=>{/* No arbitrary driver diagnostics. */})
  const isolation:RuntimeIsolation={database:{host:'127.0.0.1',port:18533,name:database,disposable:true},syntheticDataOnly:true,model:'gpt-6-luna',modelInvocationApproved:true,calendar:'synthetic-loopback',calendarOrigins:[PROVIDER]}
  const provider=new SyntheticCalendarProvider()
  let lock:PoolClient|undefined
  const rows=async()=> (await pool.query('SELECT id,kind,version,data FROM planner_entities ORDER BY id')).rows
  const snapshot=async():Promise<Snapshot>=> (await pool.query('SELECT snapshot FROM calendar_sync_state WHERE id=1')).rows[0].snapshot
  try{
    stage='target-and-empty-namespace'
    validateRuntimeIsolation(pool,isolation)
    const actual=(await pool.query("SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::int AS version")).rows[0]
    check(actual.db===database&&actual.host==='127.0.0.1'&&actual.port===18533&&actual.version>=170000&&actual.version<180000)
    lock=await pool.connect();check((await lock.query('SELECT pg_try_advisory_lock(817349) AS acquired')).rows[0].acquired===true)
    const tables=(await pool.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY tablename")).rows
    check(canonicalJson(tables)===canonicalJson(['app_sessions','calendar_mutations','calendar_sync_state','planner_entities','planner_runs'].map(tablename=>({schemaname:'public',tablename}))))
    check((await rows()).length===0&&(await pool.query('SELECT count(*)::int AS n FROM calendar_mutations')).rows[0].n===0&&(await pool.query('SELECT count(*)::int AS n FROM app_sessions')).rows[0].n===0)
    const sync=(await pool.query('SELECT * FROM calendar_sync_state')).rows,planner=(await pool.query('SELECT * FROM planner_runs')).rows
    check(sync.length===1&&sync[0].id===1&&sync[0].source_hash===null&&sync[0].last_success===null&&sync[0].last_attempt===null&&sync[0].error===null&&sync[0].failures===0&&canonicalJson(sync[0].snapshot)===canonicalJson({calendars:[]}))
    check(planner.length===1&&planner[0].id===1&&planner[0].day===null&&planner[0].summary===null&&planner[0].last_success===null&&planner[0].error===null&&planner[0].requested===false)
    stage='bootstrap-and-provider'
    await runtime.preflight();await provider.start();await provider.refresh(pool)
    const writer=createScopedCalendarWriter(pool,calendarConfig)
    const store=new SqlIntentStore(pool,'synthetic-runtime-acceptance')
    for(const campaignSeed of [20261105,20261106]){
      seed=campaignSeed
      // Each phase gets a fresh auth/app/browser scope; production rate limits
      // stay enabled. Never sleep/retry through a rate limit.
      stage='timer-browser'
      let hostMode:'none'|'no-tab'|'auth-loss'='none',hostDone=Promise.resolve()
      const bridge:TaskBridge=(input,signal)=>{
        if(hostMode==='none')return runtime.invoke(input,signal)
        const work=hostTimerProbe(input,signal,hostMode==='no-tab')
        hostDone=work.then(()=>undefined,()=>undefined)
        return work
      }
      const app=authenticatedRuntimeFixture({pool,bridge,origin:ORIGIN,isolation,isolatedSyntheticOnly:true,calendarSnapshot:snapshot,guardedCalendarWriter:writer})
      let browser:JourneyBrowser|undefined
      const timerStart=runtime.calls
      try{
        const artifactSha256=await mountBuiltApp(app);check(measurements.every(m=>m.artifactSha256===artifactSha256));await app.listen({host:'127.0.0.1',port:18534})
        browser=await JourneyBrowser.open()
        const name=`QA mini ${seed}`
        const first=await browser.submit(`Synthetic QA ${seed}. Read my focus timer. Configure focus 25 minutes and break 5 minutes, start the default focus session, then add one mini timer named "${name}" lasting 5 minutes WHILE the default clock is running. Do not restart, reset, switch phase or select the mini. Read after start and after adding the mini. Use current versions before each write. No other actions.`)
        const firstRecord=await store.read(first.key)
        check(first.summary.effects.length===3&&first.summary.effects.every(e=>e.state==='applied'))
        const commands=firstRecord.calls.filter(c=>TOOLS[c.command.tool].write)
        check(commands[0]?.command.tool==='control_focus_timer'&&commands[0].command.args.action==='configure'&&commands[1]?.command.args.action==='start'&&commands[2]?.command.tool==='edit_focus_queue'&&commands[2].command.args.action==='add')
        await timerProof(pool,store,first.key,browser)
        const afterStart=firstRecord.calls.slice(firstRecord.calls.indexOf(commands[1]!)+1,firstRecord.calls.indexOf(commands[2]!)).find(c=>c.command.tool==='get_focus_timer'&&c.result?.state==='ok')
        const afterQueue=firstRecord.calls.slice(firstRecord.calls.indexOf(commands[2]!)+1).find(c=>c.command.tool==='get_focus_timer'&&c.result?.state==='ok')
        check(afterStart?.result?.state==='ok'&&afterQueue?.result?.state==='ok')
        const startData=afterStart.result.data as Record<string,any>,queueData=afterQueue.result.data as Record<string,any>
        check(startData.running===true&&queueData.running===true&&queueData.focusMinutes===25&&queueData.breakMinutes===5&&startData.activeMiniId===queueData.activeMiniId&&queueData.sessionRemainingMs<=startData.sessionRemainingMs&&queueData.sessionRemainingMs>1400000)
        check(queueData.miniTimers.length===1&&queueData.miniTimers[0].name===name&&queueData.miniTimers[0].duration===300)
        await browser.advancing();await browser.cloneDenied();await browser.manualPauseResume()
        stage='timer-model-pause-resume'
        const second=await browser.submit(`Synthetic QA ${seed}. Read my current timer, pause it, read its paused state, then resume that SAME focus session and read again. Preserve elapsed progress, phase, active identity and queued minis. Do not start a new session, reset, configure or edit the queue.`)
        await timerProof(pool,store,second.key,browser)
        const secondRecord=await store.read(second.key),secondWrites=secondRecord.calls.filter(c=>TOOLS[c.command.tool].write)
        check(second.summary.effects.length===2&&secondWrites[0]?.command.args.action==='pause'&&secondWrites[1]?.command.args.action==='resume')
        const paused=secondRecord.calls.slice(secondRecord.calls.indexOf(secondWrites[0]!)+1,secondRecord.calls.indexOf(secondWrites[1]!)).find(c=>c.command.tool==='get_focus_timer'&&c.result?.state==='ok')
        check(paused?.result?.state==='ok'&&(paused.result.data as {running:boolean}).running===false)
        const resumed=secondRecord.calls.slice(secondRecord.calls.indexOf(secondWrites[1]!)+1).find(c=>c.command.tool==='get_focus_timer'&&c.result?.state==='ok')
        check(resumed?.result?.state==='ok')
        const pausedData=paused.result.data as Record<string,any>,resumedData=resumed.result.data as Record<string,any>
        check(resumedData.running===true&&resumedData.phase===pausedData.phase&&resumedData.activeMiniId===pausedData.activeMiniId&&resumedData.sessionRemainingMs<=pausedData.sessionRemainingMs&&pausedData.sessionRemainingMs<=queueData.sessionRemainingMs)
        await browser.advancing()
        const replayBefore=await browser.timer(),rowsBefore=canonicalJson(await rows()),callsBefore=runtime.calls
        check(canonicalJson(await browser.replay(second.key,second.prompt,second.tabId))===canonicalJson(second.summary))
        const replayAfter=await browser.timer()
        check(runtime.calls===callsBefore&&canonicalJson(await rows())===rowsBefore&&canonicalJson(replayAfter.receipts)===canonicalJson(replayBefore.receipts)&&replayAfter.version===replayBefore.version&&replayAfter.timer.sessionRemainingMs<=replayBefore.timer.sessionRemainingMs)
        stage='timer-model-reset-cleanup'
        const third=await browser.submit(`Synthetic QA ${seed}. Read my timer and queue. Remove only the mini named "${name}" by its current backend-owned ID, then reset the default focus session. Read back. End paused, focus phase, empty mini queue, 25-minute fresh default session. Preserve receipt history; do not configure or create anything else.`)
        await timerProof(pool,store,third.key,browser)
        check(third.summary.effects.length===2)
        const thirdWrites=(await store.read(third.key)).calls.filter(c=>TOOLS[c.command.tool].write)
        check(thirdWrites[0]?.command.tool==='edit_focus_queue'&&thirdWrites[0].command.args.action==='remove'&&thirdWrites[1]?.command.tool==='control_focus_timer'&&thirdWrites[1].command.args.action==='reset')
        const clean=await browser.timer()
        check(!clean.timer.running&&clean.timer.phase==='focus'&&clean.timer.sessionRemainingMs===1500000&&clean.timer.activeMiniId===null&&clean.timer.miniTimers.length===0&&Object.keys(clean.receipts).length===7)
        await browser.reloadProof()
        stage='timer-host-no-tab'
        hostMode='no-tab'
        const noTabKey=`dcc_qa_${seed}_no_tab`
        const response=await browser.context.request.post(ORIGIN+ACTION_PATH,{headers:{Origin:ORIGIN},data:{key:noTabKey,prompt:'Synthetic host-only no-tab refusal; no model.'}})
        check(response.status()===200)
        const noTab=await store.read(noTabKey)
        check(noTab.calls.length===2&&noTab.calls.every(c=>c.result?.state==='rejected')&&canonicalJson((await browser.timer()).receipts)===canonicalJson(clean.receipts))
        stage='timer-host-auth-loss'
        hostMode='auth-loss'
        await authLossProbe(browser,store,()=>hostDone)
        check(runtime.calls-timerStart===3)
        measurements.push({seed,phase:'timer',calls:3,rows:(await rows()).length,puts:provider.events.filter(e=>e.method==='PUT').length,artifactSha256,timerVersion:clean.version,timerReceiptCount:Object.keys(clean.receipts).length})
      }finally{
        try{
          if(browser){
            try{const d=await browser.timer();timerEvidence.push({seed:campaignSeed,version:d.version,remainingMs:d.timer.sessionRemainingMs,running:d.timer.running,phase:d.timer.phase,receiptCount:Object.keys(d.receipts).length})}catch{/* No raw browser/session error. */}
            await browser.close()
          }
        }finally{await app.close()}
      }

      stage='calendar-browser'
      let syncAfterSaved=false
      const syncedWriter={...writer,write:async(change:EventChange)=>{const result=await writer.write(change);if(syncAfterSaved&&result.saved)await provider.refresh(pool);return result}}
      const calendarApp=authenticatedRuntimeFixture({pool,bridge:(input,signal)=>runtime.invoke(input,signal),origin:ORIGIN,isolation,isolatedSyntheticOnly:true,calendarSnapshot:snapshot,guardedCalendarWriter:syncedWriter})
      let calendarBrowser:JourneyBrowser|undefined
      const calendarStart=runtime.calls,putsBefore=provider.events.filter(e=>e.method==='PUT').length
      try{
        const artifactSha256=await mountBuiltApp(calendarApp);check(measurements.every(m=>m.artifactSha256===artifactSha256));await calendarApp.listen({host:'127.0.0.1',port:18534})
        calendarBrowser=await JourneyBrowser.open()
        const target=calendars[campaignSeed===20261105?0:1]!,title=`QA weekly ${seed}`
        const oldSnapshot=canonicalJson(await snapshot())
        const created=await calendarBrowser.submit(`Synthetic QA ${seed}. List calendars, then list ${target.name} events in [2026-10-01T00:00:00Z,2026-12-01T00:00:00Z), limit 25 offset 0. In EXACT calendar ${target.name}, create ONE weekly timed series titled "${title}", description "Synthetic weekly check", location "QA room", scope series. Start 2026-11-02 09:00 and end 10:00 America/New_York (14:00Z to 15:00Z); RRULE FREQ=WEEKLY;COUNT=4. Add RDATE 2026-11-04T14:00:00Z and EXDATE 2026-11-23T14:00:00Z. Use that calendar's trusted timezone-donor event for VTIMEZONE, not a guessed zone definition. Check the returned operation receipt. Saved is snapshot_pending, not a refreshed event ID; do not invent one. No other writes.`)
        check(created.summary.effects.length===1&&created.summary.effects[0]?.state==='saved'&&created.summary.effects[0].confirmation==='snapshot_pending')
        await expect(calendarBrowser.page.locator('#tell-hermes-status')).toContainText('snapshot confirmation pending')
        check(canonicalJson(await snapshot())===oldSnapshot)
        const entry=[...provider.resources.entries()].find(([,resource])=>resource.body.includes(title))
        check(entry)
        const [path,resource]=entry,root=new ICAL.Component(ICAL.parse(resource.body)),master=root.getFirstSubcomponent('vevent')!
        check(root.getAllSubcomponents('vtimezone').length===1&&root.getFirstSubcomponent('vtimezone')!.toString()===new ICAL.Component(ICAL.parse(EASTERN_ZONE)).toString())
        check(master.getFirstPropertyValue('rrule')?.toString()==='FREQ=WEEKLY;COUNT=4'&&master.getFirstProperty('dtstart')?.getParameter('tzid')==='America/New_York'&&String(master.getFirstPropertyValue('dtstart'))==='2026-11-02T09:00:00')
        const uid=String(master.getFirstPropertyValue('uid')),zone=root.getFirstSubcomponent('vtimezone')!.toString(),rdates=master.getAllProperties('rdate').map(p=>p.toICALString()),exdates=master.getAllProperties('exdate').map(p=>p.toICALString())
        check(rdates.length===1&&exdates.length===1)
        await calendarProof(pool,store,created.key,provider)
        const fresh=await provider.refresh(pool),selected=fresh.events.find(e=>e.title===title&&e.start==='2026-11-02T14:00:00.000Z')
        check(selected)
        // Controlled external edit: stale cache ETag must fail BEFORE any PUT.
        const altered={body:resource.body.replace('QA room','QA externally reviewed room'),etag:'"qa-external-'+seed+'"'}
        provider.resources.set(path,altered)
        const stalePuts=provider.events.filter(e=>e.method==='PUT').length
        const stale=await writer.write({id:`${seed}-0000-4000-a000-000000000001`,calendarId:target.id,eventId:selected.id,etag:selected.etag,uid,scope:'series',title,start:selected.start,end:selected.end,allDay:false,description:'Must not overwrite',location:'QA room'})
        check(stale.safeFailure==='revision_mismatch'&&provider.events.filter(e=>e.method==='PUT').length===stalePuts&&provider.resources.get(path)===altered)
        // Existing recurring timed -> all-day conversion is a source-level
        // deterministic refusal; DST questions below test typed envelopes only.
        let conversionRefused=false
        try{buildScopedEventResource({id:'12345678-1234-4234-a234-123456789abc',scope:'series',uid,title,start:'2026-11-02',end:'2026-11-03',allDay:true,description:'',location:''},altered.body)}catch{conversionRefused=true}
        check(conversionRefused)
        for(const reason of ['dst_gap','dst_fold'] as const)check(validClarification(clarification(reason)))
        await provider.refresh(pool)
        syncAfterSaved=true
        stage='calendar-model-occurrence-edit-cancel'
        const changed=await calendarBrowser.submit(`Synthetic QA ${seed}. In exact calendar ${target.name}, list events for [2026-11-01T00:00:00Z,2026-11-30T00:00:00Z), limit 25 offset 0. For series "${title}", read get_calendar_series and current ETags. Move ONLY occurrence originally 2026-11-09 09:00 America/New_York (14:00Z), to 10:00-11:00 that day (15:00Z-16:00Z), explicit single scope, retaining title/description/location. Then cancel ONLY the DIFFERENT occurrence 2026-11-16 09:00 America/New_York, single scope, using its exact cached recurrenceId. Our isolated sync runs after each verified save: list events/read master AGAIN between writes to obtain current ETag. Preserve UID, RRULE, RDATE, EXDATE, timezone and all unrelated occurrences. Read master afterwards. Saved receipts remain snapshot_pending, never claim production sync. No other writes.`)
        check(changed.summary.effects.length===2&&changed.summary.effects[0]?.tool==='update_calendar_event'&&changed.summary.effects[1]?.tool==='cancel_calendar_event'&&changed.summary.effects.every(e=>e.state==='saved'&&e.confirmation==='snapshot_pending'))
        await calendarProof(pool,store,changed.key,provider)
        const calendarWrites=(await store.read(changed.key)).calls.filter(c=>TOOLS[c.command.tool].write)
        check(calendarWrites.length===2&&calendarWrites.every(c=>c.command.args.scope==='single')&&calendarWrites[0]?.command.args.recurrenceId==='2026-11-09T09:00:00'&&calendarWrites[1]?.command.args.recurrenceId==='2026-11-16T09:00:00')
        const final=provider.resources.get(path)!,finalRoot=new ICAL.Component(ICAL.parse(final.body)),finalMaster=finalRoot.getFirstSubcomponent('vevent')!
        check(String(finalMaster.getFirstPropertyValue('uid'))===uid&&finalMaster.getFirstPropertyValue('status')!=='CANCELLED'&&finalRoot.getFirstSubcomponent('vtimezone')!.toString()===zone&&finalMaster.getFirstPropertyValue('rrule')?.toString()==='FREQ=WEEKLY;COUNT=4')
        check(canonicalJson(finalMaster.getAllProperties('rdate').map(p=>p.toICALString()))===canonicalJson(rdates)&&canonicalJson(finalMaster.getAllProperties('exdate').map(p=>p.toICALString()))===canonicalJson(exdates))
        const exceptions=finalRoot.getAllSubcomponents('vevent').filter(e=>e.hasProperty('recurrence-id'))
        check(exceptions.length===2&&exceptions.every(e=>String(e.getFirstPropertyValue('uid'))===uid))
        const shifted=exceptions.find(e=>String(e.getFirstPropertyValue('recurrence-id'))==='2026-11-09T09:00:00'),cancelled=exceptions.find(e=>String(e.getFirstPropertyValue('recurrence-id'))==='2026-11-16T09:00:00')
        check(shifted&&shifted.getFirstPropertyValue('status')!=='CANCELLED'&&String(shifted.getFirstPropertyValue('dtstart'))==='2026-11-09T10:00:00'&&String(shifted.getFirstPropertyValue('dtend'))==='2026-11-09T11:00:00'&&cancelled?.getFirstPropertyValue('status')==='CANCELLED')
        const live=(await provider.snapshot()).events.filter(e=>e.uid===uid)
        check(live.length===3&&live.some(e=>e.start==='2026-11-02T14:00:00.000Z')&&live.some(e=>e.start==='2026-11-04T14:00:00.000Z')&&live.some(e=>e.start==='2026-11-09T15:00:00.000Z')&&!live.some(e=>e.recurrenceId==='2026-11-16T09:00:00'))
        const beforeReplay=canonicalJson(await rows()),mutationBefore=canonicalJson((await pool.query('SELECT * FROM calendar_mutations ORDER BY id')).rows),puts=provider.events.filter(e=>e.method==='PUT').length,calls=runtime.calls
        check(canonicalJson(await calendarBrowser.replay(changed.key,changed.prompt,changed.tabId))===canonicalJson(changed.summary))
        check(runtime.calls===calls&&canonicalJson(await rows())===beforeReplay&&canonicalJson((await pool.query('SELECT * FROM calendar_mutations ORDER BY id')).rows)===mutationBefore&&provider.events.filter(e=>e.method==='PUT').length===puts)
        check(puts-putsBefore===3&&runtime.calls-calendarStart===2)
        measurements.push({seed,phase:'calendar',calls:2,rows:(await rows()).length,puts:3,artifactSha256,providerBodySha256:hash(final.body),providerEtag:final.etag})
      }finally{try{if(calendarBrowser)await calendarBrowser.close()}finally{await calendarApp.close()}}
    }
    stage='final-evidence'
    check(runtime.calls===10&&runtime.evidence.length===10&&provider.events.filter(e=>e.method==='PUT').length===6)
    check(provider.events.every((e,i)=>e.method!=='PUT'||e.code!==412&&(e.ifNoneMatch==='*'||!!e.ifMatch)&&provider.events.slice(0,i).some(g=>g.method==='GET'&&g.path===e.path&&(e.ifNoneMatch==='*'?g.code===404:g.etag===e.ifMatch))))
    check((await rows()).every(r=>['dcc-request-intent-v1','hermes-command',RECEIPT_KIND].includes(r.kind)))
    console.log(JSON.stringify({status:'passed',stage,assertions,modelCalls:runtime.calls,schemaEvidence:runtime.evidence,measurements,timerEvidence,providerPuts:6,publicTLSProven:false,realCalDAVProven:false,fullMatrixPending:265}))
  }finally{
    // Bounded known synthetic evidence survives provider listener teardown even
    // on failure. No Authorization, capability, nonce, prompt or arbitrary log.
    providerEvidence={resources:[...provider.resources].slice(0,8).map(([path,r])=>({pathHash:hash(path),bodySha256:hash(r.body),etag:r.etag})),puts:provider.events.filter(e=>e.method==='PUT').slice(-8).map(({path,method:_method,...e})=>({...e,pathHash:hash(path)}))}
    try{await provider.close()}finally{try{if(lock){try{await lock.query('SELECT pg_advisory_unlock(817349)')}finally{lock.release()}}}finally{await pool.end()}}
  }
}

async function timerProof(pool:Pool,store:SqlIntentStore,key:string,browser:JourneyBrowser){
  const record=await store.read(key),document=await browser.timer()
  check(record.phase==='completed'&&record.rounds===1&&record.calls.length<=12)
  for(const call of record.calls.filter(c=>TOOLS[c.command.tool].write)){
    check(call.result?.state==='applied')
    const receipt=document.receipts[String(call.command.args.operationKey)]
    check(receipt&&canonicalJson(receipt.result)===canonicalJson(call.result)&&canonicalJson(browser.acks.get(call.result.id))===canonicalJson(call.result))
    const sql=(await pool.query('SELECT data FROM planner_entities WHERE kind=$1 AND data->>\'key\'=$2',[RECEIPT_KIND,call.command.args.operationKey])).rows
    check(sql.length===1&&canonicalJson(sql[0].data.result)===canonicalJson(call.result))
  }
}
async function calendarProof(pool:Pool,store:SqlIntentStore,key:string,provider:SyntheticCalendarProvider){
  const record=await store.read(key)
  check(record.phase==='completed'&&record.rounds===1&&record.calls.length<=12)
  for(const call of record.calls.filter(c=>TOOLS[c.command.tool].write)){
    check(call.result?.state==='saved'&&call.result.confirmation==='snapshot_pending'&&call.result.readback==='verified')
    const sql=(await pool.query('SELECT data FROM planner_entities WHERE kind=$1 AND data->>\'key\'=$2',[RECEIPT_KIND,call.command.args.operationKey])).rows
    check(sql.length===1)
    const receipt=sql[0].data,ledger=(await pool.query('SELECT payload_hash,result FROM calendar_mutations WHERE id=$1',[call.result.mutationId])).rows
    check(receipt.writerPayloadHash===hash(receipt.writerPayloadJson)&&canonicalJson(JSON.parse(receipt.writerPayloadJson))===canonicalJson(receipt.change)&&canonicalJson(receipt.result)===canonicalJson(call.result))
    check(ledger.length===1&&ledger[0].payload_hash===receipt.writerPayloadHash&&ledger[0].result.saved===true&&ledger[0].result.completion.readback==='verified'&&ledger[0].result.completion.snapshot==='pending')
    const providerEtag=call.result.providerEtag
    check(provider.events.some(e=>e.method==='PUT'&&e.etag===providerEtag))
  }
}

async function hostTimerProbe(input:TaskBridgeInput,signal:AbortSignal,noTab:boolean){
  let id=0
  const rpc=async(method:string,params?:unknown,notification=false)=>{
    const response=await fetch(ORIGIN+TASK_CALLBACK_PATH,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+input.callbackCapability,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:++id}),method,...(params?{params}:{})}),signal:AbortSignal.any([signal,abort.signal,AbortSignal.timeout(15000)])})
    if(response.status!==(notification?202:200))throw Error('QA host probe callback denied')
    return notification?undefined:response.json()
  }
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'dcc-synthetic-host-negative',version:'1'}})
  await rpc('notifications/initialized',undefined,true)
  const read=await rpc('tools/call',{name:'get_focus_timer',arguments:{}})
  const version=noTab?1:read?.result?.structuredContent?.result?.data?.version
  if(!Number.isInteger(version))throw Error('QA host timer version unavailable')
  await rpc('tools/call',{name:'control_focus_timer',arguments:{action:'configure',focusMinutes:31,expectedVersion:version}})
  return {status:'finished'}
}

async function authLossProbe(browser:JourneyBrowser,store:SqlIntentStore,settled:()=>Promise<void>){
  const page=browser.page
  await page.getByRole('button',{name:'Home',exact:true}).click()
  let release=()=>{},held=false,routeDone=false
  const gate=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/api/v1/hermes/timer-bridge',async route=>{
    const response=await route.fetch(),body=await response.json() as {commands?:{command?:{tool:string}}[]}
    const selected=body.commands?.some(c=>c.command?.tool==='control_focus_timer')===true
    if(selected){held=true;await gate}
    try{await route.fulfill({response})}catch{if(!route.request().failure())throw Error('QA held timer delivery failed')}finally{if(selected)routeDone=true}
  })
  try{
  const input=page.getByRole('textbox',{name:'Ask Hermes about tasks, projects, or calendar'})
  await expect(page.locator('#tell-hermes-status')).not.toContainText('MCP actions are unavailable')
  await input.fill('Synthetic host-only auth-loss timer refusal; no model.');await input.press('Enter')
  await expect.poll(()=>held).toBe(true)
  const submission=await page.evaluate(()=>JSON.parse(localStorage.getItem('dcc.tell-hermes.submission.v1')??'null')) as {key:string}
  const before=await browser.timer()
  const logout=await browser.context.request.post(ORIGIN+'/api/v1/auth/logout',{headers:{Origin:ORIGIN},data:{}})
  check(logout.status()===200&&(await logout.json()).authenticated===false)
  const session=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/auth/session')
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  check((await (await session).json()).authenticated===false)
  await expect(page.getByLabel('Username',{exact:true})).toBeVisible()
  release();await expect.poll(()=>routeDone).toBe(true);await settled()
  await expect.poll(()=>browser.locks()).toBe(0)
  const after=await browser.timer(),record=await store.read(submission.key)
  check(after.version===before.version&&canonicalJson(after.timer)===canonicalJson(before.timer)&&canonicalJson(after.receipts)===canonicalJson(before.receipts))
  check(record.calls.length===2&&record.calls[1]?.command.tool==='control_focus_timer'&&record.calls[1].command.args.focusMinutes===31&&record.calls.every(c=>!TOOLS[c.command.tool].write||c.result?.state!=='applied'))
  }finally{release()}
}

main().catch(()=>{console.log(JSON.stringify({status:'failed',stage,seed,assertions,modelCalls:runtime.calls,measurements,timerEvidence,providerEvidence,fullMatrixPending:265}));process.exitCode=1}).finally(()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)})
