# Changes

## 1.1.0: icon files that hide their own colours (the nimbus case)

A rule for the parts of an icon (`#nimbus_default .cls-1 { fill: red !important; }`) was applied and the nodes did not
change. The cause was not the rule: `nimbus.svg` keeps its three looks (`nimbus_default`, `nimbus_rollover`,
`nimbus_active`) inside one group called `nimbus`, OpenNMS draws that whole group for every node, and the look that
comes last in the file lies on top of the others. The studio now finds this itself and says it in words.

New, on the Topology page:

- **Icon files** (under the preview): every svg file of the OpenNMS you preview, the icons it holds, and what is wrong
  with the way each is built. *Make a repaired copy in the workspace* writes `workspace/topology/icons/<name>.svg`:
  the file with two ids renamed and nothing else. The preview draws the copy; *Apply* sends it like the CSS (backup,
  md5 check, a check that the web server sends it, overlay copy on production); *Undo* puts the old file back; *Remove
  my copy* deletes the copy from the workspace. Files that are not well-formed XML are listed as skipped.
- **What your rules reach in this preview** (under the editor): for every selector of your CSS the elements it
  matches, the shapes of icons among them, the nodes that show those shapes, and whether a later shape with the same
  outline covers them (it names the drawing that is on top). A selector that matches nothing says so. It opens by itself
  when a rule has a problem.
- **The parts of the icon you clicked**, a new entry in the list of snippets: one rule for each class of the drawing a
  node shows, with the colour it has now (for a file that stacks its looks, the rules of the layer on top).
- The inspector of a node warns when its icon comes from a flawed file, and links to the box.
- Apply and Undo handle your copies of icon files. The result of an apply has a check for each:
  `OpenNMS serves svg/<name> (your copy)`.

New files: `server/src/util/iconcheck.ts` (the check and the repair), `web/src/lib/iconRules.ts` (the words of the
panel and the snippet), `CHANGES.md`. New API routes: `GET /api/topology/icons`, `POST /api/topology/icons/repair`,
`POST /api/topology/icons/remove` (docs/how-the-studio-works.md, section 6). `GET /api/status` also returns the version.

Smaller changes: a very long line of a diff (a whole svg file on one line) is cut in the plan; the notice for files of
OpenNMS itself says "your changes" instead of "your labels"; 7 new unit tests (21 in all).

Documentation: GUIDE.md has Experiment T8 (the nimbus case, step by step), a new exercise and three rows in the
troubleshooting table; docs/opennms-topology.md has part 4.1 (what an icon file must look like, with pixel counts of
each experiment) and the new files in part 5; docs/how-the-studio-works.md has the new routes and folder.

Upgrade from 1.0.0: README.md, section 2 ("Updating from 1.0.0 to 1.1.0"). No package changed, so `npm install` is not
needed; `npm run build` and a restart of the studio are. Your workspace, history and backups are not touched.

What was not tested: a real OpenNMS. The check and the repair were tested on the `nimbus.svg` you sent, in a
browser that draws it the way OpenNMS does (the file whole in `<defs>`, a node is a `<use>`), and the studio on stand-ins
of the development and production OpenNMS (the containers, ssh, the overlay folders); the first thing to look at after
an apply is the topology page of dev in a new tab.

## 1.0.0

The first version: the Topology module (CSS editor and preview, icon mappings, apply to dev and production, undo), the
Menu bar module (the word for the Plugins menu and the menu names), History (snapshots and experiments as git
commits), the topology kit (`kit/`), README.md, GUIDE.md and docs/.
