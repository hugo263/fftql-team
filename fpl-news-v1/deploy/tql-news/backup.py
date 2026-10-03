#!/usr/bin/python3
"""Seven daily local backups of this site's database and uploaded files, without cloud purchases."""
from datetime import datetime
from pathlib import Path
import json
import os
import subprocess
import tarfile

os.umask(0o077)
folder = Path('/var/backups/tql-news')
folder.mkdir(mode=0o700, exist_ok=True)
folder.chmod(0o700)
stamp = datetime.now().strftime('%Y%m%d')
dump = folder / ('tql-news-' + stamp + '.dump')
pending = folder / (dump.name + '.pending')
with pending.open('wb') as output:
    subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dump', '--format=custom', '--compress=6', '--no-owner', '--dbname=tql_news'], stdout=output, check=True, cwd='/tmp')
subprocess.run(['pg_restore', '--list', str(pending)], stdout=subprocess.DEVNULL, check=True)
pending.replace(dump)

uploads = Path('/var/lib/tql-news/uploads')
archive = folder / ('tql-news-files-' + stamp + '.tar.gz')
pending_files = folder / (archive.name + '.pending')
with tarfile.open(pending_files, 'w:gz') as output:
    if uploads.is_dir():
        output.add(uploads, arcname='uploads')
pending_files.replace(archive)

for pattern in ('tql-news-????????.dump', 'tql-news-files-????????.tar.gz'):
    for old in sorted(folder.glob(pattern), reverse=True)[7:]:
        old.unlink()
print(json.dumps({'database': 'tql_news', 'date': stamp, 'dump_bytes': dump.stat().st_size, 'files_bytes': archive.stat().st_size, 'retention_days': 7, 'location': str(folder)}))
