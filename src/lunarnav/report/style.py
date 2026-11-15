"""Stylesheet of the report (screen and A4 print). Colour is never the only carrier of meaning."""

CSS = """
@page { size: A4; margin: 17mm 14mm 17mm 14mm;
  @top-left { content: string(runtitle); font: 7pt 'DejaVu Sans'; color: #333; }
  @top-right { content: string(runhash); font: 7pt 'DejaVu Sans'; color: #333; }
  @bottom-left { content: string(rungen); font: 7pt 'DejaVu Sans'; color: #333; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7pt 'DejaVu Sans'; color: #333; } }
* { box-sizing: border-box; }
html { font-family: 'DejaVu Sans', sans-serif; font-size: 8.6pt; line-height: 1.38; color: #111; background: #fff; }
body { margin: 0 auto; max-width: 190mm; }
@media screen { body { padding: 10mm 6mm; } }
h1 { font-size: 19pt; margin: 0 0 1mm 0; line-height: 1.15; }
h2 { font-size: 12.5pt; margin: 7mm 0 2.5mm 0; padding-bottom: 1mm; border-bottom: 1.6pt solid #111;
     break-after: avoid; page-break-after: avoid; }
h3 { font-size: 9.6pt; margin: 4.5mm 0 1.5mm 0; break-after: avoid; page-break-after: avoid; }
p { margin: 0 0 2mm 0; }
.sub { color: #333; font-size: 8.6pt; }
.rt, .rh, .rg { string-set: none; }
.rt { string-set: runtitle content(); }
.rh { string-set: runhash content(); }
.rg { string-set: rungen content(); }
.meta { display: flex; flex-wrap: wrap; gap: 1mm 6mm; margin: 2mm 0 0 0; font-size: 7.6pt; color: #222; }
.mono { font-family: 'DejaVu Sans Mono', monospace; }
.small { font-size: 7.2pt; }
table { border-collapse: collapse; width: 100%; margin: 0 0 3mm 0; font-size: 7.7pt; }
th, td { border-bottom: 0.5pt solid #777; padding: 1pt 4pt 1pt 0; text-align: left; vertical-align: top; }
th { border-bottom: 1.2pt solid #111; font-weight: 700; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
.nw { white-space: nowrap; }
table.dense { font-size: 6.9pt; }
td.small { overflow-wrap: anywhere; }
td.bycase { overflow-wrap: normal; min-width: 6em; }
td.wholeword { overflow-wrap: normal; }
td.num { white-space: nowrap; }
th.num { white-space: normal; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; padding-right: 6pt; }
td.hash { font-family: 'DejaVu Sans Mono', monospace; font-size: 6.2pt; word-break: break-all; }
caption { text-align: left; font-weight: 700; padding-bottom: 1mm; caption-side: top; }
.verdict { display: inline-block; font-size: 30pt; font-weight: 700; letter-spacing: 1pt; padding: 1mm 8mm;
  border: 2.4pt solid #111; line-height: 1.15; }
.verdict.pass { background: #fff; color: #111; }
.verdict.marginal { background: repeating-linear-gradient(135deg, #fff 0 3pt, #bbb 3pt 6pt); color: #111; }
.verdict.fail { background: #111; color: #fff; }
.verdict.unknown { background: #fff; color: #111; border-style: dashed; }
.state { font-weight: 700; white-space: nowrap; padding: 0 3pt; border: 1pt solid #111; }
.state.pass { background: #fff; }
.state.marginal { background: #c9c9c9; }
.state.fail { background: #111; color: #fff; }
.state.unknown { border-style: dashed; }
.answer { border: 1pt solid #111; padding: 4mm 5mm; margin: 2mm 0 4mm 0; break-inside: avoid; }
.answer .lead { font-size: 10.5pt; margin: 3mm 0 2mm 0; }
.answer table { font-size: 8.6pt; }
.answer th { width: 38mm; border-bottom: 0.5pt solid #777; font-weight: 700; }
.conv { border-left: 3pt solid #111; padding: 1mm 3mm; margin: 2mm 0 3mm 0; font-size: 7.6pt; }
figure { margin: 0 0 4mm 0; break-inside: avoid; page-break-inside: avoid; }
figure svg { width: 100%; height: auto; display: block; }
figcaption { font-size: 7.6pt; margin-top: 1mm; color: #222; }
ul.limits { margin: 0 0 2mm 0; padding-left: 4mm; }
ul.limits li { margin: 0 0 1.4mm 0; break-inside: avoid; }
.src { color: #333; font-size: 7pt; }
pre { font-family: 'DejaVu Sans Mono', monospace; font-size: 6.2pt; line-height: 1.25; white-space: pre-wrap;
  word-break: break-all; border: 0.6pt solid #777; padding: 2mm; margin: 0; }
.pagebreak { break-before: page; page-break-before: always; }
.keep { break-inside: avoid; }
table.kv th { border-bottom: 0.5pt solid #777; width: 44mm; }
table.kv td.num { text-align: left; padding-right: 0; }
#scenario { break-before: page; page-break-before: always; }
table.inline { border-collapse: collapse; } table.inline td { padding: 0 3mm 0 0; border: 0; }
h4 { margin: 3mm 0 1mm 0; font-size: 9.5pt; }
.spread { margin: 2mm 0 2mm 0; font-size: 8.4pt; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 6mm; }
"""
