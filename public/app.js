import { setupToolWorkspace } from './tools-ui.js';
import { apiRequest, storageLabel } from './platform.js';

const $ = id => document.getElementById(id);
const state = {
  token: '', steps: [], projects: [], project: null, analysis: null, step: 0,
  dirty: false, busy: false, busyLabel: '', editVersion: 0, analysisSerial: 0,
  analysisPending: false, analysisError: '', analyzeTimer: null, toastTimer: null,
  toastAction: null, ready: false, toolCatalog: [], view: 'steps',
};
const MAX_BYTES = 4 * 1024 * 1024;
const SVG_NS = 'http://www.w3.org/2000/svg';
const numberFormat = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });
const smallNumberFormat = new Intl.NumberFormat('ja-JP', { notation: 'scientific', maximumSignificantDigits: 3 });
const fmt = value => value === null || value === undefined || !Number.isFinite(value) ? '—' : value !== 0 && Math.abs(value) < 0.001 ? smallNumberFormat.format(value) : numberFormat.format(value);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
};
const svgEl = (tag, attrs = {}, text) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = String(text);
  return node;
};
const getPath = path => path.split('.').reduce((value, key) => value?.[key], state.project);
function setPath(path, value) {
  const keys = path.split('.');
  let parent = state.project;
  for (const key of keys.slice(0, -1)) parent = parent[key];
  parent[keys.at(-1)] = value;
}
function makeButton(text, className, command) {
  const button = el('button', className, text);
  button.type = 'button';
  if (command) button.dataset.command = command;
  return button;
}
function errorMessage(error) {
  return error?.message || '処理できませんでした。接続と入力内容を確認してください。';
}
async function api(url, { method = 'GET', body, binary = false } = {}) {
  return apiRequest(url, { method, body, binary, csrfToken: state.token });
}
function showError(error) {
  const message = errorMessage(error);
  if (state.project) {
    const banner = $('error-banner');
    banner.replaceChildren(el('span', '', message));
    if (error.status === 409) {
      const actions = el('div', 'error-actions');
      actions.append(makeButton('入力をJSONで保存', 'button button-outline', 'backup'), makeButton('保存版を開き直す', 'button button-quiet', 'reload'));
      banner.append(actions);
    }
    banner.hidden = false;
  }
  showToast(message, null, null, 10000);
}
function clearError() { $('error-banner').hidden = true; }
function showToast(message, actionLabel, action, duration = 5000) {
  clearTimeout(state.toastTimer);
  $('toast-message').textContent = message;
  $('toast-action').hidden = !action;
  $('toast-action').textContent = actionLabel || '';
  state.toastAction = action || null;
  $('toast').hidden = false;
  state.toastTimer = setTimeout(() => { $('toast').hidden = true; state.toastAction = null; }, duration);
}
function updateControls() {
  const locked = state.busy || !state.ready;
  for (const id of ['new-project', 'sample-project', 'import-project', 'project-select']) $(id).disabled = locked;
  for (const id of ['save-project', 'export-xlsx', 'export-pptx', 'backup-project']) $(id).disabled = locked || !state.project;
  $('open-tools').disabled = locked || !state.project;
  $('save-project').disabled ||= !state.dirty;
  for (const button of document.querySelectorAll('.step-button')) button.disabled = locked || !state.project;
  for (const button of document.querySelectorAll('[data-command="new"], [data-command="sample"]')) button.disabled = locked;
  $('toast-action').disabled = state.busy;
  $('workspace').inert = state.busy;
  $('workspace').setAttribute('aria-busy', String(state.busy));
  const status = $('save-status');
  status.className = state.dirty ? 'dirty' : '';
  status.textContent = state.busy ? state.busyLabel : !state.ready ? '準備しています' : !state.project ? '活動を作成して始めましょう' : state.dirty ? '● 未保存の変更があります' : `✓ ${storageLabel}に保存済み`;
  status.title = state.project?.updatedAt ? `最終保存：${new Date(state.project.updatedAt).toLocaleString('ja-JP')}` : '';
  $('revision-status').textContent = state.project ? `版 ${state.project.revision}` : '';
}
async function perform(label, task) {
  if (state.busy) return;
  state.busy = true; state.busyLabel = label; updateControls();
  try { await task(); }
  catch (error) { showError(error); }
  finally { state.busy = false; state.busyLabel = ''; updateControls(); }
}
function updateProjectList(project) {
  const summary = { id: project.id, title: project.meta.title, team: project.meta.team, updatedAt: project.updatedAt, isSample: project.isSample, revision: project.revision };
  state.projects = [summary, ...state.projects.filter(item => item.id !== project.id)];
  renderProjectSelector();
}
function renderProjectSelector() {
  const select = $('project-select');
  select.replaceChildren();
  if (!state.projects.length) select.append(new Option('活動を選択', ''));
  for (const project of state.projects) select.append(new Option(`${project.isSample ? '［サンプル］' : ''}${project.title || '名称未入力の活動'}`, project.id));
  select.value = state.project?.id || '';
}
function acceptProject(payload, firstStep = true) {
  clearTimeout(state.analyzeTimer);
  state.analysisSerial++; state.editVersion++;
  state.project = payload.project; state.analysis = payload.analysis;
  state.dirty = false; state.analysisPending = false; state.analysisError = '';
  if (firstStep) { state.step = 0; state.view = 'steps'; toolUI.reset(); }
  updateProjectList(state.project); clearError(); renderWorkspace();
}
async function saveProject() {
  if (!state.project || !state.dirty) return;
  const version = state.editVersion;
  const snapshot = structuredClone(state.project);
  const payload = await api(`/api/projects/${encodeURIComponent(snapshot.id)}`, { method: 'PUT', body: { project: snapshot } });
  if (state.project.id !== snapshot.id) return;
  if (state.editVersion === version) {
    state.project = payload.project; state.analysis = payload.analysis;
    state.dirty = false; state.analysisPending = false; state.analysisError = '';
  } else {
    state.project.revision = payload.project.revision;
    state.project.updatedAt = payload.project.updatedAt;
  }
  updateProjectList(state.project); clearError(); renderProjectHeading(); renderAnalysis(); updateControls();
}
function askBeforeLeaving() {
  if (!state.dirty) return Promise.resolve('discard');
  return new Promise(resolve => {
    const dialog = $('confirm-dialog');
    const finish = answer => {
      dialog.close(); dialog.removeEventListener('click', onClick); dialog.removeEventListener('cancel', onCancel); resolve(answer);
    };
    const onClick = event => { const button = event.target.closest('[data-answer]'); if (button) finish(button.dataset.answer); };
    const onCancel = event => { event.preventDefault(); finish('cancel'); };
    dialog.addEventListener('click', onClick); dialog.addEventListener('cancel', onCancel); dialog.showModal();
  });
}
async function mayLeave() {
  const answer = await askBeforeLeaving();
  if (answer === 'cancel') return false;
  if (answer === 'save') await saveProject();
  return true;
}
function createProject(source) {
  return perform('活動を作成しています…', async () => {
    if (!await mayLeave()) return;
    const payload = await api('/api/projects', { method: 'POST', body: { source } });
    acceptProject(payload); showToast(source === 'sample' ? 'サンプル（架空データ）を開きました。' : '新しい活動を作成しました。テーマ名から入力しましょう。');
  });
}
function loadProject(id) {
  return perform('活動を開いています…', async () => {
    if (!await mayLeave()) return;
    acceptProject(await api(`/api/projects/${encodeURIComponent(id)}`));
  });
}
function markDirty() {
  state.dirty = true; state.editVersion++; state.analysisPending = true;
  toolUI.markPending();
  $('metrics').classList.add('is-pending'); $('metrics').setAttribute('aria-busy', 'true');
  updateControls(); renderProjectHeading();
  clearTimeout(state.analyzeTimer);
  state.analyzeTimer = setTimeout(analyzeEdits, 320);
}
async function analyzeEdits() {
  if (!state.project) return;
  const serial = ++state.analysisSerial, version = state.editVersion, projectId = state.project.id;
  try {
    const payload = await api('/api/analyze', { method: 'POST', body: { project: structuredClone(state.project) } });
    if (serial !== state.analysisSerial || version !== state.editVersion || projectId !== state.project?.id) return;
    state.analysis = payload.analysis; state.analysisError = '';
  } catch (error) {
    if (serial !== state.analysisSerial || version !== state.editVersion || projectId !== state.project?.id) return;
    state.analysisError = errorMessage(error);
  }
  state.analysisPending = false; renderAnalysis();
}
function renderWorkspace() {
  $('loading-screen').hidden = true;
  $('welcome-screen').hidden = !!state.project;
  $('project-workspace').hidden = !state.project;
  renderNav(); updateControls();
  if (!state.project) return;
  renderProjectHeading(); renderStage(); renderAnalysis();
  applyWorkspaceView();
}
function applyWorkspaceView() {
  const toolsView = state.view === 'tools';
  for (const selector of ['#metrics', '.stage-heading', '.stage-layout', '#analysis-section', '.stage-pagination', '#project-workspace > .workspace-note']) document.querySelector(selector).hidden = toolsView;
  $('tool-workspace').hidden = !toolsView;
  $('open-tools').classList.toggle('active', toolsView);
  $('open-tools').setAttribute('aria-pressed', String(toolsView));
  $('tools-count').textContent = state.project?.tools?.length || 0;
  if (toolsView) toolUI.render();
  renderNav();
}
function renderProjectHeading() {
  if (!state.project) return;
  const project = state.project;
  $('project-title').textContent = project.meta.title || '新しいQC活動';
  $('project-meta').textContent = [project.meta.department, project.meta.team].filter(Boolean).join(' / ') || 'QC ACTIVITY';
  $('sample-banner').hidden = !project.isSample;
  document.title = `${project.meta.title || '新しいQC活動'} — QC Studio`;
}
function renderNav() {
  const nav = $('step-nav'); nav.replaceChildren();
  for (const [index, step] of state.steps.entries()) {
    const progress = state.analysis?.steps?.find(item => item.id === step.id);
    const button = makeButton('', `step-button${index === state.step && state.project && state.view === 'steps' ? ' active' : ''}${progress?.filled ? ' has-input' : ''}`);
    button.dataset.step = index;
    if (index === state.step && state.project && state.view === 'steps') button.setAttribute('aria-current', 'step');
    button.append(el('span', 'step-number', String(index + 1).padStart(2, '0')), el('span', 'step-name', step.title), el('span', 'step-completion'));
    button.disabled = !state.project || state.busy; nav.append(button);
  }
  const filled = state.analysis?.steps?.filter(step => step.filled === step.total).length || 0;
  $('step-count').textContent = state.project ? `${filled} / 7 入力充足` : '7 STEPS';
}
function field(path, label, { type = 'text', placeholder = '', hint = '', full = false, options, tall = false, min, max, step = 'any', readOnly = false } = {}) {
  const wrapper = el('div', `field${full ? ' full' : ''}`);
  const id = `field-${path.replaceAll('.', '-')}`;
  const labelNode = el('label', 'field-label', label); labelNode.htmlFor = id;
  let control;
  if (options) {
    control = el('select');
    for (const option of options) control.append(new Option(option.label, option.value));
  } else if (type === 'textarea') { control = el('textarea', tall ? 'tall' : ''); control.rows = tall ? 4 : 3; }
  else { control = el('input'); control.type = type; }
  control.id = id; control.dataset.path = path; control.value = getPath(path) ?? '';
  if (placeholder) control.placeholder = placeholder;
  if (type === 'number') {
    control.dataset.number = 'true'; control.step = step;
    if (min !== undefined) control.min = String(min);
    if (max !== undefined) control.max = String(max);
  }
  if (readOnly) control.readOnly = true;
  if (!options && !['date', 'number'].includes(type)) control.maxLength = ['title', 'metricName', 'unit', 'team', 'department', 'leader', 'owner'].includes(path.split('.').at(-1)) ? 200 : 6000;
  wrapper.append(labelNode, control);
  if (hint) { const note = el('p', 'field-hint', hint); note.id = `${id}-hint`; control.setAttribute('aria-describedby', note.id); wrapper.append(note); }
  return wrapper;
}
function fieldGrid(fields, three = false) { const grid = el('div', `field-grid${three ? ' three-columns' : ''}`); grid.append(...fields); return grid; }
function card(title, subtitle, number) {
  const section = el('section', 'form-card');
  const heading = el('div', 'card-heading'), text = el('div'), h3 = el('h3');
  if (number) h3.append(el('span', 'card-number', number));
  h3.append(document.createTextNode(title)); text.append(h3);
  if (subtitle) text.append(el('p', '', subtitle));
  heading.append(text); section.append(heading); return section;
}
const area = (path, label, placeholder, extras = {}) => field(path, label, { type: 'textarea', full: true, placeholder, ...extras });
function renderStage() {
  if (!state.project) return;
  const step = state.steps[state.step];
  $('stage-eyebrow').textContent = `STEP ${String(state.step + 1).padStart(2, '0')} / 07`;
  $('stage-title').textContent = step.title; $('stage-description').textContent = step.description;
  const form = $('stage-form'); form.replaceChildren();
  ({ theme: renderTheme, current: renderCurrent, causes: renderCauses, actions: renderActions, effect: renderEffect, standards: renderStandards, reflection: renderReflection }[step.id])(form);
  $('previous-step').disabled = state.step === 0;
  $('next-step').hidden = state.step === 6;
  $('pagination-label').textContent = `${String(state.step + 1).padStart(2, '0')} / 07`;
  renderAnalysis();
}
function renderTheme(form) {
  const basic = card('活動の基本情報', 'まずは活動名とチームを記録します。', '01');
  basic.append(fieldGrid([
    field('meta.title', 'テーマ名', { full: true, placeholder: '例：梱包工程のラベル貼り間違い削減' }),
    field('meta.department', '部署・職場', { placeholder: '例：製造部 第1梱包ライン' }), field('meta.team', 'チーム名', { placeholder: '例：梱包改善チーム' }),
    field('meta.leader', 'リーダー'), field('meta.members', 'メンバー', { placeholder: '名前を区切って入力' }),
    field('meta.startDate', '活動開始日', { type: 'date' }), field('meta.endDate', '活動終了予定日', { type: 'date' }),
  ]));
  const theme = card('テーマを選んだ理由', '現場の困りごとと、取り組む範囲を明確にします。', '02');
  theme.append(fieldGrid([
    area('theme.background', '背景・問題点', 'どのような困りごとが、どこで起きていますか？'),
    area('theme.reason', '選定理由', 'なぜ、このテーマを優先して改善しますか？'),
    area('theme.scope', '対象範囲', '対象の工程・製品・設備・作業などを具体的に'),
  ]));
  const target = card('評価指標と目標', '測定する数値と、目指す水準を決めます。', '03');
  const type = state.project.theme.metricType;
  target.append(fieldGrid([
    field('theme.metricName', '評価指標名', { full: true, placeholder: '例：ラベル貼り間違い率' }),
    field('theme.metricType', '集計方法', { options: [{ value: 'rate', label: '不良率（合計不良数 ÷ 合計検査数）' }, { value: 'count', label: '件数（合計）' }, { value: 'average', label: '平均値（各行を同じ重みで計算）' }] }),
    field('theme.unit', '単位', { placeholder: '例：件、秒、mm', readOnly: type === 'rate', hint: type === 'rate' ? '不良率の単位は % です。' : '測定値と同じ単位を設定してください。' }),
    field('theme.direction', '改善する方向', { options: [{ value: 'lower', label: '小さいほど良い' }, { value: 'higher', label: '大きいほど良い' }] }),
    field('theme.target', '目標値', { type: 'number', min: type === 'average' ? undefined : 0, max: type === 'rate' ? 100 : undefined, hint: '空欄は未入力です。0も目標値として設定できます。' }),
    field('theme.targetDate', '目標期限', { type: 'date' }),
  ]));
  form.append(basic, theme, target);
}
function renderCurrent(form) {
  const observation = card('現場で確認したこと', '事実と解釈を分け、測定条件も残します。', '01');
  observation.append(fieldGrid([
    area('current.observation', '現場で観察した事実', 'いつ・どこで・どのような状態を確認しましたか？'),
    area('current.method', '測定方法・条件', '測定対象、期間、判定基準、測定方法を記録'),
    area('current.stratification', '層別の切り口', '例：時間帯・品種・設備・作業条件ごとに見る'),
    area('current.finding', '現場把握から分かったこと', '測定や観察から、どこに着目しましたか？'),
  ])); form.append(observation, measurementTable('before'));
}
function measurementTable(phase) {
  const before = phase === 'before', type = state.project.theme.metricType;
  const rows = state.project.measurements.map((row, index) => ({ row, index })).filter(item => item.row.phase === phase);
  const section = card(before ? '対策前の測定データ' : '対策後の測定データ', '空欄は未入力として扱います。測定値0は「0」と入力してください。', '02');
  section.classList.add('measurement-card');
  const notice = type === 'rate' ? '各行は重複しない検査対象にしてください。同じ検査数を不良分類ごとに繰り返すと不良率が変わります。分類別パレート図は「件数」で利用できます。' : type === 'average' ? '各行を同じ重みで平均します。標本数が異なる集計済みの平均値を混ぜないよう、測定単位をそろえてください。' : '各行の件数を合計します。対策前後で集計期間や作業量をそろえてください。分類を入力すると、対策前のパレート図に反映されます。';
  section.append(el('p', 'measurement-notice', notice));
  const scroll = el('div', 'table-scroll'), table = el('table', 'measurement-table');
  table.setAttribute('aria-label', before ? '対策前の測定データ' : '対策後の測定データ');
  const head = el('thead'), headRow = el('tr');
  const columns = [ ['測定日', 'date-column'], ['分類・条件', ''], [type === 'rate' ? '不良数' : type === 'count' ? '件数' : '測定値', 'number-column'], ...(type === 'rate' ? [['検査数', 'number-column']] : []), ['メモ', ''], ['操作', ''] ];
  for (const [label, cls] of columns) { const th = el('th', cls, label); th.scope = 'col'; headRow.append(th); }
  head.append(headRow); table.append(head);
  const body = el('tbody');
  for (const { row, index } of rows) {
    const tr = el('tr'); tr.dataset.measurementIndex = index;
    const cells = [ ['date', 'date'], ['category', 'text'], ['value', 'number'], ...(type === 'rate' ? [['denominator', 'number']] : []), ['note', 'text'] ];
    for (const [key, inputType] of cells) {
      const td = el('td'), input = el('input'); input.type = inputType; input.value = row[key] ?? '';
      input.dataset.path = `measurements.${index}.${key}`;
      const names = { date: '測定日', category: '分類・条件', value: type === 'rate' ? '不良数' : '測定値', denominator: '検査数', note: 'メモ' };
      input.setAttribute('aria-label', `${before ? '対策前' : '対策後'} ${rows.findIndex(item => item.index === index) + 1}行目 ${names[key]}`);
      if (inputType === 'number') { input.dataset.number = 'true'; input.step = type === 'rate' ? '1' : 'any'; if (type !== 'average') input.min = key === 'denominator' ? '1' : '0'; }
      else if (inputType === 'text') input.maxLength = 6000;
      input.placeholder = key === 'category' ? '例：Aライン' : key === 'note' ? '測定条件など' : '';
      td.append(input); tr.append(td);
    }
    const removeCell = el('td'), remove = makeButton('×', 'remove-row', 'remove-row');
    remove.dataset.list = 'measurements'; remove.dataset.index = index; remove.setAttribute('aria-label', '測定行を削除'); removeCell.append(remove); tr.append(removeCell); body.append(tr);
  }
  table.append(body); scroll.append(table); section.append(scroll);
  if (!rows.length) section.append(el('div', 'table-empty', '測定データを追加して、現状の数値を記録しましょう。'));
  const footer = el('div', 'table-footer'), add = makeButton('＋ 測定データを追加', 'add-row', 'add-row');
  add.dataset.list = 'measurements'; add.dataset.phase = phase; add.disabled = state.project.measurements.length >= 500;
  footer.append(add, el('small', '', `${rows.length} 行 ／ 全体で最大500行`)); section.append(footer); return section;
}
function repeatCard(list, index, title) {
  const section = el('article', 'repeat-card'), heading = el('div', 'repeat-card-header'), label = el('span', 'repeat-card-label');
  label.append(el('b', '', String(index + 1).padStart(2, '0')), document.createTextNode(title));
  const remove = makeButton('×', 'remove-row', 'remove-row'); remove.dataset.list = list; remove.dataset.index = index; remove.setAttribute('aria-label', `${title} ${index + 1}を削除`);
  heading.append(label, remove); section.append(heading); return section;
}
function listFooter(section, list, title) {
  if (!state.project[list].length) section.append(el('p', 'list-empty', `${title}を追加して記録しましょう。`));
  const add = makeButton(`＋ ${title}を追加`, 'add-row list-add', 'add-row'); add.dataset.list = list; add.disabled = state.project[list].length >= 100;
  section.append(add, el('p', 'inline-note', `${state.project[list].length} 件を記録 ／ 最大100件`));
}
function renderCauses(form) {
  const section = card('要因を挙げ、根拠を確かめる', '仮説と検証済みの事実を分けて記録します。', '01');
  state.project.causes.forEach((row, i) => {
    const item = repeatCard('causes', i, '要因');
    item.append(fieldGrid([
      field(`causes.${i}.category`, '分類', { placeholder: '例：人・設備・方法・材料・測定・環境' }),
      field(`causes.${i}.status`, '確認状況', { options: [{ value: 'hypothesis', label: '仮説・未検証' }, { value: 'confirmed', label: '確認済み' }, { value: 'rejected', label: '今回は主因から除外' }] }),
      area(`causes.${i}.factor`, '考えられる要因', '何が問題の発生につながっていますか？'),
      area(`causes.${i}.why`, 'なぜ起きるか', 'その要因が生じる背景や仕組みを掘り下げる'),
      area(`causes.${i}.verification`, '検証方法・結果', '観察・実験・データで確かめた結果と根拠を記録'),
    ])); section.append(item);
  }); listFooter(section, 'causes', '要因'); form.append(section);
}
function renderActions(form) {
  const section = card('実施する対策を決める', '要因と対策を結び付け、担当・期限・実施結果を記録します。', '01');
  state.project.actions.forEach((row, i) => {
    const options = [{ value: '', label: '関連する要因を選択' }, ...state.project.causes.map((cause, index) => ({ value: cause.id, label: `${String(index + 1).padStart(2, '0')} ${cause.factor || '要因名未入力'}` }))];
    if (row.causeId && !state.project.causes.some(cause => cause.id === row.causeId)) options.push({ value: row.causeId, label: '削除された要因（再選択してください）' });
    const item = repeatCard('actions', i, '対策');
    item.append(fieldGrid([
      field(`actions.${i}.causeId`, '関連する要因', { full: true, options }),
      area(`actions.${i}.action`, '対策内容', '何を、どのように変えますか？'),
      field(`actions.${i}.owner`, '担当者'), field(`actions.${i}.dueDate`, '実施期限', { type: 'date' }),
      field(`actions.${i}.status`, '実施状況', { full: true, options: [{ value: 'planned', label: '計画中' }, { value: 'doing', label: '実施中' }, { value: 'done', label: '実施完了' }] }),
      area(`actions.${i}.result`, '実施結果', 'いつ、どの範囲で実施しましたか？変更点や未実施の内容も記録'),
    ])); section.append(item);
  }); listFooter(section, 'actions', '対策'); form.append(section);
}
function renderEffect(form) {
  const section = card('対策の効果を評価する', '前後の比較条件を確認し、数値と現場の変化をまとめます。', '01');
  section.append(fieldGrid([
    area('effect.comparability', '前後の比較条件', '対象・測定方法・期間・作業量は比較できますか？'),
    area('effect.conclusion', '効果の評価', '目標の達成状況と、結果をどう評価するかを記録'),
    area('effect.sideEffects', '副作用・他への影響', '作業時間、負担、安全、他工程への影響など'),
    area('effect.intangible', '数値以外の効果', '意識・連携・知識などに、どのような変化がありましたか？'),
  ])); form.append(section, measurementTable('after'));
}
function renderStandards(form) {
  const section = card('改善を続ける仕組み', '守るルールと、維持できているかを確かめる方法を決めます。', '01');
  state.project.standards.forEach((row, i) => {
    const item = repeatCard('standards', i, '管理項目');
    item.append(fieldGrid([
      area(`standards.${i}.rule`, '定着させるルール', '誰が行っても同じように実施できる内容に'),
      field(`standards.${i}.document`, '標準書・記録先', { full: true, placeholder: '標準書名・版・チェックシートの保管先など' }),
      field(`standards.${i}.owner`, '管理担当'), field(`standards.${i}.frequency`, '確認頻度', { placeholder: '例：切り替えごと、週1回' }),
      area(`standards.${i}.checkMethod`, '確認方法', '何を見て、どの基準で確認しますか？'),
      area(`standards.${i}.response`, '異常時の対応', '基準を外れた場合の行動・連絡先'),
      area(`standards.${i}.education`, '教育・周知', '対象者・伝える内容・実施時期'),
    ])); section.append(item);
  }); listFooter(section, 'standards', '管理項目'); form.append(section);
}
function renderReflection(form) {
  const section = card('活動を振り返る', '今回の学びを、次の活動へつなげます。', '01');
  section.append(fieldGrid([
    area('reflection.good', '良かった点', '進め方やチームの取り組みで、良かったこと'),
    area('reflection.improve', '改善したい点', '次の活動では、どのように進め方を変えますか？'),
    area('reflection.remaining', '残された課題', '今回解決できなかった問題や、引き続き確かめたいこと'),
    area('reflection.nextAction', '次の行動', '残された課題に対して、具体的に何をしますか？'),
    field('reflection.owner', '次の担当者'), field('reflection.dueDate', '次の期限', { type: 'date' }),
  ]));
  const review = card('資料にまとめる前の確認', '入力の目安です。資料には未入力の項目も明記されます。', '02');
  const checklist = el('div', 'export-checklist'); checklist.id = 'export-checklist'; review.append(checklist);
  review.append(el('p', 'inline-note', '右上のPowerPoint・Excelから、編集できる資料を出力できます。出力前に入力内容を保存します。JSONバックアップは、別のPCへの移行や記録の保管に利用できます（読み込み上限4 MB）。'));
  const backup = makeButton('JSONバックアップを保存', 'button button-outline', 'backup'); backup.style.marginTop = '14px'; review.append(backup);
  form.append(section, review);
}
function renderGuide() {
  if (!state.project) return;
  const step = state.steps[state.step], progress = state.analysis?.steps?.find(item => item.id === step.id);
  const guide = $('stage-guide'); guide.replaceChildren();
  const tips = el('section', 'guide-card'); tips.append(el('div', 'guide-icon', '✧'), el('h3', '', '考えるときのヒント'));
  const list = el('ul'); for (const text of step.tips || []) list.append(el('li', '', text)); tips.append(list);
  tips.append(el('p', 'guide-footnote', '観察した事実と推測を分けて記録すると、活動の筋道が伝わります。'));
  const missing = el('section', 'missing-card'); missing.append(el('h3', '', '次に記録するとよいこと'));
  if (state.analysisError) missing.append(el('p', '', '入力内容を確認して、指標を再計算してください。'));
  else if (progress?.missing?.length) { const items = el('ul'); for (const text of progress.missing) items.append(el('li', '', text)); missing.append(items); }
  else missing.append(el('p', '', '入力項目がそろいました。現場の事実と照らして内容を確認しましょう。'));
  guide.append(tips, missing);
  const filled = progress?.filled || 0, total = progress?.total || 0;
  $('stage-progress-text').textContent = `${filled} / ${total} 項目`;
  $('stage-progress-bar').style.width = `${total ? filled / total * 100 : 0}%`;
}
function renderMetrics() {
  const metrics = $('metrics'); metrics.replaceChildren();
  metrics.classList.toggle('is-pending', state.analysisPending); metrics.setAttribute('aria-busy', String(state.analysisPending));
  const a = state.analysisError ? null : state.analysis, p = state.project;
  const type = p.theme.metricType, unit = a?.unit ?? p.theme.unit, target = p.theme.target;
  const targetHint = a?.targetMet === true ? '目標を満たしています' : a?.targetMet === false ? '目標まで継続して改善' : p.theme.direction === 'lower' ? '小さいほど良い' : '大きいほど良い';
  const changeHint = a?.improvementPercent !== null && a?.improvementPercent !== undefined ? `改善率 ${fmt(a.improvementPercent)}%` : '対策前後の数値から計算';
  const values = [
    ['対策前', a?.before?.value, unit, a?.before?.count ? `${a.before.count} 行の${type === 'average' ? '単純平均' : type === 'rate' ? '合算比率' : '合計'}` : '測定データ未入力'],
    ['対策後', a?.after?.value, unit, a?.after?.count ? `${a.after.count} 行の${type === 'average' ? '単純平均' : type === 'rate' ? '合算比率' : '合計'}` : '測定データ未入力'],
    ['目標値', target, unit, targetHint],
    ['改善量', a?.improvement, type === 'rate' ? 'pt' : unit, changeHint],
  ];
  for (const [label, value, suffix, hint] of values) {
    const item = el('article', 'metric-card'), caption = el('div', 'metric-caption', label);
    caption.append(el('span', 'metric-symbol', label === '改善量' ? '↗' : label === '目標値' ? '◎' : '·'));
    const number = el('div', `metric-value${value === null || value === undefined ? ' empty' : ''}${label === '改善量' && value < 0 ? ' negative' : ''}`, fmt(value));
    if (Number.isFinite(value)) number.title = `${value}${suffix || ''}`;
    if (value !== null && value !== undefined && suffix) number.append(el('small', '', suffix));
    item.append(caption, number, el('div', 'metric-hint', state.analysisError && label !== '目標値' ? '集計できません。入力を確認' : hint)); metrics.append(item);
  }
}
function renderAnalysis() {
  if (!state.project) return;
  $('tools-count').textContent = state.project.tools?.length || 0;
  toolUI.refreshAnalysis();
  renderMetrics(); renderNav(); renderGuide(); renderMeasurementErrors(); renderCharts();
  const checklist = $('export-checklist');
  if (checklist) {
    checklist.replaceChildren();
    for (const step of state.analysis?.steps || []) {
      const complete = step.filled === step.total, item = el('div', 'checklist-item');
      item.append(el('span', `checklist-icon${complete ? ' complete' : ''}`, complete ? '✓' : '○'), el('span', '', step.title), el('small', '', `${step.filled} / ${step.total}`)); checklist.append(item);
    }
  }
}
function renderMeasurementErrors() {
  document.querySelectorAll('.row-error').forEach(node => node.remove());
  for (const row of document.querySelectorAll('[data-measurement-index]')) {
    row.classList.remove('invalid-row'); row.querySelectorAll('input').forEach(input => { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); });
  }
  for (const issue of state.analysis?.measurementErrors || []) {
    const row = document.querySelector(`[data-measurement-index="${issue.index}"]`); if (!row) continue;
    row.classList.add('invalid-row');
    const errorRow = el('tr', 'row-error'), td = el('td', '', issue.message); td.colSpan = row.children.length; td.id = `measurement-error-${issue.index}`; errorRow.append(td); row.after(errorRow);
    row.querySelectorAll('input[type="number"]').forEach(input => { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', td.id); });
  }
}
function renderCharts() {
  const section = $('analysis-section'); section.replaceChildren();
  if (!state.project) return;
  if (state.analysisError) {
    const warning = el('div', 'warnings-card'); warning.append(el('h3', '', '集計できませんでした'), el('p', 'inline-note', state.analysisError)); section.append(warning); return;
  }
  const step = state.steps[state.step]?.id;
  if (!['current', 'effect', 'reflection'].includes(step)) return;
  const a = state.analysis;
  if (a?.warnings?.length) {
    const warning = el('section', 'warnings-card'), list = el('ul'); warning.append(el('h3', '', 'データを読むときの確認事項'));
    for (const text of a.warnings) list.append(el('li', '', text)); warning.append(list); section.append(warning);
  }
  const charts = el('div', 'analysis-grid');
  const trend = chartCard('測定値の推移', '同じ日・同じ区分のデータは、設定した集計方法でまとめています。');
  if (state.project.theme.metricType !== 'count') trend.classList.add('full-chart');
  const legend = el('div', 'chart-legend');
  for (const [text, color] of [['対策前', '#9aae89'], ['対策後', '#277a68']]) { const item = el('span', 'legend-item'), dot = el('span', 'legend-dot'); dot.style.background = color; item.append(dot, document.createTextNode(text)); legend.append(item); }
  trend.append(legend, trendChart(a?.trend || []), el('p', 'chart-footnote', '日付があり、有効な測定値を集計できる点を表示します。数値の変化だけで因果関係や統計的な有意差は判断できません。')); charts.append(trend);
  if (state.project.theme.metricType === 'count') {
    const pareto = chartCard('対策前の分類別内訳', '件数の多い順に並べ、累積比率を重ねています。');
    pareto.append(paretoChart(a?.pareto || []), el('p', 'chart-footnote', (a?.pareto?.length || 0) > 8 ? '上位8分類と、残りを合算した「その他」を表示します。元の測定行はすべて保持されます。' : 'パレート図は件数指標の対策前データから作成します。')); charts.append(pareto);
  }
  section.append(charts);
}
function chartCard(title, subtitle) { const card = el('section', 'chart-card'); card.append(el('h3', '', title), el('p', 'chart-subtitle', subtitle)); return card; }
function blankChart(text) { return el('div', 'chart-empty', text); }
function chartSvg(label) { const svg = svgEl('svg', { viewBox: '0 0 600 240', role: 'img', 'aria-label': label }); svg.append(svgEl('title', {}, label)); return svg; }
function trendChart(data) {
  const rows = data.filter(row => Number.isFinite(row.value));
  if (!rows.length) return blankChart('測定日と測定値を入力すると、推移を表示します。');
  const svg = chartSvg('対策前と対策後の測定値の推移');
  const dates = [...new Set(data.map(row => row.date))].sort(), values = rows.map(row => row.value);
  let min = Math.min(0, ...values), max = Math.max(0, ...values); if (min === max) max = min + 1;
  const span = max - min; max += span * .1; if (min < 0) min -= span * .05;
  const x = date => dates.length === 1 ? 315 : 54 + dates.indexOf(date) / (dates.length - 1) * 522;
  const y = value => 197 - (value - min) / (max - min) * 167;
  for (let i = 0; i <= 4; i++) {
    const value = min + (max - min) * i / 4, yy = y(value);
    svg.append(svgEl('line', { x1: 54, x2: 576, y1: yy, y2: yy, stroke: '#e7eee0', 'stroke-width': 1 }), svgEl('text', { x: 46, y: yy + 3, 'text-anchor': 'end', fill: '#8da080', 'font-size': 10 }, fmt(value)));
  }
  const interval = Math.max(1, Math.ceil(dates.length / 6));
  dates.forEach((date, index) => { if (index % interval === 0 || index === dates.length - 1) svg.append(svgEl('text', { x: x(date), y: 218, 'text-anchor': 'middle', fill: '#8da080', 'font-size': 10 }, date.slice(5))); });
  for (const [phase, color] of [['before', '#9aae89'], ['after', '#277a68']]) {
    const points = data.filter(row => row.phase === phase);
    let segment = [];
    const drawSegment = () => { if (segment.length > 1) svg.append(svgEl('polyline', { points: segment.map(row => `${x(row.date)},${y(row.value)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2.2, 'stroke-linejoin': 'round' })); segment = []; };
    for (const row of points) { if (Number.isFinite(row.value)) segment.push(row); else drawSegment(); } drawSegment();
    for (const row of points.filter(item => Number.isFinite(item.value))) { const dot = svgEl('circle', { cx: x(row.date), cy: y(row.value), r: 3.5, fill: color, stroke: 'white', 'stroke-width': 1.3 }); dot.append(svgEl('title', {}, `${row.date} ${phase === 'before' ? '対策前' : '対策後'}：${fmt(row.value)}${state.analysis?.unit || ''}`)); svg.append(dot); }
  }
  return svg;
}
function paretoChart(data) {
  if (!data.length) return blankChart('対策前の分類と有効な件数を入力すると表示します。');
  const rows = data.slice(0, 8).map(row => ({ ...row }));
  if (data.length > 8) rows.push({ category: `その他（${data.length - 8}分類）`, value: data.slice(8).reduce((sum, row) => sum + row.value, 0) });
  const total = rows.reduce((sum, row) => sum + row.value, 0), max = Math.max(...rows.map(row => row.value), 1), svg = chartSvg('対策前の分類別件数と累積比率のパレート図');
  const width = 505 / rows.length, x = index => 51 + width * (index + .5), y = value => 185 - value / max * 150;
  for (let i = 0; i <= 4; i++) { const yy = 185 - i / 4 * 150; svg.append(svgEl('line', { x1: 51, x2: 556, y1: yy, y2: yy, stroke: '#e7eee0' }), svgEl('text', { x: 44, y: yy + 3, 'text-anchor': 'end', fill: '#8da080', 'font-size': 10 }, fmt(max * i / 4)), svgEl('text', { x: 563, y: yy + 3, fill: '#8da080', 'font-size': 9 }, `${i * 25}%`)); }
  let running = 0; const points = [];
  rows.forEach((row, index) => {
    const bar = svgEl('rect', { x: x(index) - width * .32, y: y(row.value), width: width * .64, height: 185 - y(row.value), fill: index === 0 ? '#4d8d71' : '#b6cbaa', rx: 2 });
    bar.append(svgEl('title', {}, `${row.category}：${fmt(row.value)}${state.analysis?.unit || ''}`)); svg.append(bar);
    const label = row.category.length > 7 ? `${row.category.slice(0, 6)}…` : row.category;
    const text = svgEl('text', { x: x(index), y: 205, 'text-anchor': 'middle', fill: '#859777', 'font-size': 9 }, label); text.append(svgEl('title', {}, row.category)); svg.append(text);
    running += row.value; if (total > 0) points.push([x(index), 185 - running / total * 150]);
  });
  if (points.length) { svg.append(svgEl('polyline', { points: points.map(point => point.join(',')).join(' '), stroke: '#b08350', 'stroke-width': 2, fill: 'none' })); for (const point of points) svg.append(svgEl('circle', { cx: point[0], cy: point[1], r: 3, fill: '#b08350' })); }
  return svg;
}
function addRow(list, phase) {
  const rows = state.project[list]; if (!Array.isArray(rows)) return;
  const max = list === 'measurements' ? 500 : 100; if (rows.length >= max) { showToast(`追加できる上限は${max}行です。`); return; }
  const blank = { id: crypto.randomUUID() };
  if (list === 'measurements') Object.assign(blank, { phase: phase === 'after' ? 'after' : 'before', date: '', category: '', value: null, denominator: null, note: '' });
  if (list === 'causes') Object.assign(blank, { category: '方法', factor: '', why: '', verification: '', status: 'hypothesis' });
  if (list === 'actions') Object.assign(blank, { causeId: '', action: '', owner: '', dueDate: '', status: 'planned', result: '' });
  if (list === 'standards') Object.assign(blank, { rule: '', document: '', owner: '', frequency: '', checkMethod: '', response: '', education: '' });
  rows.push(blank); markDirty(); renderStage();
  const first = document.querySelector(`[data-path^="${list}.${rows.length - 1}."]`); first?.focus();
}
function removeRow(list, index) {
  const rows = state.project[list]; if (!Array.isArray(rows) || !rows[index]) return;
  const removed = rows.splice(index, 1)[0], projectId = state.project.id;
  // Keep any linked cause ID visible as unresolved until the user chooses a replacement.
  markDirty(); renderStage();
  showToast('行を削除しました。', '元に戻す', () => {
    if (state.project?.id !== projectId) { showToast('活動が切り替わったため、元に戻せません。'); return; }
    const maximum = list === 'measurements' ? 500 : 100;
    if (state.project[list].length >= maximum) { showToast(`上限の${maximum}行に達しています。`); return; }
    state.project[list].splice(Math.min(index, state.project[list].length), 0, removed); markDirty(); renderStage(); showToast('削除した行を元に戻しました。');
  }, 8000);
}
function changeStep(index) {
  if (!state.project || index < 0 || index >= state.steps.length || state.busy) return;
  state.step = index; state.view = 'steps'; applyWorkspaceView(); renderStage();
  $('stage-title').focus({ preventScroll: true }); $('stage-title').scrollIntoView({ block: 'start', behavior: 'auto' });
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function backupProject() {
  if (!state.project) return;
  const title = (state.project.meta.title || 'QC活動').replace(/[\\/:*?"<>|]/g, '_').slice(0, 70);
  download(new Blob([JSON.stringify(state.project, null, 2)], { type: 'application/json;charset=utf-8' }), `${state.project.isSample ? 'サンプル_' : ''}${title}_バックアップ.json`);
  showToast('現在の入力内容をJSONでダウンロードしました。');
}
function importProject(file) {
  return perform('JSONを読み込んでいます…', async () => {
    if (file.size > MAX_BYTES) throw new Error('読み込めるJSONファイルは4 MB以内です。');
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error('JSONの形式を確認してください。QC StudioのJSONバックアップを選択してください。'); }
    const project = parsed?.project?.schemaVersion ? parsed.project : parsed;
    if (!project || project.schemaVersion !== 1 || !project.meta || !project.theme) throw new Error('QC Studioから保存したJSONバックアップを選択してください。');
    if (!await mayLeave()) return;
    acceptProject(await api('/api/projects/import', { method: 'POST', body: { project } }));
    showToast('JSONを新しい活動として読み込みました。');
  });
}
function exportProject(format) {
  return perform(`${format === 'pptx' ? 'PowerPoint' : 'Excel'}を作成しています…`, async () => {
    await saveProject();
    const invalid = state.project.tools?.find(tool => tool.included && !state.analysis?.tools?.find(item => item.id === tool.id)?.valid);
    if (invalid) throw new Error(`「${invalid.title}」に必要な入力がそろっていません。QC道具画面で修正するか、「資料に含める」のチェックを外してください。`);
    const response = await api('/api/exports', { method: 'POST', body: { project: state.project, format }, binary: true });
    const disposition = response.headers.get('Content-Disposition') || '';
    const utf = disposition.match(/filename\*=UTF-8''([^;]+)/i), basic = disposition.match(/filename="([^"]+)"/i);
    let filename = `QC活動資料.${format}`;
    if (utf) { try { filename = decodeURIComponent(utf[1]); } catch { /* Fallback to a safe local name. */ } }
    else if (basic) filename = basic[1];
    download(await response.blob(), filename); showToast(`${filename} をダウンロードしました。`, null, null, 8000);
  });
}
function handleFieldInput(event) {
  const control = event.target.closest('[data-path]'); if (!control || !state.project) return;
  const path = control.dataset.path;
  const value = control.dataset.boolean ? control.checked : control.dataset.number ? control.value.trim() === '' ? null : Number(control.value) : control.value;
  if (Object.is(getPath(path), value)) return;
  setPath(path, value);
  if (path === 'theme.metricType') {
    if (value === 'rate') state.project.theme.unit = '%';
    else if (state.project.theme.unit === '%') state.project.theme.unit = value === 'count' ? '件' : '';
  }
  markDirty();
  if (path === 'theme.metricType') { renderStage(); renderMetrics(); }
}
document.addEventListener('input', handleFieldInput);
document.addEventListener('change', event => { if (event.target.matches('[data-path]')) handleFieldInput(event); });
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if (button.dataset.step !== undefined) { changeStep(Number(button.dataset.step)); return; }
  const command = button.dataset.command;
  if (command === 'new') createProject('blank');
  if (command === 'sample') createProject('sample');
  if (command === 'backup') backupProject();
  if (command === 'reload' && state.project) loadProject(state.project.id);
  if (command === 'add-row') addRow(button.dataset.list, button.dataset.phase);
  if (command === 'remove-row') removeRow(button.dataset.list, Number(button.dataset.index));
});
$('new-project').addEventListener('click', () => createProject('blank'));
$('open-tools').addEventListener('click', () => { if (!state.project || state.busy) return; state.view = 'tools'; applyWorkspaceView(); $('tool-workspace').scrollIntoView({ block: 'start' }); });
$('sample-project').addEventListener('click', () => createProject('sample'));
$('save-project').addEventListener('click', () => perform('保存しています…', async () => { await saveProject(); showToast(`${storageLabel}に保存しました。`); }));
$('project-select').addEventListener('change', event => { const id = event.target.value; event.target.value = state.project?.id || ''; if (id && id !== state.project?.id) loadProject(id); });
$('previous-step').addEventListener('click', () => changeStep(state.step - 1));
$('next-step').addEventListener('click', () => changeStep(state.step + 1));
$('export-xlsx').addEventListener('click', () => exportProject('xlsx'));
$('export-pptx').addEventListener('click', () => exportProject('pptx'));
$('backup-project').addEventListener('click', backupProject);
$('import-project').title = 'QC StudioのJSONバックアップを読み込み（上限4 MB）';
$('import-project').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; if (file) importProject(file); });
$('toast-close').addEventListener('click', () => { $('toast').hidden = true; state.toastAction = null; });
$('toast-action').addEventListener('click', () => { const action = state.toastAction; state.toastAction = null; $('toast').hidden = true; action?.(); });
window.addEventListener('beforeunload', event => { if (state.dirty || state.busy) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (state.project && !state.busy) perform('保存しています…', async () => { await saveProject(); showToast(`${storageLabel}に保存しました。`); }); } });
async function init() {
  try {
    const [bootstrap, list] = await Promise.all([api('/api/bootstrap'), api('/api/projects')]);
    state.token = bootstrap.csrfToken; state.steps = bootstrap.steps; state.toolCatalog = bootstrap.toolCatalog || []; state.projects = list.projects; state.ready = true;
    renderProjectSelector();
    if (state.projects.length) acceptProject(await api(`/api/projects/${encodeURIComponent(state.projects[0].id)}`));
    else renderWorkspace();
    if (list.warning) showToast(list.warning, null, null, 12000);
  } catch (error) {
    $('loading-screen').replaceChildren(el('p', '', errorMessage(error)));
    const retry = makeButton('再読み込み', 'button button-primary'); retry.addEventListener('click', () => location.reload()); $('loading-screen').append(retry); updateControls();
  }
}
const toolUI = setupToolWorkspace({ state, api, perform, markDirty, showToast, fmt, updateControls });
init();
