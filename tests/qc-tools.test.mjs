import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_CATALOG,
  createTool,
  normalizeTools,
  analyzeTool,
  analyzeTools,
} from '../lib/qc-tools.mjs';
import { createBlankProject, normalizeProject, analyzeProject } from '../lib/model.mjs';

// Independent reference fixtures. Control-chart conventions were checked against:
// https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc322.htm
// https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc321.htm
// https://www.itl.nist.gov/div898/software/dataplot/refman1/ch2/pcontrol.pdf
// PCA uses standardized columns and sample covariance (NIST Y = ZV):
// https://www.itl.nist.gov/div898/handbook/pmc/section5/pmc55.htm

const QC = ['pareto', 'fishbone', 'checksheet', 'histogram', 'scatter', 'control', 'graph'];
const NEW_QC = ['affinity', 'relations', 'tree', 'matrix', 'pca', 'arrow', 'pdpc'];
const ALL_KINDS = [...QC, ...NEW_QC, 'stratification'];
let rowId = 0;

function fixture(kind, rows = [], settings = {}) {
  const tool = createTool(kind);
  tool.rows = rows.map(row => ({ id: `test-row-${++rowId}`, ...row }));
  Object.assign(tool.settings, settings);
  return tool;
}

function matrixFixture(kind, values, columns = values[0]?.map((_, i) => `変数${i + 1}`) ?? []) {
  const tool = fixture(kind);
  tool.matrix = {
    columns,
    rows: values.map((values, i) => ({ id: `matrix-row-${++rowId}`, label: `観測${i + 1}`, values })),
  };
  return tool;
}

function near(actual, expected, tolerance = 1e-9) {
  assert.equal(typeof actual, 'number', `Expected a number near ${expected}, received ${actual}`);
  assert.ok(Number.isFinite(actual), `Expected finite value, received ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

function valid(result) {
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
  return result;
}

function invalid(result) {
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0, 'An invalid draft needs an actionable error');
  assert.ok(result.errors.every(error => typeof error === 'string' && error.trim()));
}

const BASIC_PARETO = [
  { label: 'A', value: 2 }, { label: 'B', value: 3 },
  { label: 'A', value: 4 }, { label: 'C', value: 1 },
];
const NIST_IMR = [49.6, 47.6, 49.9, 51.3, 47.8, 51.2, 52.6, 52.4, 53.6, 52.1];
const CPM_DIAMOND = [
  { key: 'A', label: '作業A', from: '1', to: '2', value: 3 },
  { key: 'B', label: '作業B', from: '1', to: '3', value: 2 },
  { key: 'C', label: '作業C', from: '2', to: '4', value: 4 },
  { key: 'D', label: '作業D', from: '3', to: '4', value: 2 },
];

test('catalog contains seven QC tools, seven new QC tools, and a separately named stratification tool', () => {
  assert.deepEqual(TOOL_CATALOG.filter(tool => tool.family === 'qc').map(tool => tool.kind).sort(), QC.toSorted());
  assert.deepEqual(TOOL_CATALOG.filter(tool => tool.family === 'newqc').map(tool => tool.kind).sort(), NEW_QC.toSorted());
  assert.deepEqual(TOOL_CATALOG.filter(tool => tool.family === 'extra').map(tool => tool.kind), ['stratification']);
  assert.equal(new Set(TOOL_CATALOG.map(tool => tool.kind)).size, 15);
});

test('new tools do not insert fictional observations into a real activity', () => {
  for (const kind of ALL_KINDS) {
    const tool = createTool(kind);
    assert.equal(tool.kind, kind);
    assert.deepEqual(tool.rows, []);
    assert.deepEqual(tool.matrix.rows, []);
    assert.ok(!tool.title.startsWith('サンプル'));
  }
});

test('explicit examples are labeled as fictional and each tool produces valid analysis', () => {
  for (const kind of ALL_KINDS) {
    const tool = createTool(kind, { sample: true });
    assert.ok(tool.title.startsWith('サンプル'), kind);
    assert.match(tool.notes, /架空データ/);
    valid(analyzeTool(tool));
  }
});

test('every empty tool is an incomplete draft with a specific error', () => {
  for (const kind of ALL_KINDS) invalid(analyzeTool(createTool(kind)));
});

test('a missing numeric field is never silently dropped to make a partial result', () => {
  const cases = [
    ['pareto', [{ label: 'A', value: 4 }, { label: 'B', value: null }]],
    ['histogram', [{ label: 'A', value: 4 }, { label: 'B', value: null }]],
    ['scatter', [{ label: 'A', x: 1, y: 2 }, { label: 'B', x: 2, y: null }]],
    ['control', [{ label: 'A', value: 4, denominator: null }, { label: 'B', value: null, denominator: null }]],
    ['graph', [{ label: 'A', value: 4 }, { label: 'B', value: null }]],
    ['stratification', [{ label: 'A', group: 'G', value: 4 }, { label: 'B', group: 'G', value: null }]],
  ];
  for (const [kind, rows] of cases) invalid(analyzeTool(fixture(kind, rows)));
});

test('Pareto combines duplicate categories and computes descending cumulative shares', () => {
  const result = valid(analyzeTool(fixture('pareto', BASIC_PARETO)));
  assert.deepEqual(result.details.pareto, [
    { label: 'A', value: 6, cumulativePercent: 60 },
    { label: 'B', value: 3, cumulativePercent: 90 },
    { label: 'C', value: 1, cumulativePercent: 100 },
  ]);
  const chart = result.charts.find(chart => chart.type === 'pareto');
  assert.deepEqual(chart.categories, ['A', 'B', 'C']);
  assert.deepEqual(chart.series.find(series => series.axis === 'right').values, [60, 90, 100]);
});

test('a zero-total Pareto preserves zero counts and leaves percentages undefined', () => {
  const result = valid(analyzeTool(fixture('pareto', [{ label: 'A', value: 0 }, { label: 'B', value: 0 }])));
  assert.equal(result.details.pareto.length, 2);
  assert.ok(result.details.pareto.every(row => row.value === 0 && row.cumulativePercent === null));
  assert.ok(result.warnings.length > 0);
});

test('checksheet keeps unobserved combinations blank instead of creating a zero count', () => {
  const result = valid(analyzeTool(fixture('checksheet', [
    { label: 'A', group: '午前', value: 0 },
    { label: 'B', group: '午前', value: 2 },
    { label: 'B', group: '午後', value: 3 },
    { label: 'B', group: '午後', value: 4 },
  ])));
  const table = result.tables.find(table => table.name === 'チェック集計');
  assert.deepEqual(table.rows, [['A', 0, null], ['B', 2, 7]]);
});

test('histogram bins are lower-inclusive, upper-exclusive, with the final maximum included', () => {
  const result = valid(analyzeTool(fixture('histogram', [0, 1, 2, 3, 4].map(value => ({ label: '', value })), { bins: 2 })));
  assert.deepEqual(result.details.bins, [
    { lower: 0, upper: 2, count: 2, upperInclusive: false },
    { lower: 2, upper: 4, count: 3, upperInclusive: true },
  ]);
});

test('decimal histogram boundaries do not move a threshold observation into the previous bin', () => {
  const result = valid(analyzeTool(fixture('histogram', [0, 0.1, 0.2, 0.3, 0.4].map(value => ({ label: '', value })), { bins: 4 })));
  assert.deepEqual(result.details.bins.map(bin => bin.count), [1, 1, 1, 2]);
  const closeBelow = valid(analyzeTool(fixture('histogram', [0, 0.1, 0.2, 0.2999999, 0.3, 0.4].map(value => ({ label: '', value })), { bins: 4 })));
  assert.deepEqual(closeBelow.details.bins.map(bin => bin.count), [1, 1, 2, 2]);
  const adjacentBelow = valid(analyzeTool(fixture('histogram', [0, 0.1, 0.2, 0.29999999999999993, 0.3, 0.4].map(value => ({ label: '', value })), { bins: 4 })));
  assert.deepEqual(adjacentBelow.details.bins.map(bin => bin.count), [1, 1, 2, 2]);
});

test('constant observations use a finite one-bin histogram with every observation retained', () => {
  const result = valid(analyzeTool(fixture('histogram', Array.from({ length: 5 }, () => ({ label: '', value: 7 })), { bins: 8 })));
  assert.deepEqual(result.details.bins, [{ lower: 7, upper: 7, count: 5, upperInclusive: true }]);
  assert.ok(result.warnings.length > 0);
});

test('Pearson correlation distinguishes perfect positive and negative linear association', () => {
  for (const [ys, expected] of [[[2, 4, 6], 1], [[5, 3, 1], -1]]) {
    const result = valid(analyzeTool(fixture('scatter', ys.map((y, x) => ({ label: `点${x}`, x, y })))));
    near(result.details.correlation, expected);
    assert.equal(result.charts.find(chart => chart.type === 'scatter').points.length, 3);
    assert.ok(result.warnings.some(warning => /因果/.test(warning)));
  }
});

test('constant scatter variables have undefined correlation while retaining the visible points', () => {
  for (const rows of [
    [{ x: 2, y: 1 }, { x: 2, y: 3 }, { x: 2, y: 5 }],
    [{ x: 1, y: 2 }, { x: 3, y: 2 }, { x: 5, y: 2 }],
  ]) {
    const result = valid(analyzeTool(fixture('scatter', rows.map(row => ({ label: '', ...row })))));
    assert.equal(result.details.correlation, null);
    assert.equal(result.charts[0].points.length, 3);
    assert.ok(result.warnings.some(warning => /定義|ばらつき/.test(warning)));
  }
});

test('I-MR matches the independent NIST ten-observation example and preserves input order', () => {
  const rows = NIST_IMR.map((value, i) => ({ label: `時点${10 - i}`, value, denominator: null }));
  const result = valid(analyzeTool(fixture('control', rows, { mode: 'imr' })));
  result.details.cl.forEach(value => near(value, 50.81));
  result.details.lcl.forEach(value => near(value, 45.81591016548464));
  result.details.ucl.forEach(value => near(value, 55.804089834515366));
  near(result.details.movingRange.center, 1.8777777777777778);
  near(result.details.movingRange.ucl, 6.1347);
  assert.equal(result.details.movingRange.lcl, 0);
  assert.equal(result.details.movingRange.values[0], null);
  [2, 2.3, 1.4, 3.5, 3.4, 1.4, 0.2, 1.2, 1.5].forEach((expected, i) => near(result.details.movingRange.values[i + 1], expected));
  assert.deepEqual(result.details.outOfControl, []);
  assert.deepEqual(result.details.movingRange.outOfControl, []);
  assert.deepEqual(result.charts[0].categories, rows.map(row => row.label));
});

test('I-MR flags only points strictly outside the limits, including moving-range excursions', () => {
  const rows = [...Array(20).fill(0), 100].map((value, i) => ({ label: `時点${i + 1}`, value, denominator: null }));
  const result = valid(analyzeTool(fixture('control', rows, { mode: 'imr' })));
  assert.deepEqual(result.details.outOfControl, [20]);
  assert.deepEqual(result.details.movingRange.outOfControl, [20]);
  near(result.details.movingRange.ucl, 16.335);

  const constant = valid(analyzeTool(fixture('control', [1, 2, 3].map(i => ({ label: String(i), value: 5, denominator: null })), { mode: 'imr' })));
  assert.deepEqual(constant.details.cl, [5, 5, 5]);
  assert.deepEqual(constant.details.ucl, [5, 5, 5]);
  assert.deepEqual(constant.details.lcl, [5, 5, 5]);
  assert.deepEqual(constant.details.outOfControl, []);
  assert.equal(constant.details.movingRange.center, 0);
});

test('p control uses the pooled proportion and changes limits with each inspected population', () => {
  const result = valid(analyzeTool(fixture('control', [
    { label: '小集団', value: 1, denominator: 10 },
    { label: '大集団', value: 1, denominator: 90 },
  ], { mode: 'p' })));
  assert.deepEqual(result.details.cl, [2, 2]);
  near(result.details.observed[0], 10);
  near(result.details.observed[1], 1.1111111111111112);
  near(result.details.ucl[0], 15.281566172707192);
  near(result.details.ucl[1], 6.427188724235731);
  assert.deepEqual(result.details.lcl, [0, 0]);
  assert.deepEqual(result.details.outOfControl, []);
  assert.equal(result.charts[0].yLabel, '%');
});

test('p control bounds remain inside 0–100% and zero defect counts remain real zeroes', () => {
  const high = valid(analyzeTool(fixture('control', [
    { label: 'A', value: 9, denominator: 10 }, { label: 'B', value: 100, denominator: 100 },
  ], { mode: 'p' })));
  assert.deepEqual(high.details.ucl, [100, 100]);
  near(high.details.cl[0], 99.0909090909091);
  near(high.details.lcl[0], 90.08677780769865);

  const zero = valid(analyzeTool(fixture('control', [
    { label: 'A', value: 0, denominator: 10 }, { label: 'B', value: 0, denominator: 90 },
  ], { mode: 'p' })));
  assert.deepEqual(zero.details.observed, [0, 0]);
  assert.deepEqual(zero.details.cl, [0, 0]);
  assert.deepEqual(zero.details.ucl, [0, 0]);
  assert.deepEqual(zero.details.lcl, [0, 0]);
  assert.deepEqual(zero.details.outOfControl, []);
});

test('p control rejects missing, fractional, negative or impossible count/population inputs', () => {
  for (const [value, denominator] of [[null, 10], [1, null], [-1, 10], [0, 0], [1, -10], [0.5, 10], [1, 10.5], [11, 10]]) {
    invalid(analyzeTool(fixture('control', [
      { label: '正常行', value: 1, denominator: 10 }, { label: '要確認行', value, denominator },
    ], { mode: 'p' })));
  }
});

test('stratification retains sample counts and uses an unweighted within-group mean or sum', () => {
  const rows = [{ group: 'A', value: 0 }, { group: 'A', value: 6 }, { group: 'B', value: 10 }].map(row => ({ label: '', ...row }));
  const average = valid(analyzeTool(fixture('stratification', rows, { aggregation: 'mean' })));
  assert.deepEqual(average.details.groups, [{ group: 'A', count: 2, value: 3 }, { group: 'B', count: 1, value: 10 }]);
  const total = valid(analyzeTool(fixture('stratification', rows, { aggregation: 'sum' })));
  assert.deepEqual(total.details.groups, [{ group: 'A', count: 2, value: 6 }, { group: 'B', count: 1, value: 10 }]);
});

test('normalization preserves a blank matrix relationship separately from explicit zero', () => {
  const tool = matrixFixture('matrix', [[null, 0, 1, 3, 9]]);
  const [normalized] = normalizeTools([tool]);
  assert.deepEqual(normalized.matrix.rows[0].values, [null, 0, 1, 3, 9]);
  invalid(analyzeTool(normalized));
  valid(analyzeTool(matrixFixture('matrix', [[0, 0, 1, 3, 9]])));
});

test('relationship matrix accepts only the declared relationship scale', () => {
  for (const value of [-1, 2, 4, 10]) invalid(analyzeTool(matrixFixture('matrix', [[value]])));
});

test('relations permit cycles and disconnected nodes but reject unknown destinations', () => {
  const rows = [
    { key: 'A', label: '要因A', to: 'B' },
    { key: 'B', label: '要因B', to: 'A' },
    { key: 'C', label: '独立要因', to: '' },
  ];
  valid(analyzeTool(fixture('relations', rows)));
  rows[0].to = 'B, absent';
  invalid(analyzeTool(fixture('relations', rows)));
});

test('tree accepts input out of parent order but requires one acyclic rooted hierarchy', () => {
  const rows = [
    { key: 'B', parent: 'A', label: '手段B' },
    { key: 'C', parent: 'A', label: '手段C' },
    { key: 'A', parent: '', label: '目的A' },
  ];
  valid(analyzeTool(fixture('tree', rows)));
  for (const invalidRows of [
    [{ key: 'A', parent: 'B', label: 'A' }, { key: 'B', parent: 'A', label: 'B' }],
    [{ key: 'A', parent: 'A', label: 'A' }],
    [{ key: 'A', parent: '', label: 'A' }, { key: 'B', parent: '', label: 'B' }],
    [{ key: 'A', parent: '', label: 'A' }, { key: 'B', parent: 'missing', label: 'B' }],
  ]) invalid(analyzeTool(fixture('tree', invalidRows)));
});

test('duplicate semantic keys cannot make reference diagrams ambiguous', () => {
  for (const kind of ['relations', 'tree']) {
    invalid(analyzeTool(fixture(kind, [
      { key: 'A', label: 'first', parent: '', to: '' },
      { key: 'A', label: 'second', parent: '', to: '' },
    ])));
  }
});

test('arrow CPM rejects cycles and multiple starting or finishing events', () => {
  for (const rows of [
    [{ key: 'A', label: 'A', from: '1', to: '2', value: 1 }, { key: 'B', label: 'B', from: '2', to: '1', value: 1 }],
    [{ key: 'A', label: 'A', from: '1', to: '3', value: 1 }, { key: 'B', label: 'B', from: '2', to: '3', value: 1 }],
    [{ key: 'A', label: 'A', from: '1', to: '2', value: 1 }, { key: 'B', label: 'B', from: '1', to: '3', value: 1 }],
    [{ key: 'A', label: 'A', from: '1', to: '1', value: 0 }],
  ]) invalid(analyzeTool(fixture('arrow', rows)));
});

test('negative activity duration is an invalid draft, while a zero-duration dummy is allowed', () => {
  invalid(analyzeTool(fixture('arrow', [{ key: 'A', label: 'A', from: '1', to: '2', value: -1 }])));
  valid(analyzeTool(fixture('arrow', [{ key: 'D', label: 'ダミー', from: '1', to: '2', value: 0 }])));
});

test('activity-on-arrow CPM uses the longest path and calculates event times and total float', () => {
  const result = valid(analyzeTool(fixture('arrow', CPM_DIAMOND)));
  assert.equal(result.details.duration, 7);
  const times = Object.fromEntries(result.details.nodes.map(node => [node.key, [node.earliest, node.latest]]));
  assert.deepEqual(times, { 1: [0, 0], 2: [3, 3], 3: [2, 5], 4: [7, 7] });
  const activities = Object.fromEntries(result.details.activities.map(row => [row.key, row]));
  for (const [key, expected] of Object.entries({
    A: [0, 3, 0, 3, 0, true], B: [0, 2, 3, 5, 3, false],
    C: [3, 7, 3, 7, 0, true], D: [2, 4, 5, 7, 3, false],
  })) {
    const row = activities[key];
    assert.deepEqual([row.earliestStart, row.earliestFinish, row.latestStart, row.latestFinish, row.totalFloat, row.critical], expected);
  }
  const reordered = valid(analyzeTool(fixture('arrow', CPM_DIAMOND.toReversed())));
  assert.equal(reordered.details.duration, 7);
  assert.deepEqual(Object.fromEntries(reordered.details.nodes.map(node => [node.key, [node.earliest, node.latest]])), times);
});

test('zero-duration dummy activities retain the required predecessor constraint', () => {
  const result = valid(analyzeTool(fixture('arrow', [
    { key: 'A', label: 'A', from: 'S', to: 'A', value: 2 },
    { key: 'B', label: 'B', from: 'S', to: 'B', value: 3 },
    { key: 'D', label: 'ダミー', from: 'A', to: 'B', value: 0 },
    { key: 'C', label: 'C', from: 'B', to: 'E', value: 4 },
  ])));
  assert.equal(result.details.duration, 7);
  const dummy = result.details.activities.find(row => row.key === 'D');
  assert.equal(dummy.totalFloat, 1);
  assert.equal(dummy.critical, false);
  assert.deepEqual(result.details.activities.filter(row => row.critical).map(row => row.key).sort(), ['B', 'C']);
});

test('PCA standardizes unequal measurement units before computing eigenvalues and scores', () => {
  const result = valid(analyzeTool(matrixFixture('pca', [[1, 10], [2, 20], [3, 30]])));
  assert.deepEqual(result.details.means, [2, 20]);
  assert.deepEqual(result.details.sd, [1, 10]);
  near(result.details.eigenvalues[0], 2);
  near(result.details.eigenvalues[1], 0);
  near(result.details.explained[0], 100);
  near(result.details.explained[1], 0);
  near(Math.abs(result.details.coefficients[0][0]), Math.SQRT1_2);
  near(Math.abs(result.details.coefficients[0][1]), Math.SQRT1_2);
  near(Math.abs(result.details.scores[0][0]), Math.SQRT2);
  near(result.details.scores[1][0], 0);
  near(Math.abs(result.details.scores[2][0]), Math.SQRT2);
  result.details.scores.forEach(row => near(row[1], 0));
});

test('PCA of correlation one-half has eigenvalues 1.5 and 0.5 with 75%/25% variance', () => {
  const result = valid(analyzeTool(matrixFixture('pca', [[-1, -1], [0, 1], [1, 0]])));
  assert.deepEqual(result.details.means, [0, 0]);
  assert.deepEqual(result.details.sd, [1, 1]);
  near(result.details.correlation[0][1], 0.5);
  result.details.eigenvalues.forEach((value, i) => near(value, [1.5, 0.5][i]));
  result.details.explained.forEach((value, i) => near(value, [75, 25][i]));
  const table = result.tables.find(table => table.name === '主成分の寄与率');
  near(table.rows[0][3], 75);
  near(table.rows[1][3], 100);

  for (let component = 0; component < 2; component++) {
    const scores = result.details.scores.map(row => row[component]);
    near(scores.reduce((total, value) => total + value, 0), 0);
    near(scores.reduce((total, value) => total + value ** 2, 0) / 2, [1.5, 0.5][component]);
    const coefficient = result.details.coefficients[component];
    near(coefficient.reduce((total, value) => total + value ** 2, 0), 1);
  }
  near(result.details.coefficients[0].reduce((total, value, i) => total + value * result.details.coefficients[1][i], 0), 0);
});

test('PCA results are unchanged by positive rescaling and offsets of input variables', () => {
  const result = valid(analyzeTool(matrixFixture('pca', [[-1, 97], [0, 103], [1, 100]])));
  assert.deepEqual(result.details.means, [0, 100]);
  assert.deepEqual(result.details.sd, [1, 3]);
  result.details.eigenvalues.forEach((value, i) => near(value, [1.5, 0.5][i]));
  result.details.explained.forEach((value, i) => near(value, [75, 25][i]));
});

test('PCA with equal eigenvalues preserves total variance without requiring a particular axis orientation', () => {
  const result = valid(analyzeTool(matrixFixture('pca', [[-1, -1], [-1, 1], [1, -1], [1, 1]])));
  result.details.eigenvalues.forEach(value => near(value, 1));
  result.details.explained.forEach(value => near(value, 50));
  result.details.sd.forEach(value => near(value, 1.1547005383792515));
  for (let component = 0; component < 2; component++) {
    near(result.details.scores.reduce((total, row) => total + row[component] ** 2, 0) / 3, 1);
  }
});

test('three-variable PCA preserves all orthogonal components and the correlation trace', () => {
  // Pairwise correlations are all 1/2. The analytic spectrum is 2, 1/2, 1/2.
  const result = valid(analyzeTool(matrixFixture('pca', [[2, 2, 2], [0, 0, -2], [0, -2, 0], [-2, 0, 0]])));
  result.details.eigenvalues.forEach((value, i) => near(value, [2, 0.5, 0.5][i]));
  result.details.explained.forEach((value, i) => near(value, [200 / 3, 50 / 3, 50 / 3][i]));
  near(result.details.eigenvalues.reduce((total, value) => total + value, 0), 3);
  const coefficients = result.details.coefficients;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      near(coefficients[i].reduce((total, value, k) => total + value * coefficients[j][k], 0), i === j ? 1 : 0);
    }
    near(result.details.scores.reduce((total, row) => total + row[i] ** 2, 0) / 3, [2, 0.5, 0.5][i]);
  }
});

test('PCA rejects incomplete matrices, insufficient observations, and constant variables', () => {
  for (const values of [
    [[1, 1], [2, null], [3, 3]],
    [[1, 1], [2, 2]],
    [[1], [2], [3]],
    [[1, 7], [2, 7], [3, 7]],
  ]) invalid(analyzeTool(matrixFixture('pca', values)));
});

test('tool normalization rejects unsupported kinds, bad enums, non-finite values, and malformed structure', () => {
  assert.throws(() => createTool('unsupported'));
  for (const input of [null, {}, 'tools']) assert.throws(() => normalizeTools(input));
  const unknown = createTool('graph');
  unknown.kind = 'unsupported';
  assert.throws(() => normalizeTools([unknown]));
  const badStage = createTool('graph');
  badStage.step = 'not-a-stage';
  assert.throws(() => normalizeTools([badStage]));
  const badMode = createTool('control');
  badMode.settings.mode = 'not-a-mode';
  assert.throws(() => normalizeTools([badMode]));
  const badIncluded = createTool('graph');
  badIncluded.included = 'yes';
  assert.throws(() => normalizeTools([badIncluded]));
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => normalizeTools([fixture('graph', [{ label: 'A', value }])]));
  }
  assert.throws(() => normalizeTools([{ ...createTool('graph'), rows: [null] }]));
});

test('tool, data-row and diagram-row limits reject overflow instead of truncating it', () => {
  const twenty = Array.from({ length: 20 }, () => createTool('graph'));
  assert.equal(normalizeTools(twenty).length, 20);
  assert.throws(() => normalizeTools([...twenty, createTool('graph')]));
  const rows = Array.from({ length: 120 }, (_, i) => ({ label: `測定${i}`, value: i }));
  assert.equal(normalizeTools([fixture('graph', rows)])[0].rows.length, 120);
  assert.throws(() => normalizeTools([fixture('graph', [...rows, { label: '超過', value: 1 }])]));
  const diagramRows = Array.from({ length: 24 }, (_, i) => ({ group: 'G', label: `要因${i}` }));
  assert.equal(normalizeTools([fixture('affinity', diagramRows)])[0].rows.length, 24);
  assert.throws(() => normalizeTools([fixture('affinity', [...diagramRows, { group: 'G', label: '超過' }])]));
});

test('matrix and PCA dimension limits preserve the final allowed row and column', () => {
  const matrix = matrixFixture('matrix', Array.from({ length: 12 }, () => Array(12).fill(0)));
  assert.equal(normalizeTools([matrix])[0].matrix.rows.length, 12);
  assert.equal(normalizeTools([matrix])[0].matrix.columns.length, 12);
  assert.throws(() => normalizeTools([matrixFixture('matrix', Array.from({ length: 13 }, () => Array(12).fill(0)))]));
  assert.throws(() => normalizeTools([matrixFixture('matrix', [Array(13).fill(0)])]));
  const pca = matrixFixture('pca', Array.from({ length: 60 }, (_, i) => Array.from({ length: 8 }, (_, j) => i + j)));
  assert.equal(normalizeTools([pca])[0].matrix.rows.length, 60);
  assert.equal(normalizeTools([pca])[0].matrix.columns.length, 8);
  assert.throws(() => normalizeTools([matrixFixture('pca', Array.from({ length: 61 }, () => Array(8).fill(1)))]));
  assert.throws(() => normalizeTools([matrixFixture('pca', [Array(9).fill(1)])]));
});

test('normalization preserves text at its boundary and rejects oversized labels and notes', () => {
  const tool = fixture('graph', [{ label: 'あ'.repeat(80), value: 0 }]);
  tool.notes = 'あ'.repeat(2000);
  const [normalized] = normalizeTools([tool]);
  assert.equal(normalized.rows[0].label.length, 80);
  assert.equal(normalized.notes.length, 2000);
  tool.rows[0].label += 'あ';
  assert.throws(() => normalizeTools([tool]));
  tool.rows[0].label = 'A';
  tool.notes += 'あ';
  assert.throws(() => normalizeTools([tool]));
});

test('normalization rejects duplicate technical IDs and ragged matrix structures', () => {
  const tool = createTool('graph');
  assert.throws(() => normalizeTools([tool, structuredClone(tool)]));
  const rows = fixture('graph', [{ label: 'A', value: 1 }, { label: 'B', value: 2 }]);
  rows.rows[1].id = rows.rows[0].id;
  assert.throws(() => normalizeTools([rows]));
  const matrix = matrixFixture('matrix', [[0, 1], [3, 9]]);
  matrix.matrix.rows[1].values.pop();
  assert.throws(() => normalizeTools([matrix]));
});

test('legacy schema-1 projects without a tools field migrate without altering their QC activity', () => {
  const project = createBlankProject();
  project.meta.title = '既存の活動';
  project.theme.background = '既存の記録';
  delete project.tools;
  const original = structuredClone(project);
  const normalized = normalizeProject(project);
  assert.deepEqual(normalized.tools, []);
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.meta.title, '既存の活動');
  assert.equal(normalized.theme.background, '既存の記録');
  assert.deepEqual(project, original);
  assert.deepEqual(analyzeProject(normalized).tools, []);
});

test('tool analyses retain every tool including excluded drafts without changing inputs', () => {
  const tools = [createTool('pareto', { sample: true }), createTool('pca')];
  tools[1].included = false;
  const before = structuredClone(tools);
  const result = analyzeTools(tools);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(item => item.id), tools.map(tool => tool.id));
  assert.equal(result[0].valid, true);
  assert.equal(result[1].valid, false);
  assert.deepEqual(tools, before);
});

test('project normalization and analysis carry the added tools without dropping excluded drafts', () => {
  const project = createBlankProject();
  project.tools = [createTool('pareto', { sample: true }), createTool('pca')];
  project.tools[1].included = false;
  const normalized = normalizeProject(project);
  assert.equal(normalized.tools.length, 2);
  assert.equal(normalized.tools[1].included, false);
  const results = analyzeProject(normalized).tools;
  assert.equal(results.length, 2);
  assert.equal(results[0].valid, true);
  assert.equal(results[1].valid, false);
});
