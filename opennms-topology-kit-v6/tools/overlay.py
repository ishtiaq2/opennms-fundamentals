#!/usr/bin/env python3
"""./topo.sh deploy prod: where the overlay folders of the OpenNMS container keep the deployed files.

The image copies three folders into OpenNMS at every start (rsync, so a file there overwrites a hot-deployed
copy with its old content):
  /opt/opennms-overlay                 below OpenNMS's home        etc/x.cfg, jetty-webapps/opennms/svg/x.svg
  /opt/opennms-etc-overlay             below etc/                  x.cfg
  /opt/opennms-jetty-webapps-overlay   below jetty-webapps/ (or a folder below it: the files that are there show which)
A deploy therefore changes the copies that exist there, and puts a new file next to the files of its own folder.

stdin, one line each, fields separated by tabs:
  mounted  <folder>  <host path>      an overlay folder of the container
  file     <folder>  <path>           a file in it ("./path" as find prints it)
  changed  <path>                     deployed files (paths below OpenNMS's home)
  removed  <path>                     deployed files that go away
  all      <path>                     every file the kit manages (to find the neighbours of a new file)
  kept     etc                        OpenNMS's etc/ is on a volume: a new etc file survives without an overlay copy
stdout, one line per action, fields separated by tabs:
  replace|add|remove  <folder>  <path below the folder>  <file below OpenNMS's home or ->  <host path of the folder>
  skip  -  -  <file>  -               a changed file that has no place in any overlay folder
"""
import os
import re
import sys

JETTY, ROOT, ETC = '/opt/opennms-jetty-webapps-overlay', '/opt/opennms-overlay', '/opt/opennms-etc-overlay'
ORDER = [JETTY, ROOT, ETC]  # where a new file goes first, when its neighbours are in several

host, files, changed, removed, everything, kept = {}, set(), [], [], [], set()
for line in sys.stdin:
    kind, *f = line.rstrip('\n').split('\t')
    f = [x[2:] if x.startswith('./') else x for x in f]
    if not f or not f[-1]:
        continue
    if kind == 'mounted':
        host[f[0]] = f[1] if len(f) > 1 else '?'
    elif kind == 'file':
        files.add((f[0], f[1]))
    elif kind == 'changed':
        changed.append(f[0])
    elif kind == 'removed':
        removed.append(f[0])
    elif kind == 'all':
        everything.append(f[0])
    elif kind == 'kept':
        kept.add(f[0])


def names(folder, path):
    """The names the file `path` (below OpenNMS's home) can have in `folder`, most specific first."""
    if folder == ROOT:
        return [path]
    if folder == ETC:
        return [path[len('etc/'):]] if path.startswith('etc/') else []
    if folder == JETTY and path.startswith('jetty-webapps/'):
        parts = path[len('jetty-webapps/'):].split('/')
        return ['/'.join(parts[i:]) for i in range(len(parts))]
    return []


def copies(path):
    """[(folder, name)] where an overlay folder holds this file now: the most specific name of each folder."""
    found = []
    for folder in ORDER:
        if folder in host:
            hit = next((n for n in names(folder, path) if (folder, n) in files), None)
            if hit:
                found.append((folder, hit))
    return found


def kind(path):
    """Files of one kind: the same folder; for factory configurations (<pid>-<name>.cfg, such as the cfg files of
    GraphML views) also the same pid, so they do not follow the icon mappings of the same folder."""
    folder, name = os.path.split(path)
    factory = re.match(r'(.+)-[^-]+\.cfg$', name)
    return folder, factory.group(1) if factory else None


def new_home(path):
    """(folder, name) for a file no overlay folder has: next to the files of its kind that it has."""
    here, votes = kind(path), {}
    for other in everything:
        if other != path and kind(other) == here:
            for folder, name in copies(other):
                key = (folder, os.path.dirname(name))
                votes[key] = votes.get(key, 0) + 1
    if votes:
        (folder, sub), _ = max(votes.items(), key=lambda kv: (kv[1], -ORDER.index(kv[0][0])))
        return folder, (sub + '/' if sub else '') + os.path.basename(path)
    if not needs_copy(path):
        return None
    if ROOT in host:  # its names are plain: the path below OpenNMS's home
        return ROOT, path
    if ETC in host and path.startswith('etc/'):
        return ETC, path[len('etc/'):]
    return None


def needs_copy(path):
    """Does a new file need a copy in an overlay folder, to be there in a new container? Not one below a volume."""
    return not (path.startswith('etc/') and 'etc' in kept)


for path in changed:
    found = copies(path)
    for folder, name in found:
        print('replace', folder, name, path, host[folder], sep='\t')
    if not found:
        home = new_home(path)
        if home:
            print('add', home[0], home[1], path, host[home[0]], sep='\t')
        elif host and needs_copy(path):
            print('skip', '-', '-', path, '-', sep='\t')
for path in removed:
    for folder, name in copies(path):
        print('remove', folder, name, '-', host[folder], sep='\t')
