#!/usr/bin/env python3
"""./topo.sh export: a folder with your topology files, in the layout of production, and a script that installs them.

  export.py <stage folder> <output folder>

<stage folder> holds your files at their paths below OpenNMS's home (what ./topo.sh deploy would send). stdin, one line
each, fields separated by tabs:
  meta  <key>  <value>                 ssh, container, home (OpenNMS's home in the container), kit, made (a date)
  file  <path>                         a file to export: its path below OpenNMS's home
  plan  <action>  <folder>  <name>  <file>  <host path of the folder>
                                       tools/overlay.py's lines: replace|add put <file> into an overlay folder; skip: no
                                       overlay folder can hold the file (a new container starts without it)
  etc   yes|no                         OpenNMS's etc/ is on a volume of the container (it keeps etc files by itself)

It writes
  files/live/<path>                    for the running container
  files/overlays/<folder>/<name>       for the overlay folders of the host: what a restart or a new container copies in
  files/MD5SUMS
  install-on-production.sh             backs up what it replaces, copies both kinds of files, checks the result
  README.md
"""
import hashlib
import os
import shlex
import shutil
import stat
import sys


def md5(path):
    with open(path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


def main(stage, out):
    meta, files, plan, skipped, etc_volume = {}, [], [], [], False
    for line in sys.stdin:
        kind, *f = line.rstrip('\n').split('\t')
        if kind == 'meta' and len(f) >= 2:
            meta[f[0]] = f[1]
        elif kind == 'file' and f and f[0]:
            files.append(f[0])
        elif kind == 'plan' and len(f) >= 5:
            plan.append(tuple(f[:5]))
        elif kind == 'etc' and f:
            etc_volume = f[0] == 'yes'
    if not files:
        print('Nothing to export.')
        return 1
    skipped = [p[3] for p in plan if p[0] == 'skip']

    live = os.path.join(out, 'files', 'live')
    overlays = os.path.join(out, 'files', 'overlays')
    sums = []
    for path in files:
        target = os.path.join(live, path)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copyfile(os.path.join(stage, path), target)
        os.chmod(target, 0o644)
        sums.append((md5(target), 'live/' + path))
    copies = []  # (name of the host folder, name below it, file below home, host path of the file, md5)
    hostdirs = {}  # name of the host folder -> its path on the host
    for action, folder, name, path, host in plan:
        if action not in ('replace', 'add'):
            continue
        base = os.path.basename(host.rstrip('/')) or os.path.basename(folder)
        hostdirs[base] = host.rstrip('/')
        target = os.path.join(overlays, base, name)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copyfile(os.path.join(stage, path), target)
        os.chmod(target, 0o644)
        copies.append((base, name, path, host.rstrip('/') + '/' + name, md5(target)))
        sums.append((md5(target), 'overlays/%s/%s' % (base, name)))
    with open(os.path.join(out, 'files', 'MD5SUMS'), 'w') as f:
        for s, n in sorted(sums, key=lambda x: x[1]):
            f.write('%s  %s\n' % (s, n))

    with open(os.path.join(out, 'install-on-production.sh'), 'w') as f:
        f.write(install_script(meta, files, copies, skipped, stage))
    os.chmod(os.path.join(out, 'install-on-production.sh'), 0o755)
    with open(os.path.join(out, 'README.md'), 'w') as f:
        f.write(readme(meta, files, copies, skipped, etc_volume, hostdirs))
    print('  %d file(s) for the running container, %d for the overlay folders of the host' % (len(files), len(copies)))
    return 0


def q(s):
    return shlex.quote(s)


def folder_name(meta):
    """The name of the exported folder as it is after scp -r: the last part of its path."""
    return os.path.basename(meta.get('folder', '<this folder>').rstrip('/')) or '<this folder>'


def install_script(meta, files, copies, skipped, stage):
    c, home = meta.get('container', 'opennms'), meta.get('home', '/opt/opennms')
    by_file = {}
    for c_ in copies:
        by_file.setdefault(c_[2], []).append(c_)
    out = ['#!/usr/bin/env bash',
           '# Installs the topology files of this folder into the OpenNMS container of this host, and into the overlay folders',
           '# that the image copies into OpenNMS at every start. Made by ./topo.sh export on %s.' % meta.get('made', ''),
           '#',
           '# Run it on the production machine (%s) as the user who runs the container, in this folder:' % meta.get('ssh', 'production'),
           '#   scp -r %s %s:   and then   ssh %s "cd %s && ./install-on-production.sh"' % (
               meta.get('folder', '<this folder>'), meta.get('ssh', '<production>'), meta.get('ssh', '<production>'), folder_name(meta)),
           '# Nothing restarts. Every step below is a plain command: read it first, run the script, or run the steps one by one.',
           'set -eEu',
           'cd "$(dirname "$0")"',
           'HERE=$PWD',
           'C=%s                      # the container' % q(c),
           'HOME_IN=%s     # OpenNMS\'s home inside it (/opt/opennms is a link to it)' % q(home),
           'BACKUP=${BACKUP:-$HOME/topology-backup-$(date +%Y%m%d-%H%M%S)}',
           '',
           'podman container exists "$C" || { echo "There is no container $C for this user (podman ps -a)." >&2; exit 1; }',
           'mkdir -p "$BACKUP"',
           'RESTORE=$BACKUP/restore.sh',
           'printf \'#!/usr/bin/env bash\\n# Puts back what install-on-production.sh replaced and removes what it added.\\nset -eu\\nC=%s\\n\' "$C" >"$RESTORE"',
           'chmod +x "$RESTORE"',
           'trap \'echo "Stopped at line $LINENO. $RESTORE puts back what was replaced until now." >&2\' ERR',
           '',
           '# keep_live <path below OpenNMS\'s home>: what the container has now goes to the backup',
           'keep_live() {',
           '  if podman exec "$C" test -f "$HOME_IN/$1"; then',
           '    mkdir -p "$BACKUP/live/$(dirname "$1")"',
           '    podman cp "$C:$HOME_IN/$1" "$BACKUP/live/$1"',
           '    printf \'podman cp %q %q\\n\' "$BACKUP/live/$1" "$C:$HOME_IN/$1" >>"$RESTORE"',
           '  else',
           '    printf \'podman exec "$C" rm -f %q\\n\' "$HOME_IN/$1" >>"$RESTORE"',
           '  fi',
           '}',
           '# keep_host <absolute path on this machine>: the same for a file in an overlay folder',
           'keep_host() {',
           '  if [ -f "$1" ]; then',
           '    mkdir -p "$BACKUP/host$(dirname "$1")"',
           '    cp -p "$1" "$BACKUP/host$1"',
           '    printf \'cp -p %q %q\\n\' "$BACKUP/host$1" "$1" >>"$RESTORE"',
           '  else',
           '    printf \'rm -f %q\\n\' "$1" >>"$RESTORE"',
           '  fi',
           '}',
           '']
    for path in files:
        out.append('echo %s' % q(path))
        out.append('# now, in the running container')
        out.append('keep_live %s' % q(path))
        out.append('podman cp "$HERE/files/live/%s" "$C:$HOME_IN/%s"' % (path, path))
        for base, name, _, hostpath, _ in by_file.get(path, []):
            out.append('# at every start: the overlay folder %s, which the image copies into OpenNMS' % base)
            out.append('keep_host %s' % q(hostpath))
            out.append('install -D -m 644 "$HERE/files/overlays/%s/%s" %s' % (base, name, q(hostpath)))
        if path in skipped:
            out.append('# (no overlay folder can hold this file: a container that is created again starts without it)')
        out.append('')
    out += ['echo "Check:"',
            'bad=0',
            'check() { if [ "$2" = "$3" ]; then echo "  ok       $1"; else echo "  DIFFERS  $1"; bad=1; fi; }']
    for path in files:
        out.append('check %s %s "$(podman exec "$C" md5sum "$HOME_IN/%s" | cut -c1-32)"' % (
            q('in the container: ' + path), md5(os.path.join(stage, path)), path))
        for _, _, p_, hostpath, sum_ in by_file.get(path, []):
            out.append('check %s %s "$(md5sum %s | cut -c1-32)"' % (q('overlay folder: ' + hostpath), sum_, q(hostpath)))
        if path.startswith('jetty-webapps/opennms/svg/') and path.endswith('.svg'):
            out.append('podman exec "$C" curl -fsS -o /dev/null "http://localhost:8980/opennms/svg/%s" && echo "  ok       OpenNMS serves %s" || { echo "  NOT SERVED  %s"; bad=1; }' % (
                os.path.basename(path), os.path.basename(path), os.path.basename(path)))
    out += ['',
            'if [ "$bad" = 0 ]; then',
            '  echo "Done. Nothing restarted. Open the topology page in a new tab. To undo all of it: $RESTORE"',
            'else',
            '  echo "Something differs (see above). To undo: $RESTORE" >&2',
            '  exit 1',
            'fi',
            '']
    return '\n'.join(out)


def readme(meta, files, copies, skipped, etc_volume, hostdirs):
    folder = meta.get('folder', '<this folder>')
    ssh = meta.get('ssh', '<production>')
    lines = ['# Topology files for %s' % meta.get('container', 'opennms'),
             '',
             'Made by `./topo.sh export` on %s from the kit folder `%s`. The step-by-step explanation is `GUIDE-production-permanent.md` of the kit.' % (
                 meta.get('made', ''), meta.get('kit', '')),
             '',
             '## What is in it',
             '',
             '| file (below OpenNMS\'s home) | in the running container | in an overlay folder of the host (kept at every start) |',
             '|---|---|---|']
    by_file = {}
    for c_ in copies:
        by_file.setdefault(c_[2], []).append(c_[3])
    for path in files:
        where = ', '.join('`%s`' % h for h in by_file.get(path, [])) or ('none (OpenNMS\'s etc/ is on a volume, which keeps it)' if path.startswith('etc/') and etc_volume else 'none')
        lines.append('| `%s` | `files/live/%s` | %s |' % (path, path, where))
    mapping = ', '.join('`files/overlays/%s/` is the folder `%s` of the host' % (b, h) for b, h in sorted(hostdirs.items()))
    lines += ['',
              '`files/overlays/` has the layout of the overlay folders of the production host (%s). ' % (mapping or 'none was needed') +
              'Commit them to your source repository, so that the next deployment from it has the files. `files/MD5SUMS` has the check sums.',
              '']
    if skipped:
        lines += ['No overlay folder can hold: %s. A container that is created again starts without them.' % ', '.join('`%s`' % s for s in skipped), '']
    if any(f.endswith('/zz-topology-styles.svg') for f in files):
        lines += ['`styles/topology.css` is the source of `jetty-webapps/opennms/svg/zz-topology-styles.svg`; `make-style-svg.sh` makes the svg file from it again, '
                  'without the kit (remove the line `/* mark */` first if there is one: it adds a label to the page).',
                  '']
    lines += [
             '## Install on production, by hand',
             '',
             '```bash',
             'scp -r %s %s:' % (folder, ssh),
             'ssh %s' % ssh,
             'cd %s' % os.path.basename(folder.rstrip('/')),
             'less install-on-production.sh     # read it: every step is a plain command',
             './install-on-production.sh        # nothing restarts',
             '```',
             '',
             'The script saves what it replaces in `~/topology-backup-<date>/` and writes `restore.sh` there, which puts it all back.',
             '',
             '## The steps without the script',
             '']
    n = 0
    for path in files:
        n += 1
        lines.append('%d. `%s`' % (n, path))
        lines.append('   - the running container: `podman cp files/live/%s %s:%s/%s`' % (path, meta.get('container', 'opennms'), meta.get('home', '/opt/opennms'), path))
        for base, name, p_, hostpath, _ in [c_ for c_ in copies if c_[2] == path]:
            lines.append('   - the overlay folder (kept at every start): `install -D -m 644 files/overlays/%s/%s %s`' % (base, name, hostpath))
    lines += ['',
              'Check one file: `podman exec %s md5sum %s/<path>` and `md5sum files/live/<path>` print the same sum; '
              '`podman exec %s curl -fsS -o /dev/null http://localhost:8980/opennms/svg/zz-topology-styles.svg` prints nothing when OpenNMS serves it.' % (
                  meta.get('container', 'opennms'), meta.get('home', '/opt/opennms'), meta.get('container', 'opennms')),
              '']
    return '\n'.join(lines)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2]))
