"""Source-owned DCC inference policy, shared by production and QA. No fallback."""
from datetime import datetime
from zoneinfo import ZoneInfo

DCC_MODEL = 'gpt-6-luna'
DCC_TIMEZONE = 'America/New_York'


def agent_policy():
    return {'provider':'openai-codex','requested_provider':'openai-codex','model':DCC_MODEL}


def inference_context(now=None):
    reference=(now or datetime.now(ZoneInfo(DCC_TIMEZONE))).astimezone(ZoneInfo(DCC_TIMEZONE))
    return ('Trusted DCC reference time: '+reference.isoformat(timespec='seconds')+'; application timezone '+DCC_TIMEZONE+
        '. Resolve relative dates against this reference, never invent missing year/time/duration/calendar. Clarify ambiguous DST folds/gaps and targets. This reference is not evidence of a personal schedule or capacity.')
