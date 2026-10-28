# Merges the kit's icon mappings (first file) into an OpenNMS icon mapping file (second file).
#   awk -v prefix=das_ -f tools/merge-cfg.awk dist/icon-mapping.cfg current.cfg > new.cfg
# Drops every line whose key is in the kit file or whose icon id starts with the prefix (so
# mappings removed from the kit disappear too), keeps everything else, then appends the kit lines.
# Keys follow java.util.Properties: they end at the first unescaped '=', ':' or blank.

function parse(line,   i, n, c) {
  K = ""; V = ""
  sub(/^[ \t\f]+/, "", line)
  n = length(line)
  for (i = 1; i <= n; i++) {
    c = substr(line, i, 1)
    if (c == "\\") { K = K substr(line, i, 2); i++; continue }
    if (c == "=" || c == ":" || c == " " || c == "\t" || c == "\f") break
    K = K c
  }
  V = substr(line, i)
  sub(/^[ \t\f]*[=:]?[ \t\f]*/, "", V)
  sub(/[ \t\f\r]+$/, "", V)
}

BEGIN { header = "# DAS topology kit (deploy.sh): mappings to " prefix "* icons" }

FNR == NR {                              # the kit's mappings
  if ($0 ~ /^[ \t\f]*([#!]|$)/) next
  parse($0); kit[K] = 1; lines[++n] = K " = " V
  next
}

$0 == header { next }
/^[ \t\f]*([#!]|$)/ { print; next }      # comments and blank lines stay
{
  parse($0)
  if ((K in kit) || index(V, prefix) == 1) next
  print
}

END {
  if (n == 0) exit
  print header
  for (i = 1; i <= n; i++) print lines[i]
}
