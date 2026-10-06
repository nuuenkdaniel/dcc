"""Read-only IMAP adapter using existing Himalaya credentials. No mailbox writes."""
from pathlib import Path
import base64, datetime, email, email.policy, hashlib, imaplib, re, ssl, tomllib, sys
sys.path.insert(0,str(next((Path("/root/.local/share/daymark/mail-venv/lib")).glob("python*/site-packages"))))
from imapclient.response_parser import parse_response
from pathlib import Path
from html.parser import HTMLParser
from zoneinfo import ZoneInfo
ACCOUNTS={'personal':'config-gmail.toml','school':'config-sb.toml','work':'config.toml'}
class Text(HTMLParser):
    def __init__(self): super().__init__(); self.out=[]; self.hidden=0
    def handle_starttag(self,t,a):
        if t in ('script','style'): self.hidden+=1
        if t in ('p','br','div','li'): self.out.append('\n')
    def handle_endtag(self,t):
        if t in ('script','style'): self.hidden=max(0,self.hidden-1)
    def handle_data(self,d):
        if not self.hidden:self.out.append(d)
def connect(account):
    if account not in ACCOUNTS:raise ValueError('Unknown account')
    config=tomllib.loads((Path.home()/'.config/himalaya'/ACCOUNTS[account]).read_text())['accounts']['primary']
    b=config['backend']; auth=b['auth']
    if auth.get('type')!='password' or not isinstance(auth.get('raw'),str):raise ValueError('Unsupported stored authentication')
    client=imaplib.IMAP4_SSL(b['host'],b.get('port',993),ssl_context=ssl.create_default_context(),timeout=40)
    client.login(b['login'],auth['raw']); client.select('INBOX',readonly=True)
    validity=client.response('UIDVALIDITY')[1][0].decode()
    return client,validity,config['email']
def mime_parts(c,uid):
    typ,data=c.uid('fetch',uid,'(BODYSTRUCTURE)')
    if typ!='OK':raise ValueError('MIME structure unavailable')
    values=parse_response(data)[1];node=values[values.index(b'BODYSTRUCTURE')+1]
    out=[]
    def text(v):return v.decode('utf-8','replace') if isinstance(v,bytes) else str(v or '')
    def params(v):return {text(v[i]).lower():text(v[i+1]) for i in range(0,len(v),2)} if isinstance(v,tuple) else {}
    def visit(n,prefix=''):
        if isinstance(n[0],tuple):
            for i,child in enumerate(n):
                if not isinstance(child,tuple):break
                visit(child,(prefix+'.' if prefix else '')+str(i+1))
            return
        kind=text(n[0]).lower()+'/'+text(n[1]).lower();parameters=params(n[2]);part=prefix or '1'
        dispindex=9 if kind.startswith('text/') else 11 if kind=='message/rfc822' else 8
        disp=n[dispindex] if len(n)>dispindex else None
        disposition=text(disp[0]).lower() if isinstance(disp,tuple) and disp else ''
        dp=params(disp[1]) if isinstance(disp,tuple) and len(disp)>1 else {}
        header=email.message.EmailMessage();header['Content-Type']=kind
        for k,v in parameters.items():header.set_param(k,v)
        if disposition:
            header['Content-Disposition']=disposition
            for k,v in dp.items():header.set_param(k,v,header='Content-Disposition')
        encoding=text(n[5]);header['Content-Transfer-Encoding']=encoding
        filename=header.get_filename()
        attachment=bool(filename or disposition=='attachment' or not kind.startswith('text/'))
        wire_size=int(n[6]);estimate=int(wire_size*0.73) if encoding.lower()=='base64' else wire_size
        out.append({'part':part,'name':str(filename or 'attachment'),'size':estimate,'wireSize':wire_size,'kind':kind,'attachment':attachment,'header':header})
    visit(node);return out

def fetch_part(c,uid,p,max_size):
    if p['wireSize']>max_size:raise ValueError('Part exceeds download limit')
    typ,data=c.uid('fetch',uid,'(BODY.PEEK['+p['part']+'])')
    if typ!='OK':raise ValueError('Part fetch failed')
    raw=next(x[1] for x in data if isinstance(x,tuple))
    header=p['header'];header.set_payload(raw)
    return header.get_payload(decode=True) or b''

def dispatch(data):
    account=data.get('account');c,validity,address=connect(account)
    try:
        if data.get('mode')=='mail-html':
            uid=data.get('uid','')
            if not re.fullmatch(r'\d+',uid) or data.get('validity')!=validity:raise ValueError('Message identity changed; sync first')
            match=next((p for p in mime_parts(c,uid) if p['kind']=='text/html' and not p['attachment']),None)
            if match is None:return {'html':None}
            binary=fetch_part(c,uid,match,2*1024*1024)
            if len(binary)>2*1024*1024:raise ValueError('HTML exceeds 2 MB limit')
            return {'html':binary.decode(match['header'].get_content_charset() or 'utf-8',errors='replace')}
        if data.get('mode')=='mail-attachment':
            uid=data.get('uid','');part=data.get('part','')
            if not re.fullmatch(r'\d+',uid) or not re.fullmatch(r'\d+(?:\.\d+)*',part) or data.get('validity')!=validity:raise ValueError('Message identity changed; sync first')
            match=next((p for p in mime_parts(c,uid) if p['part']==part and p['attachment']),None)
            if match is None:raise ValueError('Attachment not found')
            binary=fetch_part(c,uid,match,35*1024*1024)
            if len(binary)>25*1024*1024:raise ValueError('Attachment exceeds 25 MB limit')
            return {'name':match['name'],'content':base64.b64encode(binary).decode()}
        since=(datetime.datetime.now(ZoneInfo('America/New_York'))-datetime.timedelta(days=30)).strftime('%d-%b-%Y')
        typ,result=c.uid('search',None,'SINCE',since)
        if typ!='OK':raise ValueError('Search failed')
        uids=result[0].decode().split();offset=data.get('offset',0)
        if not isinstance(offset,int) or offset<0:raise ValueError('Invalid offset')
        batch=uids[offset:offset+25];known=data.get('known',[])
        messages=[]
        metadata={}
        if batch:
            typ,flags_data=c.uid('fetch',','.join(batch),'(UID FLAGS INTERNALDATE RFC822.SIZE)')
            if typ!='OK':raise ValueError('Metadata fetch failed')
            for raw_meta in flags_data:
                if isinstance(raw_meta,bytes):
                    found=re.search(rb'UID (\d+)',raw_meta)
                    if found:metadata[found[1].decode()]=raw_meta
        for uid in batch:
            meta=metadata[uid]
            flags=imaplib.ParseFlags(meta);received=imaplib.Internaldate2tuple(meta)
            import time
            received_at=datetime.datetime.fromtimestamp(time.mktime(received),datetime.timezone.utc).isoformat() if received else None
            key=hashlib.sha256((account+'\0'+validity+'\0'+uid).encode()).hexdigest()
            base={'id':key,'account':account,'address':address,'uid':uid,'validity':validity,'unread':b'\\Seen' not in flags}
            if key in known:messages.append(base);continue
            typ,header=c.uid('fetch',uid,'(BODY.PEEK[HEADER])');raw=next(x[1] for x in header if isinstance(x,tuple))
            msg=email.message_from_bytes(raw,policy=email.policy.default);body='';notice=''
            structure=mime_parts(c,uid)
            base['hasHtml']=any(not p['attachment'] and p['kind']=='text/html' for p in structure)
            candidates=[p for p in structure if not p['attachment'] and p['kind'] in ('text/plain','text/html')]
            candidates.sort(key=lambda p:p['kind']!='text/plain')
            if candidates:
                chosen=candidates[0]
                if chosen['wireSize']>2*1024*1024:notice='Text part exceeds 2 MB; body not cached.'
                else:
                    body=fetch_part(c,uid,chosen,2*1024*1024).decode(chosen['header'].get_content_charset() or 'utf-8',errors='replace')
                    if chosen['kind']=='text/html':parser=Text();parser.feed(body);body=''.join(parser.out)
                    if len(body)>100000:notice='Body truncated at 100,000 characters.'
            attachments=[{'part':p['part'],'name':p['name'],'size':p['size'],'sizeApproximate':True} for p in structure if p['attachment']]
            messages.append({**base,'subject':str(msg.get('Subject','(no subject)')),'sender':str(msg.get('From','')),'to':str(msg.get('To','')),'receivedAt':received_at,'body':body[:100000],'bodyNotice':notice,'attachments':attachments,'mimeVersion':2})
        return {'messages':messages,'next':offset+len(batch) if offset+len(batch)<len(uids) else None,'total':len(uids)}
    finally:
        try:c.logout()
        except Exception:pass
