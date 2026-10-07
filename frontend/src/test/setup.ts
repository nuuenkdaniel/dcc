import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
if(!navigator.locks)Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,callback:()=>unknown)=>callback()}})
afterEach(cleanup)
