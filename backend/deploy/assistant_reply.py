"""Versioned display-only product reply; no imports from Hermes or config."""
import re


def text_fits(value):
    if type(value) is not str or re.fullmatch(r'[\t\n\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*', value):
        return False
    try:
        return (len(value.encode('utf-16-le')) // 2 <= 2048
                and len(value.encode('utf-8')) <= 4096
                and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', value))
    except UnicodeError:
        return False


def completion(result):
    reply = {'status': 'finished', 'replyVersion': 1}
    # Never mine messages, fallback prose, reasoning or tool-returned objects.
    if (type(result) is dict and result.get('completed') is True
            and not any(result.get(k) for k in ('error', 'interrupted', 'partial', 'truncated', 'failed'))
            and text_fits(result.get('final_response'))):
        reply['assistantText'] = result['final_response']
    return reply


def valid_completion(value):
    return (type(value) is dict and value.get('status') == 'finished'
            and type(value.get('replyVersion')) is int and value['replyVersion'] == 1
            and (set(value) == {'status', 'replyVersion'}
                 or set(value) == {'status', 'replyVersion', 'assistantText'} and text_fits(value['assistantText'])))
