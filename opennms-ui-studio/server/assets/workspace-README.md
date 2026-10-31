# Your workspace

This folder holds your changes. The studio created it, and it is a git repository: every snapshot you make in
the studio (History > Snapshot) is a git commit here, and every apply to an OpenNMS records the snapshot it sent
(making one first if you changed something since the last), so you can always see what you changed, when, and what
each OpenNMS got (`../backups/journal.jsonl`).

| File | What it is | What it becomes in OpenNMS (below `/usr/share/opennms`, the home of OpenNMS in the container) |
|---|---|---|
| `topology/topology.css` | your CSS for the topology page | `jetty-webapps/opennms/svg/zz-topology-styles.svg`: the CSS inside an svg file, because OpenNMS puts every file of that folder into the topology page |
| `topology/icon-mappings.json` | which node gets which icon: `{"<namespace>.<node id>": "<icon id>"}` | lines between two comments of the studio in `etc/org.opennms.features.topology.app.icons.default.cfg` |
| `menu/labels.json` | your words for the menu bar: `plugins` (the Plugins menu) and `menuNames` (entries of dispatcher-servlet.xml, by id) | `jetty-webapps/opennms/WEB-INF/templates/navbar.ftl` (the bar of the JSP pages), `jetty-webapps/opennms/ui/assets/index-<hash>.js` (the bar of the Vue pages) and `jetty-webapps/opennms/WEB-INF/dispatcher-servlet.xml` |

You can edit these files with any editor too: the studio sees the change. `kit/topo.sh` (the topology kit) uses
`topology/topology.css` as its `styles/topology.css` (see `kit/kit.env`), so both tools work on the same file.

Plain git works here as well:

```bash
cd workspace
git log --oneline          # your snapshots
git diff HEAD              # what changed since the last snapshot
git branch                 # your experiments (experiment/...)
```
