import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildApp} from '../src/app.js'
test('price data and settings require authentication',async()=>{const app=buildApp({auth:{username:'test',password:'test-only',origin:'https://daymark.invalid',store:{async put(){},async has(){return false},async remove(){}}},plannerPool:{query(){throw Error('Unauthenticated request reached database')}} as unknown as import('pg').Pool});try{for(const url of ['/api/v1/prices/snapshot'])assert.equal((await app.inject(url)).statusCode,401);for(const url of ['/api/v1/prices/refresh','/api/v1/prices/settings'])assert.equal((await app.inject({method:'POST',url,headers:{origin:'https://daymark.invalid'},payload:{}})).statusCode,401)}finally{await app.close()}})
