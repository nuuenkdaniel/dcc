import {fireEvent,render,screen} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import {AccessibleDialog} from './AccessibleDialog'

it('focuses and contains focus, closes with Escape, restores focus, and unlocks scrolling',()=>{
 const close=vi.fn()
 const trigger=document.createElement('button');trigger.textContent='Open';document.body.append(trigger);trigger.focus()
 const {unmount}=render(<AccessibleDialog label="Example dialog" onClose={close}><button>First</button><button hidden>Hidden</button><button>Last</button></AccessibleDialog>)
 const dialog=screen.getByRole('dialog',{name:'Example dialog'})
 expect(dialog).toHaveFocus()
 expect(document.body.style.overflow).toBe('hidden')
 const first=screen.getByRole('button',{name:'First'}),last=screen.getByRole('button',{name:'Last'})
 dialog.focus();fireEvent.keyDown(dialog,{key:'Tab'});expect(first).toHaveFocus()
 dialog.focus();fireEvent.keyDown(dialog,{key:'Tab',shiftKey:true});expect(last).toHaveFocus()
 last.focus();fireEvent.keyDown(dialog,{key:'Tab'});expect(first).toHaveFocus()
 first.focus();fireEvent.keyDown(dialog,{key:'Tab',shiftKey:true});expect(last).toHaveFocus()
 fireEvent.keyDown(dialog,{key:'Escape'});expect(close).toHaveBeenCalledOnce()
 unmount();expect(trigger).toHaveFocus();expect(document.body.style.overflow).toBe('')
 trigger.remove()
})

it('does not dismiss while dismissal is disabled',()=>{
 const close=vi.fn()
 render(<AccessibleDialog label="Saving" onClose={close} dismissible={false}><button>Wait</button></AccessibleDialog>)
 const dialog=screen.getByRole('dialog',{name:'Saving'})
 fireEvent.keyDown(dialog,{key:'Escape'})
 fireEvent(dialog,new Event('cancel',{cancelable:true}))
 expect(close).not.toHaveBeenCalled()
})
