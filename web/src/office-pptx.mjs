import PptxGenJS from 'pptxgenjs';
import { STEPS, C, COLORS, FONT, TYPE, CAUSE, ACTION, SNAPSHOT, text, sample, stage, finite, wrap, chunks, display, typeNote, validTarget, axisFormat, rawTable, settings, plots, buildToolScenes } from './office-shared.mjs';

const W = 13.333333, H = 7.5;
function addText(slide, value, x, y, w, h, size = 18, options = {}) {
  slide.addText(String(value ?? ''), { x, y, w, h, fontFace: FONT, fontSize: size, color: C.ink, margin: 0, breakLine: false, valign: 'top', ...options });
}
function addScene(pptx, slide, scene) {
  // Independent horizontal/vertical mapping keeps Japanese labels readable.
  const sx = 10.5 / scene.width, sy = 4.92 / scene.height, ox = (W - 10.5) / 2, oy = 1.40;
  for (const edge of scene.lines) {
    const x1 = ox + edge.x1 * sx, x2 = ox + edge.x2 * sx, y1 = oy + edge.y1 * sy, y2 = oy + edge.y2 * sy;
    slide.addShape(pptx.ShapeType.line, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(.001, Math.abs(x2 - x1)), h: Math.max(.001, Math.abs(y2 - y1)), flipH: x2 < x1, flipV: y2 < y1, line: { color: C.muted, width: 1.2, ...(edge.arrow ? { endArrowType: 'triangle' } : {}) } });
    if (edge.label) {
      const width = Math.max(.75, Math.min(2.1, [...edge.label].length * .07 + .1));
      addText(slide, edge.label, (x1 + x2) / 2 - width / 2, (y1 + y2) / 2 - .24, width, .23, 11, { align: 'center', fill: { color: C.paper } });
    }
  }
  for (const box of scene.boxes) {
    const primary = box.style === 'primary', x = ox + box.x * sx, y = oy + box.y * sy, w = box.w * sx, h = box.h * sy;
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: primary ? C.ink : box.style === 'accent' ? C.amber : C.pale }, line: { color: C.line, width: .6 } });
    const lines = wrap(box.text, Math.max(2, (w * 72 - 8) / 13.5));
    const capacity = Math.max(1, Math.floor((h * 72 - 6) / 14.5));
    // Large/long labels are already retained on the scene's reference pages.
    // Keep the code and an explicit reference marker if a compact box cannot fit.
    const label = lines.length <= capacity ? lines.join('\n') : `${String(box.text).split('\n')[0]}${capacity >= 2 ? '\n全文は参照ページ' : ''}`;
    addText(slide, label, x + .045, y + .03, w - .09, h - .045, 13.5, { color: primary ? 'FFFFFF' : C.ink, bold: primary, lineSpacingMultiple: 1.02, valign: 'mid' });
  }
  for (const item of scene.texts) {
    addText(slide, item.text, ox + item.x * sx, oy + item.y * sy, item.w * sx, item.h * sy, Math.max(13, (item.fontSize || 22) * .66), { lineSpacingMultiple: 1.02 });
  }
}
export async function createPresentationBlob(project, { analysis, tools }) {
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.author = 'QC Studio'; pptx.subject = 'QC活動報告'; pptx.title = text(project.meta.title); pptx.company = ''; pptx.lang = 'ja-JP'; pptx.theme = { headFontFace: FONT, bodyFontFace: FONT, lang: 'ja-JP' };
  let count = 0;
  function makeSlide(title, subtitle = '', tool) {
    const slide = pptx.addSlide(); count++; slide.background = { color: C.paper };
    addText(slide, title, .64, .35, 12.06, .58, 29, { bold: true });
    if (subtitle) {
      // Full user titles also appear in the narrative and notes. Avoid header clipping.
      const lines = wrap(subtitle, 51);
      addText(slide, lines.length > 2 ? `${lines[0]}\n全文は概要・参照ページを参照` : lines.join('\n'), .68, 1.00, 12, .39, 15, { color: C.teal, bold: true });
    }
    if (tool) addText(slide, SNAPSHOT, .68, 6.65, 12, .31, 11, { color: C.orange });
    addText(slide, `${sample(project, tool)}${sample(project, tool) ? '   ' : ''}${count}`, .68, 7.04, 12, .22, 11, { color: C.muted });
    slide.addNotes(`${sample(project, tool)}\n${tool ? `${tool.title}\n関連工程：${stage(tool.step)}\n${SNAPSHOT}` : 'QC Studioの入力内容から生成。'}`);
    return slide;
  }
  function narrative(title, entries, tool) {
    let slide = makeSlide(title, tool ? `関連工程：${stage(tool.step)}` : '', tool), y = 1.5;
    for (const [label, value] of entries) {
      const lines = wrap(text(value), 44); let offset = 0;
      while (offset < lines.length) {
        let capacity = Math.floor((6.45 - y - .36) / .32);
        if (capacity < 1 || offset === 0 && lines.length <= 12 && capacity < lines.length && y > 1.5) { slide = makeSlide(title, '続き', tool); y = 1.5; capacity = 13; }
        const size = Math.min(capacity, lines.length - offset);
        addText(slide, `${label}${offset ? '（続き）' : ''}`, .72, y, 11.85, .3, 14, { color: C.teal, bold: true });
        addText(slide, lines.slice(offset, offset + size).join('\n'), .72, y + .34, 11.85, size * .32 + .03, 18, { lineSpacingMultiple: 1.05 });
        y += .49 + size * .32; offset += size;
      }
    }
  }
  function tables(title, table, tool, preferredWidths) {
    const blocks = [];
    if (table.columns.length <= 6) blocks.push(table.columns.map((_, i) => i));
    else for (let col = 1; col < table.columns.length; col += 5) blocks.push([0, ...Array.from({ length: Math.min(5, table.columns.length - col) }, (_, i) => col + i)]);
    for (const indices of blocks) {
      const widths = preferredWidths && blocks.length === 1 ? preferredWidths : indices.map(() => 11.9 / indices.length);
      const headers = indices.map((i, j) => wrap(table.columns[i], Math.max(4, (widths[j] * 72 - 14) / 15)).join('\n'));
      const headerHeight = Math.max(.46, ...headers.map(h => h.split('\n').length * .245 + .14));
      const expanded = [];
      for (const record of table.rows.length ? table.rows : [table.columns.map(() => '未入力')]) {
        const parts = indices.map((i, j) => chunks(record[i] === null || record[i] === undefined ? '未入力' : String(record[i]), Math.max(3, (widths[j] * 72 - 14) / 15), 10));
        for (let part = 0; part < Math.max(...parts.map(p => p.length)); part++) {
          const row = parts.map(p => p[part] || '');
          expanded.push({ row, height: Math.max(.46, ...row.map(c => c.split('\n').length * .245 + .14)) });
        }
      }
      let offset = 0;
      while (offset < expanded.length) {
        const slide = makeSlide(title, `${table.name}${blocks.length > 1 ? `（列 ${indices.slice(1).map(i => i + 1).join('・')}）` : ''}`, tool);
        const rows = [], heights = [headerHeight]; let height = headerHeight;
        while (offset < expanded.length && height + expanded[offset].height <= 4.9) { const r = expanded[offset++]; rows.push(r.row); heights.push(r.height); height += r.height; }
        if (!rows.length) throw new Error(`${table.name}の表の1行がスライドに収まりません。`);
        const styled = [headers.map(h => ({ text: h, options: { fill: C.ink, color: 'FFFFFF', bold: true } })), ...rows.map((r, i) => r.map(value => ({ text: value, options: { fill: i % 2 ? 'FFFFFF' : C.pale } })))];
        slide.addTable(styled, { x: .72, y: 1.5, w: 11.9, colW: widths, rowH: heights, autoPage: false, fontFace: FONT, fontSize: 15, color: C.ink, border: { type: 'solid', color: C.line, pt: .6 }, margin: [4, 6, 4, 6], valign: 'top', lineSpacingMultiple: 1.0 });
      }
    }
  }
  function chartSlides(title, plot, tool) {
    const scatter = plot.type === 'scatter', pages = scatter ? 1 : Math.max(1, Math.ceil(plot.categories.length / 16));
    for (let page = 0; page < pages; page++) {
      const slide = makeSlide(title, `${plot.title}${pages > 1 ? `（${page + 1}/${pages}）` : ''}`, tool), first = page * 16;
      const categories = scatter ? [] : plot.categories.slice(first, first + 16).map((v, i) => [...String(v)].length > 14 ? `項目${first + i + 1}` : String(v));
      const data = scatter ? [{ name: plot.xLabel || 'X', values: plot.points.map(p => p.x) }, { name: plot.yLabel || 'Y', values: plot.points.map(p => p.y), labels: plot.points.map(p => p.label || '') }]
        : plot.series.map(s => ({ name: s.name, labels: categories, values: s.values.slice(first, first + 16) }));
      const values = scatter ? plot.points.map(p => p.y) : data.flatMap(s => s.values), format = axisFormat(scatter ? [...plot.points.map(p => p.x), ...values] : values);
      slide.addChart(scatter ? pptx.ChartType.scatter : plot.type === 'line' ? pptx.ChartType.line : pptx.ChartType.bar, data, {
        x: .85, y: 1.60, w: 11.65, h: 4.52, showLegend: !scatter && data.length > 1, legendPos: 'b', legendFontFace: FONT, legendFontSize: 12,
        chartColors: COLORS, showValue: false, showLabel: false, showTitle: false, showBorder: false,
        catAxisLabelFontFace: FONT, catAxisLabelFontSize: 12, valAxisLabelFontFace: FONT, valAxisLabelFontSize: 12,
        valAxisLabelFormatCode: format, catLabelFormatCode: format, valAxisTitle: plot.yLabel || '', catAxisTitle: plot.xLabel || '', showValAxisTitle: !!plot.yLabel, showCatAxisTitle: !!plot.xLabel, valAxisTitleFontSize: 12, catAxisTitleFontSize: 12,
        valGridLine: { color: C.line, width: .6 }, catGridLine: { style: 'none' }, showMarker: true, lineSize: scatter ? 0 : 1.8, lineDataSymbolSize: scatter ? 6 : 4, lineDataSymbolLineColor: C.teal,
        barDir: 'col', barGrouping: 'clustered', barGapWidthPct: plot.histogram ? 0 : 100, displayBlanksAs: 'gap',
        ...(plot.percentScale ? { valAxisMinVal: 0, valAxisMaxVal: 100 } : plot.type === 'bar' && values.every(v => v >= 0) ? { valAxisMinVal: 0 } : {}),
      });
      const notes = [plot.companion ? '量と累積比率は、それぞれの軸で別のグラフとして表示。' : '', plot.omitted ? '初回の移動範囲は計算できないため、2点目から図示。' : '', categories.some(v => /^項目\d+$/.test(v)) ? '長い項目名は後続の集計表・入力表に全文を記載。' : ''].filter(Boolean).join(' ');
      if (notes) addText(slide, notes, .72, 6.20, 11.9, .30, 11, { color: C.muted });
    }
  }
  const cover = makeSlide('QC 活動報告'); cover.background = { color: C.ink };
  addText(cover, 'QC 活動報告', .78, .80, 11.7, .5, 23, { color: '91D5D4' });
  const titleParts = chunks(project.meta.title || '活動テーマを入力してください', 24, 3);
  addText(cover, titleParts[0], .78, 2.1, 11.7, 2.35, 35, { color: 'FFFFFF', bold: true });
  const coverMeta = wrap(`${text(project.meta.department)}　${text(project.meta.team)}`, 42);
  addText(cover, coverMeta.length <= 2 ? coverMeta.join('\n') : '部署・チームの全文は活動情報に記載', .8, 5.22, 11.7, .62, 18, { color: 'E3EAEE' });
  addText(cover, `${text(project.meta.startDate)} ～ ${text(project.meta.endDate)}`, .8, 6.02, 11.7, .38, 18, { color: 'E3EAEE' });
  if (project.isSample) addText(cover, sample(project), .8, 6.84, 11.7, .3, 16, { color: 'FFD492', bold: true });
  const stepTitle = n => `${String(n + 1).padStart(2, '0')}  ${STEPS[n]}`;
  narrative(stepTitle(0), [['活動情報', `テーマ：${text(project.meta.title)}\n部署：${text(project.meta.department)}\nチーム：${text(project.meta.team)}\nリーダー：${text(project.meta.leader)}\nメンバー：${text(project.meta.members)}\n期間：${text(project.meta.startDate)} ～ ${text(project.meta.endDate)}`], ['背景', project.theme.background], ['選定理由', project.theme.reason], ['対象範囲', project.theme.scope], ['指標と目標', `${text(project.theme.metricName)}／${TYPE[project.theme.metricType]}\n目標：${display(project.theme.target, analysis.unit)}　期日：${text(project.theme.targetDate)}\n${project.theme.direction === 'lower' ? '小さいほど良い' : '大きいほど良い'}\n${typeNote(project)}`]]);
  narrative(stepTitle(1), [['対策前の値', `${display(analysis.before.value, analysis.unit)}（記録 ${analysis.before.count} 件）`], ['現場での観察', project.current.observation], ['測定方法', project.current.method], ['層別の切り口', project.current.stratification], ['把握できた事実', project.current.finding]]);
  const measurements = (phase, n) => {
    const rows = project.measurements.filter(m => m.phase === phase).map(m => [m.date, m.category, m.value, project.theme.metricType === 'rate' ? m.denominator : '対象外', m.note]);
    if (rows.length) tables(stepTitle(n), { name: `${phase === 'before' ? '対策前' : '対策後'}の測定記録`, columns: ['測定日', '分類', '値／分子', '母数', '注記'], rows }, null, [1.65, 2.2, 1.35, 1.35, 5.35]);
  };
  measurements('before', 1);
  tables(stepTitle(2), { name: '要因と検証', columns: ['分類・要因・なぜ', '検証方法・結果', '状態'], rows: project.causes.map(c => [`分類：${text(c.category)}\n要因：${text(c.factor)}\nなぜ：${text(c.why)}`, c.verification, CAUSE[c.status]]) }, null, [5.3, 4.95, 1.65]);
  tables(stepTitle(3), { name: '対策の計画・実施', columns: ['対象の要因・対策', '担当・期限', '状態・実施結果'], rows: project.actions.map(a => [`要因：${text(project.causes.find(c => c.id === a.causeId)?.factor)}\n対策：${text(a.action)}`, `${text(a.owner)}\n${text(a.dueDate)}`, `${ACTION[a.status]}\n${text(a.result)}`]) }, null, [5.8, 2.1, 4]);
  const available = [['対策前', analysis.before.value], ['対策後', analysis.after.value], ['目標値', validTarget(project) ? project.theme.target : null]].filter(([, v]) => finite(v));
  if (available.length) chartSlides(stepTitle(4), { type: 'bar', title: '対策前・対策後・目標値', yLabel: analysis.unit, categories: available.map(([k]) => k), series: [{ name: text(project.theme.metricName), values: available.map(([, v]) => v) }] });
  narrative(stepTitle(4), [['指標と効果', `${text(project.theme.metricName)}\n対策前 ${display(analysis.before.value, analysis.unit)}　対策後 ${display(analysis.after.value, analysis.unit)}\n改善量 ${display(analysis.improvement, project.theme.metricType === 'rate' ? 'pt' : analysis.unit)}\n改善率 ${display(analysis.improvementPercent, '%')}\n${analysis.targetMet === null ? '目標判定：未判定' : analysis.targetMet ? '目標値に到達' : '目標値に未到達'}`], ['比較条件', project.effect.comparability], ['効果の結論', project.effect.conclusion], ['副作用・他工程への影響', project.effect.sideEffects], ['無形の効果', project.effect.intangible], ...(analysis.warnings.length ? [['出力時の確認事項', analysis.warnings.join('\n')]] : [])]);
  measurements('after', 4);
  tables(stepTitle(5), { name: '標準化・維持管理', columns: ['標準・文書・教育', '担当・頻度', '確認方法・異常時の対応'], rows: project.standards.map(s => [`標準：${text(s.rule)}\n文書：${text(s.document)}\n教育：${text(s.education)}`, `${text(s.owner)}\n${text(s.frequency)}`, `確認：${text(s.checkMethod)}\n対応：${text(s.response)}`]) }, null, [5.1, 2.4, 4.4]);
  narrative(stepTitle(6), [['良かった点', project.reflection.good], ['改善すべき点', project.reflection.improve], ['残された課題', project.reflection.remaining], ['次の活動', project.reflection.nextAction], ['担当・期限', `${text(project.reflection.owner)}\n${text(project.reflection.dueDate)}`]]);
  for (const { tool, spec, result, index } of tools) {
    const title = `道具 ${String(index).padStart(2, '0')}  ${spec.name}`;
    narrative(title, [['名称', tool.title], ['関連工程', stage(tool.step)], ...(settings(tool, spec).length ? [['設定', settings(tool, spec).map(([k, v]) => `${k}：${text(v)}`).join('\n')]] : []), ...(result.metrics.length ? [['解析値', result.metrics.map(m => `${m.label}：${m.value === null ? '定義不可' : display(m.value, m.unit)}`).join('\n')]] : []), ...(tool.notes ? [['注記', tool.notes]] : []), ...(result.warnings.length ? [['解析の前提・注意', result.warnings.join('\n')]] : [])], tool);
    for (const plot of result.charts.flatMap(plots)) chartSlides(title, plot, tool);
    for (const scene of buildToolScenes(tool, result)) addScene(pptx, makeSlide(title, scene.title, tool), scene);
    for (const table of result.tables.filter(t => !['入力データ', '入力行列'].includes(t.name))) tables(title, { ...table, name: `${table.name}（出力時点）` }, tool);
    tables(title, rawTable(tool, spec), tool);
  }
  const output = await pptx.write({ outputType: 'arraybuffer', compression: true });
  return new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
