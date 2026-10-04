from mail_connector import connect,mime_parts,fetch_part
import imaplib,json
results=[]
for account in ('personal','school','work'):
 c,v,address=connect(account)
 try:
  typ,data=c.uid('search',None,'UNSEEN');uids=data[0].decode().split()
  if not uids:typ,data=c.uid('search',None,'ALL');uids=data[0].decode().split()
  uid=uids[-1]
  def flags():
   _,d=c.uid('fetch',uid,'(FLAGS)');return imaplib.ParseFlags(b' '.join(x for x in d if isinstance(x,bytes)))
  before=flags();structure=mime_parts(c,uid);text=next((p for p in structure if not p['attachment']),None);raw=fetch_part(c,uid,text,2*1024*1024) if text else b'';after=flags();assert before==after
  results.append({'account':account,'readOnly':c.is_readonly,'flagsUnchanged':True,'bodyFetched':bool(raw),'attachmentCount':len([p for p in structure if p['attachment']])})
 finally:c.logout()
print(json.dumps(results))
