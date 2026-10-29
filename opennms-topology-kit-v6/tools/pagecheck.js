(async () => {
  const out = [], say = s => out.push(s);
  let served = null; // the style file as the web server gives it now
  try {
    say('page check of the topology kit');
    say('page:    ' + location.href);
    say('browser: ' + navigator.userAgent);

    // 1. Which svg files this page asked for while it loaded (before this check asks for one itself).
    const seen = performance.getEntriesByType('resource').filter(e => /\/svg\/[^/?#]+\.svg/.test(e.name));
    const zz = seen.filter(e => /zz-topology-styles\.svg/.test(e.name));
    say('svg files this page asked for: ' + seen.length + '; zz-topology-styles.svg: ' +
      (zz.length ? 'asked for, status ' + (zz[0].responseStatus || 'not told by this browser') : 'not in the browser\'s list (the line "your CSS in the page" below is the sure one)'));

    // 2. What the web server gives this browser for the style file, asked now (through whatever stands in between).
    const base = location.href.replace(/^(https?:\/\/[^/]+\/[^/?#]+).*$/, '$1'); // for example http://192.168.0.36:8980/opennms
    const url = base + '/svg/zz-topology-styles.svg';
    try {
      const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
      const t = await r.text(), v = /topology\.css ([0-9a-f]{6})/.exec(t);
      if (r.ok) served = { text: t, label: v ? v[1] : '' };
      say('asked now for ' + url + ':');
      say('         ' + r.status + ' ' + (r.headers.get('content-type') || 'no type') + ', ' + new TextEncoder().encode(t).length +
        ' bytes, Cache-Control: ' + (r.headers.get('cache-control') || 'none') + (v ? ', label ' + v[1] : ''));
    } catch (e) { say('asked now for ' + url + ': failed (' + e + ')'); }

    // 3. Which svg files are in the page, and whether the CSS of the kit is one of them.
    const defs = document.getElementsByTagName('defs');
    say('svg files in the page (first <defs>): ' + (defs.length ? defs[0].querySelectorAll(':scope > svg').length : 'no <defs>'));
    let holder = null;
    const walk = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
    for (let c; (c = walk.nextNode());) if (/Made by topo\.sh/.test(c.data)) { holder = c.parentNode; break; }
    if (!defs.length) {
      say('your CSS in the page: cannot tell: this window has no <defs>, so it is not the topology page, or the page has not drawn its map yet');
      say('  Open ' + base + '/topology in a tab of its own, choose a view that shows nodes, and run this again.' +
        (document.querySelector('iframe') ? ' (This window holds an iframe: if the topology is inside it, choose that frame in the list at the top of the Console instead of "top".)' : ''));
    } else if (!holder) say('your CSS in the page: NO, the page did not take zz-topology-styles.svg in');
    else {
      const st = holder.querySelector('style'), sh = st && st.sheet;
      if (!sh) say('your CSS in the page: its <style> has no style sheet, the browser refused it (a Content-Security-Policy?)');
      else {
        let label = '', want = null;
        for (const r of sh.cssRules) { const v = /topology\.css ([0-9a-f]{6})/.exec(r.cssText); if (v) label = v[1]; }
        if (served) { // the rules of the file: its top-level { } blocks
          let depth = 0;
          want = 0;
          for (const ch of served.text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[|\]\]>|\/\*[\s\S]*?\*\//g, '')) {
            if (ch === '{') { if (depth === 0) want++; depth++; } else if (ch === '}') depth--;
          }
        }
        const have = sh.cssRules.length;
        say('your CSS in the page: yes, ' + have + ' rules understood' + (want === null ? '' : ' of ' + want + ' in the file') +
          (label ? ', label ' + label : ''));
        if (want !== null && have < want) say('  ! this browser dropped ' + (want - have) + ' rule(s) it does not know (a newer CSS feature?)');
        if (served && served.label && label && served.label !== label)
          say('  ! the page holds an older copy (label ' + label + ') than the server gives now (' + served.label + '): reload the page');
      }
    }

    // 4. What the nodes and links really look like now.
    const href = u => u && (u.getAttribute('href') || u.getAttributeNS('http://www.w3.org/1999/xlink', 'href'));
    const ups = [...document.querySelectorAll('g.vertex use.upIcon')], ids = {};
    ups.forEach(u => { const k = href(u) || '?'; ids[k] = (ids[k] || 0) + 1; });
    say('nodes on the page: ' + ups.length + (ups.length ? ' (icons ' + Object.entries(ids).map(([k, n]) => k + ' x' + n).join(', ') + ')' : ': open a view that shows nodes, then run this again'));
    const lab = document.querySelector('g.vertex text.vertex-label');
    if (lab) { const s = getComputedStyle(lab); say('first label: font-size ' + s.fontSize + ', font-weight ' + s.fontWeight + ', fill ' + s.fill); }
    const ic = document.querySelector('g.vertex g.icon-container');
    if (ic) say('first icon container: scale ' + (getComputedStyle(ic).scale || 'not known to this browser'));
    const ed = document.querySelector('path.edge');
    if (ed) { const s = getComputedStyle(ed); say('first link: class "' + ed.getAttribute('class') + '", stroke ' + s.stroke + ', stroke-width ' + s.strokeWidth); }
    const lb = getComputedStyle(document.body, '::after').content;
    if (lb && lb !== 'none' && lb !== 'normal') say('label at the bottom left: ' + lb);
  } catch (e) { say('the check stopped: ' + e); }
  console.log(out.join('\n'));
})();
