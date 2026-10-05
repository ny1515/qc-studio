import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS,
  createBlankProject,
  createSampleProject,
  normalizeProject,
  analyzeProject,
} from '../lib/model.mjs';

const EXPECTED_STEPS = [
  ['theme', 'テーマの選定'],
  ['current', '現場把握'],
  ['causes', '要因の解析'],
  ['actions', '対策の立案'],
  ['effect', '効果の確認'],
  ['standards', '標準化と管理の定着'],
  ['reflection', '反省と残された課題'],
];

let nextRow = 0;
function measurement(value, denominator, phase = 'before', overrides = {}) {
  return {
    id: `measurement-${++nextRow}`,
    phase,
    date: phase === 'before' ? '2026-01-01' : '2026-02-01',
    category: '',
    value,
    denominator,
    note: '',
    ...overrides,
  };
}

function projectWith(type, rows, extraTheme = {}) {
  const project = createBlankProject();
  project.theme = {
    ...project.theme,
    metricType: type,
    unit: type === 'rate' ? '%' : '件',
    ...extraTheme,
  };
  project.measurements = rows;
  return project;
}

function near(actual, expected) {
  assert.equal(typeof actual, 'number');
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

test('keeps the exact seven stages requested by the user', () => {
  assert.deepEqual(STEPS.map(({ id, title }) => [id, title]), EXPECTED_STEPS);
  const analysis = analyzeProject(createBlankProject());
  assert.deepEqual(analysis.steps.map(({ id, title }) => [id, title]), EXPECTED_STEPS);
});

test('new projects have no fabricated observations and no computed zeroes', () => {
  const project = createBlankProject();
  assert.equal(project.isSample, false);
  assert.equal(project.meta.title, '');
  assert.equal(project.theme.target, null);
  for (const list of ['measurements', 'causes', 'actions', 'standards']) {
    assert.deepEqual(project[list], []);
  }
  const result = analyzeProject(project);
  for (const phase of ['before', 'after']) {
    assert.equal(result[phase].value, null);
    assert.equal(result[phase].count, 0);
    assert.equal(result[phase].complete, false);
  }
  assert.equal(result.improvement, null);
  assert.equal(result.improvementPercent, null);
  assert.equal(result.targetMet, null);
  assert.ok(result.steps.every(step => step.missing.length > 0));
});

test('blank projects do not share mutable arrays or nested form objects', () => {
  const first = createBlankProject();
  const second = createBlankProject();
  assert.notEqual(first.id, second.id);
  first.meta.title = 'Changed';
  first.measurements.push(measurement(1, 10));
  assert.equal(second.meta.title, '');
  assert.deepEqual(second.measurements, []);
});

test('rates use total occurrences / total inspected population, not an average of percentages', () => {
  const result = analyzeProject(projectWith('rate', [
    measurement(1, 10),
    measurement(1, 90),
    measurement(1, 100, 'after'),
  ], { target: 1 }));
  near(result.before.value, 2);
  near(result.after.value, 1);
  assert.equal(result.before.sum, 2);
  assert.equal(result.before.denominator, 100);
  assert.equal(result.before.count, 2);
  assert.equal(result.before.complete, true);
  near(result.improvement, 1);
  near(result.improvementPercent, 50);
  assert.equal(result.targetMet, true);
});

test('zero observed occurrences are valid but an empty occurrence cell is missing', () => {
  const zero = analyzeProject(projectWith('rate', [measurement(0, 80)]));
  assert.equal(zero.before.value, 0);
  assert.equal(zero.before.count, 1);
  assert.equal(zero.before.complete, true);

  for (const blank of [null, '']) {
    const missing = analyzeProject(projectWith('rate', [measurement(blank, 80)]));
    assert.equal(missing.before.value, null);
    assert.equal(missing.before.complete, false);
  }
});

test('an empty denominator cannot become an inspected population of zero', () => {
  for (const blank of [null, '']) {
    const result = analyzeProject(projectWith('rate', [measurement(0, blank)]));
    assert.equal(result.before.value, null);
    assert.equal(result.before.complete, false);
  }
});

test('invalid rate populations are reported and never contribute a rate', async t => {
  const invalidRows = [
    ['negative numerator', -1, 100],
    ['fractional numerator', 0.5, 100],
    ['negative denominator', 1, -100],
    ['zero denominator', 0, 0],
    ['fractional denominator', 1, 100.5],
    ['numerator greater than denominator', 101, 100],
  ];
  for (const [name, value, denominator] of invalidRows) {
    await t.test(name, () => {
      const result = analyzeProject(projectWith('rate', [measurement(value, denominator)]));
      assert.equal(result.before.value, null);
      assert.equal(result.before.complete, false);
      assert.ok(result.measurementErrors.some(error => error.index === 0 && error.message));
    });
  }
});

test('count mode sums observations without requiring a denominator', () => {
  const result = analyzeProject(projectWith('count', [
    measurement(0, null),
    measurement(3, null),
    measurement(7, null),
    measurement(4, null, 'after'),
  ]));
  assert.equal(result.before.value, 10);
  assert.equal(result.before.count, 3);
  assert.equal(result.before.complete, true);
  assert.equal(result.after.value, 4);
  assert.equal(result.improvement, 6);
  assert.equal(result.improvementPercent, 60);
  const invalid = analyzeProject(projectWith('count', [measurement(-1, null)]));
  assert.equal(invalid.before.value, null);
  assert.equal(invalid.measurementErrors.length, 1);
});

test('average mode is the unweighted arithmetic mean and accepts negative readings', () => {
  const result = analyzeProject(projectWith('average', [
    measurement(-20, 1),
    measurement(10, 1000),
    measurement(0, null),
  ], { unit: '℃' }));
  near(result.before.value, -10 / 3);
  assert.equal(result.before.sum, -10);
  assert.equal(result.before.count, 3);
  assert.equal(result.before.complete, true);
  assert.equal(result.unit, '℃');
});

test('target judgment and improvement follow the chosen metric direction', () => {
  for (const [direction, target, targetMet, improvement] of [
    ['lower', 5, true, 5],
    ['lower', 4, false, 5],
    ['higher', 5, true, -5],
    ['higher', 6, false, -5],
  ]) {
    const result = analyzeProject(projectWith('count', [
      measurement(10, null), measurement(5, null, 'after'),
    ], { direction, target }));
    assert.equal(result.improvement, improvement);
    assert.equal(result.targetMet, targetMet);
  }
});

test('zero is a valid target, while an absent target has no achievement judgment', () => {
  const rows = [measurement(4, null), measurement(0, null, 'after')];
  const zero = analyzeProject(projectWith('count', rows, { target: 0 }));
  assert.equal(zero.targetMet, true);
  for (const target of [null, '']) {
    const missing = analyzeProject(projectWith('count', rows, { target }));
    assert.equal(missing.targetMet, null);
  }
});

test('out-of-range rate and count targets never produce an achievement judgment', () => {
  for (const [type, target] of [['rate', -1], ['rate', 101], ['count', -1]]) {
    const result = analyzeProject(projectWith(type, [
      measurement(10, 100), measurement(5, 100, 'after'),
    ], { target }));
    assert.equal(result.targetMet, null);
    assert.ok(result.warnings.some(warning => /目標値/.test(warning)));
  }
});

test('negative targets remain valid for measurements that allow negative readings', () => {
  const result = analyzeProject(projectWith('average', [
    measurement(-20, null), measurement(-8, null, 'after'),
  ], { target: -10, direction: 'higher' }));
  assert.equal(result.targetMet, true);
  assert.equal(result.after.value, -8);
  assert.ok(!result.warnings.some(warning => /目標値の範囲/.test(warning)));
});

test('improvement percentage is unavailable for nonpositive baselines', () => {
  const negative = analyzeProject(projectWith('average', [
    measurement(-10, null), measurement(-4, null, 'after'),
  ], { direction: 'higher' }));
  assert.equal(negative.improvement, 6);
  assert.equal(negative.improvementPercent, null);
  assert.ok(negative.warnings.length > 0);

  const zero = analyzeProject(projectWith('average', [
    measurement(0, null), measurement(3, null, 'after'),
  ], { direction: 'higher' }));
  assert.equal(zero.improvement, 3);
  assert.equal(zero.improvementPercent, null);
});

test('any missing or invalid numeric row prevents a misleading partial headline', () => {
  for (const bad of [measurement(null, 100), measurement(101, 100)]) {
    const result = analyzeProject(projectWith('rate', [
      measurement(10, 100), bad, measurement(1, 100, 'after'),
    ], { target: 1 }));
    assert.equal(result.before.value, null);
    assert.equal(result.before.complete, false);
    assert.equal(result.after.value, 1);
    assert.equal(result.improvement, null);
    assert.equal(result.improvementPercent, null);
  }
  const missingAfter = analyzeProject(projectWith('rate', [
    measurement(10, 100), measurement(1, 100, 'after'), measurement(null, 100, 'after'),
  ], { target: 1 }));
  assert.equal(missingAfter.after.value, null);
  assert.equal(missingAfter.targetMet, null);
});

test('missing observations invalidate count and average totals as well as rates', () => {
  for (const type of ['count', 'average']) {
    const result = analyzeProject(projectWith(type, [
      measurement(8, null), measurement(null, null),
    ]));
    assert.equal(result.before.value, null);
    assert.equal(result.before.complete, false);
  }
});

test('missing dates preserve numeric totals but warn about trend interpretation', () => {
  const result = analyzeProject(projectWith('count', [
    measurement(3, null, 'before', { date: '' }),
  ]));
  assert.equal(result.before.value, 3);
  assert.ok(result.warnings.length > 0);
});

test('trend combines same-day samples using the same weighted rate', () => {
  const result = analyzeProject(projectWith('rate', [
    measurement(1, 90, 'before', { date: '2026-01-02' }),
    measurement(1, 10, 'before', { date: '2026-01-02' }),
    measurement(2, 20, 'before', { date: '2026-01-01' }),
    measurement(3, 100, 'after', { date: '2026-01-02' }),
  ]));
  assert.equal(result.trend.length, 3);
  near(result.trend.find(row => row.phase === 'before' && row.date === '2026-01-02').value, 2);
  near(result.trend.find(row => row.phase === 'after' && row.date === '2026-01-02').value, 3);
});

test('category Pareto is unavailable for rates to avoid duplicated inspected populations', () => {
  const result = analyzeProject(projectWith('rate', [
    measurement(3, 100, 'before', { category: 'キズ' }),
    measurement(2, 100, 'before', { category: '寸法' }),
  ]));
  assert.deepEqual(result.pareto, []);
});

test('count Pareto groups only before data and orders cumulative proportions', () => {
  const result = analyzeProject(projectWith('count', [
    measurement(2, null, 'before', { category: 'キズ' }),
    measurement(4, null, 'before', { category: 'キズ' }),
    measurement(3, null, 'before', { category: '寸法' }),
    measurement(1, null, 'before', { category: '' }),
    measurement(100, null, 'after', { category: '新しい種類' }),
  ]));
  assert.deepEqual(result.pareto, [
    { category: 'キズ', value: 6, cumulativePercent: 60 },
    { category: '寸法', value: 3, cumulativePercent: 90 },
    { category: '未分類', value: 1, cumulativePercent: 100 },
  ]);
});

test('zero-count Pareto does not invent a cumulative percentage', () => {
  const result = analyzeProject(projectWith('count', [
    measurement(0, null, 'before', { category: 'キズ' }),
  ]));
  assert.deepEqual(result.pareto, [
    { category: 'キズ', value: 0, cumulativePercent: null },
  ]);
});

test('a fractional-completion label cannot imply the blank project completed QC', () => {
  const project = createBlankProject();
  project.effect.conclusion = '良くなったと思う';
  project.actions = [{
    id: 'action-1', causeId: '', action: '', owner: '', dueDate: '',
    status: 'done', result: '',
  }];
  const result = analyzeProject(project);
  for (const id of ['current', 'causes', 'actions', 'effect', 'standards']) {
    const step = result.steps.find(item => item.id === id);
    assert.ok(step.missing.length > 0, `${id} must still identify missing evidence`);
    assert.ok(step.filled < step.total, `${id} must not report all inputs present`);
  }
});

test('confirmed causes still need recorded evidence and deleted cause links leave a gap', () => {
  const project = createSampleProject();
  const confirmed = project.causes.find(row => row.status === 'confirmed');
  confirmed.verification = '';
  let result = analyzeProject(project);
  assert.ok(result.steps.find(step => step.id === 'causes').missing.length > 0);

  project.causes = project.causes.filter(row => row.id !== project.actions[0].causeId);
  result = analyzeProject(project);
  assert.ok(result.steps.find(step => step.id === 'actions').missing.length > 0);
  assert.ok(result.warnings.some(warning => /要因/.test(warning)));
});

test('normalization preserves an explicit zero and preserves missing numeric cells', () => {
  const project = projectWith('rate', [
    measurement(0, 100), measurement('', '', 'after'),
  ], { target: 0 });
  const normalized = normalizeProject(project);
  assert.equal(normalized.theme.target, 0);
  assert.equal(normalized.measurements[0].value, 0);
  assert.equal(normalized.measurements[1].value, null);
  assert.equal(normalized.measurements[1].denominator, null);
});

test('normalization rejects values that cannot be represented as finite numbers', () => {
  for (const value of [Infinity, -Infinity, NaN, 'not-a-number']) {
    const project = projectWith('rate', [measurement(value, 100)]);
    assert.throws(() => normalizeProject(project));
  }
});

test('normalization rejects invalid enums and impossible calendar dates', () => {
  for (const [key, value] of [['metricType', 'median'], ['direction', 'sideways']]) {
    const project = createBlankProject();
    project.theme[key] = value;
    assert.throws(() => normalizeProject(project));
  }
  const project = projectWith('count', [measurement(1, null, 'before', { date: '2026-02-30' })]);
  assert.throws(() => normalizeProject(project));
});

test('imports reject excess measurements instead of silently losing records', () => {
  const project = projectWith('count', Array.from({ length: 501 }, () => measurement(1, null)));
  assert.throws(() => normalizeProject(project));
});

test('imports enforce the 100-row limit on other editable record lists', async t => {
  for (const name of ['causes', 'actions', 'standards']) {
    await t.test(name, () => {
      const project = createBlankProject();
      project[name] = Array.from({ length: 101 }, (_, index) => ({ id: `${name}-${index}` }));
      assert.throws(() => normalizeProject(project));
    });
  }
});

test('normalization accepts the measurement boundary without dropping any row', () => {
  const project = projectWith('count', Array.from({ length: 500 }, () => measurement(1, null)));
  const normalized = normalizeProject(project);
  assert.equal(normalized.measurements.length, 500);
  assert.equal(analyzeProject(normalized).before.value, 500);
});

test('normalization rejects too-long text instead of silently truncating it', () => {
  const project = createBlankProject();
  project.meta.title = 'あ'.repeat(200);
  project.theme.background = 'あ'.repeat(6000);
  const normalized = normalizeProject(project);
  assert.equal(normalized.meta.title.length, 200);
  assert.equal(normalized.theme.background.length, 6000);
  project.meta.title += 'あ';
  assert.throws(() => normalizeProject(project));
  project.meta.title = '';
  project.theme.background += 'あ';
  assert.throws(() => normalizeProject(project));
});

test('unsupported schemas, non-object imports, malformed rows and duplicate row IDs are rejected', () => {
  for (const input of [null, [], 'project', { schemaVersion: 2 }]) {
    assert.throws(() => normalizeProject(input));
  }
  for (const invalidRow of [null, [], 42]) {
    const project = projectWith('count', [invalidRow]);
    assert.throws(() => normalizeProject(project));
  }
  const repeated = measurement(1, null);
  assert.throws(() => normalizeProject(projectWith('count', [repeated, { ...repeated }])));
});

test('project IDs cannot carry a filesystem path into persistence', () => {
  for (const id of ['../private', '..\\private', 'C:\\private', '%2e%2e', 'with space']) {
    const project = createBlankProject();
    project.id = id;
    assert.throws(() => normalizeProject(project));
  }
});

test('normalization strips unrecognized keys and does not mutate the caller object', () => {
  const project = createSampleProject();
  project.unrecognized = 'not part of schema';
  project.meta.title = 'Updated title';
  const original = structuredClone(project);
  const normalized = normalizeProject(project);
  assert.deepEqual(project, original);
  assert.equal(Object.hasOwn(normalized, 'unrecognized'), false);
  normalized.meta.title = 'Other title';
  assert.equal(project.meta.title, 'Updated title');
});

test('sample creation is explicit and sample metadata survives normalization', () => {
  const sample = createSampleProject();
  assert.equal(sample.isSample, true);
  assert.ok(sample.meta.title.trim());
  assert.ok(sample.measurements.length > 0);
  assert.equal(normalizeProject(sample).isSample, true);
  assert.equal(createBlankProject().isSample, false);
});
