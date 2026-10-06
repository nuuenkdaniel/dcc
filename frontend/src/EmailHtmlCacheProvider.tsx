import {useEffect,useState} from 'react'
import type {ReactNode} from 'react'
import {EmailHtmlCache} from './EmailHtmlCache'
import {EmailHtmlCacheContext} from './EmailHtmlCacheContext'

export function EmailHtmlCacheProvider({children}:{children:ReactNode}){
 const [cache]=useState(()=>new EmailHtmlCache())
 useEffect(()=>{cache.retain();return()=>cache.release()},[cache])
 return <EmailHtmlCacheContext.Provider value={cache}>{children}</EmailHtmlCacheContext.Provider>
}
