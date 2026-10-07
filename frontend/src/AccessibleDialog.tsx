import {useEffect,useRef,type KeyboardEvent,type ReactNode} from 'react'

export function AccessibleDialog({children,label,labelledBy,onClose,dismissible=true,className='modal-dialog-shell'}:{children:ReactNode;label?:string;labelledBy?:string;onClose:()=>void;dismissible?:boolean;className?:string}){
 const ref=useRef<HTMLDialogElement>(null)
 const previousFocus=useRef<HTMLElement|null>(null)
 useEffect(()=>{
  const dialog=ref.current;if(!dialog)return
  previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null
  const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden'
  if(typeof dialog.showModal==='function'){try{if(!dialog.open)dialog.showModal()}catch{dialog.setAttribute('open','')}}else dialog.setAttribute('open','')
  dialog.focus()
  return()=>{document.body.style.overflow=previousOverflow;if(dialog.open&&typeof dialog.close==='function')dialog.close();previousFocus.current?.focus()}
 },[])
 const keyDown=(event:KeyboardEvent<HTMLDialogElement>)=>{
  if(event.key==='Escape'){event.preventDefault();if(dismissible)onClose();return}
  if(event.key!=='Tab')return
  const focusable=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(element=>{
   let current:HTMLElement|null=element
   while(current&&current!==event.currentTarget){const style=getComputedStyle(current);if(current.hidden||current.matches('[aria-hidden="true"],[inert]')||style.display==='none'||style.visibility==='hidden')return false;current=current.parentElement}
   return true
  })
  if(!focusable.length){event.preventDefault();event.currentTarget.focus();return}
  const first=focusable[0],last=focusable.at(-1)!
  if(document.activeElement===event.currentTarget){event.preventDefault();(event.shiftKey?last:first).focus()}
  else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
 }
 return <dialog ref={ref} className={className} aria-label={label} aria-labelledby={labelledBy} tabIndex={-1} onKeyDown={keyDown} onCancel={event=>{event.preventDefault();if(dismissible)onClose()}} onMouseDown={event=>{if(dismissible&&event.target===event.currentTarget)onClose()}}>{children}</dialog>
}
