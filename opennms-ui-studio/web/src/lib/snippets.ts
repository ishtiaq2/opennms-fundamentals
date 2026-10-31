// Rules to start from, for the CSS editor of the topology module (the same rules as the kit's examples 07-13).
// "{icon}" becomes the icon of the node you clicked in the preview.
export interface Snippet {
  name: string
  css: string
}

export const SNIPPETS: Snippet[] = [
  {
    name: 'All icons: another background instead of the green',
    css: `/* All icons: the green (normal) background becomes light grey with a thin frame. An alarm keeps its colour. */
svg .vertex > rect.status.normal { fill: #F1F3F5; stroke: #8A97A8; stroke-width: 3px; }
`,
  },
  {
    name: 'One icon: a background of its own',
    css: `/* Every node drawn with the icon {icon}: its own background (fill) and frame (stroke). */
svg .vertex:has(use.upIcon[*|href="#{icon}"]) > rect.status.normal { fill: #FFF1D6; stroke: #E08A00; }
`,
  },
  {
    name: 'No background, no frame',
    css: `svg .vertex > rect.status.normal { fill: none; stroke: none; }
`,
  },
  {
    name: 'One icon: its colour in every alarm state (the alarm on the frame only)',
    css: `svg .vertex:has(use.upIcon[*|href="#{icon}"]) > rect.status { fill: #DCEBFA; }
`,
  },
  {
    name: 'Bigger icons (72 px instead of 48 px)',
    css: `/* scale works around the centre of the node; the frame and the mouse target grow with the icon */
svg .vertex .icon-container, svg .vertex > rect.status, svg .vertex > rect.svgIconOverlay { scale: 1.5; }
svg .vertex > text.vertex-label { translate: 0 12px; }
`,
  },
  {
    name: 'Labels: bigger, bold, dark blue',
    css: `svg .vertex > text.vertex-label { font-size: 12px; font-weight: bold; fill: #1F3A5F; }
`,
  },
  {
    name: 'Links: colour and width',
    css: `/* OpenNMS writes stroke-width: 3px into each link (style=""), so the width needs !important */
svg path.edge, svg path.edge.normal { stroke: #1F3A5F; stroke-width: 4px !important; }
`,
  },
  {
    name: 'Alarm frames: one red for major and critical',
    css: `svg .vertex > rect.status.major, svg .vertex > rect.status.critical { stroke: #C62828; fill: #C62828; }
`,
  },
  {
    name: 'Round corners and a thinner frame for every node',
    css: `svg .vertex > rect.status { rx: 6px; stroke-width: 2px; }
`,
  },
  {
    name: 'A label on the page with the version of this CSS (the mark line)',
    css: `/* mark */
`,
  },
]
