import ExcelJS from 'exceljs';
import { addNativeCharts } from './office-xlsx-charts.mjs';
import { STEPS, C, FONT, TYPE, CAUSE, ACTION, SNAPSHOT, text, sample, stage, finite, chunks, wrap, column, dateValue, typeNote, validTarget, rawTable, settings, plots, chartTable, buildToolScenes } from './office-shared.mjs';

const fill = color => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } });
const font = (bold = false, size = 11, color = C.ink) => ({ name: FONT, size, bold, color: { argb: `FF${color}` } });
function put(sheet, row, col, value, input = false) {
  const cell = sheet.getCell(row, col);
  cell.value = value ?? null; // Strings remain literal strings, including a leading '='.
  cell.font = font(); cell.alignment = { vertical: 'top', wrapText: true };
  cell.fill = fill(input ? C.amber : C.pale);
  if (value instanceof Date) cell.numFmt = 'yyyy/mm/dd';
  return cell;
}
function formula(sheet, address, expression, result) {
  const cell = sheet.getCell(address);
  cell.value = { formula: expression.replace(/^=/, ''), result: result ?? '' };
  cell.font = font(); cell.alignment = { vertical: 'top', wrapText: true }; cell.fill = fill(C.pale);
  return cell;
}
function newSheet(wb, name, project, widths = [28, 86], tool) {
  const sheet = wb.addWorksheet(name, { views: [{ showGridLines: false }], properties: { tabColor: { argb: `FF${C.teal}` } } });
  widths.forEach((width, i) => { sheet.getColumn(i + 1).width = width; });
  sheet.getCell('A2').value = name; sheet.getCell('A2').font = font(true, 17); sheet.getRow(2).height = 32;
  sheet.getCell('A3').value = sample(project, tool); sheet.getCell('A3').font = font(false, 11, C.orange); sheet.getRow(3).height = 22;
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return sheet;
}
function field(sheet, row, label, value, { input = true, fixed = false } = {}) {
  const pieces = typeof value === 'string' ? chunks(value || '未入力', Math.max(12, sheet.getColumn(2).width * .48), fixed ? 500 : 18) : [value];
  pieces.forEach((part, i) => {
    put(sheet, row + i, 1, `${label}${i ? '（続き）' : ''}`);
    put(sheet, row + i, 2, part, input);
    sheet.getRow(row + i).height = Math.min(409, Math.max(27, typeof part === 'string' ? wrap(part, sheet.getColumn(2).width * .48).length * 17 + 10 : 27));
  });
  return row + pieces.length;
}
function fields(sheet, row, entries, options) { for (const [label, value] of entries) row = field(sheet, row, label, value, options); return row; }
function note(sheet, row, value) {
  for (const line of wrap(value, 62)) { const cell = sheet.getCell(row, 1); cell.value = line; cell.font = font(false, 11, C.orange); sheet.getRow(row++).height = 22; }
  return row;
}
function table(sheet, row, value, { input = false, preserveRows = false } = {}) {
  sheet.getCell(row, 1).value = value.name; sheet.getCell(row, 1).font = font(true, 12, C.teal); sheet.getRow(row++).height = 26;
  const header = row;
  value.columns.forEach((name, i) => { const cell = put(sheet, row, i + 1, name); cell.fill = fill(C.ink); cell.font = font(true, 11, 'FFFFFF'); });
  sheet.getRow(row++).height = Math.max(32, ...value.columns.map((v, i) => wrap(v, sheet.getColumn(i + 1).width * .45).length * 17 + 10));
  for (const source of value.rows.length ? value.rows : [value.columns.map(() => null)]) {
    const parts = source.map((v, i) => typeof v === 'string' && !preserveRows ? chunks(v, Math.max(5, sheet.getColumn(i + 1).width * .45), 18) : [v]);
    for (let piece = 0; piece < Math.max(...parts.map(p => p.length)); piece++) {
      const values = parts.map(p => p[piece] ?? null);
      values.forEach((v, i) => put(sheet, row, i + 1, v, input));
      sheet.getRow(row++).height = Math.min(409, Math.max(28, ...values.map((v, i) => typeof v === 'string' ? wrap(v, Math.max(5, sheet.getColumn(i + 1).width * .45)).length * 17 + 10 : 28)));
    }
  }
  return { header, start: header + 1, end: row - 1, next: row + 2 };
}
const sheetName = (index, name, prefix = '道具') => `${prefix}${String(index).padStart(2, '0')} ${name}`.replace(/[\[\]:*?/\\]/g, '').slice(0, 31);
const rangeRef = (sheet, col, first, last) => `'${sheet.name.replace(/'/g, "''")}'!$${column(col)}$${first}:$${column(col)}$${last}`;
function chartSpec(sheet, row, plot, source) {
  return { sheetId: sheet.id, row, plot, categoryRef: rangeRef(sheet, 1, source.start, source.end), series: plot.type === 'scatter'
    ? [{ name: plot.title, xRef: rangeRef(sheet, 1, source.start, source.end), xValues: plot.points.map(p => p.x), ref: rangeRef(sheet, 2, source.start, source.end), values: plot.points.map(p => p.y) }]
    : plot.series.map((s, i) => ({ name: s.name, values: s.values, ref: rangeRef(sheet, i + 2, source.start, source.end) })) };
}
function cellScene(sheet, scene, start) {
  const rowCount = 35, colCount = 50, refs = [], used = new Set();
  const xy = (x, y) => [Math.max(0, Math.min(colCount - 1, Math.round(x / scene.width * colCount))), Math.max(0, Math.min(rowCount - 1, Math.round(y / scene.height * rowCount)))];
  for (let r = 0; r < rowCount; r++) sheet.getRow(start + r).height = 14;
  for (const edge of scene.lines) {
    const [x1, y1] = xy(edge.x1, edge.y1), [x2, y2] = xy(edge.x2, edge.y2), steps = Math.max(1, Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x1 + (x2 - x1) * i / steps), y = Math.round(y1 + (y2 - y1) * i / steps);
      const arrow = Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? x2 >= x1 ? '▶' : '◀' : y2 >= y1 ? '▼' : '▲';
      const cell = sheet.getCell(start + y, x + 1); cell.value = edge.arrow && i === steps ? arrow : x1 === x2 ? '│' : y1 === y2 ? '─' : (x2 - x1) * (y2 - y1) >= 0 ? '╲' : '╱'; cell.font = font(false, 10, C.muted);
    }
    if (edge.label) refs.push(`線の注記：${edge.label}`);
  }
  for (const [i, box] of scene.boxes.entries()) {
    const code = `N${String(i + 1).padStart(2, '0')}`, [x, y] = xy(box.x, box.y), [xe, ye] = xy(box.x + box.w, box.y + box.h);
    const cells = [];
    for (let r = y; r < Math.max(y + 1, ye); r++) for (let c = x; c < Math.max(x + 1, xe); c++) cells.push(`${r}:${c}`);
    const collision = cells.some(c => used.has(c));
    refs.push(`${code}：${box.text}`);
    if (!collision) {
      cells.forEach(c => used.add(c));
      for (let r = y; r < Math.max(y + 1, ye); r++) for (let c = x; c < Math.max(x + 1, xe); c++) sheet.getCell(start + r, c + 1).value = null;
      sheet.mergeCells(start + y, x + 1, start + Math.max(y, ye - 1), Math.max(x + 1, xe));
      const cell = sheet.getCell(start + y, x + 1); cell.value = code; cell.fill = fill(box.style === 'primary' ? C.ink : box.style === 'accent' ? C.amber : C.pale); cell.font = font(true, 11, box.style === 'primary' ? 'FFFFFF' : C.ink); cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side => [side, { style: 'thin', color: { argb: `FF${C.muted}` } }]));
    }
  }
  scene.texts.forEach(t => refs.push(t.text));
  let row = scene.boxes.length || scene.lines.length ? start + rowCount + 2 : start;
  for (const value of refs) for (const line of wrap(value, 58)) {
    sheet.mergeCells(row, 1, row, 50); const cell = sheet.getCell(row, 1); cell.value = line; cell.font = font(); sheet.getRow(row++).height = 22;
  }
  return row + 2;
}

export async function createWorkbookBlob(project, { analysis, tools }) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'QC Studio'; wb.created = new Date(); wb.calcProperties.fullCalcOnLoad = true;
  const sheets = [newSheet(wb, STEPS[0], project), newSheet(wb, STEPS[1], project), newSheet(wb, STEPS[2], project, [18, 40, 42, 56, 18]), newSheet(wb, STEPS[3], project, [35, 50, 20, 18, 18, 50]), newSheet(wb, STEPS[4], project, [30, 42, 25, 25]), newSheet(wb, STEPS[5], project, [42, 30, 20, 30, 42, 42, 42]), newSheet(wb, STEPS[6], project), newSheet(wb, '測定データ', project, [15, 17, 28, 18, 18, 60, 40, 20, 15, 24, 4, 26, 20, 20])];
  const [theme, current, causes, actions, effect, standards, reflection, data] = sheets, chartItems = [], longFixed = [];
  note(theme, 4, '黄色は入力欄。集計方法・目標値と測定データの変更はExcelで再計算されます。');
  const fixed = (row, label, value) => {
    if (typeof value === 'string' && wrap(value, 40).length > 18) { longFixed.push([label, value]); field(theme, row, label, '下の「活動情報（全文）」を参照', { fixed: true }); }
    else field(theme, row, label, value, { fixed: true });
  };
  [['活動テーマ', project.meta.title], ['部署', project.meta.department], ['チーム', project.meta.team], ['リーダー', project.meta.leader], ['メンバー', project.meta.members], ['開始日', dateValue(project.meta.startDate)], ['終了日', dateValue(project.meta.endDate)]].forEach(([k, v], i) => fixed(5 + i, k, v));
  fixed(13, '指標', project.theme.metricName); fixed(14, '集計方法', TYPE[project.theme.metricType]); fixed(15, '単位', analysis.unit); fixed(16, '改善方向', project.theme.direction === 'lower' ? '小さいほど良い' : '大きいほど良い'); fixed(17, '目標値', project.theme.target); fixed(18, '目標期日', dateValue(project.theme.targetDate));
  theme.getCell('B14').dataValidation = { type: 'list', allowBlank: false, formulae: ['"比率,合計,平均（単純平均）"'] };
  theme.getCell('B16').dataValidation = { type: 'list', allowBlank: false, formulae: ['"小さいほど良い,大きいほど良い"'] };
  let at = fields(theme, 20, [['背景', project.theme.background], ['選定理由', project.theme.reason], ['対象範囲', project.theme.scope]]);
  for (const [k, v] of longFixed) at = field(theme, at, `活動情報（全文） ${k}`, v);
  const type = `'${STEPS[0]}'!$B$14`, lower = `'${STEPS[0]}'!$B$16="小さいほど良い"`;
  note(data, 4, '入力範囲は8～507行（500件）。未入力の数値を0に置き換えません。');
  formula(data, 'A5', `IF(${type}="比率","比率＝値の合計÷母数の合計×100。各行は重複しない検査対象とします。",IF(${type}="平均（単純平均）","平均は測定値の単純平均です。重みづけは行いません。","合計は測定値の総和です。"))`, typeNote(project));
  const headers = ['区分', '測定日', '分類', '値／分子', '母数', '注記', '記録ID', '行の指標値', '有効件数', '入力状況'];
  headers.forEach((h, i) => { const c = put(data, 7, i + 1, h); c.fill = fill(C.ink); c.font = font(true, 11, 'FFFFFF'); });
  const longRecords = [];
  for (let i = 0; i < 500; i++) {
    const r = i + 8, m = project.measurements[i];
    const values = m ? [m.phase === 'before' ? '対策前' : '対策後', dateValue(m.date), m.category, m.value, m.denominator, m.note, m.id] : Array(7).fill(null);
    for (const col of [2, 5]) if (typeof values[col] === 'string' && wrap(values[col], col === 2 ? 12 : 27).length > 18) { longRecords.push([`測定 ${i + 1} ${headers[col]}（${m.id}）`, values[col]]); values[col] = `下の全文欄・測定 ${i + 1}`; }
    values.forEach((v, c) => put(data, r, c + 1, v, true));
    data.getRow(r).height = Math.min(409, Math.max(26, wrap(values[2], 12).length * 17 + 8, wrap(values[5], 27).length * 17 + 8));
    const valid = m && finite(m.value) && (project.theme.metricType === 'average' || m.value >= 0) && (project.theme.metricType !== 'rate' || finite(m.denominator) && m.denominator > 0 && Number.isInteger(m.value) && Number.isInteger(m.denominator) && m.value <= m.denominator);
    formula(data, `I${r}`, `IF(COUNTA(A${r}:G${r})=0,"",IF(AND(OR(A${r}="対策前",A${r}="対策後"),ISNUMBER(D${r})),IF(${type}="比率",IF(ISNUMBER(E${r}),IF(AND(E${r}>0,D${r}>=0,D${r}<=E${r},D${r}=INT(D${r}),E${r}=INT(E${r})),1,0),0),IF(OR(${type}="平均（単純平均）",AND(${type}="合計",D${r}>=0)),1,0)),0))`, m ? valid ? 1 : 0 : '');
    formula(data, `H${r}`, `IF(I${r}=1,IF(${type}="比率",D${r}/E${r}*100,D${r}),"")`, valid ? project.theme.metricType === 'rate' ? m.value / m.denominator * 100 : m.value : '');
    formula(data, `J${r}`, `IF(NOT(ISNUMBER(I${r})),"",IF(I${r}=1,"有効","数値等を確認"))`, m ? valid ? '有効' : '数値等を確認' : '');
    data.getCell(`A${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"対策前,対策後"'] };
  }
  data.autoFilter = 'A7:J507'; data.views = [{ state: 'frozen', xSplit: 2, ySplit: 7, showGridLines: false }];
  [['集計', '対策前', '対策後'], ['入力件数'], ['有効件数'], ['値の合計'], ['母数の合計'], ['集計値']].forEach((row, i) => row.forEach((v, c) => put(data, i + 7, c + 12, v)));
  for (const [col, phase] of [['M', 'before'], ['N', 'after']]) {
    const rows = project.measurements.filter(m => m.phase === phase), a = analysis[phase];
    const validCount = rows.filter(m => finite(m.value) && (project.theme.metricType !== 'rate' || finite(m.denominator) && m.denominator > 0)).length;
    formula(data, `${col}8`, `COUNTIF($A$8:$A$507,${col}$7)`, rows.length);
    formula(data, `${col}9`, `SUMIF($A$8:$A$507,${col}$7,$I$8:$I$507)`, validCount);
    formula(data, `${col}10`, `SUMIF($A$8:$A$507,${col}$7,$D$8:$D$507)`, rows.reduce((s, m) => s + (finite(m.value) ? m.value : 0), 0));
    formula(data, `${col}11`, `SUMIF($A$8:$A$507,${col}$7,$E$8:$E$507)`, rows.reduce((s, m) => s + (finite(m.denominator) ? m.denominator : 0), 0));
    formula(data, `${col}12`, `IF(OR(${col}8=0,${col}8<>${col}9),"",IF(${type}="比率",${col}10/${col}11*100,IF(${type}="平均（単純平均）",${col}10/${col}9,${col}10)))`, a.value);
  }
  note(data, 14, '集計値は有効な行がそろうまで空欄です。');
  at = 511; for (const [label, value] of longRecords) { at = note(data, at, label); for (const part of chunks(value, 72, 18)) { data.mergeCells(at, 1, at, 6); const c = put(data, at, 1, part, true); c.alignment.wrapText = true; data.getRow(at++).height = Math.min(409, part.split('\n').length * 17 + 10); } }
  field(current, 5, '集計方法', typeNote(project), { input: false }); formula(current, 'B5', "'測定データ'!A5", typeNote(project));
  field(current, 7, '対策前の値', null, { input: false }); formula(current, 'B7', 'IF(ISNUMBER(測定データ!M12),測定データ!M12,"")', analysis.before.value);
  field(current, 8, '単位', null, { input: false }); formula(current, 'B8', `IF(${type}="比率","%",'${STEPS[0]}'!B15)`, analysis.unit);
  fields(current, 10, [['現場での観察', project.current.observation], ['測定方法', project.current.method], ['層別の切り口', project.current.stratification], ['把握できた事実', project.current.finding]]);
  table(causes, 5, { name: '要因と検証', columns: ['分類', '要因', 'なぜ', '検証方法・結果', '状態'], rows: project.causes.map(c => [c.category, c.factor, c.why, c.verification, CAUSE[c.status]]) }, { input: true });
  table(actions, 5, { name: '対策の計画・結果', columns: ['対象の要因', '対策', '担当', '期限', '状態', '実施結果'], rows: project.actions.map(a => [project.causes.find(c => c.id === a.causeId)?.factor || '', a.action, a.owner, dateValue(a.dueDate), ACTION[a.status], a.result]) }, { input: true });
  [['指標', '対策前', '対策後'], [null, null, null]].forEach((row, i) => row.forEach((v, c) => put(effect, i + 5, c + 1, v)));
  formula(effect, 'A6', `'${STEPS[0]}'!B13`, text(project.theme.metricName));
  formula(effect, 'B6', 'IF(ISNUMBER(測定データ!M12),測定データ!M12,"")', analysis.before.value); formula(effect, 'C6', 'IF(ISNUMBER(測定データ!N12),測定データ!N12,"")', analysis.after.value);
  ['目標値', '改善量', '改善率（基準値比）', '目標判定'].forEach((v, i) => put(effect, i + 7, 1, v));
  formula(effect, 'B7', `IF(COUNTBLANK('${STEPS[0]}'!B17)=1,"",'${STEPS[0]}'!B17)`, project.theme.target);
  formula(effect, 'B8', `IF(AND(ISNUMBER(B6),ISNUMBER(C6)),IF(${lower},B6-C6,C6-B6),"")`, analysis.improvement);
  formula(effect, 'B9', 'IF(AND(ISNUMBER(B6),ISNUMBER(C6),B6>0),B8/B6*100,"")', analysis.improvementPercent);
  const judgment = analysis.targetMet === null ? project.theme.target !== null && !validTarget(project) ? '目標値を確認' : '未判定' : analysis.targetMet ? '目標値に到達' : '目標値に未到達';
  formula(effect, 'B10', `IF(NOT(ISNUMBER(B7)),IF(B7="","未判定","目標値を確認"),IF(OR(AND(${type}<>"平均（単純平均）",B7<0),AND(${type}="比率",B7>100)),"目標値を確認",IF(NOT(ISNUMBER(C6)),"未判定",IF(IF(${lower},C6<=B7,C6>=B7),"目標値に到達","目標値に未到達"))))`, judgment);
  formula(effect, 'C8', `IF(${type}="比率","pt",'${STEPS[0]}'!B15)`, project.theme.metricType === 'rate' ? 'pt' : analysis.unit); put(effect, 9, 3, '%');
  note(effect, 11, '改善率は対策前が正の値のときのみ算出。集計不可は空欄です。');
  for (let r = 13; r <= 31; r++) effect.getRow(r).height = 22;
  const basePlot = { type: 'bar', title: '対策前・対策後・目標値', categories: ['対策前', '対策後', '目標値'], series: [{ name: '指標値', values: [analysis.before.value, analysis.after.value, validTarget(project) ? project.theme.target : null] }] };
  const source = table(effect, 33, chartTable(basePlot));
  ['B6', 'C6', 'B7'].forEach((ref, i) => formula(effect, `B${source.start + i}`, `IF(AND(ISNUMBER(${ref})${i === 2 ? ',B10<>"目標値を確認"' : ''}),${ref},"")`, basePlot.series[0].values[i]));
  chartItems.push({ ...chartSpec(effect, 13, basePlot, source), endColumn: 4 });
  at = fields(effect, source.next, [['比較条件', project.effect.comparability], ['効果の結論', project.effect.conclusion], ['副作用・他工程への影響', project.effect.sideEffects], ['無形の効果', project.effect.intangible]]);
  if (analysis.warnings.length) field(effect, at, '出力時の確認事項', analysis.warnings.join('\n'), { input: false });
  table(standards, 5, { name: '標準化・維持管理', columns: ['標準・ルール', '文書', '担当', '頻度', '確認方法', '異常時の対応', '教育'], rows: project.standards.map(s => [s.rule, s.document, s.owner, s.frequency, s.checkMethod, s.response, s.education]) }, { input: true });
  fields(reflection, 5, [['良かった点', project.reflection.good], ['改善すべき点', project.reflection.improve], ['残された課題', project.reflection.remaining], ['次の活動', project.reflection.nextAction], ['担当', project.reflection.owner], ['期限', dateValue(project.reflection.dueDate)]]);
  for (const { tool, spec, result, index } of tools) {
    const raw = rawTable(tool, spec), width = Math.max(8, raw.columns.length, ...result.tables.map(t => t.columns.length));
    const sheet = newSheet(wb, sheetName(index, spec.name), project, Array.from({ length: width }, (_, i) => i ? 24 : 30), tool);
    at = fields(sheet, 5, [['名称', tool.title], ['関連工程', stage(tool.step)]], { input: false });
    at = note(sheet, at, SNAPSHOT); at++;
    if (result.metrics.length) at = table(sheet, at, { name: '解析値（出力時点）', columns: ['項目', '値', '単位'], rows: result.metrics.map(m => [m.label, m.value, m.unit || '']) }).next;
    if (settings(tool, spec).length) at = table(sheet, at, { name: '設定', columns: ['項目', '設定値'], rows: settings(tool, spec) }, { input: true }).next;
    if (tool.notes) at = field(sheet, at, '注記', tool.notes);
    for (const warning of result.warnings) at = note(sheet, at, warning);
    for (const plot of result.charts.flatMap(plots)) {
      if (plot.companion) at = note(sheet, at, 'パレート図の量と累積比率は別のグラフで表示しています。');
      if (plot.omitted) at = note(sheet, at, '初回の移動範囲は計算できないため2点目から図示。表では空欄。');
      const start = at;
      for (let r = at; r < at + 20; r++) sheet.getRow(r).height = 22;
      at += 21;
      const source = table(sheet, at, { ...chartTable(plot), name: `グラフ用集計値（出力時点）：${plot.title}` }, { preserveRows: true });
      chartItems.push(chartSpec(sheet, start, plot, source)); at = source.next;
    }
    for (const t of result.tables.filter(t => !['入力データ', '入力行列'].includes(t.name))) at = table(sheet, at, { ...t, name: `${t.name}（出力時点）` }).next;
    table(sheet, at, raw, { input: true });
    if (tool.kind !== 'matrix') {
      const scenes = buildToolScenes(tool, result);
      if (scenes.length) {
        const diagram = newSheet(wb, sheetName(index, spec.name, '図'), project, Array(50).fill(2.5), tool); at = 5;
        for (const [i, scene] of scenes.entries()) {
          diagram.mergeCells(at, 1, at, 50); diagram.getCell(at, 1).value = `${spec.name} セル配置図 ${i + 1}`; diagram.getCell(at, 1).font = font(true, 14); diagram.getRow(at++).height = 30;
          diagram.mergeCells(at, 1, at, 50); diagram.getCell(at, 1).value = `${sample(project, tool)} N番号の全文は図の下に記載。${SNAPSHOT}`; diagram.getCell(at, 1).font = font(false, 10, C.orange); diagram.getCell(at, 1).alignment = { wrapText: true }; diagram.getRow(at++).height = 33;
          at = cellScene(diagram, scene, at + 1);
        }
      }
    }
  }
  return addNativeCharts(await wb.xlsx.writeBuffer(), chartItems);
}
