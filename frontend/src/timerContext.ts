import {createContext,useContext,type SetStateAction} from 'react'
import type {FocusTimerState} from './focusTimer'
import type {Reply,TimerDocument} from './timerState'
export type TimerPort={document:TimerDocument;tabId?:string;warning:string;owned:boolean;retryOwnership:()=>void;setTimer:(update:SetStateAction<FocusTimerState>)=>boolean;setFocusMinutes:(n:number)=>void;setBreakMinutes:(n:number)=>void;process:(command:unknown,recoverOnly?:boolean)=>Reply}
export const TimerContext=createContext<TimerPort|null>(null)
export function useBrowserTimer(){const port=useContext(TimerContext);if(!port)throw Error('Timer provider required');return port}
export function useOptionalBrowserTimer(){return useContext(TimerContext)}
