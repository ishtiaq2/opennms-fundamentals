# Make the finished styles part of production for good

You are happy with the styles on dev and have hot deployed them. This guide makes sure that production keeps them (when
the container restarts, and when it is created again), and gets the files into your production source code. It ends
with a list of manual steps: copy the files from the development machine (192.168.0.47), `podman cp` them into the
running `opennms` container on production (192.168.0.36), and copy them into its overlay folders. Nothing restarts.

Run the commands of steps 1 and 2 on the development machine as user `admin`, in the kit folder:

```bash
cd ~/opennms-fundamentals/opennms-fundamentals/opennms-topology-kit-v6
```

Needs kit 3.10 (`./topo.sh persist` and `./topo.sh export`). The manual steps (step 3) need no kit.

## 0. What "permanent" means for the OpenNMS container

A file can be in four places, and each one survives different things:

| Where the file is | How it gets there | A restart of the container | A new container on this machine | A new machine, or a lost `/opt/maven-nms` |
|---|---|---|---|---|
| inside the running container (`/usr/share/opennms/...`) | `podman cp`, or `./topo.sh deploy prod` | kept | **lost** | lost |
| an overlay folder of production (`/opt/maven-nms/data/overlays/...`) | `install`/`cp` on production, or `./topo.sh deploy prod` | **copied back in at every start** | copied in | lost |
| OpenNMS's `etc/` (the named volume `opennms_data-config`) | `podman cp` into `etc/` | kept | kept (the volume stays) | lost |
| your source repository (git) | commit | | | **kept** |

The image copies three folders into OpenNMS at every start: `/opt/opennms-overlay` (below OpenNMS's home),
`/opt/opennms-etc-overlay` (below `etc/`) and `/opt/opennms-jetty-webapps-overlay` (below `jetty-webapps/`). On the host
they are `/opt/maven-nms/data/overlays/overlay`, `.../etc-overlay` and `.../jetty-webapps-overlay`. They overwrite files
in the container, so a file in the container whose overlay copy is older is **replaced by the old one at the next
start**. That is why a file has to be in the container and in its overlay folder, and the same in both.

`./topo.sh deploy prod` already does both. This guide shows how to check that, and how to do it by hand.

"Production source code" here means the files that decide what the production container runs: the overlay folders
and, if you keep them in git, that repository. Step 4 covers the repository, and an image that you build yourself.

## 1. Check what production keeps: `./topo.sh persist`

```bash
./topo.sh persist
```

It looks at each file you sent to production (the style file, and the files of your production deploys listed in
`backups/`), and prints where it is:

```
What keeps your files in opennms on maven-admin@192.168.0.36 when it restarts, and when its container is created again:
  jetty-webapps/opennms/svg/zz-topology-styles.svg
    in the container now:  yours
    overlay folder:        yours, in /opt/maven-nms/data/overlays/jetty-webapps-overlay/opennms/svg/zz-topology-styles.svg
    => kept at every start and in a new container
All 1 file(s) are kept. ./topo.sh export makes a folder for your source repository and a script that installs it.
```

| It says | Meaning | What to do |
|---|---|---|
| `kept at every start and in a new container` | the container and the overlay folder have your version | nothing |
| `NOT SAFE: the container has another version than yours` | you changed the file on dev after your last deploy | `./topo.sh deploy prod` |
| `NOT SAFE: the overlay copy is another version: a restart puts it back` | the overlay folder holds an older file | `./topo.sh deploy prod` updates it |
| `NOT SAFE: only in the running container ... a container that is created again loses it` | no overlay folder has the file | `./topo.sh deploy prod` adds it next to its neighbours; if it says `none fits this file`, step 3 puts it into an overlay folder by hand |
| `etc volume: OpenNMS's etc/ is on a volume ...` | an `etc/` file that the volume keeps | nothing on this machine; step 4 keeps a copy in the repository |

It only reads. The other check is `./topo.sh css prod`: it compares the style file that production serves with your
`styles/topology.css`, and prints the lines that differ.

## 2. Collect the files and install them on production: `./topo.sh export`

```bash
./topo.sh export
```

It makes a folder `export/<date>-<time>/` with your files in the layout of production, and a script that installs them:

```
export/20261029-211935/
  README.md                    what is in it, and the steps by hand
  install-on-production.sh     backs up, copies into the container and the overlay folders, checks
  make-style-svg.sh            styles/topology.css -> the svg file, without the kit
  styles/topology.css          the source of the style file
  files/MD5SUMS
  files/live/...               the files at their paths below OpenNMS's home: for the running container
  files/overlays/...           the files as the overlay folders of production hold them
```

Copy the folder to production and run the script there, as the user who runs the container:

```bash
scp -r export/20261029-211935 maven-admin@192.168.0.36:
ssh maven-admin@192.168.0.36
cd 20261029-211935
less install-on-production.sh        # every step in it is a plain command: read it first
./install-on-production.sh
```

The script keeps what it replaces in `~/topology-backup-<date>-<time>/`, with a `restore.sh` that puts all of it back.
It copies each file into the running container (`podman cp`) and into its overlay folder, compares the md5 sums of
both with the file, asks OpenNMS for the style file, and prints `ok` or `DIFFERS` for each check. If a step fails it
stops and names the `restore.sh`.

`FILES='etc/org.opennms.features.topology.app.icons.default.cfg' ./topo.sh export` adds files that are not in the
list (any path below OpenNMS's home that exists in `opennms/`). `./topo.sh export my-folder` names the folder.

## 3. The manual steps, without the scripts

The same thing with plain commands. Use it to understand what the script does, or when you want to do it yourself.
The paths are yours: container `opennms`, OpenNMS's home `/usr/share/opennms` (`/opt/opennms` is a link to it) and the
overlay folders below `/opt/maven-nms/data/overlays/`. Step 3.4 shows how to check them.

### 3.1 On the development machine: collect the files

```bash
cd ~/opennms-fundamentals/opennms-fundamentals/opennms-topology-kit-v6
mkdir -p ~/topology-files/jetty-webapps/opennms/svg ~/topology-files/etc

# the style file, made from your CSS the way the kit makes it (take a /* mark */ line out of the CSS first)
tools/make-style-svg.sh styles/topology.css > ~/topology-files/jetty-webapps/opennms/svg/zz-topology-styles.svg

# the other files you changed and deployed: icon mappings, icons (only the ones that you changed)
cp opennms/etc/org.opennms.features.topology.app.icons.default.cfg ~/topology-files/etc/
cp opennms/jetty-webapps/opennms/svg/<your icon>.svg ~/topology-files/jetty-webapps/opennms/svg/
```

The file the development OpenNMS serves is the same file, if you want it from there:
`podman cp onms-dev-core:/usr/share/opennms/jetty-webapps/opennms/svg/zz-topology-styles.svg ~/topology-files/jetty-webapps/opennms/svg/`.
The folder `~/topology-files` has the paths below OpenNMS's home.

### 3.2 Copy them to the production machine

```bash
scp -r ~/topology-files maven-admin@192.168.0.36:
ssh maven-admin@192.168.0.36
```

### 3.3 On production: keep what you replace

```bash
B=~/topology-backup-$(date +%Y%m%d-%H%M%S); mkdir -p $B
podman cp opennms:/usr/share/opennms/jetty-webapps/opennms/svg/zz-topology-styles.svg $B/container-zz-topology-styles.svg
cp -p /opt/maven-nms/data/overlays/jetty-webapps-overlay/opennms/svg/zz-topology-styles.svg $B/overlay-zz-topology-styles.svg
ls $B
```

A file that does not exist yet gives an error here: that is fine, there is nothing to keep.

### 3.4 On production: find the container's home and the overlay folders

```bash
podman exec opennms readlink -f /opt/opennms
podman inspect opennms --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
```

You should see `/usr/share/opennms`, and lines like these (the folders on the left are the overlay folders):

```
/opt/maven-nms/data/overlays/overlay -> /opt/opennms-overlay
/opt/maven-nms/data/overlays/etc-overlay -> /opt/opennms-etc-overlay
/opt/maven-nms/data/overlays/jetty-webapps-overlay -> /opt/opennms-jetty-webapps-overlay
/home/maven-admin/.local/share/containers/storage/volumes/opennms_data-config/_data -> /opt/opennms/etc
```

Which overlay folder takes which file: **the one that already holds files of the same kind.** The svg files of your
other icons (`orion.svg`, ...) and `zz-topology-styles.svg` are below `jetty-webapps-overlay/opennms/svg/`; the
`org.opennms.features.topology.app.icons.*.cfg` files are in `etc-overlay/`. `ls -R /opt/maven-nms/data/overlays` shows
it, and `./topo.sh persist` on the development machine names the folder for each file.

### 3.5 On production: into the running container, and into the overlay folder

```bash
# the style file
podman cp ~/topology-files/jetty-webapps/opennms/svg/zz-topology-styles.svg \
  opennms:/usr/share/opennms/jetty-webapps/opennms/svg/zz-topology-styles.svg
install -D -m 644 ~/topology-files/jetty-webapps/opennms/svg/zz-topology-styles.svg \
  /opt/maven-nms/data/overlays/jetty-webapps-overlay/opennms/svg/zz-topology-styles.svg

# an icon mapping file (an etc file: the volume keeps the one in the container; the overlay copy comes in at every start)
podman cp ~/topology-files/etc/org.opennms.features.topology.app.icons.default.cfg \
  opennms:/usr/share/opennms/etc/org.opennms.features.topology.app.icons.default.cfg
install -D -m 644 ~/topology-files/etc/org.opennms.features.topology.app.icons.default.cfg \
  /opt/maven-nms/data/overlays/etc-overlay/org.opennms.features.topology.app.icons.default.cfg
```

The first command of each pair is the running container: OpenNMS uses the file at once. The second is the overlay
folder: the image copies it into OpenNMS at every start. Do both for every file, and put the **same** file in both.

### 3.6 On production: check

```bash
md5sum ~/topology-files/jetty-webapps/opennms/svg/zz-topology-styles.svg
podman exec opennms md5sum /usr/share/opennms/jetty-webapps/opennms/svg/zz-topology-styles.svg
md5sum /opt/maven-nms/data/overlays/jetty-webapps-overlay/opennms/svg/zz-topology-styles.svg
podman exec opennms curl -fsS -o /dev/null http://localhost:8980/opennms/svg/zz-topology-styles.svg && echo served
```

The three sums are the same, and `served` is printed. Reload production's topology page
(http://192.168.0.36:8980/opennms/topology). Back on the development machine, `./topo.sh css prod` says that
production has your latest `styles/topology.css`, and `./topo.sh persist` says `kept` for every file.

### 3.7 Take it back

```bash
podman cp $B/container-zz-topology-styles.svg opennms:/usr/share/opennms/jetty-webapps/opennms/svg/zz-topology-styles.svg
cp -p $B/overlay-zz-topology-styles.svg /opt/maven-nms/data/overlays/jetty-webapps-overlay/opennms/svg/zz-topology-styles.svg
```

Or, from the kit, `./topo.sh undo` undoes the last `./topo.sh deploy prod`.

### 3.8 If a command says "Permission denied"

`install` and `cp` into an overlay folder need write access to it as `maven-admin`. `ls -ld /opt/maven-nms/data/overlays/*`
shows the owner. If another user owns it, run the two lines for the overlay folder with `sudo` (and
`sudo chown maven-admin: <file>` afterwards, so that `./topo.sh deploy prod` can update it again). The `podman cp` lines
do not need it.

## 4. Into your source repository

The overlay folders are what the production container is made of, so the repository that deploys production should hold
the same files. What goes in:

| File | Why |
|---|---|
| `styles/topology.css` | **the source** of the style file: change this one, not the svg |
| the overlay files: `files/overlays/*` from the export folder | the same layout as `/opt/maven-nms/data/overlays/`: copy `etc-overlay/`, `jetty-webapps-overlay/` (and `overlay/`) into the repository's `data/overlays/` |
| `make-style-svg.sh` | turns the CSS into the svg file without the kit: `./make-style-svg.sh styles/topology.css > zz-topology-styles.svg` |

Commit them where you keep production's files. If `/opt/maven-nms` on production is itself a git repository:

```bash
cd /opt/maven-nms
git status
git add data/overlays/jetty-webapps-overlay/opennms/svg/zz-topology-styles.svg data/overlays/etc-overlay
git commit -m "Topology page styles: icon backgrounds, links, labels"
```

If the repository is somewhere else, copy the three kinds of files into it (`scp` them from the export folder) and
commit there. The next deployment from the repository then puts the files into the overlay folders, and the image
copies them into OpenNMS.

**If you build the image yourself,** put `zz-topology-styles.svg` next to the other svg files that its build copies into
`jetty-webapps/opennms/svg/` (a `COPY zz-topology-styles.svg /usr/share/opennms/jetty-webapps/opennms/svg/` line in the
Containerfile), and rebuild. Then every container made from the image has the file. An overlay copy of the file,
if there is one, still overwrites the image's file at every start, so update it with the same file or delete it.

**Changing the styles later.** Edit `styles/topology.css` on the development machine, see it with `./topo.sh watch`,
then `./topo.sh deploy prod` (container and overlay folder), `./topo.sh persist`, and commit the new
`styles/topology.css` and `zz-topology-styles.svg` (`./topo.sh export` makes both).

## 5. When something is not as expected

| What you see | Why | What to do |
|---|---|---|
| after a restart the old styles are back | the overlay folder had an older `zz-topology-styles.svg` than the container: the start copied it in | put the new file into the overlay folder (step 3.5), or `./topo.sh deploy prod` |
| `./topo.sh persist` says `none fits this file` | no overlay folder holds files of its kind | create the folder path in the overlay folder and `install -D` the file there (step 3.5), then ask `persist` again |
| `./topo.sh persist` says the container has "another version than yours" | you changed `styles/topology.css` after your last deploy | `./topo.sh deploy prod` |
| `export` says there is nothing to export | `styles/topology.css` has no rules and no deploy to production is on record | put rules into the CSS and `./topo.sh deploy prod`, or name files: `FILES='etc/<file>' ./topo.sh export` |
| the install script says "There is no container opennms for this user" | you ran it as another user, or the container has another name | run it as `maven-admin`; `podman ps -a` names the container |
| the install script stops and names `restore.sh` | a step failed (read the line above it) | run that `restore.sh`, fix the cause (step 3.8), run the script again |
| a file of the export is not what is in production | someone changed production after the export | `./topo.sh pull` copies production's files to the kit; `./topo.sh diff` shows the difference; export again |

## 6. The commands of this guide

| Command | What it does |
|---|---|
| `./topo.sh persist` | for each file you sent to production: is it in the container and in an overlay folder, and the same in both |
| `./topo.sh export [folder]` | your files in the layout of production, with a script that installs them and a script that undoes it |
| `./topo.sh deploy prod` | container and overlay folders in one step |
| `./topo.sh css prod` | whether production serves your latest `styles/topology.css`; the lines that differ when it does not |
| `./topo.sh undo` | take the last production deploy back |
| `tools/make-style-svg.sh styles/topology.css` | prints the svg file for the CSS, without the kit |
