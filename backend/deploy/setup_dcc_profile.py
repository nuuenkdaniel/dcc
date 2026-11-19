"""Explicit operator setup: create DCC profile without cloning credentials/history.

Run on Hermes with system Python after reviewing this source. No service starts,
model calls, credential reads/copies, or memory overwrites. A known legacy
tool-discovery configuration is migrated with a backup.
"""
import os
import hashlib
from pathlib import Path
import subprocess
import tempfile
from dcc_profile import PROFILE_HOME, PROFILE_MARKER, validate_profile


def migrate_tool_discovery(home, templates):
    """Repair only the exact source-owned legacy config; preserve customized files."""
    target = home / 'config.yaml'
    legacy_sha = '6de80c114b18da22f2d2b3db5732688b22cc5f59162c7287be7c41a5e61cbfaa'
    if hashlib.sha256(target.read_bytes()).hexdigest() != legacy_sha:
        return False
    backup = home / 'dcc-setup-seeds'
    backup.mkdir(mode=0o700, exist_ok=True)
    with (backup / 'config.before-tool-discovery-fix.yaml').open('xb') as stream:
        stream.write(target.read_bytes())
    fd, name = tempfile.mkstemp(prefix='.dcc-config-', dir=home)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write((templates / 'config.yaml').read_bytes())
        os.replace(name, target)
    finally:
        Path(name).unlink(missing_ok=True)
    return True


def initialize(home, templates):
    """Seed once. Refuse existing managed identity files instead of overwriting memory."""
    for name in ('SOUL.md', 'config.yaml'):
        source = templates / name
        target = home / name
        # Fresh official profile creation seeds these files; caller backs them up first.
        if target.exists():
            raise ValueError('Refusing to overwrite existing profile files')
        with target.open('x') as stream:
            stream.write(source.read_text())
        target.chmod(0o600)
    (home / 'memories').mkdir(mode=0o700, exist_ok=True)
    for name in ('MEMORY.md', 'USER.md'):
        with (home / 'memories' / name).open('x') as stream:
            stream.write('')
        (home / 'memories' / name).chmod(0o600)
    with (home / '.dcc-profile-v1').open('x') as stream:
        stream.write(PROFILE_MARKER)


def main():
    os.umask(0o077)
    home = PROFILE_HOME
    if home.exists():
        validate_profile(home)
        if migrate_tool_discovery(home, Path(__file__).with_name('dcc-profile')):
            print('Migrated legacy DCC tool-discovery config; previous config backed up.')
        print('DCC profile already initialized; identity and learned memories preserved.')
        return
    env = {**os.environ, 'HERMES_HOME': '/root/.hermes'}
    subprocess.run(['/usr/local/bin/hermes', 'profile', 'create', 'dcc', '--no-alias', '--no-skills',
                    '--description', 'DCC task, project, calendar and focus assistant with dedicated memory.'],
                   env=env, check=True)
    # Preserve the official seed files; do not read or touch any auth/.env files.
    backup = home / 'dcc-setup-seeds'
    backup.mkdir(mode=0o700)
    for name in ('SOUL.md', 'config.yaml'):
        target = home / name
        if target.exists():
            target.rename(backup / name)
    initialize(home, Path(__file__).with_name('dcc-profile'))
    validate_profile(home)
    print('DCC profile initialized. No service or model was started.')


if __name__ == '__main__':
    main()
