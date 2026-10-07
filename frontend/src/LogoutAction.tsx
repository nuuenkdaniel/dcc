import {useRef,useState} from 'react'
import {logout,LogoutError} from './auth'

function failureMessage(error:unknown) {
  if(error instanceof DOMException&&(error.name==='TimeoutError'||error.name==='AbortError'))return 'Sign out timed out. Your session may still be active; check your connection and try again.'
  if(error instanceof LogoutError&&error.status)return `Sign out failed (server status ${error.status}). Your session is still considered active; try again.`
  if(error instanceof LogoutError)return 'The server did not confirm sign out. Your session is still considered active; try again.'
  return 'Could not reach the server to sign out. Your session may still be active; check your connection and try again.'
}

export function LogoutAction({label='Sign out',className}:{label?:string;className?:string}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const inFlight=useRef(false)
  const submit=async()=>{
    if(inFlight.current)return
    inFlight.current=true;setBusy(true);setError('')
    try{await logout()}catch(cause){setError(failureMessage(cause))}finally{inFlight.current=false;setBusy(false)}
  }
  return <div className={className}>
    <button type="button" disabled={busy} aria-busy={busy} onClick={()=>void submit()}>{busy?'Signing out…':label}</button>
    {error&&<span className="logout-error" role="alert">{error}</span>}
  </div>
}
