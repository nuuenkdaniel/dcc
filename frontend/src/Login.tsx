import {useState} from 'react'
export function Login({configured,onSignedIn,onUnavailable}:{configured:boolean;onSignedIn:()=>void;onUnavailable:()=>void}){
 const [username,setUsername]=useState('')
 const [password,setPassword]=useState('')
 const [message,setMessage]=useState(configured?'Sign in with your dcc login, not your Nextcloud password.':'Authentication is not configured on the backend.')
 const [busy,setBusy]=useState(false)
 return <main className="login-preview"><section className="login-card"><h1>Welcome back</h1><p className="subtitle" role="status">{message}</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{const r=await fetch('/api/v1/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});setPassword('');if(r.status===401){setMessage('Sign-in failed. Check your dcc credentials.');return}if(!r.ok){onUnavailable();return}window.dispatchEvent(new Event('dcc-auth-changed'));onSignedIn()}catch{setPassword('');onUnavailable()}finally{setBusy(false)}}}><label>Username<input autoComplete="username" required disabled={!configured} value={username} onChange={e=>setUsername(e.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" required disabled={!configured} value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={!configured||busy}>Sign in</button></form></section></main>
}
