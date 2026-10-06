import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {EmailBody} from './EmailBody'
import {safeEmailStyle,sanitizeEmailHtml} from './emailHtml'

afterEach(()=>vi.unstubAllGlobals())

it('removes active content and keeps only a small safe inline-style subset',()=>{
 const result=sanitizeEmailHtml(`<meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example"><style>@import 'https://evil.example/x.css'</style><script src="https://evil.example/script.js">alert(1)</script><iframe src="https://evil.example/frame"></iframe><form action="https://evil.example"><input src="https://evil.example/input.png"></form><svg onload="alert(1)"></svg><table style="color:#123;background-image:url(https://evil.example/p);position:fixed;border-collapse:collapse"><tr><td onclick="alert(1)">Hello</td></tr></table>`)
 const doc=new DOMParser().parseFromString(result,'text/html')
 expect(doc.querySelector('script,iframe,form,input,svg,meta[http-equiv="refresh"],base')).toBeNull()
 expect(doc.querySelectorAll('style')).toHaveLength(0)
 expect(doc.querySelector('table')?.getAttribute('style')).toBe('color:#123;border-collapse:collapse')
 expect(doc.querySelector('td')?.getAttribute('onclick')).toBeNull()
 expect(result).toContain("default-src 'none'")
 expect(result).toContain("img-src 'none'")
 expect(safeEmailStyle('font-family:Arial;color:red;--secret:x;position:absolute')).toBe('font-family:Arial;color:red')
 expect(safeEmailStyle('padding:1px 2px;border-spacing:2px 3px')).toBe('padding:1px 2px;border-spacing:2px 3px')
})

it('blocks images by default and enables only risk-checked HTTP(S) URLs explicitly',()=>{
 const raw='<img alt="remote" src="https://images.example/pixel.png"><img src="http://127.0.0.1/private"><img src="cid:part1"><img srcset="https://evil.example/2x 2x" src="javascript:alert(1)">'
 const blocked=new DOMParser().parseFromString(sanitizeEmailHtml(raw),'text/html')
 expect([...blocked.images].every(image=>!image.hasAttribute('src'))).toBe(true)
 expect(blocked.documentElement.innerHTML).not.toContain('srcset')
 const loaded=new DOMParser().parseFromString(sanitizeEmailHtml(raw,true),'text/html')
 expect([...loaded.images].map(image=>image.getAttribute('src'))).toEqual(['https://images.example/pixel.png',null,null,null])
 expect(loaded.documentElement.innerHTML).toContain('img-src http: https:')
 expect(loaded.body.textContent).not.toContain('evil.example')
})

it('keeps safe links, reveals their hostname, and disables risky destinations',()=>{
 const doc=new DOMParser().parseFromString(sanitizeEmailHtml('<a href="https://news.example/path">Sender label</a><a href="https://trusted.example@evil.example/login">Misleading</a><a ping="https://tracker.example" download href="javascript:alert(1)">Bad</a>'),'text/html')
 const links=[...doc.querySelectorAll('a')]
 expect(links[0].getAttribute('href')).toBe('https://news.example/path')
 expect(links[0].getAttribute('target')).toBe('_blank')
 expect(links[0].getAttribute('rel')).toBe('noopener noreferrer')
 expect(links[0].textContent).toBe('Sender label [news.example]')
 expect(links[1].getAttribute('href')).toBeNull()
 expect(links[2].getAttribute('href')).toBeNull()
 expect(doc.querySelector('[ping],[download]')).toBeNull()
})

it('fetches HTML only when eligible, defaults to formatted, and retains the text toggle',async()=>{
 const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({html:'<p>Formatted message</p><img src="https://images.example/p.png">',hasHtml:true})})
 vi.stubGlobal('fetch',fetchMock)
 const {container}=render(<EmailBody id={'a'.repeat(64)} body="Plain fallback" hasHtml/>)
 const frame=await screen.findByTitle('Formatted email')
 expect(fetchMock).toHaveBeenCalledTimes(1)
 expect(frame).toHaveAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox')
 expect(frame).toHaveAttribute('referrerpolicy','no-referrer')
 expect(frame.getAttribute('srcdoc')).toContain("img-src 'none'")
 fireEvent.click(screen.getByRole('button',{name:'Text'}))
 expect(container.querySelector('.email-body')).toHaveTextContent('Plain fallback')
 fireEvent.click(screen.getByRole('button',{name:'Formatted'}))
 fireEvent.click(screen.getByRole('button',{name:/Load remote images/}))
 await waitFor(()=>expect(screen.getByTitle('Formatted email').getAttribute('srcdoc')).toContain('src="https://images.example/p.png"'))
})

it('does not request HTML when the MIME cache says none exists',()=>{
 const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock)
 render(<EmailBody id={'b'.repeat(64)} body="Text only" hasHtml={false}/>)
 expect(fetchMock).not.toHaveBeenCalled()
 expect(screen.getByText('Text only')).toBeInTheDocument()
})
