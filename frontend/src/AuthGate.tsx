import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react'
import {AUTH_REQUIRED_EVENT} from './auth'
import {Login} from './Login'

type Session={authenticated:boolean;configured:boolean}
type GateState='checking'|'authenticated'|'signed-out'|'unavailable'

function safeRoute(candidate:string|null){
 if(!candidate||!candidate.startsWith('/')||candidate.startsWith('//'))return '/'
 try{const url=new URL(candidate,window.location.origin);return url.origin===window.location.origin&&url.pathname!=='/login'?url.pathname+url.search+url.hash:'/'}catch{return '/'}
}
function currentRoute(){return window.location.pathname+window.location.search+window.location.hash}
function loginRoute(next:string){return `/login?next=${encodeURIComponent(safeRoute(next))}`}

export function AuthGate({children}:{children:ReactNode}){
 const initialRequest=useRef(window.location.pathname==='/login'?safeRoute(new URLSearchParams(window.location.search).get('next')):safeRoute(currentRoute()))
 const [state,setState]=useState<GateState>('checking'),[configured,setConfigured]=useState(true)
 const checking=useRef(false)
 const showLogin=useCallback((requested=currentRoute())=>{if(window.location.pathname!=='/login')initialRequest.current=safeRoute(requested);window.history.replaceState({},'',loginRoute(initialRequest.current));setState('signed-out')},[])
 const check=useCallback(async(initial=false)=>{
  if(checking.current)return;checking.current=true
  try{
   const response=await fetch('/api/v1/auth/session',{credentials:'same-origin',signal:AbortSignal.timeout(8000)})
   if(response.status===401){showLogin(window.location.pathname==='/login'?initialRequest.current:currentRoute());return}
   if(!response.ok)throw Error()
   const session=await response.json() as Session
   if(!session.authenticated){setConfigured(Boolean(session.configured));showLogin(window.location.pathname==='/login'?initialRequest.current:currentRoute());return}
   if(window.location.pathname==='/login')window.history.replaceState({},'',initialRequest.current)
   setState('authenticated')
  }catch{if(initial)setState('unavailable')}
  finally{checking.current=false}
 },[showLogin])
 useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)void check(true)});return()=>{active=false}},[check])
 useEffect(()=>{
  if(state!=='authenticated')return
  const expired=()=>showLogin(currentRoute())
  const recheck=()=>void check(false)
  const visible=()=>{if(document.visibilityState==='visible')recheck()}
  const timer=window.setInterval(recheck,60000)
  window.addEventListener(AUTH_REQUIRED_EVENT,expired)
  window.addEventListener('focus',recheck)
  document.addEventListener('visibilitychange',visible)
  return()=>{window.clearInterval(timer);window.removeEventListener(AUTH_REQUIRED_EVENT,expired);window.removeEventListener('focus',recheck);document.removeEventListener('visibilitychange',visible)}
 },[check,showLogin,state])
 const signedIn=()=>{window.history.replaceState({},'',initialRequest.current);setState('authenticated')}
 if(state==='authenticated')return children
 if(state==='checking')return <main className="login-preview"><section className="login-card"><h1>Welcome back</h1><p className="subtitle" role="status">Checking your session…</p></section></main>
 if(state==='unavailable')return <main className="login-preview"><section className="login-card"><h1>Connection unavailable</h1><p className="subtitle" role="alert">The backend could not confirm your session. Your cookie and browser data have not been changed.</p><button type="button" onClick={()=>{setState('checking');void check(true)}}>Retry</button></section></main>
 return <Login configured={configured} onSignedIn={signedIn} onUnavailable={()=>setState('unavailable')}/>
}
