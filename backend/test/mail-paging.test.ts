import {test} from 'node:test'
import assert from 'node:assert/strict'
import {decodeMailCursor} from '../src/mail-paging.js'
import {buildApp} from '../src/app.js'
test('mail cursor validation',()=>{assert.equal(decodeMailCursor(),null);assert.deepEqual(decodeMailCursor(Buffer.from(JSON.stringify(['2026-10-04T12:00:00Z','abc'])).toString('base64url')),['2026-10-04T12:00:00Z','abc']);assert.throws(()=>decodeMailCursor('bad'));assert.throws(()=>decodeMailCursor(Buffer.from('["bad","abc"]').toString('base64url')))})
test('mobile mail metadata and body routes require authentication',async()=>{const app=buildApp({plannerPool:{query:async()=>{throw Error('Must not query before authentication')}} as unknown as import('pg').Pool});try{for(const path of ['/api/v1/mail/page','/api/v1/mail/message/abc'])assert.equal((await app.inject(path)).statusCode,401)}finally{await app.close()}})
