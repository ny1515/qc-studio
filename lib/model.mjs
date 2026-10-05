import { normalizeTools, analyzeTools } from './qc-tools.mjs';

const randomUUID = () => globalThis.crypto.randomUUID();

export const STEPS = [
  { id: 'theme', title: 'テーマの選定', description: '取り組む問題と、達成したい目標を決めます。', tips: ['困りごとと選定理由を、現場の事実と結び付けます。', '対象範囲・指標・目標値・期限を明確にします。'] },
  { id: 'current', title: '現場把握', description: '現場で観察した事実と測定データを整理します。', tips: ['いつ・どこで・どの条件で測ったかを記録します。', '不良率の各行は重複しない検査対象にします。同じ検査数を不良項目ごとに繰り返し入力しないでください。'] },
  { id: 'causes', title: '要因の解析', description: '要因の仮説を挙げ、検証した結果を記録します。', tips: ['人・設備・方法・材料・測定・環境などの観点で考えます。', '仮説と確認済みの要因を分け、確認した根拠を残します。'] },
  { id: 'actions', title: '対策の立案', description: '要因に対応した対策と担当・期限を決めます。', tips: ['どの要因に効く対策なのかを結び付けます。', '実施状況と実施結果を記録してから効果を確認します。'] },
  { id: 'effect', title: '効果の確認', description: '対策前後の実績を、同じ指標と比較条件で確認します。', tips: ['検査方法・対象・期間などの比較条件を確認します。', '数値の変化だけでは因果関係や統計的な有意差を断定できません。副作用も記録します。'] },
  { id: 'standards', title: '標準化と管理の定着', description: '改善を維持するルールと確認方法を決めます。', tips: ['標準書・担当・確認頻度・異常時の対応を具体化します。', '関係者への教育と、継続して確認する方法を記録します。'] },
  { id: 'reflection', title: '反省と残された課題', description: '活動を振り返り、次の取り組みにつなげます。', tips: ['良かった点と改善したい点を具体的に残します。', '残された課題には次の行動・担当・期限を設定します。'] },
];

const fields = {
  meta: ['title', 'department', 'team', 'leader', 'members', 'startDate', 'endDate'],
  theme: ['background', 'reason', 'scope', 'metricName', 'unit', 'targetDate'],
  current: ['observation', 'method', 'stratification', 'finding'],
  effect: ['comparability', 'conclusion', 'sideEffects', 'intangible'],
  reflection: ['good', 'improve', 'remaining', 'nextAction', 'owner', 'dueDate'],
};
const listFields = {
  measurements: ['date', 'category', 'note'],
  causes: ['category', 'factor', 'why', 'verification'],
  actions: ['causeId', 'action', 'owner', 'dueDate', 'result'],
  standards: ['rule', 'document', 'owner', 'frequency', 'checkMethod', 'response', 'education'],
};

export function createBlankProject() {
  const now = new Date().toISOString();
  const p = { schemaVersion: 1, id: randomUUID(), revision: 1, createdAt: now, updatedAt: now, isSample: false };
  for (const [section, names] of Object.entries(fields)) p[section] = Object.fromEntries(names.map(name => [name, '']));
  Object.assign(p.theme, { metricType: 'rate', unit: '%', direction: 'lower', target: null });
  for (const name of Object.keys(listFields)) p[name] = [];
  p.tools = [];
  return p;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}はオブジェクトで指定してください。`);
  return value;
}
function text(value, label, max = 6000) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw new Error(`${label}は文字列で指定してください。`);
  if (value.length > max) throw new Error(`${label}は${max}文字以内で入力してください。`);
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)) throw new Error(`${label}に使用できない制御文字があります。`);
  return value;
}
function date(value, label) {
  const v = text(value, label, 10);
  if (!v) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw new Error(`${label}は有効な日付（YYYY-MM-DD）で入力してください。`);
  return v;
}
function number(value, label) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) throw new Error(`${label}は数値で入力してください。`);
    value = Number(value);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw new Error(`${label}は絶対値1兆以下の有限な数値で入力してください。`);
  return value;
}
function choice(value, allowed, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) throw new Error(`${label}の値が不正です。`);
  return value;
}
function id(value, label) {
  if (!value) return randomUUID();
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error(`${label}のIDが不正です。`);
  return value;
}

export function normalizeProject(input) {
  object(input, 'プロジェクト');
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) throw new Error('未対応のプロジェクト形式です。');
  const p = createBlankProject();
  p.id = id(input.id, 'プロジェクト');
  if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || input.revision < 1)) throw new Error('保存バージョンが不正です。');
  p.revision = input.revision ?? 1;
  if (input.isSample !== undefined && typeof input.isSample !== 'boolean') throw new Error('サンプル区分が不正です。');
  p.isSample = input.isSample ?? false;
  for (const key of ['createdAt', 'updatedAt']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || !Number.isFinite(Date.parse(input[key]))) throw new Error('更新日時が不正です。');
      p[key] = new Date(input[key]).toISOString();
    }
  }
  for (const [section, names] of Object.entries(fields)) {
    const source = input[section] === undefined ? {} : object(input[section], section);
    for (const name of names) p[section][name] = /Date$/.test(name) ? date(source[name], name) : text(source[name], name, ['title','metricName','unit','team','department','leader','owner'].includes(name) ? 200 : 6000);
  }
  const theme = input.theme ?? {};
  p.theme.metricType = choice(theme.metricType, ['rate', 'count', 'average'], 'rate', '指標の種類');
  p.theme.direction = choice(theme.direction, ['lower', 'higher'], 'lower', '改善方向');
  p.theme.target = number(theme.target, '目標値');
  if (p.theme.metricType === 'rate') p.theme.unit = '%';
  for (const [name, names] of Object.entries(listFields)) {
    const rows = input[name] ?? [];
    if (!Array.isArray(rows)) throw new Error(`${name}は配列で指定してください。`);
    const max = name === 'measurements' ? 500 : 100;
    if (rows.length > max) throw new Error(`${name}は${max}行以内で入力してください。`);
    const seen = new Set();
    p[name] = rows.map((value, index) => {
      object(value, `${name}の${index + 1}行目`);
      const row = { id: id(value.id, `${name}の${index + 1}行目`) };
      if (seen.has(row.id)) throw new Error(`${name}に重複する行IDがあります。`);
      seen.add(row.id);
      for (const key of names) row[key] = /Date$/.test(key) || key === 'date' ? date(value[key], key) : text(value[key], key, key === 'causeId' ? 80 : 6000);
      if (name === 'measurements') Object.assign(row, { phase: choice(value.phase, ['before', 'after'], 'before', '測定区分'), value: number(value.value, '測定値'), denominator: number(value.denominator, '検査数') });
      if (name === 'causes') row.status = choice(value.status, ['hypothesis', 'confirmed', 'rejected'], 'hypothesis', '要因の確認状況');
      if (name === 'actions') row.status = choice(value.status, ['planned', 'doing', 'done'], 'planned', '対策の実施状況');
      return row;
    });
  }
  p.tools = normalizeTools(input.tools);
  return p;
}

function rowIssue(row, type) {
  if (row.value === null || row.value === undefined || row.value === '') return { kind: 'missing', message: '測定値が未入力です。' };
  if (typeof row.value !== 'number' || !Number.isFinite(row.value)) return { kind: 'invalid', message: '測定値は有限な数値で入力してください。' };
  if (type !== 'average' && row.value < 0) return { kind: 'invalid', message: '件数は0以上で入力してください。' };
  if (type === 'rate') {
    if (!Number.isInteger(row.value)) return { kind: 'invalid', message: '不良数は整数で入力してください。' };
    if (row.denominator === null || row.denominator === undefined || row.denominator === '') return { kind: 'missing', message: '検査数が未入力です。' };
    if (!Number.isSafeInteger(row.denominator) || row.denominator <= 0) return { kind: 'invalid', message: '検査数は1以上の整数で入力してください。' };
    if (row.value > row.denominator) return { kind: 'invalid', message: '不良数が検査数を超えています。' };
  }
  return null;
}
function aggregate(rows, type) {
  const valid = rows.filter(row => !rowIssue(row, type));
  const sum = valid.reduce((n, row) => n + row.value, 0);
  const denominator = type === 'rate' ? valid.reduce((n, row) => n + row.denominator, 0) : 0;
  const complete = rows.length > 0 && valid.length === rows.length;
  const value = !complete ? null : type === 'rate' ? sum / denominator * 100 : type === 'average' ? sum / valid.length : sum;
  return { value, count: rows.length, sum, denominator, complete };
}
const has = value => typeof value === 'string' && value.trim().length > 0;
const numeric = value => typeof value === 'number' && Number.isFinite(value);

export function analyzeProject(p) {
  const type = p.theme.metricType;
  const beforeRows = p.measurements.filter(row => row.phase === 'before');
  const afterRows = p.measurements.filter(row => row.phase === 'after');
  const before = aggregate(beforeRows, type);
  const after = aggregate(afterRows, type);
  const measurementErrors = p.measurements.flatMap((row, index) => {
    const issue = rowIssue(row, type);
    return issue ? [{ index, ...issue }] : [];
  });
  const warnings = [];
  if (measurementErrors.length) warnings.push('測定データに未入力または不正な値があります。該当する区分の集計は未確定です。');
  if (p.measurements.some(row => !has(row.date))) warnings.push('測定日が未入力の行があります。推移グラフには日付がある行のみ表示します。');
  if (type === 'rate') warnings.push('不良率は不良数の合計 ÷ 検査数の合計で計算します。各行の検査対象が重複しないことを確認してください。');
  if (type === 'average') warnings.push('平均値は各測定行を同じ重みで計算します。行ごとの値に集計済み平均を入力する場合は、標本数の違いに注意してください。');
  if (type === 'count') warnings.push('件数の前後比較では、集計期間や作業量が同等か確認してください。');
  if (before.value !== null && before.value < 0) warnings.push('改善前の値が負のため、改善率は表示しません。変化量で確認してください。');
  if (p.meta.startDate && p.meta.endDate && p.meta.startDate > p.meta.endDate) warnings.push('活動終了日が開始日より前になっています。');
  const targetValid = numeric(p.theme.target) && (type === 'average' || p.theme.target >= 0) && (type !== 'rate' || p.theme.target <= 100);
  if (numeric(p.theme.target) && !targetValid) warnings.push('目標値の範囲を確認してください。不良率は0～100%、件数は0以上で設定します。');
  const comparable = before.value !== null && after.value !== null;
  const improvement = !comparable ? null : p.theme.direction === 'lower' ? before.value - after.value : after.value - before.value;
  const improvementPercent = improvement === null || before.value <= 0 ? null : improvement / before.value * 100;
  const targetMet = !targetValid || after.value === null ? null : p.theme.direction === 'lower' ? after.value <= p.theme.target : after.value >= p.theme.target;
  const groups = new Map();
  for (const row of p.measurements) if (row.date) {
    const key = `${row.date}:${row.phase}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const trend = [...groups.values()].map(rows => ({ date: rows[0].date, phase: rows[0].phase, value: aggregate(rows, type).value })).sort((a,b) => a.date.localeCompare(b.date) || a.phase.localeCompare(b.phase));
  const categories = new Map();
  if (type === 'count' && before.complete) for (const row of beforeRows) {
    const key = row.category.trim() || '未分類';
    categories.set(key, (categories.get(key) ?? 0) + row.value);
  }
  let cumulative = 0;
  const pareto = [...categories].map(([category, value]) => ({ category, value })).sort((a,b) => b.value - a.value || a.category.localeCompare(b.category,'ja')).map(row => {
    cumulative += row.value;
    return { ...row, cumulativePercent: before.sum > 0 ? cumulative / before.sum * 100 : null };
  });
  const missingRows = (rows, checks, empty) => {
    if (!rows.length) return [empty];
    return checks.flatMap(([key,label]) => rows.some(row => !has(row[key])) ? [label] : []);
  };
  const causeIds = new Set(p.causes.map(row => row.id));
  const orphaned = p.actions.some(row => row.causeId && !causeIds.has(row.causeId));
  if (orphaned) warnings.push('対策に、削除された要因との関連があります。関連要因を選び直してください。');
  const steps = [];
  function addStep(id, checks) {
    const missing = checks.filter(([ok]) => !ok).map(([,label]) => label);
    const meta = STEPS.find(step => step.id === id);
    steps.push({ id, title: meta.title, filled: checks.length - missing.length, total: checks.length, missing });
  }
  addStep('theme', [[has(p.meta.title),'テーマ名'],[has(p.theme.background),'背景・問題点'],[has(p.theme.reason),'選定理由'],[has(p.theme.scope),'対象範囲'],[has(p.theme.metricName),'評価指標'],[targetValid,'有効な目標値'],[has(p.theme.targetDate),'目標期限']]);
  addStep('current', [[has(p.current.observation),'現場で観察した事実'],[has(p.current.method),'測定方法・条件'],[before.complete,'改善前の有効な測定データ'],[beforeRows.length > 0 && beforeRows.every(row => has(row.date)),'改善前の測定日'],[has(p.current.finding),'現場把握から分かったこと']]);
  addStep('causes', [[p.causes.length > 0 && p.causes.every(row => has(row.factor)),'要因の仮説'],[p.causes.length > 0 && p.causes.every(row => has(row.verification)),'各要因の検証方法・結果'],[p.causes.some(row => row.status === 'confirmed' && has(row.verification)),'確認済みの要因と根拠']]);
  const actionMissing = missingRows(p.actions, [['action','対策内容'],['owner','担当者'],['dueDate','実施期限']], '対策');
  addStep('actions', [[p.actions.length > 0 && !actionMissing.includes('対策内容'),'対策内容'],[p.actions.length > 0 && p.actions.every(row => has(row.causeId) && causeIds.has(row.causeId)),'関連する要因'],[p.actions.length > 0 && !actionMissing.includes('担当者'),'対策の担当者'],[p.actions.length > 0 && !actionMissing.includes('実施期限'),'対策の実施期限']]);
  addStep('effect', [[before.complete && after.complete,'前後の有効な測定データ'],[afterRows.length > 0 && afterRows.every(row => has(row.date)),'改善後の測定日'],[has(p.effect.comparability),'前後の比較条件'],[has(p.effect.conclusion),'効果の評価'],[p.actions.length > 0 && p.actions.every(row => row.status === 'done' && has(row.result)),'対策の実施完了・実施結果']]);
  const standardKeys = [['rule','定着させるルール'],['document','標準書・記録先'],['owner','管理担当'],['frequency','確認頻度'],['checkMethod','確認方法'],['response','異常時の対応'],['education','教育・周知']];
  addStep('standards', standardKeys.map(([key,label]) => [p.standards.length > 0 && p.standards.every(row => has(row[key])), label]));
  addStep('reflection', [[has(p.reflection.good),'良かった点'],[has(p.reflection.improve),'改善したい点'],[has(p.reflection.remaining),'残された課題'],[has(p.reflection.nextAction),'次の行動'],[has(p.reflection.owner),'次の担当'],[has(p.reflection.dueDate),'次の期限']]);
  return { before, after, unit: type === 'rate' ? '%' : p.theme.unit, improvement, improvementPercent, targetMet, pareto, trend, steps, warnings, measurementErrors, tools: analyzeTools(p.tools) };
}

export function createSampleProject() {
  const p = createBlankProject();
  p.isSample = true;
  Object.assign(p.meta, { title: '梱包工程のラベル貼り間違い削減', department: '製造部（架空）', team: '梱包改善チーム', leader: '担当A', members: '担当A、担当B、担当C', startDate: '2026-04-01', endDate: '2026-06-30' });
  Object.assign(p.theme, { background: '梱包後の検査でラベル貼り間違いが見つかり、貼り直し作業が発生している。', reason: '手直しの負担を減らすため、ラベル貼り間違いを優先して改善する。', scope: '第1梱包ラインの製品A。ラベル貼付から出荷前検査まで。', metricName: 'ラベル貼り間違い率', metricType: 'rate', unit: '%', direction: 'lower', target: 1, targetDate: '2026-06-30' });
  Object.assign(p.current, { observation: '品種切り替え時に旧ラベルが作業台に残っていた。類似したラベルを同じ棚で保管していた。', method: '出荷前の全数検査で、製品とラベルの品番が一致するかを確認。不一致品数を検査数で割る。各測定日は別の製品群を検査する。', stratification: '日付・品種・切り替えの有無で分けて記録する。', finding: '切り替え直後の作業に着目し、残留ラベルと保管場所を検証する。' });
  p.measurements = [
    ['before','2026-04-06',18,400],['before','2026-04-13',22,500],['before','2026-04-20',15,450],['before','2026-04-27',25,650],
    ['after','2026-06-01',3,500],['after','2026-06-08',5,600],['after','2026-06-15',4,500],['after','2026-06-22',4,400],
  ].map(([phase,date,value,denominator]) => ({ id: randomUUID(), phase, date, category: '第1梱包ライン', value, denominator, note: 'サンプル（架空データ）' }));
  p.causes = [
    { id:'cause-method',category:'方法',factor:'切り替え時のラベル残留',why:'旧ラベルの回収確認を標準に定めていなかった。',verification:'切り替え時の観察で作業台に旧ラベルの残留を確認。（架空の検証例）',status:'confirmed' },
    { id:'cause-material',category:'材料',factor:'類似ラベルの混在',why:'品番別の保管場所が明確でなかった。',verification:'棚卸しで隣接区画のラベル混在を確認。（架空の検証例）',status:'confirmed' },
    { id:'cause-person',category:'人',factor:'経験年数による違い',why:'経験による差がある可能性を検討した。',verification:'経験年数だけでは違いを説明できず、今回の主因から外した。（架空の検証例）',status:'rejected' },
  ];
  p.actions = [
    {id:randomUUID(),causeId:'cause-method',action:'切り替え時に旧ラベルを回収し、確認表に記録する。',owner:'担当A',dueDate:'2026-05-15',status:'done',result:'対象者全員へ説明し、5月18日から運用。（架空の実施例）'},
    {id:randomUUID(),causeId:'cause-material',action:'ラベルの保管区画を品番別に分離し、棚の表示を統一する。',owner:'担当B',dueDate:'2026-05-15',status:'done',result:'対象棚の区画変更と表示の設置を完了。（架空の実施例）'},
  ];
  Object.assign(p.effect, { comparability: '同一ライン・同一品種・同一の検査判定で比較。前後とも合計2,000個を検査した。', conclusion: '貼り間違い率は4.0%から0.8%へ低下し、目標1.0%以下を満たした。観察期間を延ばし、効果の維持を確認する。', sideEffects: '確認作業を追加したため、切り替え時間への影響を継続して確認する。', intangible: '切り替え時に確認する項目をチームで共有できた。' });
  p.standards = [{id:randomUUID(),rule:'切り替え前に旧ラベルを回収し、新ラベルの品番を照合する。',document:'梱包作業標準書・切り替え確認表（例）',owner:'ラインリーダー',frequency:'切り替えごとに確認。週1回、記録を点検する。',checkMethod:'確認表の記入と現物を照合する。',response:'不一致時は作業を止め、ラベルを隔離してリーダーに連絡する。',education:'標準書の改訂時と新規担当者の配属時に実物で説明する。'}];
  Object.assign(p.reflection, { good:'現場の観察と数値を合わせて対策を決められた。',improve:'活動開始時から切り替え条件も記録しておくと検証しやすかった。',remaining:'他品種・他ラインでの再現性と効果の継続を確認する。',nextAction:'次の1か月も同じ条件で測定し、他ラインへの展開を判断する。',owner:'担当C',dueDate:'2026-07-31' });
  return p;
}
