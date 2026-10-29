#!/usr/bin/env bash
# The OpenNMS files that draw and style /opennms/topology (FILES.md says which file does what):
# copy them from production, change them, see each change in the development OpenNMS, then hot
# deploy them to production. Nothing restarts.
#
#   ./topo.sh pull [prod|dev]       copy the topology files of production (or dev) into opennms/, and onto dev
#   ./topo.sh watch                 deploy every save in opennms/ and styles/ to dev
#   ./topo.sh deploy dev|prod [-y]  copy what changed into the running container
#   ./topo.sh undo [-y]             put back the production files the last deploy replaced
#   ./topo.sh example [N]           list the examples, or apply example N to opennms/ and dev
#   ./topo.sh diff                  your changes since the last pull or production deploy
#   ./topo.sh revert [file]         drop those changes (all, or one file), and deploy to dev
#   ./topo.sh icons [dev|prod]      the icons in the svg files, and the icon each node gets
#   ./topo.sh css [dev|prod]        the svg files, style rules that clash, and whether styles/topology.css is there
#   ./topo.sh css <file.svg | icon id>  CSS for the parts of one icon, to copy into styles/topology.css
#   ./topo.sh view [list [dev|prod]]          the GraphML views there: entries of the View menu
#   ./topo.sh view show <name> [dev|prod]     a view's nodes: id, label, icon key, the icon drawn
#   ./topo.sh view icon <name> <node id> <icon id>   another icon for one node of a view (--reset: the view's own)
#   ./topo.sh view add <file.graphml> [name]  a GraphML file becomes a view in opennms/ and on dev
#   ./topo.sh view remove <name> [dev|prod]   takes a view out of opennms/ and away there
source "$(dirname "$0")/tools/common.sh"

WS=opennms                                       # the workspace: same paths as below /opt/opennms
BASE=.kit/baseline                               # production's files as of the last pull or deploy: diff, revert, deploy
SVG_DIR=jetty-webapps/opennms/svg
STYLE_CSS=styles/topology.css                    # your CSS for the topology page reaches it in
STYLE_PREFIX=zz-topology-styles                  # kit 3.6 and older: $SVG_DIR/zz-topology-styles.<hash>.svg
STYLE_SVG=$SVG_DIR/$STYLE_PREFIX.svg             # styles/topology.css in the page, always this name (FILES.md, section 6)
THEME_DIR=system/org/opennms/features/topology/themes/org.opennms.features.topology.themes.default-theme
VIEW_CFG=etc/org.opennms.features.topology.plugins.topo.graphml # -<name>.cfg puts etc/graphml/<name>.xml in the View menu
GRAPH_CFG=etc/org.opennms.netmgt.graph.provider.graphml         # -<name>.cfg: the same view for rest/api/v2/graphs
DEMO_VIEW=das-demo                                              # the demo view of ./dev.sh: not pulled, not deployed
ICON_CFG=etc/org.opennms.features.topology.app.icons.default.cfg # where ./topo.sh view icon writes: "<namespace>.<node id> = <icon id>"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

tp() { local t=$1; shift; if [ "$t" = prod ]; then pp "$@"; else p "$@"; fi; } # podman where that OpenNMS runs
container_of() { if [ "$1" = prod ]; then say "$PROD_CONTAINER"; else say "$DEV_CONTAINER"; fi; }
name_of() { if [ "$1" = prod ]; then say "$PROD_CONTAINER on $PROD_SSH"; else say "the development OpenNMS"; fi; }
check_target() {
  [ "$1" != prod ] || need_prod
  [ "$(tp "$1" container inspect -f '{{.State.Running}}' "$(container_of "$1")" 2>/dev/null)" = true ] && return 0
  if [ "$1" = prod ]; then die "Container $PROD_CONTAINER on $PROD_SSH is not running (podman ps there)."; fi
  die "The development OpenNMS is not running: ./dev.sh up"
}
home_of() { tp "$1" exec "$(container_of "$1")" readlink -f /opt/opennms; } # /usr/share/opennms in the stock image
# The overlay folders of the container that live outside of it (tools/overlay.py): "<folder><TAB><host path>".
overlay_mounts() {
  tp "$1" container inspect -f '{{range .Mounts}}{{if ne (len .Name) 64}}{{.Destination}}{{"\t"}}{{.Source}}{{"\n"}}{{end}}{{end}}' "$(container_of "$1")" |
    awk -F'\t' '$1 == "/opt/opennms-overlay" || $1 == "/opt/opennms-etc-overlay" || $1 == "/opt/opennms-jetty-webapps-overlay"'
}
etc_kept() { # does the container keep OpenNMS's etc/ outside of itself, in a named volume or a folder?
  local mounts
  mounts=$(tp "$1" container inspect -f '{{range .Mounts}}{{if ne (len .Name) 64}}{{.Destination}}{{"\n"}}{{end}}{{end}}' "$(container_of "$1")")
  grep -qxE '/opt/opennms/etc|/usr/share/opennms/etc' <<<"$mounts"
}
changes() { ! diff -rq "$BASE" "$WS" >/dev/null 2>&1; } # in opennms/ (pull leaves styles/ alone)
# .kit/baseline holds production's version of each pulled file as of the last pull, production deploy, undo or view
# removal: a second deploy, diff, revert and pull compare with that.
base_put() { # base_put <folder with the files> <file>...: production has these files now
  local from=$1 f
  shift
  [ -d "$BASE" ] || return 0
  for f in "$@"; do
    case $f in "$SVG_DIR/$STYLE_PREFIX"*.svg) continue ;; esac # made from styles/topology.css: not a pulled file
    [ -f "$WS/$f" ] || [ -f "$BASE/$f" ] || continue
    mkdir -p "$BASE/${f%/*}"
    cp -a "$from/$f" "$BASE/$f"
  done
}
base_drop() { local f; for f in "$@"; do rm -f "$BASE/$f"; done; } # production does not have these files now
confirm() { [ "$1" = 1 ] || { read -rp "Go ahead? [y/N] " answer && [[ $answer == [yY] ]]; } || exit 1; }
there() { awk -v f="$1" '$1 != "-" && $2 == f { found = 1 } END { exit !found }' <<<"$remote"; } # in deploy(): the container has it

# The CSS file inside an SVG: OpenNMS puts every svg of the folder into the topology page.
css_body() { python3 -c 'import re, sys; sys.stdout.write(re.sub(r"\A\s*/\*.*?\*/[ \t]*\n?", "", open(sys.argv[1]).read(), flags=re.S))' "$1"; }
has_rules() { [ -f "$STYLE_CSS" ] && python3 -c 'import re, sys; sys.exit(0 if re.sub(r"/\*.*?\*/", "", open(sys.argv[1]).read(), flags=re.S).strip() else 1)' "$STYLE_CSS"; }
style_svg() {
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><!-- Made by topo.sh from %s. -->\n<style><![CDATA[\n' "$STYLE_CSS"
  sed 's/]]>/]]]]><![CDATA[>/g' "$STYLE_CSS"
  printf ']]></style></svg>\n'
}

# GraphML views (FILES.md, section 5): etc/graphml/<name>.xml, and two cfg files with its place. OpenNMS loads a view
# when its cfg file appears, and ignores later changes ("Updating is not supported"): a changed view must go away
# for a moment and come back. view_unload takes the cfg files of these views out; the next copy brings them back.
views_of() { # the names of the views that these files belong to
  printf '%s\n' "$@" | sed -nE 's#^etc/graphml/(.+)\.xml$#\1#p; s#^etc/org\.opennms\.(features\.topology\.plugins\.topo|netmgt\.graph\.provider)\.graphml-(.+)\.cfg$#\2#p' | sort -u
}
views_loaded() { # views_loaded <dev|prod> <names...>: those whose cfg file the container has
  local to=$1 v cfgs=()
  shift
  for v in "$@"; do cfgs+=("$VIEW_CFG-$v.cfg"); done
  [ ${#cfgs[@]} -gt 0 ] || return 0
  # shellcheck disable=SC2016 # runs in the container
  tp "$to" exec "$(container_of "$to")" sh -c 'cd "$1" && shift && ls -1 "$@" 2>/dev/null; true' sh "$(home_of "$to")" "${cfgs[@]}" </dev/null |
    sed -nE 's#^.*\.graphml-(.+)\.cfg$#\1#p'
}
view_unload() { # view_unload <dev|prod> <names...>
  local to=$1 c home v
  shift
  [ $# -gt 0 ] || return 0
  c=$(container_of "$to")
  home=$(home_of "$to")
  for v in "$@"; do tp "$to" exec "$c" rm -f "$home/$VIEW_CFG-$v.cfg" "$home/$GRAPH_CFG-$v.cfg" </dev/null; done
  sleep 5 # Karaf looks at etc/ every few seconds; it has to see them gone
}

# Production keeps files in overlay folders that the image copies into OpenNMS at every start (tools/overlay.py).
# These functions use the variables of deploy(): c, stage, bk, changed, stale, files.
overlay_plan() { # the lines tools/overlay.py makes from what the overlay folders hold now
  local folders=() folder src
  while IFS=$'\t' read -r folder src; do folders+=("$folder"); done <<<"$1"
  {
    while IFS=$'\t' read -r folder src; do printf 'mounted\t%s\t%s\n' "$folder" "$src"; done <<<"$1"
    # shellcheck disable=SC2016 # runs in the container
    pp exec "$c" sh -c 'for m in "$@"; do (cd "$m" && find . -type f | while IFS= read -r f; do printf "file\t%s\t%s\n" "$m" "$f"; done); done' sh "${folders[@]}" </dev/null
    if etc_kept prod; then printf 'kept\tetc\n'; fi
    printf 'changed\t%s\n' "${changed[@]}"
    printf 'removed\t%s\n' "${stale[@]}"
    printf 'all\t%s\n' "${files[@]}"
  } | python3 tools/overlay.py
}
overlay_show() { # the plan, for the person who confirms it
  printf '%s\n' "${ovl_plan[@]}" | sort -s -t$'\t' -k2,2 | awk -F'\t' '
    $1 == "skip" { skipped = skipped " " $4; next }
    $2 != last { printf "  in the overlay folder %s (host: %s), which the image copies into OpenNMS at every start:\n", $2, $5; last = $2 }
    { printf "    %-8s %s\n", $1, $3 }
    END { if (skipped != "") printf "  in no overlay folder, so a new container starts without:%s\n", skipped }'
}
overlay_backup() { # backups/<ts>/.overlay/<folder>/<name> holds what the folder had; .overlay-added lists new files
  local line action folder name
  for line in "${ovl_plan[@]}"; do
    IFS=$'\t' read -r action folder name _ <<<"$line"
    case $action in
      replace | remove)
        mkdir -p "$bk/.overlay/${folder##*/}/$(dirname "$name")"
        pp cp "$c:$folder/$name" - </dev/null | tar -xf - -C "$bk/.overlay/${folder##*/}/$(dirname "$name")" ;;
      add) printf '%s\t%s\n' "$folder" "$name" >>"$bk/.overlay-added" ;;
    esac
  done
}
overlay_write() { # the staged files into the folders, as the plan says
  local line action folder name file out="$TMP/overlay" d
  mkdir -p "$out"
  for line in "${ovl_plan[@]}"; do
    IFS=$'\t' read -r action folder name file _ <<<"$line"
    case $action in
      replace | add)
        mkdir -p "$out/${folder##*/}/$(dirname "$name")"
        cp "$stage/$file" "$out/${folder##*/}/$name" || return 1 ;;
      remove) pp exec "$c" rm -f "$folder/$name" </dev/null || return 1 ;;
    esac
  done
  for d in "$out"/*/; do
    [ -d "$d" ] || continue
    (cd "$d" && tar -cf - .) | pp cp - "$c:/opt/$(basename "$d")" || return 1
  done
}

pull() {
  local from=${1:-prod} c home f files jar
  case $from in dev | prod) ;; *) die "usage: ./topo.sh pull [prod|dev]" ;; esac
  check_target "$from"
  c=$(container_of "$from")
  home=$(home_of "$from")
  # Your changes since the last pull must not get lost: those that the source has already (deployed) are fine.
  if [ -d "$WS" ] && [ "${FORCE:-}" != 1 ] && changes; then
    mapfile -t files < <(cd "$WS" && find . -type f | sed 's|^\./||' | while IFS= read -r f; do cmp -s "$f" "../$BASE/$f" || echo "$f"; done)
    if [ ${#files[@]} -gt 0 ]; then
      # shellcheck disable=SC2016 # runs in the container
      mapfile -t files < <(cd "$WS" && md5sum "${files[@]}" | diff - <(tp "$from" exec "$c" sh -c 'cd "$1" && shift && md5sum "$@" 2>/dev/null; true' sh "$home" "${files[@]}") |
        sed -n 's/^< [0-9a-f]*  //p')
    fi
    [ ${#files[@]} -eq 0 ] || die "These files have changes that $(name_of "$from") does not have (./topo.sh diff):
$(printf '  %s\n' "${files[@]}")
Deploy them, or ./topo.sh revert, or drop them: FORCE=1 ./topo.sh pull $from"
  fi
  say "Copying the topology files from $(name_of "$from")"
  mkdir -p "$TMP/ws/etc" "$TMP/ws/jetty-webapps/opennms"
  # shellcheck disable=SC2016 # runs in the container
  mapfile -t files < <(tp "$from" exec "$c" sh -c 'cd "$1" && ls -1 etc/org.opennms.features.topology.app*.cfg etc/org.opennms.features.topology.app.icons.list 2>/dev/null' sh "$home")
  for f in "${files[@]}"; do tp "$from" cp "$c:$home/$f" - | tar -xf - -C "$TMP/ws/etc"; done
  tp "$from" cp "$c:$home/$SVG_DIR" - | tar -xf - -C "$TMP/ws/jetty-webapps/opennms"
  rm -f "$TMP/ws/$SVG_DIR/$STYLE_PREFIX"*.svg # made from styles/topology.css
  # GraphML views: their files and cfg files. The demo view of ./dev.sh stays out.
  # shellcheck disable=SC2016 # runs in the container
  mapfile -t files < <(tp "$from" exec "$c" sh -c 'cd "$1" && ls -1 etc/graphml/*.xml etc/org.opennms.features.topology.plugins.topo.graphml-*.cfg etc/org.opennms.netmgt.graph.provider.graphml-*.cfg 2>/dev/null; true' sh "$home" |
    grep -v -e "^etc/graphml/$DEMO_VIEW\.xml\$" -e "graphml-$DEMO_VIEW\.cfg\$" || true)
  for f in "${files[@]}"; do
    mkdir -p "$TMP/ws/${f%/*}"
    tp "$from" cp "$c:$home/$f" - | tar -xf - -C "$TMP/ws/${f%/*}"
  done
  # The stock topology stylesheet, from the theme jar: for reading (FILES.md, section 6).
  # shellcheck disable=SC2016 # runs in the container
  jar=$(tp "$from" exec "$c" sh -c 'ls -1 "$1"/*/*.jar 2>/dev/null | tail -n 1' sh "$home/$THEME_DIR") || jar=''
  if [ -n "$jar" ] && tp "$from" cp "$c:$jar" - | tar -xf - -C "$TMP"; then
    mkdir -p reference
    python3 -c 'import sys, zipfile
sys.stdout.write("/* Stock OpenNMS topology stylesheet, VAADIN/themes/topo_default/styles.css in\n   " + sys.argv[2] + "\n   For reading: override rules in styles/topology.css (FILES.md, section 6). */\n")
sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read("VAADIN/themes/topo_default/styles.css").decode())' \
      "$TMP/$(basename "$jar")" "$jar" >reference/topo_default-styles.css || warn "  (could not read the theme jar $jar)"
  fi
  rm -rf "$WS" "$BASE"
  mkdir -p .kit styles
  mv "$TMP/ws" "$WS"
  cp -a "$WS" "$BASE"
  [ -f "$STYLE_CSS" ] || cp tools/topology.css.template "$STYLE_CSS"
  say "  opennms/: $(find "$WS/etc" -maxdepth 1 -type f | wc -l) settings files, $(find "$WS/$SVG_DIR" -type f | wc -l) icon files, GraphML views: $(find "$WS/etc/graphml" -name '*.xml' 2>/dev/null | wc -l)$([ -s reference/topo_default-styles.css ] && echo '; reference/: the stock stylesheet')"
  [ "$from" = prod ] || return 0
  if running "$DEV_CONTAINER"; then deploy dev -q; else say "Start the development OpenNMS (./dev.sh up), then ./topo.sh deploy dev shows them there."; fi
}

deploy() {
  local to=${1:-} yes=0 quiet=0 a c home stage remote f v sum base_sum style='' ts bk ovl_mounts='' plan files=() changed=() stale=() ovl_plan=() names=() reload=() mine=() theirs=() both=() svg_new=() svg_old=()
  case $to in dev | prod) ;; *) die "usage: ./topo.sh deploy dev|prod [-y]" ;; esac
  shift
  for a in "$@"; do case $a in -y) yes=1 ;; -q) quiet=1 ;; esac; done
  [ -d "$WS" ] || die "There is nothing to deploy yet: ./topo.sh pull"
  check_target "$to"
  c=$(container_of "$to")
  home=$(home_of "$to")
  stage=$(mktemp -d -p "$TMP")
  cp -a "$WS/." "$stage/"
  rm -f "$stage/$SVG_DIR/$STYLE_PREFIX"*.svg
  # styles/topology.css reaches the page as $STYLE_SVG, always under that name: an open topology page keeps the list of
  # svg files it had when it opened, also on reload (FILES.md, section 6). Dev always has the file; production gets it
  # with the first rules and keeps it from then on, without rules if you take them all out.
  if has_rules || [ "$to" = dev ]; then style_svg >"$stage/$STYLE_SVG" && style=$STYLE_SVG; fi
  mapfile -t files < <(cd "$stage" && find . -type f | sed 's|^\./||' | sort)
  # What the container has: "<md5>  <file>" for these files and the style file, "- <file>" for each style file.
  # shellcheck disable=SC2016 # runs in the container
  remote=$(tp "$to" exec "$c" sh -c 'cd "$1" && shift && md5sum "$@" 2>/dev/null; ls -1 "$0"*.svg 2>/dev/null | sed "s/^/- /"; true' \
    "$SVG_DIR/$STYLE_PREFIX" "$home" "${files[@]}" "$STYLE_SVG")
  if [ -z "$style" ] && there "$STYLE_SVG"; then # keep it: open pages list it
    style_svg >"$stage/$STYLE_SVG" && style=$STYLE_SVG && files+=("$STYLE_SVG")
  fi
  for f in "${files[@]}"; do
    sum=$(cd "$stage" && md5sum "$f" | cut -d' ' -f1)
    [ "$(awk -v f="$f" '$1 != "-" && $2 == f { print $1; exit }' <<<"$remote")" = "$sum" ] || changed+=("$f")
  done
  mapfile -t stale < <(awk -v keep="$style" '$1 == "-" && $2 != keep { print $2 }' <<<"$remote")
  # Production may change a file after your last pull or deploy: its own software writes GraphML views, someone uses
  # Change Icon. A production deploy sends your changes only. A file you left as it was stays as production has it
  # now; a file that both of you changed is held back (FORCE=1 sends it anyway). .kit/baseline tells which is which.
  if [ "$to" = prod ] && [ "${FORCE:-}" != 1 ] && [ -d "$BASE" ]; then
    for f in "${changed[@]}"; do
      if [ ! -f "$BASE/$f" ]; then mine+=("$f"); continue; fi # a file you added
      base_sum=$(md5sum <"$BASE/$f" | cut -c 1-32)
      sum=$(awk -v f="$f" '$1 != "-" && $2 == f { print $1; exit }' <<<"$remote")
      if [ "$sum" = "$base_sum" ]; then mine+=("$f")          # production has it as it was: yours goes
      elif cmp -s "$BASE/$f" "$stage/$f"; then theirs+=("$f") # you did not change it, production did
      else both+=("$f"); fi
    done
    changed=("${mine[@]}")
    if [ ${#theirs[@]} -gt 0 ]; then
      warn "Production changed (or removed) these files after your last pull or deploy. They stay as production has them; ./topo.sh pull copies them here:"
      printf '  %s\n' "${theirs[@]}" >&2
    fi
    if [ ${#both[@]} -gt 0 ]; then
      warn "You and production both changed these files after your last pull or deploy, so they are held back. Compare (./topo.sh diff;"
      warn "./topo.sh view show <name> prod for a view), then send yours with FORCE=1 ./topo.sh deploy prod:"
      printf '  %s\n' "${both[@]}" >&2
    fi
  fi
  for f in "${changed[@]}"; do # a new svg file reaches an open page only in a new tab; a changed one, past the cache
    case $f in "$SVG_DIR"/*.svg) if there "$f"; then svg_old+=("${f##*/}"); else svg_new+=("${f##*/}"); fi ;; esac
  done
  if [ ${#changed[@]} -eq 0 ] && [ ${#stale[@]} -eq 0 ]; then
    if [ ${#theirs[@]} -gt 0 ] || [ ${#both[@]} -gt 0 ]; then say "Nothing else to deploy."
    elif [ "$quiet" != 1 ]; then say "Nothing to deploy: $(name_of "$to") has these files already."; fi
    return 0
  fi
  # A changed GraphML view that is loaded there is loaded anew: its cfg files go away for a moment (view_unload) and
  # come back with this deploy, also when only the .xml changed.
  mapfile -t names < <(views_of "${changed[@]}")
  mapfile -t reload < <(views_loaded "$to" "${names[@]}")
  for v in "${reload[@]}"; do
    for f in "$VIEW_CFG-$v.cfg" "$GRAPH_CFG-$v.cfg"; do
      if [ ! -f "$stage/$f" ]; then # not in opennms/: the container's copy comes back
        { tp "$to" cp "$c:$home/$f" - </dev/null 2>/dev/null | tar -xf - -C "$stage/etc"; } 2>/dev/null || continue
        remote+=$'\n'"there  $f"
      fi
      [[ " ${changed[*]} " == *" $f "* ]] || changed+=("$f")
    done
  done

  if [ "$to" = prod ]; then # keep what production has now, for ./topo.sh undo
    ovl_mounts=$(overlay_mounts prod)
    if [ -n "$ovl_mounts" ]; then
      plan=$(overlay_plan "$ovl_mounts") || die "Could not read the overlay folders of $PROD_CONTAINER."
      [ -z "$plan" ] || mapfile -t ovl_plan <<<"$plan"
    fi
    say "Deploy to $(name_of prod):"
    [ ${#changed[@]} -eq 0 ] || printf '  %s\n' "${changed[@]}"
    [ ${#stale[@]} -eq 0 ] || printf '  remove %s\n' "${stale[@]}"
    [ ${#reload[@]} -eq 0 ] || say "  GraphML views loaded anew (out of the View menu for about 5 seconds): ${reload[*]}"
    [ ${#ovl_plan[@]} -eq 0 ] || overlay_show
    confirm "$yes"
    ts=$(date +%Y%m%d-%H%M%S)
    bk="backups/$ts"
    mkdir -p "$bk"
    for f in "${changed[@]}" "${stale[@]}"; do
      if awk -v f="$f" '$2 == f { found = 1 } END { exit !found }' <<<"$remote"; then
        mkdir -p "$bk/$(dirname "$f")"
        pp cp "$c:$home/$f" - | tar -xf - -C "$bk/$(dirname "$f")"
      else
        echo "$f" >>"$bk/.added" # undo removes it
      fi
    done
    [ ${#ovl_plan[@]} -eq 0 ] || overlay_backup
  fi
  view_unload "$to" "${reload[@]}"
  if [ ${#changed[@]} -gt 0 ]; then
    (cd "$stage" && tar -cf - "${changed[@]}") | tp "$to" cp - "$c:$home"
  fi
  for f in "${stale[@]}"; do tp "$to" exec "$c" rm -f "$home/$f" </dev/null; done
  # The overlay folders are copied into OpenNMS at every start: they keep the files after a restart.
  if [ ${#ovl_plan[@]} -gt 0 ]; then overlay_write || warn "  (the overlay folders could not be updated: a restart of $PROD_CONTAINER would bring the old files back)"; fi
  for f in "${changed[@]}"; do
    case $f in
      "$SVG_DIR"/*) tp "$to" exec "$c" curl -fsS -o /dev/null "http://localhost:8980/opennms/svg/${f##*/}" 2>/dev/null ||
        warn "  OpenNMS does not serve /opennms/svg/${f##*/} (still starting?)" ;;
    esac
  done
  if [ "$to" = prod ]; then base_put "$stage" "${changed[@]}"; fi # production has them now: the baseline follows
  printf '%s deployed to %s: %s\n' "$(date +%T)" "$(name_of "$to")" "${changed[*]}${stale[*]:+ (removed ${stale[*]})}"
  [ ${#reload[@]} -eq 0 ] || say "  GraphML views loaded anew: ${reload[*]}"
  if [ ${#svg_new[@]} -gt 0 ]; then
    say "  New there: ${svg_new[*]}. Open the topology page in a new browser tab: a tab reads the list of svg files"
    say "  when it opens the page and keeps it on reload, so an open tab never loads a new svg file (FILES.md, section 6)."
  fi
  if [ ${#svg_old[@]} -gt 0 ] && [ "$quiet" = 1 ]; then
    say "  (reload with the browser cache off: F12 > Network > Disable cache; svg files stay cached for an hour)"
  elif [ ${#svg_old[@]} -gt 0 ]; then
    say "Reload the topology page with the browser cache off: open DevTools (F12) > Network, tick Disable cache, keep"
    say "DevTools open. The browser keeps svg files for an hour, and Ctrl+Shift+R does not load them again."
  fi
  [ "$quiet" = 1 ] || [ ${#svg_old[@]} -gt 0 ] || [ ${#svg_new[@]} -gt 0 ] || say "Reload the topology page."
}

undo() {
  local yes=0 bk c home f d line folder name files=() lines=() added=() names=() reload=()
  [ "${1:-}" != -y ] || yes=1
  bk=$(find backups -mindepth 1 -maxdepth 1 -type d ! -name '*.undone' 2>/dev/null | sort | tail -n 1)
  [ -n "$bk" ] || die "There is no production deploy to undo."
  check_target prod
  c=$PROD_CONTAINER
  home=$(home_of prod)
  mapfile -t files < <(cd "$bk" && find . -type f ! -path './.overlay/*' ! -name .added ! -name .overlay-added | sed 's|^\./||' | sort)
  [ ! -f "$bk/.added" ] || mapfile -t added <"$bk/.added"
  mapfile -t names < <(views_of "${files[@]}" "${added[@]}")
  mapfile -t reload < <(views_loaded prod "${names[@]}")
  say "Undo the deploy of ${bk#backups/} on $(name_of prod):"
  [ ${#files[@]} -eq 0 ] || printf '  put back %s\n' "${files[@]}"
  [ ! -f "$bk/.added" ] || sed 's/^/  remove   /' "$bk/.added"
  if [ -d "$bk/.overlay" ]; then
    (cd "$bk/.overlay" && find . -type f | sed 's|^\./|  put back in /opt/|') | sort
  fi
  [ ! -f "$bk/.overlay-added" ] || awk -F'\t' '{ print "  remove from " $1 ": " $2 }' "$bk/.overlay-added"
  [ ${#reload[@]} -eq 0 ] || say "  GraphML views loaded anew: ${reload[*]}"
  confirm "$yes"
  view_unload prod "${reload[@]}"
  [ ${#files[@]} -eq 0 ] || (cd "$bk" && tar -cf - "${files[@]}") | pp cp - "$c:$home"
  for f in "${added[@]}"; do pp exec "$c" rm -f "$home/$f" </dev/null; done # (not while-read: ssh would eat the list)
  for d in "$bk"/.overlay/*/; do # the overlay folders as they were
    [ -d "$d" ] || continue
    (cd "$d" && find . -type f | sed 's|^\./||' | tar -cf - -T -) | pp cp - "$c:/opt/$(basename "$d")"
  done
  if [ -f "$bk/.overlay-added" ]; then
    mapfile -t lines <"$bk/.overlay-added"
    for line in "${lines[@]}"; do
      IFS=$'\t' read -r folder name <<<"$line"
      pp exec "$c" rm -f "$folder/$name" </dev/null
    done
  fi
  base_put "$bk" "${files[@]}" # production has the old files again: the baseline follows
  base_drop "${added[@]}"
  mv "$bk" "$bk.undone"
  say "Done. opennms/ still has your version; reload the topology page."
}

watch() {
  local last='' now
  check_target dev
  [ -d "$WS" ] || die "./topo.sh pull first."
  say "Deploying every save in opennms/ and styles/ to the development OpenNMS. Ctrl+C stops."
  while :; do
    now=$(find "$WS" "$STYLE_CSS" -type f -printf '%p %s %T@\n' 2>/dev/null | sort | md5sum)
    if [ "$now" != "$last" ]; then
      bash ./topo.sh deploy dev -q || warn "  (that deploy failed; the next save tries again)"
      last=$now
    fi
    sleep 1
  done
}

example() {
  local f
  if [ -z "${1:-}" ]; then
    for f in examples/[0-9]*.sh; do
      printf '  %s  %s\n' "$(basename "$f" | cut -c1-2)" "$(sed -n 's/^# Example: //p' "$f")"
    done
    say "./topo.sh example <N> applies one to opennms/ or styles/ and deploys it to dev; ./topo.sh revert undoes it."
    return 0
  fi
  [[ $1 =~ ^[0-9]+$ ]] || die "usage: ./topo.sh example [N]"
  f=$(find examples -maxdepth 1 -name "$(printf '%02d' "$((10#$1))")-*.sh" | head -n 1)
  [ -n "$f" ] || die "There is no example $1 (./topo.sh example lists them)."
  [ -d "$WS" ] || die "./topo.sh pull first."
  check_target dev
  say "Example $(sed -n 's/^# Example: //p' "$f")"
  bash "$f"
  deploy dev -q
  sed -n 's/^# Look: /Look: /p' "$f"
}

# --- GraphML views: entries of the View menu (FILES.md, section 5) -----------------------------------------

view_list() {
  local to=${1:-dev} c home lines name label file
  case $to in dev | prod) ;; *) die "usage: ./topo.sh view list [dev|prod]" ;; esac
  check_target "$to"
  c=$(container_of "$to")
  home=$(home_of "$to")
  # shellcheck disable=SC2016 # runs in the container
  lines=$(tp "$to" exec "$c" sh -c 'cd "$1" && for f in etc/org.opennms.features.topology.plugins.topo.graphml-*.cfg; do
      [ -f "$f" ] || continue; n=${f#*.graphml-}
      printf "%s\t%s\t%s\n" "${n%.cfg}" "$(sed -n "s/^label *= *//p" "$f")" "$(sed -n "s/^topologyLocation *= *//p" "$f")"; done' sh "$home" </dev/null)
  say "GraphML views in $(name_of "$to"): name, the label of the View menu, the file"
  [ -n "$lines" ] || { say "  none"; return 0; }
  while IFS=$'\t' read -r name label file; do
    label=$(sed -E 's/\\(.)/\1/g' <<<"$label") # the cfg file is a Java properties file: "\:" is ":"
    file=${file#"$home"/}
    printf '  %-18s "%s"\n  %-18s %s%s\n' "$name" "$label" '' "${file#/opt/opennms/}" \
      "$([ ! -f "$WS/etc/graphml/$name.xml" ] || echo '   (also in opennms/)')"
  done <<<"$lines"
}

view_show() { # the nodes of a view: id, label, icon key, the icon drawn (tools/graphml.py show)
  local name=$1 to=${2:-} file="$WS/etc/graphml/$1.xml" c home
  [ -d "$WS" ] || die "./topo.sh pull first."
  if [ -n "$to" ] || [ ! -f "$file" ]; then # not in opennms/, or asked for: the container's copy
    to=${to:-dev}
    case $to in dev | prod) ;; *) die "usage: ./topo.sh view show <name> [dev|prod]" ;; esac
    check_target "$to"
    c=$(container_of "$to")
    home=$(home_of "$to")
    file="$TMP/$name.xml"
    tp "$to" cp "$c:$home/etc/graphml/$name.xml" - 2>/dev/null | tar -xOf - >"$file" 2>/dev/null ||
      die "$(name_of "$to") has no view $name (./topo.sh view list $to)."
    say "View $name in $(name_of "$to"), with the icon mappings of opennms/etc:"
  else
    say "View $name in opennms/etc/graphml/$name.xml, with the icon mappings of opennms/etc:"
  fi
  python3 tools/graphml.py show "$file" "$WS/$SVG_DIR" "$WS/etc"
}

view_icon() { # another icon for one node of a view: a line in the icon mapping file, with the view's own namespace
  local name=$1 node=$2 icon=$3 file="$WS/etc/graphml/$1.xml"
  [ -d "$WS" ] || die "./topo.sh pull first."
  [ -f "$file" ] || die "There is no opennms/etc/graphml/$name.xml (./topo.sh view list; ./topo.sh pull copies the views of production)."
  [ -f "$WS/$ICON_CFG" ] || die "There is no opennms/$ICON_CFG (./topo.sh pull)."
  check_target dev
  say "View $name:"
  python3 tools/graphml.py icon "$file" "$WS/$ICON_CFG" "$WS/$SVG_DIR" "$node" "$icon" || die "Nothing changed."
  deploy dev -q
  say "Reload the topology page. ./topo.sh view show $name shows the icons now; ./topo.sh deploy prod takes them to production."
}

view_add() {
  local file=$1 name=${2:-} home label f others=()
  [ -f "$file" ] || die "There is no file $file."
  [ -d "$WS" ] || die "./topo.sh pull first: a view goes into opennms/ like the other topology files."
  [ -n "$name" ] || name=$(basename "$file")
  name=${name%.graphml}
  name=${name%.xml}
  [[ $name =~ ^[A-Za-z0-9._-]+$ ]] || die "A view name may hold letters, digits, dots, dashes and underscores: $name"
  [ "$name" != "$DEMO_VIEW" ] || die "$DEMO_VIEW is the demo view of ./dev.sh; give yours another name."
  check_target dev
  home=$(home_of dev)
  say "View $name, from $file:"
  python3 tools/graphml.py prepare "$file" "$TMP/$name.xml" "$WS/$SVG_DIR"
  # The other views, in opennms/ and on dev (such as the demo): namespaces must be unique.
  for f in "$WS"/etc/graphml/*.xml; do [ ! -f "$f" ] || [ "$f" = "$WS/etc/graphml/$name.xml" ] || others+=("$f"); done
  mkdir -p "$TMP/dev-views"
  { p cp "$DEV_CONTAINER:$home/etc/graphml" - 2>/dev/null | tar -xf - -C "$TMP/dev-views"; } 2>/dev/null || true
  for f in "$TMP"/dev-views/graphml/*.xml; do
    [ ! -f "$f" ] || [ -f "$WS/etc/graphml/${f##*/}" ] || [ "${f##*/}" = "$name.xml" ] || others+=("$f")
  done
  python3 tools/graphml.py check "$TMP/$name.xml" "$WS/$SVG_DIR" "${others[@]}" || die "Nothing changed. Fix $file, then try again."
  label=$(python3 tools/graphml.py label "$TMP/$name.xml" "$name")
  mkdir -p "$WS/etc/graphml"
  mv "$TMP/$name.xml" "$WS/etc/graphml/$name.xml"
  printf '# Puts etc/graphml/%s.xml into the View menu of the topology page (./topo.sh view, FILES.md section 5).\ntopologyLocation = %s\nlabel = %s\n' \
    "$name" "$home/etc/graphml/$name.xml" "$label" >"$WS/$VIEW_CFG-$name.cfg"
  printf '# The same view for the Graph API (rest/api/v2/graphs).\ngraphLocation = %s\nlabel = %s\n' \
    "$home/etc/graphml/$name.xml" "$label" >"$WS/$GRAPH_CFG-$name.cfg"
  say "  opennms/etc/graphml/$name.xml, ${VIEW_CFG#etc/}-$name.cfg, ${GRAPH_CFG#etc/}-$name.cfg"
  deploy dev -q
  say "Reload the topology page: View lists \"$label\"."
  say "Change opennms/etc/graphml/$name.xml, then ./topo.sh deploy dev; ./topo.sh deploy prod takes it to production."
}

view_remove() {
  local name=$1 to=${2:-dev} c home f ts bk ovl_mounts='' plan present=() names=() changed=() stale=() files=() ovl_plan=()
  case $to in dev | prod) ;; *) die "usage: ./topo.sh view remove <name> [dev|prod]" ;; esac
  [ "$to" = dev ] || [ ! -f "$WS/etc/graphml/$name.xml" ] || say "opennms/ keeps view $name, so a later ./topo.sh deploy prod brings it back."
  check_target "$to"
  c=$(container_of "$to")
  home=$(home_of "$to")
  names=("$VIEW_CFG-$name.cfg" "$GRAPH_CFG-$name.cfg" "etc/graphml/$name.xml")
  # shellcheck disable=SC2016 # runs in the container
  mapfile -t present < <(tp "$to" exec "$c" sh -c 'cd "$1" && shift && ls -1 "$@" 2>/dev/null; true' sh "$home" "${names[@]}" </dev/null)
  if [ ${#present[@]} -eq 0 ]; then
    say "$(name_of "$to") has no view $name (./topo.sh view list $to)."
  else
    if [ "$to" = prod ]; then # the same care as a deploy: confirm, backups/ for ./topo.sh undo, the overlay folders
      stale=("${present[@]}")
      ovl_mounts=$(overlay_mounts prod)
      if [ -n "$ovl_mounts" ]; then
        plan=$(overlay_plan "$ovl_mounts") || die "Could not read the overlay folders of $PROD_CONTAINER."
        [ -z "$plan" ] || mapfile -t ovl_plan <<<"$plan"
      fi
      say "Remove view $name from $(name_of prod):"
      printf '  remove %s\n' "${present[@]}"
      [ ${#ovl_plan[@]} -eq 0 ] || overlay_show
      confirm 0
      ts=$(date +%Y%m%d-%H%M%S)
      bk="backups/$ts"
      for f in "${present[@]}"; do
        mkdir -p "$bk/${f%/*}"
        pp cp "$c:$home/$f" - </dev/null | tar -xf - -C "$bk/${f%/*}"
      done
      [ ${#ovl_plan[@]} -eq 0 ] || overlay_backup
    fi
    view_unload "$to" "$name" # out of the View menu first
    tp "$to" exec "$c" rm -f "$home/etc/graphml/$name.xml" </dev/null
    if [ ${#ovl_plan[@]} -gt 0 ]; then overlay_write || warn "  (the overlay folders could not be updated: a restart of $PROD_CONTAINER would bring the view back)"; fi
    if [ "$to" = prod ]; then base_drop "${present[@]}"; fi
    say "$(date +%T) removed view $name from $(name_of "$to"). Reload the topology page."
  fi
  if [ "$to" = dev ] && [ -f "$WS/etc/graphml/$name.xml" ]; then
    rm -f "$WS/etc/graphml/$name.xml" "$WS/$VIEW_CFG-$name.cfg" "$WS/$GRAPH_CFG-$name.cfg"
    say "It is out of opennms/ too. If production has it: ./topo.sh view remove $name prod"
  fi
}

view() {
  case ${1:-list} in
    list) view_list "${2:-dev}" ;;
    show) [ -n "${2:-}" ] || die "usage: ./topo.sh view show <name> [dev|prod]"; view_show "$2" "${3:-}" ;;
    icon) [ -n "${4:-}" ] || die "usage: ./topo.sh view icon <name> <node id> <icon id | --reset>"; view_icon "$2" "$3" "$4" ;;
    add) [ -n "${2:-}" ] || die "usage: ./topo.sh view add <file.graphml> [name]"; view_add "$2" "${3:-}" ;;
    remove) [ -n "${2:-}" ] || die "usage: ./topo.sh view remove <name> [dev|prod]"; view_remove "$2" "${3:-dev}" ;;
    *) die "usage: ./topo.sh view [list [dev|prod] | show <name> [dev|prod] | icon <name> <node id> <icon id> | add <file.graphml> [name] | remove <name> [dev|prod]]" ;;
  esac
}

# ./topo.sh css [dev|prod]: the svg files and their style rules, and whether that OpenNMS has styles/topology.css.
css_status() {
  local to=$1 c home url n there_now mine sum old
  [ -d "$WS" ] || die "./topo.sh pull first."
  python3 tools/svgcss.py overview "$WS/$SVG_DIR"
  n=$(python3 tools/svgcss.py count "$STYLE_CSS")
  say ""
  say "$STYLE_CSS has $n rule(s). The topology page gets them from $STYLE_SVG:"
  if [ "$to" = prod ]; then url=$PROD_URL; else url="http://$(host_address):$DEV_PORT/opennms"; fi
  if [ "$to" = dev ] && ! running "$DEV_CONTAINER"; then
    say "  the development OpenNMS is not running (./dev.sh up)."
    return 0
  fi
  check_target "$to"
  c=$(container_of "$to")
  home=$(home_of "$to")
  # shellcheck disable=SC2016 # runs in the container
  there_now=$(tp "$to" exec "$c" sh -c 'cd "$1" && md5sum "$2" 2>/dev/null; ls -1 "$3"*.svg 2>/dev/null; true' sh "$home" "$STYLE_SVG" "$SVG_DIR/$STYLE_PREFIX")
  sum=$(awk 'NF == 2 { print $1; exit }' <<<"$there_now")
  mine=$(style_svg | md5sum | cut -c1-32)
  if [ -z "$sum" ]; then say "  $(name_of "$to") does not have it yet: ./topo.sh deploy $to"
  elif [ "$sum" = "$mine" ]; then say "  $(name_of "$to") has it, as in $STYLE_CSS: $url/svg/${STYLE_SVG##*/}"
  else say "  $(name_of "$to") has an older version: ./topo.sh deploy $to"; fi
  old=$(grep -v -x -e "$STYLE_SVG" -e '' <<<"$(awk 'NF == 1' <<<"$there_now")" | sed 's|.*/||' | tr '\n' ' ' || true)
  [ -z "$old" ] || say "  It also has $old(the hashed names of kit 3.6 and older): the next ./topo.sh deploy $to removes them."
  say "To see it: a browser tab keeps the list of svg files it got when it opened the topology page, so after the first"
  say "deploy of ${STYLE_SVG##*/} open the page in a new tab once. The browser keeps svg files for an hour (OpenNMS"
  say "sends Cache-Control: max-age=3600) and Ctrl+Shift+R is not enough: reload with DevTools (F12) open and Network >"
  say "Disable cache ticked. FILES.md, section 6, and step 6 of GUIDE-Maven-abc-styles.md say more."
}

revert() {
  local f v gone=()
  if [ -z "${1:-}" ]; then # views added since the pull leave dev too
    for f in "$WS"/etc/graphml/*.xml; do [ ! -f "$f" ] || [ -f "$BASE/etc/graphml/${f##*/}" ] || gone+=("$(basename "$f" .xml)"); done
  fi
  if [ -n "${1:-}" ]; then
    local rel=${1#"$WS"/}
    if [ "$rel" = "$STYLE_CSS" ]; then
      cp tools/topology.css.template "$STYLE_CSS"
    else
      [ -f "$BASE/$rel" ] || die "$1 is not one of the pulled files."
      cp -a "$BASE/$rel" "$WS/$rel"
    fi
  else
    rm -rf "$WS" && cp -a "$BASE" "$WS" && cp tools/topology.css.template "$STYLE_CSS"
  fi
  say "Reverted. Deploying to dev:"
  deploy dev
  for v in "${gone[@]}"; do view_remove "$v" dev; done
}

case ${1:-} in
  pull) pull "${2:-prod}" ;;
  deploy) deploy "${@:2}" ;;
  undo) undo "${2:-}" ;;
  watch) watch ;;
  example) example "${2:-}" ;;
  diff)
    diff -ru "$BASE" "$WS" || true
    # styles/topology.css against the kit's template, without the comment at the top (it changes between kit versions)
    if [ -f "$STYLE_CSS" ]; then
      diff -u --label "$STYLE_CSS (the kit's template)" --label "$STYLE_CSS" <(css_body tools/topology.css.template) <(css_body "$STYLE_CSS") || true
    fi
    ;;
  css)
    case ${2:-dev} in
      dev | prod) css_status "${2:-dev}" ;;
      *)
        [ -d "$WS" ] || die "./topo.sh pull first."
        python3 tools/svgcss.py rules "$WS/$SVG_DIR" "$2" "http://$(host_address):$DEV_PORT/opennms" "$PROD_URL"
        ;;
    esac
    ;;
  revert) revert "${2:-}" ;;
  view) view "${@:2}" ;;
  icons)
    case ${2:-dev} in
      dev) python3 tools/icons.py "http://localhost:$DEV_PORT/opennms" "$DEV_USER" "$DEV_PASSWORD" ;;
      prod) python3 tools/icons.py "$PROD_URL" "${PROD_USER:-}" "${PROD_PASSWORD:-}" ;;
      *) die "usage: ./topo.sh icons [dev|prod]" ;;
    esac
    ;;
  *)
    sed -n '2,20p' "$0"
    exit 2
    ;;
esac
