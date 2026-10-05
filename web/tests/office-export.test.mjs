import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createOfficeBlob } from '../src/browser-exports.mjs';
import { createBlankProject, createSampleProject, analyzeProject } from '../../lib/model.mjs';
import { TOOL_CATALOG, createTool } from '../../lib/qc-tools.mjs';

const zipFor = async (p, format) => {
  const blob = await createOfficeBlob({ project: p, format });
  assert.ok(blob instanceof Blob); assert.ok(blob.size > 1000);
  return JSZip.loadAsync(await blob.arrayBuffer());
};
const read = (zip, name) => zip.file(name).async('string');
const names = (zip, pattern) => Object.keys(zip.files).filter(n => pattern.test(n));
const pointValues = (xml, tag) => [...(xml.match(new RegExp(`<c:${tag}>[\\s\\S]*?<\\/c:${tag}>`, 'g')) || [])].map(part => [...part.matchAll(/<c:pt idx="\d+"><c:v>([^<]*)<\/c:v><\/c:pt>/g)].map(m => Number(m[1])));
const cell = (xml, ref) => xml.match(new RegExp(`<c r="${ref}"[^>]*>[\\s\\S]*?<\\/c>`))?.[0] || '';

test('Office exports reject invalid values and retain incomplete measurements', async () => {
  const p = createBlankProject();
  p.measurements = [{ id: 'a', phase: 'before', date: '', category: '', value: null, denominator: null, note: '' }];
  for (const format of ['pptx', 'xlsx']) await zipFor(p, format);
  p.measurements[0].value = -1; p.measurements[0].denominator = 10;
  await assert.rejects(() => createOfficeBlob({ project: p, format: 'xlsx' }), /測定データ/);
  await assert.rejects(() => createOfficeBlob({ project: p, format: 'zip' }), /出力形式/);
});

test('XLSX keeps zero caches, weighted rate formulas, numeric dates and literal strings', async () => {
  const p = createBlankProject(); p.theme.metricName = '=1+2'; p.theme.target = 0;
  p.measurements = [{ id: 'a', phase: 'before', date: '2026-01-01', category: '=SUM(A1)', value: 1, denominator: 1000, note: '=HYPERLINK("https://invalid.example")' }, { id: 'b', phase: 'after', date: '2026-01-02', category: '', value: 0, denominator: 10, note: '' }];
  const zip = await zipFor(p, 'xlsx'), data = await read(zip, 'xl/worksheets/sheet8.xml'), effect = await read(zip, 'xl/worksheets/sheet5.xml'), theme = await read(zip, 'xl/worksheets/sheet1.xml');
  assert.match(cell(data, 'M12'), /<v>0\.1<\/v>/); assert.match(cell(data, 'N12'), /<v>0<\/v>/);
  assert.match(cell(data, 'M12'), /M10\/M11\*100/); assert.match(cell(data, 'M12'), /M8&lt;&gt;M9/);
  assert.match(cell(data, 'I507'), /ISNUMBER\(D507\)/);
  assert.match(cell(effect, 'C6'), /<v>0<\/v>/); assert.match(cell(effect, 'B7'), /<v>0<\/v>/);
  assert.match(cell(effect, 'B10'), /<v>目標値に到達<\/v>/);
  assert.match(cell(effect, 'B10'), /B7&gt;100/);
  assert.doesNotMatch(cell(data, 'B8'), /t="s"/); assert.match(cell(data, 'B8'), /<v>\d+<\/v>/);
  assert.doesNotMatch(cell(theme, 'B13'), /<f>/); assert.doesNotMatch(cell(data, 'F8'), /<f>/);
  assert.doesNotMatch(data, /<f>[^<]*HYPERLINK/);
  const chart = await read(zip, 'xl/charts/chart1.xml');
  assert.match(chart, /<c:numRef><c:f>&apos;効果の確認&apos;!\$B\$/);
  assert.deepEqual(pointValues(chart, 'val'), [[.1, 0, 0]]);
});

test('All 15 tools export native XLSX charts and native PPT charts, tables and target arrows', async () => {
  const p = createSampleProject(); p.tools = TOOL_CATALOG.map(s => createTool(s.kind, { sample: true }));
  const analysis = analyzeProject(p), xlsx = await zipFor(p, 'xlsx'), pptx = await zipFor(p, 'pptx');
  const workbook = await read(xlsx, 'xl/workbook.xml');
  assert.equal((workbook.match(/<sheet /g) || []).length, 29);
  for (const spec of TOOL_CATALOG) assert.ok(workbook.includes(spec.name), spec.name);
  const xcharts = await Promise.all(names(xlsx, /^xl\/charts\/chart\d+\.xml$/).map(n => read(xlsx, n)));
  assert.equal(xcharts.length, 10); assert.equal(xcharts.filter(c => c.includes('<c:scatterChart>')).length, 2);
  const scatter = xcharts.find(c => c.includes('<c:scatterChart>') && c.includes('散布図'));
  assert.deepEqual(pointValues(scatter, 'xVal'), [[1, 2, 3, 4, 5]]);
  assert.deepEqual(pointValues(scatter, 'yVal'), [[2.1, 3.7, 6.2, 7.8, 9.6]]);
  const pca = xcharts.find(c => c.includes('主成分得点'));
  const pcaAnalysis = analysis.tools.find(t => t.kind === 'pca');
  assert.deepEqual(pointValues(pca, 'xVal'), [pcaAnalysis.charts[0].points.map(p => p.x)]);
  assert.deepEqual(pointValues(pca, 'yVal'), [pcaAnalysis.charts[0].points.map(p => p.y)]);
  assert.match(pca, /formatCode="0\.00"/);
  const slides = await Promise.all(names(pptx, /^ppt\/slides\/slide\d+\.xml$/).map(n => read(pptx, n)));
  assert.ok(slides.length > 60); assert.ok(slides.some(s => s.includes('<a:tbl>')));
  const entire = slides.join('');
  for (const spec of TOOL_CATALOG) assert.ok(entire.includes(spec.name), spec.name);
  assert.ok(entire.includes('入力を変更した場合はアプリで再計算して再出力'));
  assert.ok(entire.includes('サンプル（架空データ）'));
  const targetArrows = [...entire.matchAll(/<a:tailEnd[^>]*type="triangle"/g)];
  assert.ok(targetArrows.length >= 10); assert.doesNotMatch(entire, /<a:headEnd[^>]*type="triangle"/);
  const pcharts = await Promise.all(names(pptx, /^ppt\/charts\/chart\d+\.xml$/).map(n => read(pptx, n)));
  assert.equal(pcharts.length, 12);
  assert.equal(pcharts.filter(c => c.includes('<c:scatterChart>')).length, 2);
  for (const c of pcharts.filter(c => c.includes('<c:scatterChart>'))) { assert.equal(pointValues(c, 'xVal')[0].length, 5); assert.equal(pointValues(c, 'yVal')[0].length, 5); }
  assert.equal(names(pptx, /^ppt\/embeddings\/.*\.xlsx$/).length, 12);
});

test('Renamed samples remain disclosed; excluded incomplete tools do not block output', async () => {
  const p = createBlankProject(), included = createTool('pareto', { sample: true }), excluded = createTool('scatter');
  included.title = '名称変更'; included.notes = ''; excluded.included = false; p.tools = [included, excluded];
  const pptx = await zipFor(p, 'pptx');
  const slides = await Promise.all(names(pptx, /^ppt\/slides\/slide\d+\.xml$/).map(n => read(pptx, n)));
  for (const xml of slides.filter(s => s.includes('道具 01'))) assert.ok(xml.includes('サンプル（架空データ）'));
  excluded.included = true;
  await assert.rejects(() => createOfficeBlob({ project: p, format: 'xlsx' }), /散布図/);
});

test('Long multiline fields and native table input retain their final text', async () => {
  const p = createBlankProject();
  p.meta.members = Array(90).fill('長文メンバー').join('\n') + '\n末尾メンバーXYZ';
  p.current.observation = '観察記録'.repeat(500) + '末尾観察XYZ';
  p.causes = [{ id: 'cause', category: '方法', factor: '要因'.repeat(1000) + '末尾要因XYZ', why: '', verification: '', status: 'hypothesis' }];
  const pptx = await zipFor(p, 'pptx'), xlsx = await zipFor(p, 'xlsx');
  const slideText = (await Promise.all(names(pptx, /^ppt\/slides\/slide\d+\.xml$/).map(n => read(pptx, n)))).join('').replace(/<[^>]+>/g, '').replace(/\s+/g, '');
  const strings = (await read(xlsx, 'xl/sharedStrings.xml')).replace(/<[^>]+>/g, '').replace(/\s+/g, '');
  for (const marker of ['末尾メンバーXYZ', '末尾観察XYZ', '末尾要因XYZ']) { assert.ok(slideText.includes(marker), `PPT ${marker}`); assert.ok(strings.includes(marker), `XLSX ${marker}`); }
});
