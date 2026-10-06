import {createContext,useContext} from 'react'
import type {EmailHtmlCache} from './EmailHtmlCache'

export const EmailHtmlCacheContext=createContext<EmailHtmlCache|null>(null)
export function useEmailHtmlCache(){return useContext(EmailHtmlCacheContext)}
