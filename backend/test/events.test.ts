import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseExpandedEvents} from '../src/events.js'
test('expanded events preserve all-day dates and ignore cancellations',()=>{
 const ics=['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:one','DTSTART;VALUE=DATE:20261002','DTEND;VALUE=DATE:20261003','SUMMARY:All day','X-DAYMARK-MUTATION:mutation-1','END:VEVENT','BEGIN:VEVENT','UID:two','DTSTART:20261002T140000Z','DTEND:20261002T150000Z','SUMMARY:Timed','END:VEVENT','BEGIN:VEVENT','UID:three','DTSTART:20261002T140000Z','STATUS:CANCELLED','END:VEVENT','END:VCALENDAR'].join('\r\n')
 const events=parseExpandedEvents(ics,'calendar','resource','etag')
 assert.equal(events.length,2)
 assert.equal(events[0]!.start,'2026-10-02')
 assert.equal(events[0]!.end,'2026-10-03')
 assert.equal(events[0]!.allDay,true)
 assert.equal(events[0]!.mutationId,'mutation-1')
 assert.equal(events[1]!.start,'2026-10-02T14:00:00.000Z')
})
