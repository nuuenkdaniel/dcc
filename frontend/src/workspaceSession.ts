import {createContext,useContext} from 'react'
export type WorkspaceSession={owner:string|null;signal:AbortSignal}
export const WorkspaceSessionContext=createContext<WorkspaceSession|null>(null)
export const validWorkspaceOwner=(value:unknown):value is string=>typeof value==='string'&&value.length===64&&/^[a-f0-9]{64}$/.test(value)
export function useWorkspaceSession(){return useContext(WorkspaceSessionContext)}
