import {useEffect,useState} from 'react'
import {protectedFetch} from './auth'

export type HermesChatAccess={owner:string;context:boolean;available:boolean}

export function useHermesChatAccess(owner:string|null){
 const [access,setAccess]=useState<HermesChatAccess|null>(null)
 useEffect(()=>{
  if(!owner)return
  let request:AbortController|undefined
  const discover=async()=>{
   request?.abort()
   const controller=new AbortController()
   request=controller
   try{
    const response=await protectedFetch('/api/v1/hermes/action-capabilities',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])})
    if(!response.ok)throw Error()
    const capability=await response.json()
    if(controller.signal.aborted)return
    if(capability.workspaceOwner===owner&&capability.conversation===true&&capability.conversationChatVersion===1&&capability.conversationReplyVersion===1){
     setAccess({owner,context:capability.conversationContextVersion===1,available:true})
    }else setAccess(null)
   }catch{
    if(!controller.signal.aborted)setAccess(previous=>previous?{...previous,available:false}:null)
   }
  }
  void discover()
  window.addEventListener('focus',discover)
  window.addEventListener('online',discover)
  return()=>{
   request?.abort()
   window.removeEventListener('focus',discover)
   window.removeEventListener('online',discover)
  }
 },[owner])
 return access?.owner===owner?access:null
}
