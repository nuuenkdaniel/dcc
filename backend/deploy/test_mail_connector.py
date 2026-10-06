import unittest
from unittest.mock import patch
import mail_connector as mail
class Fake:
    def __init__(self):self.calls=[]
    def uid(self,command,*args):
        self.calls.append((command,args))
        if command=='search':return 'OK',[b'42']
        query=args[1]
        if 'UID FLAGS' in query:return 'OK',[b'1 (UID 42 FLAGS () INTERNALDATE "03-Oct-2026 12:00:00 -0400" RFC822.SIZE 999)']
        if query=='(BODYSTRUCTURE)':return 'OK',[b'1 (UID 42 BODYSTRUCTURE (("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 11 1 NIL NIL NIL)("APPLICATION" "PDF" ("NAME" "test.pdf") NIL NIL "BASE64" 8 NIL ("ATTACHMENT" ("FILENAME" "test.pdf")) NIL) "MIXED"))']
        if query=='(BODY.PEEK[HEADER])':return 'OK',[(b'1 BODY[HEADER]',b'Subject: Example\r\nFrom: sender@example.invalid\r\n\r\n')]
        if query=='(BODY.PEEK[1])':return 'OK',[(b'1 BODY[1]',b'Hello world')]
        if query=='(BODY.PEEK[2])':return 'OK',[(b'1 BODY[2]',b'YWJjZA==')]
        raise AssertionError(query)
    def logout(self):pass
class MailTests(unittest.TestCase):
    def test_sync_fetches_text_not_attachments_and_never_seen(self):
        c=Fake()
        with patch.object(mail,'connect',return_value=(c,'123','test@example.invalid')):result=mail.dispatch({'mode':'mail-sync','account':'school'})
        self.assertEqual(result['total'],1);self.assertIsNone(result['next']);self.assertEqual(result['messages'][0]['body'],'Hello world');self.assertEqual(result['messages'][0]['attachments'][0]['part'],'2')
        self.assertFalse(any('BODY.PEEK[2]' in str(args) for _,args in c.calls));self.assertFalse(any(command=='store' for command,_ in c.calls))
    def test_download_fetches_only_requested_part(self):
        c=Fake()
        with patch.object(mail,'connect',return_value=(c,'123','test@example.invalid')):result=mail.dispatch({'mode':'mail-attachment','account':'school','uid':'42','validity':'123','part':'2'})
        self.assertEqual(result['content'],'YWJjZA==');self.assertEqual(result['name'],'test.pdf')
        self.assertFalse(any('BODY.PEEK[]' in str(args) for _,args in c.calls))
    def test_validity_mismatch_rejected_before_fetch(self):
        c=Fake()
        with patch.object(mail,'connect',return_value=(c,'123','test@example.invalid')):
            with self.assertRaises(ValueError):mail.dispatch({'mode':'mail-attachment','account':'school','uid':'42','validity':'old','part':'2'})
        self.assertEqual(c.calls,[])
    def test_html_fetches_only_nonattachment_html_with_peek(self):
        class HtmlFake(Fake):
            def uid(self,command,*args):
                self.calls.append((command,args));query=args[1]
                if query=='(BODYSTRUCTURE)':return 'OK',[b'1 (UID 42 BODYSTRUCTURE (("TEXT" "HTML" ("CHARSET" "UTF-8") NIL NIL "7BIT" 12 1 NIL NIL NIL)("IMAGE" "PNG" NIL NIL NIL "BASE64" 8 NIL ("ATTACHMENT" ("FILENAME" "x.png")) NIL) "MIXED"))']
                if query=='(BODY.PEEK[1])':return 'OK',[(b'1 BODY[1]',b'<p>Hello</p>')]
                raise AssertionError(query)
        c=HtmlFake()
        with patch.object(mail,'connect',return_value=(c,'123','test@example.invalid')):result=mail.dispatch({'mode':'mail-html','account':'school','uid':'42','validity':'123'})
        self.assertEqual(result['html'],'<p>Hello</p>');self.assertFalse(any('BODY.PEEK[2]' in str(args) for _,args in c.calls));self.assertFalse(any(command=='store' for command,_ in c.calls))
    def test_html_validity_mismatch_is_rejected_before_mime_fetch(self):
        c=Fake()
        with patch.object(mail,'connect',return_value=(c,'123','test@example.invalid')):
            with self.assertRaises(ValueError):mail.dispatch({'mode':'mail-html','account':'school','uid':'42','validity':'old'})
        self.assertEqual(c.calls,[])
if __name__=='__main__':unittest.main()
