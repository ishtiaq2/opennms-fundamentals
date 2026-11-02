# How OpenNMS draws the menu bar

OpenNMS Horizon 33.1.8, read from its source (tag `opennms-33.1.8-1`; part 6 links every file named here). Paths in
the container are below OpenNMS's home, `/usr/share/opennms`. Line numbers are those of 33.1.8; your image is your
own build, so they can differ by a few lines.

The question this answers: you renamed "Plugins" to "Tools", index.jsp says "Tools", the plugin page says "Plugins".
Why, and which files decide each word of the bar?

## Part 1: One bar, two programs

The bar at the top looks the same on every page, but two different programs make it, at different times, from
different files:

| Pages | The bar is made by | From | It reads them |
|---|---|---|---|
| **JSP pages**: `index.jsp`, the node, alarm and admin pages, ..., and the topology map | the server: `NavBarController` fills the FreeMarker template `navbar.ftl` | `WEB-INF/templates/navbar.ftl`, and the menus of `WEB-INF/dispatcher-servlet.xml` | the template: again when it changed (FreeMarker looks every 5 seconds); the menus: once, when OpenNMS starts |
| **Vue pages**: `/opennms/ui/#/...`, which include every plugin page | the browser: `Menubar.vue`, compiled into `ui/assets/index-<hash>.js` | that bundle; the menus from `GET /opennms/api/v2/menu`; the plugin entries from `GET /opennms/rest/plugins` | at every page load (the bundle: unless the browser keeps its copy); `/api/v2/menu` reads `dispatcher-servlet.xml` at every request |

So a word can live in one place for both bars (the menus of `dispatcher-servlet.xml`), or in two places, one per bar
("Plugins": `navbar.ftl` and `Menubar.vue`). Change only one of two places and the bars disagree. That is what
happened to "Tools".

### 1.1 The JSP bar, step by step

1. The JSP pages include `includes/bootstrap.jsp` at their top, and its line 231 is
   `<jsp:include page="/navBar.htm" flush="false" />`.
2. `/navBar.htm` is a Spring bean in `WEB-INF/dispatcher-servlet.xml` (line 499): `id="headerProvider"`, class
   `NavBarController`, with the property `navBarItems` set to the bean `navBarEntries`, the list of top menus (line 324).
   Spring makes these beans when OpenNMS starts, from the file as it is then.
3. `NavBarController` loads templates from `WEB-INF/templates` (line 89 of the controller) and fills `navbar.ftl`
   (line 157) with the menus this user may see.
4. `navbar.ftl` writes the top menus in a loop, `${item.name}` (lines 45 to 90), then fixed parts: the Plugins menu
   (lines 93 to 95, the word on line 94), Help (99 to 115), the user menu (118 to 130), the icons at the right (156 to
   170). JavaScript at its end asks `rest/plugins` and fills the Plugins menu, which it shows only when there is a
   plugin (lines 285 to 313).
5. The topology map is a Vaadin page, not a JSP page, but shows the same bar: its `HeaderComponent` loads
   `/opennms/includes/bootstrap.jsp?nobreadcrumbs=true&superQuiet=true` into the page with jQuery
   (`header-component_connector.js`), and `bootstrap.jsp` includes `/navBar.htm` as above. (`NavBarController` is also
   offered to the rest of OpenNMS as the service `OnmsHeaderProvider`, `dispatcher-servlet.xml` lines 503 to 508.)

See it:

```bash
podman exec onms-dev-core sed -n 93,95p /usr/share/opennms/jetty-webapps/opennms/WEB-INF/templates/navbar.ftl
curl -s -u admin:admin http://localhost:8980/opennms/navBar.htm | grep -o 'nav-plugin-top[^<]*<'
```

### 1.2 The Vue bar, step by step

1. `/opennms/ui/` sends `ui/index.html`. It loads one script, `assets/index-<hash>.js`; the hash is new with every
   build of the ui.
2. That bundle is the whole compiled Vue app. `App.vue` puts `<Menubar />` at the top (line 4).
3. `Menubar.vue` asks `GET /opennms/api/v2/menu` (`services/menuService.ts`: `v2.get('menu')`, base address
   `/opennms/api/v2`) for the menus, and `GET /opennms/rest/plugins` (`services/pluginService.ts`) for the plugin entries.
4. `/api/v2/menu` is `MenuRestService` (package `org.opennms.web.rest.v2`, served by the servlet `cxfRest2Servlet` at
   `/api/v2/*`). It calls `MenuProvider.getMainMenu`, which opens `jetty-webapps/opennms/WEB-INF/dispatcher-servlet.xml`
   (the path is set in `applicationContext-cxf-rest-v2.xml`, line 34), reads the menu beans **at every request**, and
   adds Help, the user menu, Quick-Add Node, Flows Management and Configure OpenNMS from Java code.
5. The word "Plugins" is not data: it is text in the template of `Menubar.vue` (line 54), compiled into the bundle.

See it:

```bash
podman exec onms-dev-core grep -o 'assets/index-[0-9a-zA-Z_-]*\.js' /usr/share/opennms/jetty-webapps/opennms/ui/index.html
curl -s -u admin:admin http://localhost:8980/opennms/api/v2/menu | python3 -m json.tool | grep '"name"' | head
```

## Part 2: Every word of the bar, and where it comes from

| Word | JSP bar | Vue bar | To change it |
|---|---|---|---|
| Info, Status, Reports, Dashboards, Maps, and their entries (Nodes, Alarms, Topology, ...) | `dispatcher-servlet.xml`: beans of class `...NavBarEntry` in `navBarEntries`; Maps and Dashboards are beans of their own (`mapMenuEntries`, `dashboardMenuEntries`, lines 276 and 300) that the list refers to (`<ref bean="..."/>`, lines 475 and 477) | the same file, through `/api/v2/menu` | one file. The Vue bar shows it at the next page load, the JSP bar after a restart of OpenNMS. The studio: *Menu names* |
| Search | `dispatcher-servlet.xml`, like the others | `Menubar.vue` writes "Search" itself (line 17) and gives it the url of the menu named "Search" (lines 299 and 430), which it leaves out of its menus | keep it: under another name the Vue bar shows a second menu and its Search link leads nowhere. The studio keeps this name |
| **Plugins** | `navbar.ftl`, line 94 | `Menubar.vue`, line 54, compiled into `ui/assets/index-<hash>.js` | two files; both show it without a restart. The studio: *The Plugins menu* |
| the entries of the Plugins menu | `/rest/plugins`, by the JavaScript at the end of `navbar.ftl` | `/rest/plugins`, by `Menubar.vue` | each plugin names its own entry (the `menuEntry` of its UI extension) |
| Help, About, API Documentation, Support | `navbar.ftl`, lines 99 to 115 | `MenuProvider.java`, `getHelpMenuEntry` (lines 289 to 320), compiled into `WEB-INF/lib/opennms-webapp-rest-<version>.jar` | `navbar.ftl` and a build of `opennms-webapp-rest` |
| the user menu: Change Password, Log Out | `navbar.ftl`, lines 118 to 130 | `MenuProvider.java`, `getSelfServiceMenuEntry` (line 328) | as above |
| notices assigned to you, On-Call Schedule | `navbar.ftl` and its JavaScript | `Menubar.vue` line 153; `MenuProvider.java` line 375 | a build of the ui, and of `opennms-webapp-rest` |
| Quick-Add Node, Flow Management, Configure OpenNMS (the titles of the icons at the right) | `navbar.ftl`, lines 156 to 170 | `MenuProvider.java`, lines 385, 397, 408 | as above. They differ already: "Flow Management" in `navbar.ftl`, "Flows Management" in `MenuProvider.java` |

The JSP bar also puts each menu's name into the `name` attribute of its link (`name="nav-Maps-top"`), so a new name
changes that attribute too. Nothing in OpenNMS itself looks for it, but browser tests of the web UI may.

## Part 3: The compiled bar, and why the studio can change it

A Vue template is compiled to JavaScript. The button of the Plugins menu in `Menubar.vue`,

```html
<FeatherButton link href="#" v-bind="attrs" v-on="on" class="menubar-dropdown-button-dark">
  Plugins
  <FeatherIcon :icon="ArrowDropDown" />
</FeatherButton>
```

becomes, depending on the Vue version and on minification, one of these (from the test fixtures of the studio,
`server/test/fixtures/menubar-*.js`, which are `Menubar.vue` compiled four ways):

```js
{class:"menubar-dropdown-button-dark"}),{default:r(()=>[C(" Plugins "),f(e(y),{icon:e(U)},null,8,["icon"])]   // Vue 3.3, minified
_createTextVNode(" Plugins "),                                        // Vue 3.3, not minified
{class:"menubar-dropdown-button-dark"}),{default:r(()=>[s[5]||(s[5]=C(" Plugins ")),f(e(y),...                // Vue 3.5, minified
_cache[5] || (_cache[5] = _createTextVNode(" Plugins ")),             // Vue 3.5, not minified
```

(Some Vue versions add a number after the text, `C(" Plugins ",-1)`; the studio reads that form too.)

The text of the template is now a string, `" Plugins "`, and the whole app is one long line in `index-<hash>.js`.
All buttons of the bar have the class `menubar-dropdown-button-dark`; the Plugins button is the only one whose
content starts with fixed text (the others show a name from `/api/v2/menu`). So the studio looks for that class and
takes the first string literal after it that is the argument of a call: exactly one per bar. It replaces the words
inside the quotes and keeps the spaces around them, so the file stays valid JavaScript (a unit test compiles the bar
four ways and checks the result with `node --check`). A bundle in which it finds no such string, or more than one, it
leaves alone and says so.

**Why two bundles.** The assets folder can hold more than one file with the compiled bar, for example the bundle of
an earlier build that an overlay copy brought back. Only the one that `ui/index.html` names runs. The studio changes
every file that holds the bar, so that the word is right whichever one is used, and the Menu bar page says which one
`ui/index.html` loads.

**Why nothing restarts.** The bundle is a static file: the next page load gets it (a hard reload when the browser
kept its copy). `navbar.ftl` is read again by FreeMarker within about 5 seconds. Only the menus of
`dispatcher-servlet.xml` need a restart, and only for the JSP bar.

## Part 4: What the studio changes in the menu bar

| Your file (`workspace/menu/labels.json`) | The OpenNMS file | How | Shows |
|---|---|---|---|
| `"plugins": "Tools"` | `jetty-webapps/opennms/WEB-INF/templates/navbar.ftl` | the text of `<a name="nav-plugin-top" ...>`, HTML-encoded | JSP bar, within about 5 s |
| `"plugins": "Tools"` | `jetty-webapps/opennms/ui/assets/index-<hash>.js` (each file with the bar) | the string after `menubar-dropdown-button-dark` (part 3) | Vue bar, at the next page load |
| `"menuNames": {"maps.htm#1": "Network Maps"}` | `jetty-webapps/opennms/WEB-INF/dispatcher-servlet.xml` | the `value` of `<property name="name" .../>` of that bean, XML-encoded | Vue bar at the next page load; JSP bar after a restart |

A menu's id is its `url` and a count (`maps.htm#1`: the first entry with the url `maps.htm`), so it stays the same
while its name changes. Entries without a url count under the empty url (`##1`, `##2`). Labels may hold letters,
digits, spaces and `. , : ; ! ? ( ) & / + ' -`, at most 40: they go into a template, a JavaScript string and XML, and
other characters could break one of them.

After an apply the studio checks what the bars will show: the md5 sum of each file in the container (and of each
overlay copy on production), the web server sending each changed bundle, `/opennms/navBar.htm` saying the new word, and
`/opennms/api/v2/menu` having the new names. The last two need a login (`DEV_USER`/`DEV_PASSWORD`,
`PROD_USER`/`PROD_PASSWORD` in `kit/kit.env`); without one the check says "not checked".

**These are OpenNMS's own files.** On production the studio also writes them into the jetty-webapps overlay folder,
so that a restart keeps them. A new OpenNMS image brings new versions of these files (and a bundle with a new name); the
old overlay copies would replace the new `navbar.ftl` and `dispatcher-servlet.xml` at every start. Remove them before
an upgrade and apply your words again afterwards (GUIDE.md, step 5.4). The permanent way is in the source (part 5).

## Part 5: Changing it in the source

In the OpenNMS source your image is built from:

1. `ui/src/components/Layout/Menubar.vue`, line 54: `Plugins` → your word.
2. `opennms-webapp/src/main/webapp/WEB-INF/templates/navbar.ftl`, line 94: `>Plugins</a>` → your word.
3. For menu names: the `value` of `<property name="name" .../>` in
   `opennms-webapp/src/main/webapp/WEB-INF/dispatcher-servlet.xml`.
4. For Help and the other fixed words: `navbar.ftl` and
   `opennms-webapp-rest/src/main/java/org/opennms/web/rest/support/menu/MenuProvider.java`.

The ui is built with `yarn build` in `ui/` (`vue-tsc --noEmit && vite build --base=/opennms/ui/`), packaged by Maven as
the artifact `org.opennms.ui`, and unpacked by `opennms-webapp/pom.xml` into the webapp's `ui/` folder; then build
the webapp and the image, and remove the overlay copies of these files.

Later versions: on the develop branch of OpenNMS (2026) the menu moved to a JSON file,
`opennms-webapp-rest/src/main/webapp/WEB-INF/menu/menu-template.json`, and `navbar.ftl` and `Menubar.vue` are gone.
The studio is written for 33.1.8 and finds the files by what they contain; on a version without them it finds nothing
and changes nothing.

## Part 6: Sources

All at https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/ followed by the path.

| File | What to read in it |
|---|---|
| [`opennms-webapp/src/main/webapp/includes/bootstrap.jsp`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/opennms-webapp/src/main/webapp/includes/bootstrap.jsp) | line 231: the JSP pages include `/navBar.htm` |
| [`core/web-assets/src/main/assets/js/vaadin/header-component_connector.js`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/core/web-assets/src/main/assets/js/vaadin/header-component_connector.js) | the Vaadin pages (the topology map) load `bootstrap.jsp` for their header |
| [`opennms-webapp/src/main/java/org/opennms/web/controller/NavBarController.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/opennms-webapp/src/main/java/org/opennms/web/controller/NavBarController.java) | the FreeMarker configuration (lines 87 to 90), `getTemplate("navbar.ftl")` (line 157) |
| [`opennms-webapp/src/main/webapp/WEB-INF/templates/navbar.ftl`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/opennms-webapp/src/main/webapp/WEB-INF/templates/navbar.ftl) | the menus loop (45 to 90), Plugins (93 to 95), Help (99), the JavaScript for `rest/plugins` (285 to 313) |
| [`opennms-webapp/src/main/webapp/WEB-INF/dispatcher-servlet.xml`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/opennms-webapp/src/main/webapp/WEB-INF/dispatcher-servlet.xml) | `mapMenuEntries` (276), `dashboardMenuEntries` (300), `navBarEntries` (324), the controller (499), the header service (503) |
| [`opennms-webapp-rest/src/main/java/org/opennms/web/rest/support/menu/MenuProvider.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/opennms-webapp-rest/src/main/java/org/opennms/web/rest/support/menu/MenuProvider.java) | its comment (lines 47 to 63); `getMainMenu` reads the file (118 to 129); the fixed words (289 to 410) |
| [`opennms-webapp-rest/src/main/java/org/opennms/web/rest/v2/MenuRestService.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v2/MenuRestService.java) | `@Path("menu")` in the v2 API |
| [`opennms-webapp-rest/src/main/webapp/WEB-INF/applicationContext-cxf-rest-v2.xml`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/opennms-webapp-rest/src/main/webapp/WEB-INF/applicationContext-cxf-rest-v2.xml) | lines 32 to 38: the path of `dispatcher-servlet.xml` that MenuProvider opens |
| [`opennms-webapp-rest/src/main/webapp/WEB-INF/web.xml`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/opennms-webapp-rest/src/main/webapp/WEB-INF/web.xml) | lines 85 to 92: `/rest/*` and `/api/v2/*` |
| [`ui/src/App.vue`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/ui/src/App.vue) | line 4: `<Menubar />` |
| [`ui/src/components/Layout/Menubar.vue`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/ui/src/components/Layout/Menubar.vue) | Search (17, 299, 430), the Plugins menu (49 to 70, the word on 54) |
| [`ui/src/services/menuService.ts`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/ui/src/services/menuService.ts), [`axiosInstances.ts`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/ui/src/services/axiosInstances.ts), [`pluginService.ts`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/ui/src/services/pluginService.ts) | where the Vue bar gets its data |
| [`ui/package.json`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/ui/package.json) | line 7: the build |
