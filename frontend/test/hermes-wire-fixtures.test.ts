import {readFile} from 'node:fs/promises'
import {URL} from 'node:url'
import {expect,test} from 'vitest'
import {validConversationView} from '../../backend/src/mcp/conversation-wire'
test('web validates the same backend-projection JSON asset used by native tests',async()=>{
  const fixtures=JSON.parse(await readFile(new URL('../../frontend-android/app/src/androidTest/assets/hermes-conversation.json',import.meta.url),'utf8'))
  expect(validConversationView(fixtures.question)).toBe(true)
  expect(validConversationView(fixtures.complete)).toBe(true)
  const forged=structuredClone(fixtures.complete);forged.receipt.targets.pop()
  expect(validConversationView(forged)).toBe(false)
})
