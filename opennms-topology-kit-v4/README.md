# OpenNMS topology kit (Horizon 33.1.8)

Learn and change the OpenNMS files behind `/opennms/topology`: icons, icon mappings, icon size and colours,
links. Each change shows in a development OpenNMS that runs your production image, and is then hot deployed to
production with no restart. **FILES.md** describes each file, with an example you can run.

| Machine | Address | What runs there |
|---|---|---|
| development | 192.168.0.47, user `admin` | this kit, and the development OpenNMS (`./dev.sh`) |
| production | 192.168.0.36, user `maven-admin` | the container `opennms` (`docker.io/opennms/maven:33.1.8-1192-g05c63c46e8`, PostgreSQL 14) |

The addresses, names and images are in `kit.env`.

## 1. Set up once, on the development machine

1. **VirtualBox settings** (VM shut down): System > Motherboard > Base Memory **4096 MB** or more, System > Processor **2 CPUs**,
   Network > Adapter 1 **Bridged Adapter**.
2. **Podman:** `sudo dnf install -y podman`. CentOS Stream 9 already has curl, Python 3 and ssh.
3. **A key to log in to production without a password:**

   ```bash
   ssh-keygen -t ed25519                      # press Enter at every question
   ssh-copy-id maven-admin@192.168.0.36
   ssh maven-admin@192.168.0.36 podman ps     # lists the production containers: it works
   ```

4. **Unpack the kit and start:**

   ```bash
   tar xzf opennms-topology-kit.tar.gz && cd opennms-topology-kit
   ./dev.sh up       # the development OpenNMS
   ./topo.sh pull    # the topology files of production: into opennms/, and onto dev
   ```

`./dev.sh up` does five things:

1. It checks memory, disk and ports.
2. Once, it asks for your sudo password. It opens port 8980 in firewalld and keeps the containers running after you log out.
3. It copies the production image over ssh (about 1.5 GB, only once; production keeps running).
4. It starts the image with PostgreSQL 14. The first start takes 5-10 minutes.
5. It adds demo DAS nodes: orion-1, helix-1, stratus-1/2 and nimbus-1/2, with links, a GraphML view "DAS demo" and one alarm.

When it is done, open **http://192.168.0.47:8980/opennms/topology** (admin / admin) from any computer.

## 2. Learn, change, look

```bash
./topo.sh example        # the ten examples, one per file and effect (FILES.md has the details)
./topo.sh example 7      # apply one: it changes files in opennms/ or styles/ and deploys them to dev
./topo.sh diff           # everything you changed since the pull
./topo.sh revert         # drop your changes (or one file: ./topo.sh revert <file>)
./topo.sh watch          # deploy every save to dev, while you edit files in opennms/ and styles/
./topo.sh icons          # every icon id, and the icon each node gets (./topo.sh icons prod: production's nodes)
```

Reload the topology page after a deploy. After a replaced icon file, press Ctrl+Shift+R, so the browser drops its old copy.

## 3. Hot deploy to production

```bash
./topo.sh deploy prod    # lists the changed files and asks; keeps production's old files in backups/; copies
./topo.sh undo           # puts back what the last deploy replaced, and removes what it added
```

A deploy compares each file with the container's copy and copies the changed ones over ssh with `podman cp`.
Production's icons, mappings and styles are then the ones from your development machine. Nothing restarts;
reload the topology page.

Mapping files live on production's etc volume. Files in `jetty-webapps` live in the container itself, so they
are lost when the container is re-created. To keep them, mount an overlay folder in production's run command,
`-v /srv/opennms-overlay:/opt/opennms-overlay:Z`. The image copies that folder into OpenNMS at every start, and
`./topo.sh deploy prod` writes there too. `./dev.sh prod-info` shows how production runs.

## Commands

| | |
|---|---|
| `./dev.sh up` | check, start, add demo nodes (safe to repeat) |
| `./dev.sh status`, `./dev.sh logs [file]` | state and addresses; follow `karaf.log` (or another OpenNMS log) |
| `./dev.sh down`, `./dev.sh reset` | stop (`up` starts again with all data); delete the containers and their data |
| `./dev.sh prod-info` | production container: image, command, ports, capabilities, volumes, variable names |
| `./topo.sh pull [prod\|dev]` | copy the topology files into `opennms/` (from production: also onto dev) |
| `./topo.sh deploy dev\|prod [-y]`, `./topo.sh undo [-y]` | hot deploy; undo the last production deploy |
| `./topo.sh watch`, `example [N]`, `diff`, `revert [file]`, `icons [dev\|prod]` | see section 2 |

## When something goes wrong

- **"Cannot log in to maven-admin@192.168.0.36"**: do step 3 of section 1.
- **OpenNMS stopped with exit code 137**: memory. Give the VM 4 GB or more.
- **OpenNMS stopped, the log ends with `java: Operation not permitted`**: the `java` file in the OpenNMS image has
  the capabilities NET_RAW and NET_BIND_SERVICE (for ping), and a container that may not hold them cannot run it.
  Docker gives NET_RAW, Podman 5 does not. `kit.env` adds both (`DEV_CAP_ADD`). `./dev.sh prod-info` lists the
  capabilities of production; put what production has and the dev container lacks into `DEV_CAP_ADD` or `DEV_PODMAN_ARGS`.
- **OpenNMS stopped with another code**: `./dev.sh up` prints the end of its log and keeps the whole log in
  `.kit/opennms-start.log`. If your image needs a variable that production sets (`./dev.sh prod-info` lists
  them), put it in `DEV_ENV` in `kit.env`.
- **The demo nodes fail with HTTP 401**: your image has another admin password. Set `DEV_USER` and `DEV_PASSWORD` in `kit.env`.
- **The page is "unreachable" from your computer**: the firewall. Run
  `sudo firewall-cmd --permanent --add-port=8980/tcp && sudo firewall-cmd --reload`.
- **"Permission denied" on `./dev.sh`**: the files were unpacked without their executable bit. Run `chmod +x dev.sh topo.sh`.
