# The green behind the icons: one colour for all icons, another colour for each icon

Every node on the topology page sits on a green square when it has no alarm. This guide changes that colour: the same
new colour for all icons, or a colour of its own for each icon. You change one file on the development machine
(192.168.0.47), `styles/topology.css`, see the result in the browser, and then hot deploy it to production
(192.168.0.36). No svg file is touched. Run every command as user `admin`, in the kit folder:

```bash
cd ~/opennms-fundamentals/opennms-fundamentals/opennms-topology-kit-v6
```

Needs kit 3.10 (`./topo.sh example 13` must exist) and a browser that knows the CSS selector `:has()` (Chrome and Edge
105, Safari 15.4, Firefox 121, or newer).

## 1. What the green is

OpenNMS draws a square behind each icon: `<rect class="status normal">`. Its `fill` is the background (you see it
through the transparent parts of the icon, which is why it looks like a green background) and its `stroke` is the frame
around it. OpenNMS colours both by the worst alarm of the node:

| class | colour | meaning |
|---|---|---|
| `normal` | #336600 green | no alarm: **this is the green you want to change** |
| `cleared` | #999999 grey | |
| `indeterminate` | #999000 | |
| `warning` | #FFCC00 yellow | |
| `minor` | #FF9900 orange | |
| `major` | #FF3300 red-orange | |
| `critical` | #CC0000 red | |

The rules below name `.normal`, so only nodes without an alarm change colour. A node with an alarm keeps the colour of
its alarm. (Your own earlier rules in `styles/topology.css` may have changed some of these colours already.)

## 2. The quickest way: example 13

```bash
./topo.sh example 13
```

It looks at the views you pulled, finds the icons their nodes are drawn with, and writes this into `styles/topology.css`
(between `/* example: icon backgrounds */` and `/* end: icon backgrounds */`; your other rules stay):

```css
/* All icons: the green (normal) background becomes light grey with a thin frame. An alarm keeps its colour. */
svg .vertex > rect.status.normal { fill: #F1F3F5; stroke: #8A97A8; stroke-width: 3px; }
/* One icon: every node drawn with it. Your colour for it: change fill (background) and stroke (frame). */
svg .vertex:has(use.upIcon[*|href="#cirrus"]) > rect.status.normal { fill: #DCEBFA; stroke: #2E6AC7; } /* cirrus: blue */
svg .vertex:has(use.upIcon[*|href="#das_helix"]) > rect.status.normal { fill: #FFF1D6; stroke: #E08A00; } /* das_helix: amber */
svg .vertex:has(use.upIcon[*|href="#orion"]) > rect.status.normal { fill: #D8F1F5; stroke: #00838F; } /* orion: cyan */
```

(The icons in your file are the ones your views use; the colours come from the table in step 4, one after the other.)
Open **http://192.168.0.47:8980/opennms/topology**, choose the view, and reload the page: the green is gone. Change a
colour in the file, save, reload. With `./topo.sh watch` running in another window, every save goes to dev by itself.

Other icons, or only some: `ICONS="das_helix orion" ./topo.sh example 13` writes rules for exactly these icon ids.
To take the example out, delete the lines from `/* example: icon backgrounds */` to `/* end: icon backgrounds */`.

The rest of this guide explains each line, so that you can write your own.

## 3. All icons, one colour

```css
svg .vertex > rect.status.normal { fill: #F1F3F5; stroke: #8A97A8; stroke-width: 3px; }
```

| part | what it does |
|---|---|
| `svg .vertex > rect.status.normal` | the square behind every icon of a node without an alarm. It beats OpenNMS's own rule (`.vertex .status.normal`) because it names more |
| `fill` | the background |
| `stroke` | the frame colour |
| `stroke-width` | the frame thickness; OpenNMS draws 5px |

Colours are written `#RRGGBB` (any colour picker gives them) or by name (`white`, `lightyellow`). Other wishes, in the
same rule:

| You want | Write |
|---|---|
| no background and no frame | `fill: none; stroke: none;` |
| a white background and a dark frame | `fill: #FFFFFF; stroke: #1F3A5F;` |
| a background and no frame | `fill: #EEF4FF; stroke: none;` |
| another green | `fill: #2E7D32; stroke: #2E7D32;` |
| round corners | `rx: 8px;` |
| a dashed frame | `stroke-dasharray: 6 3;` |

## 4. Each icon its own colour

Add one rule for each icon, with the id of the icon in it:

```css
svg .vertex:has(use.upIcon[*|href="#das_helix"]) > rect.status.normal { fill: #FFF1D6; stroke: #E08A00; }
```

`svg .vertex:has(use.upIcon[*|href="#das_helix"])` is every node that is drawn with the icon `das_helix`. The rule wins
over the all-icons rule of step 3 whichever of the two comes first in the file (tested in a browser with both orders);
icons without a rule of their own keep the colour of step 3.

**Which icon ids do my nodes use?**

```bash
./topo.sh view show Maven-abc      # the icon each node is drawn with (column "icon drawn")
./topo.sh icons                    # every icon id there is, by svg file
./topo.sh pagecheck                # in the browser: "nodes on the page: 8 (icons #das_nimbus x4, #das_helix x2, ...)"
```

**A colour for two icons:** name both in one rule.

```css
svg .vertex:is(:has(use.upIcon[*|href="#orion"]), :has(use.upIcon[*|href="#cirrus"])) > rect.status.normal { fill: #DCEBFA; stroke: #2E6AC7; }
```

**Colours to choose from** (a light background and a darker frame of the same colour keep the icon easy to see; the
example takes them in this order):

| name | fill (background) | stroke (frame) |
|---|---|---|
| blue | #DCEBFA | #2E6AC7 |
| amber | #FFF1D6 | #E08A00 |
| purple | #EADFF7 | #7B3FC4 |
| rose | #FBDDE6 | #C2185B |
| cyan | #D8F1F5 | #00838F |
| sand | #F2E6D8 | #8D6E4B |
| indigo | #DDE0F7 | #3949AB |
| peach | #FDE2D4 | #D9480F |

A dark icon needs a light background, a white icon needs a dark one. The label under the icon is not part of the square.

## 5. Variations

**The colour of the icon in every state, with the alarm on the frame only.** Leave out `.normal` and set `fill` only:
the rule then holds in every state of the node, and the frame keeps the colour of the alarm.

```css
svg .vertex:has(use.upIcon[*|href="#das_helix"]) > rect.status { fill: #FFF1D6; }
```

Now the background of a helix node stays amber with a warning or a critical alarm, and its frame shows the alarm colour
(the frame is 5px thick unless you set `stroke-width`). The other icons keep OpenNMS's colours.

**Another colour for one state of every icon,** for example the yellow of a warning as a light background:

```css
svg .vertex > rect.status.warning { fill: #FFF3BF; }
```

The class names are in the table of step 1.

**A view without alarm colours.** A view whose layer has no vertex status provider (`status none` in the Layer line of
`./topo.sh view show <view>`) has no square at all: OpenNMS hides it. To show it anyway, write the rule for
`rect.status` (without `.normal`: those nodes have no status class) and add `opacity: 1;`.

## 6. Deploy to production

1. Look at dev first (reload the page; `./topo.sh pagecheck` prints, in the browser, the line
   `background by icon (the status class and the fill of each node's frame): #das_helix: normal rgb(255, 241, 214) | ...`
   so that you can see the colour each icon really has on the page).
2. `./topo.sh deploy prod` (answer `y`). Nothing restarts. Production's topology page shows it after a reload.
3. `./topo.sh css prod` should say that production has your latest `styles/topology.css`.
4. To keep it for good, so that it survives a restart and a new container: `GUIDE-production-permanent.md`.

## 7. When it does not change

| What you see | Why | What to do |
|---|---|---|
| the green stays | the page has not loaded the new file (`./topo.sh css dev` says whether dev has it) | reload; a new tab if it is the first time your CSS reaches that OpenNMS (step 6.1 of `GUIDE-Maven-abc-styles.md`) |
| every colour changed except one icon | the icon id in the rule is not the one the node uses | `./topo.sh pagecheck` lists the ids the page uses (`#das_nimbus x4, #das_helix x2`): the `href="#..."` of the rule must be one of them, letter for letter |
| nothing changes, `pagecheck` says "this browser dropped N rule(s)" | the browser does not know `:has()` | use a newer browser, or the all-icons rule of step 3, which does not need it |
| the frame is gone, not green | the node's view has no alarm colours | step 5, "A view without alarm colours" |
| the colour is right on dev and green on production | production does not have your latest CSS | `./topo.sh css prod`, then `./topo.sh deploy prod` (step 6.4 of `GUIDE-Maven-abc-styles.md`) |
| an alarm node is not the colour you wanted | `.normal` leaves alarms alone | step 5 gives the way to colour them |

## 8. Commands

| Command | What it does |
|---|---|
| `./topo.sh example 13` | writes the all-icons rule and one rule for each icon your views use into `styles/topology.css` |
| `ICONS="a b" ./topo.sh example 13` | the same for the icon ids you name |
| `./topo.sh view show <view>` | the icon each node is drawn with |
| `./topo.sh pagecheck` | in the browser console: the frame colour of the first node and the background of each icon |
| `./topo.sh watch` | deploy every save to dev |
| `./topo.sh deploy prod`, `./topo.sh css prod` | hot deploy to production; whether production has your latest CSS |
| `./topo.sh revert styles/topology.css` | start the CSS again from the template (your rules go to `styles/topology.css.<date>.bak`) |
