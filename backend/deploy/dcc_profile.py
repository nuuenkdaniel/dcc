"""DCC's fixed, dedicated Hermes identity; no credentials or global profile fallback."""
import os
from pathlib import Path

PROFILE_HOME = Path('/root/.hermes/profiles/dcc')
PROFILE_MARKER = 'dcc-profile-v1\n'


def validate_profile(home, expected_home=PROFILE_HOME):
    home = Path(home)
    if home != expected_home or home.is_symlink() or home.resolve() != home:
        raise ValueError('DCC profile isolation unavailable')
    if (home / '.dcc-profile-v1').read_text() != PROFILE_MARKER:
        raise ValueError('DCC profile is not initialized')
    for relative in ('SOUL.md', 'config.yaml', 'memories/MEMORY.md', 'memories/USER.md'):
        file = home / relative
        if file.is_symlink() or not file.is_file() or file.resolve().parent not in (home, home / 'memories'):
            raise ValueError('DCC profile file unavailable')
    return home


def require_dcc_profile():
    return validate_profile(os.environ.get('HERMES_HOME', ''))
