import {useState,type ReactNode} from 'react'
import {WorkspaceSessionContext} from '../workspaceSession'
export function SyntheticWorkspaceSession({children}:{children:ReactNode}){
 const [session]=useState(()=>({owner:'a'.repeat(64),signal:new AbortController().signal}))
 return <WorkspaceSessionContext.Provider value={session}>{children}</WorkspaceSessionContext.Provider>
}
