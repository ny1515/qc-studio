import { analyzeProject } from '../../lib/model.mjs';
import { TOOL_CATALOG, analyzeTool } from '../../lib/qc-tools.mjs';
export { buildToolScenes } from '../../lib/tool-scenes.mjs';

export const STEPS = ['テーマの選定', '現場把握', '要因の解析', '対策の立案', '効果の確認', '標準化と管理の定着', '反省と残された課題'];
export const STEP_IDS = ['theme', 'current', 'causes', 'actions', 'effect', 'standards', 'reflection'];
export const C = { ink: '173249', teal: '087E8B', muted: '627484', pale: 'EEF4F5', paper: 'FCFBF7', amber: 'FFF2D3', orange: 'BC6B24', line: 'D5DFE4' };
export const COLORS = [C.teal, C.orange, '627D98', 'A64E68', '687F35', '775B97'];
export const FONT = 'Yu Gothic';
export const SNAPSHOT = '解析結果は出力時点の値です。入力を変更した場合はアプリで再計算して再出力してください。';
export const TYPE = { rate: '比率', count: '合計', average: '平均（単純平均）' };
export const CAUSE = { hypothesis: '仮説', confirmed: '確認済み', rejected: '棄却' };
export const ACTION = { planned: '計画', doing: '実施中', done: '完了' };
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const text = value => value === null || value === undefined || value === '' ? '未入力' : String(value);
export const sample = (project, tool) => project.isSample || tool?.isSample ? 'サンプル（架空データ）' : '';
export const stage = id => STEPS[STEP_IDS.indexOf(id)] || id;
export const display = (value, unit = '') => finite(value) ? `${value !== 0 && Math.abs(value) < .001 ? value.toExponential(4) : new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 5 }).format(value)}${unit ? ` ${unit}` : ''}` : '未入力・集計不可';
export const typeNote = p => p.theme.metricType === 'rate' ? '比率＝値の合計÷母数の合計×100。各行は重複しない検査対象とします。' : p.theme.metricType === 'average' ? '平均は測定値の単純平均です。重みづけは行いません。' : '合計は測定値の総和です。';
export const validTarget = p => finite(p.theme.target) && (p.theme.metricType === 'average' || p.theme.target >= 0) && (p.theme.metricType !== 'rate' || p.theme.target <= 100);
export const column = value => { let name = ''; for (let n = value; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; };
export const dateValue = value => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
export function wrap(value, units) {
  const lines = [];
  for (const paragraph of String(value ?? '').split('\n')) {
    let line = '', length = 0;
    for (const char of paragraph) {
      const width = /[\x20-\x7e]/.test(char) ? .55 : 1;
      if (line && length + width > units) { lines.push(line); line = ''; length = 0; }
      line += char; length += width;
    }
    lines.push(line);
  }
  return lines;
}
export function chunks(value, units, maxLines = 8) {
  const lines = wrap(value ?? '', units), parts = [];
  for (let i = 0; i < lines.length; i += maxLines) parts.push(lines.slice(i, i + maxLines).join('\n'));
  return parts;
}
export function axisFormat(values) {
  const list = values.filter(finite), magnitude = Math.max(0, ...list.map(Math.abs));
  if (!magnitude) return '0';
  if (magnitude < 1e-5 || magnitude >= 1e7) return '0.00E+00';
  const step = (Math.max(...list) - Math.min(...list) || magnitude) / 8;
  const places = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))));
  return places ? `0.${'0'.repeat(places)}` : '0';
}
export function prepare(project) {
  const analysis = analyzeProject(project);
  const invalid = (analysis.measurementErrors || []).filter(e => e.kind === 'invalid');
  if (invalid.length) throw new Error(`測定データを確認してください：${invalid.map(e => `${e.index + 1}行目 ${e.message}`).join('／')}`);
  const tools = (project.tools || []).filter(t => t.included !== false).map((tool, index) => {
    const spec = TOOL_CATALOG.find(s => s.kind === tool.kind), result = analyzeTool(tool);
    if (!spec || !result.valid) throw new Error(`${tool.title || tool.kind}：${result.errors?.join('／') || '未対応の道具です'}`);
    return { tool, spec, result, index: index + 1 };
  });
  return { analysis, tools };
}
export function rawTable(tool, spec) {
  return spec.matrix ? { name: '入力行列', columns: ['観測・行の名称', ...tool.matrix.columns], rows: tool.matrix.rows.map(r => [r.label, ...r.values]) }
    : { name: '入力データ', columns: spec.columns.map(c => c.label), rows: tool.rows.map(r => spec.columns.map(c => r[c.key] ?? null)) };
}
export function settings(tool, spec) {
  return (spec.settings || []).map(s => [s.label, s.options?.find(o => o.value === tool.settings?.[s.key])?.label ?? tool.settings?.[s.key] ?? null]);
}
export function plots(chart) {
  const normalize = c => {
    if (c.type === 'scatter') return [c];
    const indices = c.categories.map((_, i) => i).filter(i => c.series.every(s => finite(s.values[i])));
    if (!indices.length) return [];
    return [{ ...c, categories: indices.map(i => c.categories[i]), series: c.series.map(s => ({ ...s, values: indices.map(i => s.values[i]) })), omitted: c.categories.length - indices.length }];
  };
  if (chart.type === 'pareto') return [
    { ...chart, type: 'bar', title: `${chart.title}：量`, series: chart.series.filter(s => s.axis !== 'right'), companion: true },
    { ...chart, type: 'line', title: `${chart.title}：累積比率`, yLabel: '累積比率（%）', series: chart.series.filter(s => s.axis === 'right'), percentScale: true, companion: true },
  ].filter(c => c.series.length).flatMap(normalize);
  return normalize({ ...chart, type: chart.type === 'histogram' ? 'bar' : chart.type, histogram: chart.type === 'histogram' });
}
export function chartTable(plot) {
  return plot.type === 'scatter' ? { name: plot.title, columns: [plot.xLabel || 'X', plot.yLabel || 'Y', 'ラベル'], rows: plot.points.map(p => [p.x, p.y, p.label || '']) }
    : { name: plot.title, columns: ['区分', ...plot.series.map(s => s.name)], rows: plot.categories.map((c, i) => [c, ...plot.series.map(s => s.values[i])]) };
}
