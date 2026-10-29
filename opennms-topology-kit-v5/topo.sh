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
#   ./topo.sh diff                  your changes since the pull
#   ./topo.sh revert [file]         drop your changes since the pull (all, or one file), and deploy to dev
#   ./topo.sh icons [dev|prod]      the icons in the svg files, and the icon each node gets
source "$(dirname "$0")/tools/common.sh"

WS=opennms                                       # the workspace: same paths as below /opt/opennms
BASE=.kit/baseline                               # the files as pulled, for diff and revert
SVG_DIR=jetty-webapps/opennms/svg
STYLE_CSS=styles/topology.css                    # your CSS for the topology page reaches it in
STYLE_PREFIX=zz-topology-styles                  # $SVG_DIR/zz-topology-styles.<hash>.svg (FILES.md, section 6)
THEME_DIR=system/org/opennms/features/topology/themes/org.opennms.features.topology.themes.default-theme
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
confirm() { [ "$1" = 1 ] || { read -rp "Go ahead? [y/N] " answer && [[ $answer == [yY] ]]; } || exit 1; }

# The CSS file inside an SVG: OpenNMS puts every svg of the folder into the topology page.
has_rules() { [ -f "$STYLE_CSS" ] && python3 -c 'import re, sys; sys.exit(0 if re.sub(r"/\*.*?\*/", "", open(sys.argv[1]).read(), flags=re.S).strip() else 1)' "$STYLE_CSS"; }
style_svg() {
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><!-- Made by topo.sh from %s. -->\n<style><![CDATA[\n' "$STYLE_CSS"
  sed 's/]]>/]]]]><![CDATA[>/g' "$STYLE_CSS"
  printf ']]></style></svg>\n'
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
  if [ -d "$WS" ] && [ "${FORCE:-}" != 1 ] && changes; then
    die "You changed files since the last pull (./topo.sh diff). Deploy them, or ./topo.sh revert, or: FORCE=1 ./topo.sh pull $from"
  fi
  check_target "$from"
  c=$(container_of "$from")
  home=$(home_of "$from")
  say "Copying the topology files from $(name_of "$from")"
  mkdir -p "$TMP/ws/etc" "$TMP/ws/jetty-webapps/opennms"
  # shellcheck disable=SC2016 # runs in the container
  mapfile -t files < <(tp "$from" exec "$c" sh -c 'cd "$1" && ls -1 etc/org.opennms.features.topology.app*.cfg etc/org.opennms.features.topology.app.icons.list 2>/dev/null' sh "$home")
  for f in "${files[@]}"; do tp "$from" cp "$c:$home/$f" - | tar -xf - -C "$TMP/ws/etc"; done
  tp "$from" cp "$c:$home/$SVG_DIR" - | tar -xf - -C "$TMP/ws/jetty-webapps/opennms"
  rm -f "$TMP/ws/$SVG_DIR/$STYLE_PREFIX".*.svg # made from styles/topology.css
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
  say "  opennms/: $(find "$WS/etc" -type f | wc -l) settings files and $(find "$WS/$SVG_DIR" -type f | wc -l) icon files$([ -s reference/topo_default-styles.css ] && echo '; reference/: the stock stylesheet')"
  [ "$from" = prod ] || return 0
  if running "$DEV_CONTAINER"; then deploy dev -q; else say "Start the development OpenNMS (./dev.sh up), then ./topo.sh deploy dev shows them there."; fi
}

deploy() {
  local to=${1:-} yes=0 quiet=0 a c home stage remote f sum style='' ts bk ovl_mounts='' plan files=() changed=() stale=() ovl_plan=()
  case $to in dev | prod) ;; *) die "usage: ./topo.sh deploy dev|prod [-y]" ;; esac
  shift
  for a in "$@"; do case $a in -y) yes=1 ;; -q) quiet=1 ;; esac; done
  [ -d "$WS" ] || die "There is nothing to deploy yet: ./topo.sh pull"
  check_target "$to"
  c=$(container_of "$to")
  home=$(home_of "$to")
  stage=$(mktemp -d -p "$TMP")
  cp -a "$WS/." "$stage/"
  rm -f "$stage/$SVG_DIR/$STYLE_PREFIX".*.svg
  if has_rules; then # the name changes with the content: no browser shows a cached old version
    style_svg >"$stage/style.svg"
    style="$SVG_DIR/$STYLE_PREFIX.$(md5sum <"$stage/style.svg" | cut -c1-10).svg"
    mv "$stage/style.svg" "$stage/$style"
  fi
  mapfile -t files < <(cd "$stage" && find . -type f | sed 's|^\./||' | sort)
  # What the container has: "<md5>  <file>" for these files, "- <file>" for each style file.
  # shellcheck disable=SC2016 # runs in the container
  remote=$(tp "$to" exec "$c" sh -c 'cd "$1" && shift && md5sum "$@" 2>/dev/null; ls -1 "$0".*.svg 2>/dev/null | sed "s/^/- /"; true' \
    "$SVG_DIR/$STYLE_PREFIX" "$home" "${files[@]}")
  for f in "${files[@]}"; do
    sum=$(cd "$stage" && md5sum "$f" | cut -d' ' -f1)
    [ "$(awk -v f="$f" '$1 != "-" && $2 == f { print $1; exit }' <<<"$remote")" = "$sum" ] || changed+=("$f")
  done
  mapfile -t stale < <(awk -v keep="$style" '$1 == "-" && $2 != keep { print $2 }' <<<"$remote")
  if [ ${#changed[@]} -eq 0 ] && [ ${#stale[@]} -eq 0 ]; then
    [ "$quiet" = 1 ] || say "Nothing to deploy: $(name_of "$to") has these files already."
    return 0
  fi

  if [ "$to" = prod ]; then # keep what production has now, for ./topo.sh undo
    ovl_mounts=$(overlay_mounts prod)
    if [ -n "$ovl_mounts" ]; then
      plan=$(overlay_plan "$ovl_mounts") || die "Could not read the overlay folders of $PROD_CONTAINER."
      [ -z "$plan" ] || mapfile -t ovl_plan <<<"$plan"
    fi
    say "Deploy to $(name_of prod):"
    [ ${#changed[@]} -eq 0 ] || printf '  %s\n' "${changed[@]}"
    [ ${#stale[@]} -eq 0 ] || printf '  remove %s\n' "${stale[@]}"
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
  printf '%s deployed to %s: %s\n' "$(date +%T)" "$(name_of "$to")" "${changed[*]}${stale[*]:+ (removed ${stale[*]})}"
  [ "$quiet" = 1 ] || say "Reload the topology page. After a changed icon .svg press Ctrl+Shift+R: the browser may keep its old copy."
}

undo() {
  local yes=0 bk c home f d line folder name files=() lines=()
  [ "${1:-}" != -y ] || yes=1
  bk=$(find backups -mindepth 1 -maxdepth 1 -type d ! -name '*.undone' 2>/dev/null | sort | tail -n 1)
  [ -n "$bk" ] || die "There is no production deploy to undo."
  check_target prod
  c=$PROD_CONTAINER
  home=$(home_of prod)
  mapfile -t files < <(cd "$bk" && find . -type f ! -path './.overlay/*' ! -name .added ! -name .overlay-added | sed 's|^\./||' | sort)
  say "Undo the deploy of ${bk#backups/} on $(name_of prod):"
  [ ${#files[@]} -eq 0 ] || printf '  put back %s\n' "${files[@]}"
  [ ! -f "$bk/.added" ] || sed 's/^/  remove   /' "$bk/.added"
  if [ -d "$bk/.overlay" ]; then
    (cd "$bk/.overlay" && find . -type f | sed 's|^\./|  put back in /opt/|') | sort
  fi
  [ ! -f "$bk/.overlay-added" ] || awk -F'\t' '{ print "  remove from " $1 ": " $2 }' "$bk/.overlay-added"
  confirm "$yes"
  [ ${#files[@]} -eq 0 ] || (cd "$bk" && tar -cf - "${files[@]}") | pp cp - "$c:$home"
  if [ -f "$bk/.added" ]; then # (a while-read loop would hand the list to ssh as its input)
    mapfile -t files <"$bk/.added"
    for f in "${files[@]}"; do pp exec "$c" rm -f "$home/$f" </dev/null; done
  fi
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

revert() {
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
}

case ${1:-} in
  pull) pull "${2:-prod}" ;;
  deploy) deploy "${@:2}" ;;
  undo) undo "${2:-}" ;;
  watch) watch ;;
  example) example "${2:-}" ;;
  diff)
    diff -ru "$BASE" "$WS" || true
    diff -u tools/topology.css.template "$STYLE_CSS" || true
    ;;
  revert) revert "${2:-}" ;;
  icons)
    case ${2:-dev} in
      dev) python3 tools/icons.py "http://localhost:$DEV_PORT/opennms" "$DEV_USER" "$DEV_PASSWORD" ;;
      prod) python3 tools/icons.py "$PROD_URL" "${PROD_USER:-}" "${PROD_PASSWORD:-}" ;;
      *) die "usage: ./topo.sh icons [dev|prod]" ;;
    esac
    ;;
  *)
    sed -n '2,14p' "$0"
    exit 2
    ;;
esac
