import {useEffect,useState} from 'react'
export function Login({onContinue}:{onContinue:()=>void}){
 const [configured,setConfigured]=useState(false)
 const [username,setUsername]=useState('')
 const [password,setPassword]=useState('')
 const [message,setMessage]=useState('Checking backend connection…')
 const [busy,setBusy]=useState(false)
 useEffect(()=>{void fetch('/api/v1/auth/session',{signal:AbortSignal.timeout(8000)}).then(r=>r.json()).then(s=>{if(s.authenticated){onContinue();return}setConfigured(s.configured);setMessage(s.authenticated?'You are already signed in.':s.configured?'Sign in with your dcc login, not your Nextcloud password.':'Authentication is not configured on the backend.')}).catch(()=>setMessage('Backend unavailable. You can continue using local tasks.'))},[onContinue])
 return <main className="login-preview"><section className="login-card"><h1>Welcome back</h1><p className="subtitle" role="status">{message}</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{const r=await fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});setPassword('');if(!r.ok){setMessage('Sign-in failed. Check your dcc credentials.');return}window.dispatchEvent(new Event('dcc-auth-changed'));onContinue()}catch{setPassword('');setMessage('Backend unavailable. Try again when connected.')}finally{setBusy(false)}}}><label>Username<input autoComplete="username" required disabled={!configured} value={username} onChange={e=>setUsername(e.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" required disabled={!configured} value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={!configured||busy}>Sign in</button></form><button type="button" className="local-continue" onClick={onContinue}>Continue locally</button><p className="preview-disclosure">Local tasks remain usable without signing in.</p></section></main>
}
