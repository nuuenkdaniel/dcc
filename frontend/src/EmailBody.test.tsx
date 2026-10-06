import {render,screen} from '@testing-library/react'
import {expect,it} from 'vitest'
import {EmailBody} from './EmailBody'
import {emailBodyParts,readableEmailUrl} from './emailLinks'

it('makes long newsletter URLs readable without changing their destination',()=>{
 const url='https://www.newegg.com/p/N82E16834156587?Item=N82E16834156587&utm_source=newsletter&utm_campaign=long-tracking-value&amp;cm_sp=homepage_dailydeal'
 render(<EmailBody body={`Deal: ${url}`}/>)
 const target=url.replace('&amp;','&')
 const link=screen.getByRole('link',{name:target})
 expect(link).toHaveAttribute('href',target)
 expect(link).toHaveAttribute('title',target)
 expect(link).toHaveAttribute('target','_blank')
 expect(link).toHaveAttribute('rel','noopener noreferrer')
 expect(link).toHaveAttribute('referrerpolicy','no-referrer')
 expect(link).toHaveTextContent('www.newegg.com/p/N82E16834156587…')
 expect(link).not.toHaveTextContent('utm_')
})

it('keeps punctuation, balanced parentheses, adjacent text, and markup remnants outside links',()=>{
 const body='See (https://example.com/a_(b)).Then https://example.com/path&lt;/a&gt;Next'
 render(<EmailBody body={body}/>)
 const links=screen.getAllByRole('link')
 expect(links[0]).toHaveAttribute('href','https://example.com/a_(b)')
 expect(links[1]).toHaveAttribute('href','https://example.com/path')
 expect(screen.getByText(/\)\.Then /)).toBeInTheDocument()
 expect(screen.getByText(/&lt;\/a&gt;Next/)).toBeInTheDocument()
})

it('keeps unmatched closing parentheses that are embedded in URL paths',()=>{
 expect(emailBodyParts('See https://example.com/a)b next')).toEqual([
  {kind:'text',text:'See '},
  {kind:'link',target:'https://example.com/a)b',label:'https://example.com/a)b'},
  {kind:'text',text:' next'},
 ])
 expect(emailBodyParts('https://example.com/docs_(new)).Next')).toEqual([
  {kind:'link',target:'https://example.com/docs_(new)',label:'https://example.com/docs_(new)'},
  {kind:'text',text:').Next'},
 ])
})

it('decodes ampersand entities only in query separators',()=>{
 expect(readableEmailUrl('https://example.com/rock&amp;roll')).toEqual({target:'https://example.com/rock&amp;roll',label:'https://example.com/rock&amp;roll'})
 expect(readableEmailUrl('https://example.com/search?a=1&amp;b=2')).toEqual({target:'https://example.com/search?a=1&b=2',label:'https://example.com/search?a=1&b=2'})
 expect(emailBodyParts('https://example.com/path.')).toEqual([
  {kind:'link',target:'https://example.com/path',label:'https://example.com/path'},
  {kind:'text',text:'.'},
 ])
})

it('leaves ambiguous query endings and entities as plain text',()=>{
 for(const candidate of ['https://example.com/search?q=term.','https://example.com/path#section!','https://example.com/search?q=one&nbsp;two','https://example.com/search?q=one&copy;two']){
  expect(emailBodyParts(candidate)).toEqual([{kind:'text',text:candidate}])
 }
 expect(emailBodyParts('https://example.com/search?q=term&lt;/a&gt;Next')).toEqual([
  {kind:'link',target:'https://example.com/search?q=term',label:'https://example.com/search?q=term'},
  {kind:'text',text:'&lt;/a&gt;Next'},
 ])
})

it('leaves suspicious destinations and non-web schemes as plain text',()=>{
 const body=[
  'javascript:alert(1)',
  'http://trusted.example@evil.example/path',
  'http://127.0.0.1/private',
  'http://192.168.1.8/private',
  'http://localhost/private',
  'http://intranet/private',
  'http://service.internal/private',
  'http://2130706433/private',
  'http://0x7f000001/private',
  'http://[2001:db8::1]/reserved',
  'http://[::ffff:127.0.0.1]/mapped',
  'https://раypal.example/login',
  'https://example.com/%E2%80%AEhidden',
  'https://example.com/invisible\uFE0Fselector',
  'https://example.com/invisible%EF%B8%8Fselector',
 ].join('\n')
 render(<EmailBody body={body}/>)
 expect(screen.queryByRole('link')).not.toBeInTheDocument()
 expect(screen.getByText(/trusted\.example@evil\.example/)).toBeInTheDocument()
})

it('truncates readable labels at Unicode code-point boundaries',()=>{
 const emoji='😀'.repeat(60)
 const readable=readableEmailUrl(`https://example.com/${emoji}`)
 expect(readable?.label).toBe(`example.com/${'😀'.repeat(34)}…`)
 expect(readable?.label).not.toMatch(/[\uD800-\uDBFF]$/u)
})

it('allows ordinary web URLs and non-mixed IDNs',()=>{
 expect(readableEmailUrl('https://example.com/news?id=42')).toEqual({target:'https://example.com/news?id=42',label:'https://example.com/news?id=42'})
 expect(readableEmailUrl('https://münich.example/straße')).not.toBeNull()
 expect(emailBodyParts('mailto:test@example.com')).toEqual([{kind:'text',text:'mailto:test@example.com'}])
})

it('renders HTML-looking email content only as text and preserves line breaks',()=>{
 const body='First paragraph\n\n<script>globalThis.pwned=true</script>\n<img src="https://tracker.invalid/pixel">'
 const {container}=render(<EmailBody body={body}/>)
 expect(container.querySelector('script')).toBeNull()
 expect(container.querySelector('img')).toBeNull()
 expect(container.querySelector('.email-body')).toHaveTextContent('First paragraph <script>globalThis.pwned=true</script> <img src="https://tracker.invalid/pixel">')
 expect(container.querySelector('.email-body')?.textContent).toBe(body)
})
