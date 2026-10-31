# Guide: change OpenNMS's pages, and see exactly what happens

This guide walks through OpenNMS UI Studio one step at a time. Each experiment says what to do in the studio, then
**what happened in OpenNMS** (which file, which command), then how to **check it by hand** in a terminal, and how
to **track it** in your history. Do them in order the first time; later each one stands on its own.

| | |
|---|---|
| Development machine | 192.168.0.47, CentOS Stream 9, user `admin`: the studio and the development OpenNMS (container `onms-dev-core`) |
| Production | 192.168.0.36, user `maven-admin`: container `opennms`, overlay folders below `/opt/maven-nms/data/overlays/` |
| OpenNMS's home in the containers | `/usr/share/opennms` (`/opt/opennms` is a link to it) |
| Studio folder | `~/opennms-fundamentals/opennms-ui-studio` (commands below run there, as `admin`, unless they say otherwise) |
| Studio page | `http://192.168.0.47:8990` |

Words used below: **dev** is the development OpenNMS, **production** the real one, **apply** means the studio writes
files into an OpenNMS, a **snapshot** is a saved version of your files, an **experiment** is a line of snapshots
you can switch to and from.

---

## Part 1: Set up (about 30 minutes, once)

### Step 1.1: Node.js and git

```bash
node --version || true                        # v20 or newer is fine; then skip the next two lines
sudo dnf module list nodejs                   # which versions CentOS Stream offers
sudo dnf module install -y nodejs:20/common   # or nodejs:22/common if the list shows it
sudo dnf install -y git
git --version
```

### Step 1.2: Unpack, install, build

Copy `opennms-ui-studio-1.0.0.tar.gz` to the development machine, then:

```bash
mkdir -p ~/opennms-fundamentals && cd ~/opennms-fundamentals
tar xzf ~/opennms-ui-studio-1.0.0.tar.gz
cd opennms-ui-studio
npm install        # once: Vue, Vite and TypeScript into node_modules/
npm run build      # server/dist and web/dist
npm test           # 14 tests, all "ok"
```

`npm test` checks the parts that touch OpenNMS files against the real OpenNMS 33.1.8 files: that the style file is
byte for byte what the topology kit makes, that the Plugins label is found in Menubar.vue compiled four different
ways, that `navbar.ftl` and `dispatcher-servlet.xml` stay valid after a change.

### Step 1.3: Start it

```bash
sudo firewall-cmd --permanent --add-port=8990/tcp && sudo firewall-cmd --reload   # once
kit/dev.sh status      # is the development OpenNMS running? If not: kit/dev.sh up
npm start
```

Open the address it prints (`http://192.168.0.47:8990/?token=...`) in your browser. The **Start** page shows dev,
production and your workspace. Both dots in the left column should be green. If production is red, the text under it
says why (usually: `ssh-copy-id maven-admin@192.168.0.36` once).

Open the **command log** at the bottom (click it). Each line is a command the studio ran: `podman ...` for dev,
`ssh maven-admin@192.168.0.36 podman ...` for production, `git ...` for your workspace. Keep it open while you
learn: it is the answer to "what did it just do?".

### Step 1.4: Bring your CSS from the topology kit

Your 17+ rules are in the old kit folder. In the studio: **Topology** > *Import a CSS file*, enter
`~/opennms-fundamentals/opennms-fundamentals/opennms-topology-kit-v6/styles/topology.css`, *Import*. The editor shows
your rules and the preview draws them.

Then **History** > message `My CSS from the topology kit` > *Snapshot*. That is your starting point.

> **What happened.** The studio copied the file into `workspace/topology/topology.css` and ran
> `git add -A` and `git commit -m "My CSS from the topology kit"` in `workspace/` (see the command log).
> Nothing changed in any OpenNMS.

From now on use `kit/` inside the studio for the kit's commands (`kit/dev.sh`, `kit/topo.sh`): its `kit.env` names
the studio's CSS file (`STYLE_CSS=../workspace/topology/topology.css`).

---

## Part 2: The Topology module

docs/opennms-topology.md tells how OpenNMS builds the real page; this part lets you watch it.

Open **Topology**. Left: your CSS (`workspace/topology/topology.css`), saved by itself a moment after you stop typing.
Right: the preview, built the way OpenNMS builds `/opennms/topology`: the stock stylesheet, every svg file of dev's
`jetty-webapps/opennms/svg/` in `<defs>`, your CSS as the last of them, and the nodes of a GraphML view of dev, each as
`<g class="vertex">` with `rect.status`, the icon (`use.upIcon`), the label (`text.vertex-label`). Below: what dev and
production have now, and the panels that apply.

### Experiment T1: where does the green come from?

1. In *Status*, choose *no alarms (normal)*. Delete all your rules for a moment (select all, delete): the preview
   shows the green squares behind the icons.
2. Click a node. The inspector says what the browser computes for its frame:
   `rect.status.normal`, fill `rgb(51, 102, 0)`, stroke `rgb(51, 102, 0)`, stroke-width `5px`.
3. `#336600` is `rgb(51, 102, 0)`. It comes from the stock stylesheet, rule `.vertex .status.normal`.
4. Put your rules back: History > *Take its files back* on your snapshot (or Ctrl+Z in the editor).

> **What happened in OpenNMS.** Nothing. The preview read the files of dev once (the command log shows
> `podman exec onms-dev-core sh -c 'cd ... tar -cf - ...'` for the svg files and the views) and draws them in your browser.

**Check it by hand.** The stock stylesheet is inside a jar; the *How it works* box of the Topology page names it. On
the real page: open `http://192.168.0.47:8980/opennms/topology` (log in, choose a view), F12 > Elements, Ctrl+F
`status normal`: the same `<rect class="status normal">`. Its Styles pane shows `.vertex .status.normal` from the theme.

### Experiment T2: one colour behind all icons

1. *Insert rules to start from…* > *All icons: another background instead of the green* > *Insert*.
2. The preview changes as the line appears. Change `#F1F3F5` to `#E8F5E9` and watch it again.
3. In *Status* choose *mixed alarms*: nodes with an alarm keep their alarm colour, because the rule names `.normal`.
4. History > *Snapshot* with the message `light background for all icons`.

> **Why it wins.** `svg .vertex > rect.status.normal` names an element type more (`svg`, `rect`) than the stock
> `.vertex .status.normal`, so it is more specific and wins whatever the order. docs/opennms-topology.md, part 3.

### Experiment T3: an experiment of your own

1. History > *New experiment* `amber-helix` > *New experiment*. The left column now says `experiment/amber-helix`.
2. Topology: click a helix node; *Insert rules to start from…* > *One icon: a background of its own* > *Insert*.
   The rule names the icon you clicked: `svg .vertex:has(use.upIcon[*|href="#das_helix"]) > rect.status.normal`.
3. Snapshot: `amber behind helix`.
4. History > *Switch* on `main`: the editor and the preview go back to the version without amber. *Switch* back to
   `experiment/amber-helix`: amber again.
5. Pick the two snapshots in the list > *Compare the two picked*: the diff shows exactly your new line.

> **What happened.** `git switch -c experiment/amber-helix`, `git commit`, `git switch main`, `git diff <a> <b>` in
> `workspace/`. The studio noticed that the files changed on disk and loaded them again.

### Experiment T4: apply to dev, and find the file

1. In the panel *Development OpenNMS*, read the plan: one file, `jetty-webapps/opennms/svg/zz-topology-styles.svg`,
   its md5 now and after, and its diff: your CSS between `<style><![CDATA[` and `]]></style>`.
2. *Apply to the development OpenNMS*. The result lists the checks: the md5 sum of the file in the container, and
   *OpenNMS serves svg/zz-topology-styles.svg ... 200, the new file*.
3. Open `http://192.168.0.47:8980/opennms/topology` in a **new browser tab** (a tab keeps the list of svg files it
   loaded; a changed file only needs a reload) and look at your view.

> **What happened in OpenNMS.** The command log shows, in order: `git add` and `git commit` in `workspace/` (the
> snapshot that this apply records, unless you made one already), `podman exec onms-dev-core cat <file>` (the old file,
> kept in `backups/<date>-<time>-dev-topology/`), `podman exec -i onms-dev-core sh -c 'mkdir -p "$(dirname "$1")" && cat > "$1"' sh /usr/share/opennms/jetty-webapps/opennms/svg/zz-topology-styles.svg`
> (the new file on its standard input), `podman exec onms-dev-core md5sum <file>`, then an HTTP request from the studio
> to `http://127.0.0.1:8980/opennms/svg/zz-topology-styles.svg`. OpenNMS itself was not restarted: the topology page
> lists the svg folder each time a new page (tab) is made, and puts every file into its `<defs>`.

**Check it by hand.**

```bash
podman exec onms-dev-core cat /usr/share/opennms/jetty-webapps/opennms/svg/zz-topology-styles.svg | head -5
curl -s http://localhost:8980/opennms/svg/zz-topology-styles.svg | md5sum     # the md5 of the plan's "after"
ls backups/ && cat backups/journal.jsonl | tail -n 1 | python3 -m json.tool | head -20
```

### Experiment T5: another icon for one node

1. In the preview, click a node. The inspector says why it has its icon, for example *because of its iconKey in the
   GraphML file*, or *the line Maven-abc.10 in org.opennms.features.topology.app.icons.default.cfg*.
2. *Another icon for this node* > choose an icon. The preview draws it at once; `workspace/topology/icon-mappings.json`
   gets the line.
3. The dev panel now plans two files: the style file and `etc/org.opennms.features.topology.app.icons.default.cfg`,
   whose diff adds a block between two comments of the studio. Apply to dev, reload the topology page.

> **What happened in OpenNMS.** The studio read dev's mapping file, replaced its own block at the end (or added one),
> and wrote the file back. OpenNMS (Karaf) reads a changed `.cfg` of `etc/` within a second. A line
> `<namespace>.<node id> = <icon id>` beats the node's iconKey (IconRepositoryManager looks for that key first).
> Lines outside the block (for example the ones `kit/topo.sh view icon` wrote) stay as they are; the block is last,
> so for the same key it wins.

```bash
podman exec onms-dev-core tail -6 /usr/share/opennms/etc/org.opennms.features.topology.app.icons.default.cfg
```

### Experiment T6: alarm colours

1. *Status* > *mixed alarms*. Click a node with a major or critical alarm and change its status in the inspector.
2. Insert *Alarm frames: one red for major and critical*. Only those nodes change.
3. Insert *One icon: its colour in every alarm state*: that icon keeps its background in every state; the frame
   (stroke) still shows the alarm.

### Experiment T7: a rule that does nothing (on purpose)

1. Add `.vertex .status.normal { fill: hotpink; }` at the end. The preview does not change: the inspector still shows
   your earlier colour. Your earlier `svg ...` rule is more specific than this one.
2. Change it to `svg .vertex > rect.status.normal { fill: hotpink; }`: now it wins, because among rules of equal
   weight the later one wins. Delete it again.

> **The lesson.** On the real page your CSS meets the stock stylesheet and the `<style>` of every other svg file (some
> icon files bring page-wide rules). Start rules with `svg`, name the classes, and use the inspector (or F12 on the
> real page) to see which rule wins.

---

## Part 3: The Menu bar module

### Experiment M1: two bars, two programs

1. On dev, open `http://192.168.0.47:8980/opennms/index.jsp` and then a plugin page (Plugins menu > your plugin).
   The bars look alike but are made by two programs:
   - the JSP pages (and the topology map) by `NavBarController`, from the template
     `jetty-webapps/opennms/WEB-INF/templates/navbar.ftl`;
   - the Vue pages (`/opennms/ui/#/...`, every plugin page) by `Menubar.vue`, compiled into
     `jetty-webapps/opennms/ui/assets/index-<hash>.js`.
2. In the studio, open **Menu bar**. The table *The Plugins menu* says what each file says now, for example *Tools* in
   navbar.ftl line 94 and in the bundle that `ui/index.html` loads, and *Plugins* in an older bundle that nothing loads.

docs/opennms-menu.md follows both programs step by step, and lists every word of the bar with the file it comes from.

### Experiment M2: find the words by hand first

```bash
podman exec onms-dev-core grep -n 'nav-plugin-top' /usr/share/opennms/jetty-webapps/opennms/WEB-INF/templates/navbar.ftl
podman exec onms-dev-core grep -o 'assets/index-[0-9a-zA-Z_-]*\.js' /usr/share/opennms/jetty-webapps/opennms/ui/index.html
podman exec onms-dev-core sh -c 'cd /usr/share/opennms/jetty-webapps/opennms/ui/assets && grep -l menubar-dropdown-button-dark *.js'
podman exec onms-dev-core sh -c "grep -o '.\{70\}menubar-dropdown-button-dark.\{60\}' /usr/share/opennms/jetty-webapps/opennms/ui/assets/index-*.js | grep '(\" '"
```

The last command shows the compiled button: `...{class:"menubar-dropdown-button-dark"}),{default:r(()=>[C(" Tools ")...`.
Vue turned the text of the template (`Plugins` on line 54 of Menubar.vue) into a call with the string `" Plugins "`.
That string is what the studio finds and changes: the only fixed text that a button of the bar starts with.

### Experiment M3: your word for the Plugins menu

1. Type your word, for example `Tools` (or `My Tools`). Both bars of the *Live preview* show it at once, highlighted.
2. The dev panel plans: `navbar.ftl` with a one-line diff, and each bundle that holds the compiled bar, with the text
   around the change (a bundle is one long line, so a line diff would show the whole file).
3. Apply to dev. The checks: the md5 sums, the web server serving the bundles with the new word, and *The JSP bar
   (/opennms/navBar.htm) says the new Plugins label* (the studio logs in with `DEV_USER`/`DEV_PASSWORD` of `kit/kit.env`).
4. Reload index.jsp (the template is read again within about 5 seconds) and the plugin page: both say your word.

> **What happened in OpenNMS.** Three or more files were written with `podman exec -i onms-dev-core sh -c '... cat > ...'`,
> the old ones kept in `backups/`. Nothing restarted: FreeMarker notices a changed template, and the browser loads
> the bundle again when the Vue page loads (a hard reload if your browser kept it).

**Check it by hand:** run the commands of M2 again.

### Experiment M4: a menu name from dispatcher-servlet.xml

1. In *Menu names from dispatcher-servlet.xml*, give `Maps` the name `Network Maps`. The preview shows it in both bars.
2. Apply to dev. The checks say: *The Vue bar (/opennms/api/v2/menu ...) has the new names*: yes; *The JSP bar shows new names
   after the next restart of OpenNMS*: not yet.
3. Open a Vue page: `Network Maps`. Open index.jsp: still `Maps`.
4. *Restart the development OpenNMS* (a few minutes; the command log shows `podman restart onms-dev-core` and the
   waiting). Reload index.jsp: `Network Maps`.

> **Why.** Both bars take these names from `WEB-INF/dispatcher-servlet.xml`, but at different times. The Vue bar asks
> `/opennms/api/v2/menu` (the REST API v2), and `MenuProvider.java` behind it reads the file at every request. The JSP
> bar uses Spring beans (`navBarEntries`), made once when OpenNMS starts. See it yourself:
>
> ```bash
> curl -s -u admin:admin http://localhost:8980/opennms/api/v2/menu | python3 -m json.tool | grep '"name"' | head
> ```

### Experiment M5: a word the studio does not change

Read *Words the studio does not change*. "Help" is written in `navbar.ftl` for the JSP bar, but the Vue bar gets it
from `MenuProvider.java`, compiled into `WEB-INF/lib/opennms-webapp-rest-*.jar`. Changing only navbar.ftl would make
the two bars disagree, the very problem the Plugins menu had. A change there needs the OpenNMS source and a build
(Part 6).

### Experiment M6: track your labels

Snapshot `Tools in both bars`. Make an experiment `german-labels`, set `Werkzeuge`, snapshot, and compare the two
snapshots: the diff of `menu/labels.json` is one line. Switch back to `main`.

---

## Part 4: Tracking your changes

| You want | In the studio | The same in a terminal (`cd workspace`) |
|---|---|---|
| see what changed since the last snapshot | History: *Changed since the last snapshot* and its diff | `git status`, `git diff HEAD` |
| keep a version | message + *Snapshot* | `git add -A && git commit -m "..."` |
| try an idea without losing the current one | *New experiment* | `git switch -c experiment/<name>` |
| go back to another line | *Switch* (snapshot your changes first) | `git switch <branch>` |
| see the difference of two versions | pick two, *Compare the two picked* | `git diff <older> <newer>` |
| take the files of an old version back | *Take its files back* (then snapshot) | `git restore --source=<snapshot> -- topology menu` |
| know what each OpenNMS got | History: *Applies*, each with the snapshot it applied | `cat ../backups/journal.jsonl` |
| take an apply back | the panel of that OpenNMS, on the page of that module: *Undo the last … apply* | the files of `../backups/<apply>/` |

Good habits: one experiment per idea; a message that says what you tried and why; apply to dev before production;
compare the snapshot of the last production apply with your current one before the next.

---

## Part 5: Production

### Step 5.1: before

Dev looks right on the real pages. The state lines on the Topology page say what production has (*has your CSS* or
*another version*). The production panels list what an apply would write.

### Step 5.2: apply

In the panel *Production*: *Apply to production…*, type `production`, confirm. Read the result: each file in the
container and its **overlay copy** (`/opt/maven-nms/data/overlays/jetty-webapps-overlay/opennms/...`), each with an md5
check. Reload production's pages (a new tab the first time a new svg file arrives).

> **What happened.** The same commands as for dev, through `ssh maven-admin@192.168.0.36 podman ...`, plus the
> overlay copies: the image copies its overlay folders into OpenNMS at every start of the container, so a file only
> in the container would be replaced by an older copy at the next start, or be lost in a new container. The studio
> writes the copy through the container's mount (`/opt/opennms-jetty-webapps-overlay/...`), so it needs no rights on
> the host folder. An etc file gets no overlay copy: production's `etc/` is the volume `opennms_data-config`, which
> keeps it.

**Check it by hand** (on the development machine):

```bash
ssh maven-admin@192.168.0.36 podman exec opennms md5sum /usr/share/opennms/jetty-webapps/opennms/WEB-INF/templates/navbar.ftl
ssh maven-admin@192.168.0.36 md5sum /opt/maven-nms/data/overlays/jetty-webapps-overlay/opennms/WEB-INF/templates/navbar.ftl
kit/topo.sh persist           # the topology kit's check of the style file: in the container and in the overlay folder
```

### Step 5.3: undo

*Undo the last menu apply on prod* (on the Menu bar page; the Topology page has its own), type `production`. The kept
files go back into the container and the overlay folders; copies the apply added are removed. Each click goes one apply
of that module further back.

### Step 5.4: before you upgrade OpenNMS (a new image)

Overlay copies of OpenNMS's own files replace the new version's files at every start. Before the upgrade, remove them
on production, then upgrade, then apply your labels again on the new version (its bundle has a new name):

```bash
ssh maven-admin@192.168.0.36
ls -R /opt/maven-nms/data/overlays/jetty-webapps-overlay/opennms/WEB-INF /opt/maven-nms/data/overlays/jetty-webapps-overlay/opennms/ui
rm /opt/maven-nms/data/overlays/jetty-webapps-overlay/opennms/WEB-INF/templates/navbar.ftl
rm /opt/maven-nms/data/overlays/jetty-webapps-overlay/opennms/WEB-INF/dispatcher-servlet.xml     # if you renamed menus
rm /opt/maven-nms/data/overlays/jetty-webapps-overlay/opennms/ui/assets/index-*.js
```

Your style file (`opennms/svg/zz-topology-styles.svg`) and icons stay: they are yours, not OpenNMS's.

---

## Part 6: Make it part of your source code

Applying keeps the changes in the running container and the overlay folders. For the source of production:

- **Topology.** `workspace/topology/topology.css` is the source; the file production needs is
  `opennms/svg/zz-topology-styles.svg` of the jetty-webapps overlay folder. `kit/topo.sh export` makes a folder with
  both, in the layout of the overlay folders, for your repository (kit/GUIDE-production-permanent.md).
- **Menu bar.** In the OpenNMS source your image is built from (33.1.8 line numbers):
  - `ui/src/components/Layout/Menubar.vue`, line 54: `Plugins` → your word;
  - `opennms-webapp/src/main/webapp/WEB-INF/templates/navbar.ftl`, line 94: `>Plugins</a>` → your word;
  - `opennms-webapp/src/main/webapp/WEB-INF/dispatcher-servlet.xml`: the `value` of `<property name="name" .../>`
    for menu names;
  - for Help and the other fixed words: `opennms-webapp-rest/src/main/java/org/opennms/web/rest/support/menu/MenuProvider.java`
    and navbar.ftl.

  Rebuild the `ui` module (`yarn build`, Maven module `org.opennms.ui`) and the webapp, build the image, and remove
  the overlay copies of these files (step 5.4).

---

## Part 7: Exercises

1. Make the labels of nodes with a critical alarm red and bold. *Hint:* `svg .vertex:has(> rect.status.critical) > text.vertex-label`.
2. Rename *Status* to *Health* in both bars on dev. Which check stays open after the apply, and what closes it?
3. Give two icons the same background with one rule. *Hint:* `svg .vertex:is(:has(use.upIcon[*|href="#a"]), :has(use.upIcon[*|href="#b"])) > rect.status.normal`.
4. Find by hand which bundle the Vue app loads and why the other one does not matter (Experiment M2).
5. Apply something to dev, undo it, and prove with `md5sum` that the file in the container is the old one again
   (the journal line has `md5Before`).
6. Explain to a colleague, with the command log, every command an apply to production ran.

---

## Part 8: When something is not as expected

The table in README.md, section 10, covers the studio. For OpenNMS pages:

| What you see | Why | What to do |
|---|---|---|
| dev's topology page ignores your CSS after an apply | the tab is older than the style file | a new tab (the list of svg files is made when the page is made) |
| the plugin page still says the old word | the browser kept the old bundle | reload with F12 > Network > Disable cache ticked |
| after a restart of dev the old words are back | dev's overlay folders (copies of production's) hold older copies | apply to dev again; `kit/dev.sh up` copies production's overlay folders after a production apply |
| the studio finds no label in a bundle | another OpenNMS version compiles the bar differently | Experiment M2's commands show the bundle's text; the studio leaves such a file alone |
| *Not a valid name* | labels are letters, digits, spaces and `. , : ; ! ? ( ) & / + ' -`, at most 40 | they go into a template, a JavaScript string and XML: other characters could break them |
