import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readCalendarConfig, calendarClient} from '../src/caldav.js'
test('calendar configuration gates and outbound origins fail closed',async()=>{
 assert.equal(readCalendarConfig({}),null)
 assert.equal(readCalendarConfig({NEXTCLOUD_SYNC_ENABLED:'false'}),null)
 assert.throws(()=>readCalendarConfig({NEXTCLOUD_SYNC_ENABLED:'true'}))
 const config=readCalendarConfig({NEXTCLOUD_SYNC_ENABLED:'true',NEXTCLOUD_URL:'https://cloud.example.test',NEXTCLOUD_USERNAME:'test',NEXTCLOUD_APP_PASSWORD:'fixture'})!
 assert.equal(config.interval,600)
 const client=calendarClient(config)
 await assert.rejects(client.fetchOverride!('https://other.example.test'),/origin/)
})
