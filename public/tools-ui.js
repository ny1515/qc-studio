import { buildToolScenes } from '../lib/tool-scenes.mjs';

const SVG = 'http://www.w3.org/2000/svg';
const FAMILY = { qc: 'QC7つ道具', newqc: '新QC7つ道具', extra: '補助的な整理方法' };
const COLORS = ['#237c70', '#839a77', '#b27640', '#bd8c69', '#67849a', '#9984a3'];
const text = value => value === null || value === undefined ? '—' : String(value);
function node(tag, cls = '', content) { const n = document.createElement(tag); if (cls) n.className = cls; if (content !== undefined) n.textContent = String(content); return n; }
function svgNode(tag, attrs = {}, content) { const n = document.createElementNS(SVG, tag); for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value)); if (content !== undefined) n.textContent = String(content); return n; }
function button(label, action, cls = 'button button-outline') { const b = node('button', cls, label); b.type = 'button'; b.dataset.toolAction = action; return b; }
function heading(title, subtitle) { const h = node('div', 'tool-section-heading'); h.append(node('h3', '', title)); if (subtitle) h.append(node('p', '', subtitle)); return h; }

export function setupToolWorkspace({ state, api, perform, markDirty, showToast, fmt, updateControls }) {
  const root = document.getElementById('tool-workspace');
  const ui = { active: null, scenePage: new Map(), picker: null };
  const tools = () => state.project?.tools || [];
  const current = () => tools().find(tool => tool.id === ui.active) || tools()[0];
  const catalog = tool => state.toolCatalog.find(entry => entry.kind === tool?.kind);
  const analysisFor = tool => state.analysis?.tools?.find(item => item.id === tool.id);
  function binding(control, path, value, numeric = false) {
    control.dataset.path = path; control.value = value ?? '';
    if (numeric) control.dataset.number = 'true';
    return control;
  }
  function field(path, label, value, options = {}) {
    const wrapper = node('label', `field${options.full ? ' full' : ''}`), caption = node('span', 'field-label', label);
    let control;
    if (options.options) { control = node('select'); options.options.forEach(item => control.append(new Option(item.label, item.value))); }
    else if (options.type === 'textarea') { control = node('textarea'); control.rows = 3; control.maxLength = options.maxLength || 2000; }
    else { control = node('input'); control.type = options.type || 'text'; if (control.type === 'number') { control.step = options.integer ? '1' : 'any'; if (options.min !== undefined) control.min = String(options.min); } else control.maxLength = options.maxLength || 80; }
    binding(control, path, value, options.type === 'number');
    if (options.placeholder) control.placeholder = options.placeholder;
    wrapper.append(caption, control); if (options.hint) wrapper.append(node('span', 'field-hint', options.hint)); return wrapper;
  }
  function toolName(tool) { return `${tool.isSample ? '［架空］' : ''}${tool.title || catalog(tool)?.name || '名称未入力'}`; }
  function renderList() {
    const list = document.getElementById('tool-tabs'); if (!list) return;
    list.replaceChildren();
    for (const tool of tools()) {
      const b = button('', 'select', `tool-tab${current()?.id === tool.id ? ' active' : ''}`); b.dataset.toolId = tool.id; b.title = toolName(tool); b.setAttribute('aria-pressed', String(current()?.id === tool.id));
      b.append(node('span', 'tool-tab-name', toolName(tool)));
      const a = analysisFor(tool), label = !tool.included ? '資料から除外' : a?.valid ? '出力対象' : '入力中';
      b.append(node('span', `tool-tab-status${!tool.included ? ' excluded' : a?.valid ? ' valid' : ''}`, label)); list.append(b);
    }
  }
  function render() {
    if (!state.project || state.view !== 'tools') return;
    state.project.tools ||= [];
    if (!tools().some(tool => tool.id === ui.active)) ui.active = tools()[0]?.id || null;
    root.replaceChildren();
    const top = node('div', 'tools-heading'), words = node('div');
    words.append(node('span', 'eyebrow', 'QUALITY TOOLS'), node('h2', '', 'QC道具'), node('p', '', 'データや考えを図に整理し、活動資料の付録にまとめます。'));
    const add = button('＋ 道具を追加', 'picker', 'button button-primary'); add.disabled = tools().length >= 20;
    top.append(words, add); root.append(top);
    root.append(node('p', 'tool-workspace-note', `QC7つ道具・新QC7つ道具・層別の15種類。作成済み ${tools().length} / 20 件。活動本文は左の7工程から編集できます。`));
    const tabs = node('div', 'tool-tabs'); tabs.id = 'tool-tabs'; tabs.setAttribute('aria-label', '作成したQC道具'); root.append(tabs); renderList();
    const tool = current();
    if (!tool) {
      const empty = node('section', 'tools-empty'); empty.append(node('span', 'tool-empty-symbol', '◇'), node('h3', '', '目的に合う道具を選びましょう'), node('p', '', '数値の分布や関連を見る道具と、意見や計画を整理する道具を用意しています。空の道具から始めるか、明示された架空の例を追加できます。'), button('道具を選ぶ', 'picker', 'button button-primary')); root.append(empty);
      return;
    }
    renderEditor(tool); renderPreview(); updateControls();
  }
  function renderEditor(tool) {
    const index = tools().findIndex(item => item.id === tool.id), definition = catalog(tool), path = `tools.${index}`;
    if (!definition) { root.append(node('p', 'error-banner', 'この道具の定義を読み込めません。画面を再読み込みしてください。')); return; }
    if (tool.isSample) root.append(node('p', 'sample-banner', 'サンプル（架空データ） — 名前を変更しても、画面と出力資料に架空データと表示します。'));
    const config = node('section', 'form-card tool-config');
    const h = heading(definition.name, definition.description), buttons = node('div', 'tool-editor-actions');
    const example = button('架空の例を別に追加', 'example', 'button button-quiet'); example.dataset.kind = tool.kind; example.disabled = tools().length >= 20;
    buttons.append(example, button('この道具を削除', 'delete', 'button button-quiet tool-delete')); h.append(buttons); config.append(h);
    const grid = node('div', 'field-grid');
    grid.append(field(`${path}.title`, '道具のタイトル', tool.title, { maxLength: 120 }), field(`${path}.step`, '関連する工程', tool.step, { options: state.steps.map(step => ({ value: step.id, label: step.title })) }));
    const include = node('label', 'tool-included');
    const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.dataset.path = `${path}.included`; checkbox.checked = tool.included; checkbox.dataset.boolean = 'true';
    include.append(checkbox, node('span', '', 'PowerPoint・Excelの資料に含める'));
    config.append(grid, include, node('p', 'field-hint', '未完成の道具はチェックを外すと出力から除外できます。入力内容は保持されます。'));
    if (definition.settings.length) {
      const settings = node('div', 'field-grid tool-settings');
      for (const setting of definition.settings) settings.append(field(`${path}.settings.${setting.key}`, setting.label, tool.settings[setting.key], { type: setting.type === 'number' ? 'number' : 'text', options: setting.options, min: setting.key === 'bins' ? 1 : undefined, integer: setting.key === 'bins' }));
      config.append(settings);
    }
    config.append(field(`${path}.notes`, '考察・補足メモ', tool.notes, { type: 'textarea', full: true, placeholder: '図から読み取ったこと、判断の根拠、測定条件など', hint: '最大2,000文字。記入内容は出力資料にも掲載します。' }));
    root.append(config);
    definition.matrix ? renderMatrix(tool, index, definition) : renderRows(tool, index, definition);
    const preview = node('section', 'tool-preview'); preview.id = 'tool-preview'; preview.setAttribute('aria-label', '道具の解析とプレビュー'); root.append(preview);
  }
  function renderRows(tool, index, definition) {
    const section = node('section', 'form-card tool-data-card');
    section.append(heading('入力データ', `空欄は未入力、0は数値0として扱います。${tool.kind === 'control' ? '行の順序を測定の時間順にしてください。' : ''}`));
    if (['relations', 'tree', 'arrow'].includes(tool.kind)) section.append(node('p', 'measurement-notice', tool.kind === 'relations' ? '「要因ID」は重複させず、「影響先ID」に接続先のIDをカンマで区切って入力します。矢印は原因から結果へ向きます。' : tool.kind === 'tree' ? '最上位の項目だけ親IDを空欄にし、ほかは上位項目のIDを指定します。最上位は1つにします。' : '作業を矢印、結合点IDを始点と終点として入力します。並行作業の合流には、所要時間0のダミー作業を使えます。'));
    if (tool.kind === 'control') section.append(node('p', 'measurement-notice', tool.settings.mode === 'p' ? 'p管理図：不良品数と検査数を整数で入力します。同じ品物の重複計数は避けてください。' : 'I-MR管理図：個々の測定値を時間順に入力します。「検査数」は使いません。全入力行が暫定の基準データになります。'));
    const scroll = node('div', 'tool-table-scroll'), table = node('table', 'tool-data-table'), thead = node('thead'), header = node('tr');
    header.append(node('th', 'tool-row-number', 'No.'));
    for (const column of definition.columns) { const th = node('th', column.type === 'number' ? 'tool-number-column' : '', column.label); th.scope = 'col'; header.append(th); }
    header.append(node('th', 'tool-row-controls', '行の操作')); thead.append(header); table.append(thead);
    const body = node('tbody');
    tool.rows.forEach((row, rowIndex) => {
      const tr = node('tr'); tr.append(node('th', 'tool-row-number', rowIndex + 1));
      for (const column of definition.columns) {
        const td = node('td'), input = node('input'); input.type = column.type === 'number' ? 'number' : 'text';
        if (input.type === 'text') input.maxLength = 80; else { input.step = column.integer ? '1' : 'any'; if (column.min !== undefined) input.min = String(column.min); }
        binding(input, `tools.${index}.rows.${rowIndex}.${column.key}`, row[column.key], column.type === 'number'); input.setAttribute('aria-label', `${rowIndex + 1}行目 ${column.label}`);
        if (tool.kind === 'control' && column.key === 'denominator' && tool.settings.mode !== 'p') { input.readOnly = true; input.title = 'I-MR管理図の計算では使いません。入力済みの値は保持されます。'; }
        td.append(input); tr.append(td);
      }
      const actions = node('td', 'tool-row-controls');
      for (const [label, action, disabled] of [['↑', 'row-up', rowIndex === 0], ['↓', 'row-down', rowIndex === tool.rows.length - 1], ['×', 'row-delete', false]]) { const b = button(label, action, 'tool-row-button'); b.dataset.index = rowIndex; b.disabled = disabled; b.setAttribute('aria-label', `${rowIndex + 1}行目を${action === 'row-delete' ? '削除' : action === 'row-up' ? '上へ移動' : '下へ移動'}`); actions.append(b); }
      tr.append(actions); body.append(tr);
    });
    table.append(body); scroll.append(table); section.append(scroll);
    if (!tool.rows.length) section.append(node('p', 'table-empty', '「行を追加」から、記録を入力してください。'));
    const footer = node('div', 'table-footer'), add = button('＋ 行を追加', 'row-add', 'add-row'); add.disabled = tool.rows.length >= definition.maxRows;
    footer.append(add, node('small', '', `${tool.rows.length} / ${definition.maxRows} 行`)); section.append(footer); root.append(section);
  }
  function renderMatrix(tool, index, definition) {
    const section = node('section', 'form-card tool-data-card'), matrix = tool.matrix, isPca = tool.kind === 'pca';
    section.append(heading(isPca ? '対象 × 変数のデータ行列' : '項目どうしの関連度', isPca ? '対象を行、測定する変数を列にします。3対象・2変数以上、空欄なしで入力します。' : '0＝関係なし、1＝弱い、3＝中程度、9＝強い。空欄は未評価であり、0とは異なります。'));
    const scroll = node('div', 'tool-table-scroll'), table = node('table', 'tool-matrix-table'), head = node('thead'), header = node('tr');
    header.append(node('th', 'tool-matrix-name', isPca ? '対象名' : tool.settings.rowAxis || '行項目'));
    matrix.columns.forEach((label, colIndex) => {
      const th = node('th'), input = node('input'); input.type = 'text'; input.maxLength = 80; binding(input, `tools.${index}.matrix.columns.${colIndex}`, label); input.placeholder = `列${colIndex + 1}の名称`; input.setAttribute('aria-label', `列${colIndex + 1}の名称`);
      const remove = button('列を削除', 'column-delete', 'tool-column-delete'); remove.dataset.index = colIndex; remove.setAttribute('aria-label', `列${colIndex + 1}を削除`); th.append(input, remove); header.append(th);
    }); header.append(node('th', 'tool-matrix-remove', '操作')); head.append(header); table.append(head);
    const body = node('tbody');
    matrix.rows.forEach((row, rowIndex) => {
      const tr = node('tr'), name = node('td', 'tool-matrix-name'), input = node('input'); input.type = 'text'; input.maxLength = 80; binding(input, `tools.${index}.matrix.rows.${rowIndex}.label`, row.label); input.placeholder = `行${rowIndex + 1}の名称`; input.setAttribute('aria-label', `行${rowIndex + 1}の名称`); name.append(input); tr.append(name);
      matrix.columns.forEach((_, colIndex) => {
        const td = node('td'); let cell;
        if (isPca) { cell = node('input'); cell.type = 'number'; cell.step = 'any'; }
        else { cell = node('select'); for (const [value, label] of [['', '未評価'], ['0', '0 なし'], ['1', '1 弱'], ['3', '3 中'], ['9', '9 強']]) cell.append(new Option(label, value)); }
        binding(cell, `tools.${index}.matrix.rows.${rowIndex}.values.${colIndex}`, row.values[colIndex], true); cell.setAttribute('aria-label', `行${rowIndex + 1} 列${colIndex + 1}の値`); td.append(cell); tr.append(td);
      });
      const td = node('td'), remove = button('×', 'matrix-row-delete', 'tool-row-button'); remove.dataset.index = rowIndex; remove.setAttribute('aria-label', `行${rowIndex + 1}を削除`); td.append(remove); tr.append(td); body.append(tr);
    }); table.append(body); scroll.append(table); section.append(scroll);
    const footer = node('div', 'table-footer'), actions = node('div', 'tool-matrix-add');
    const addRow = button('＋ 行を追加', 'matrix-row-add', 'add-row'), addCol = button('＋ 列を追加', 'column-add', 'add-row'); addRow.disabled = matrix.rows.length >= (isPca ? 60 : 12); addCol.disabled = matrix.columns.length >= (isPca ? 8 : 12);
    actions.append(addRow, addCol); footer.append(actions, node('small', '', `${matrix.rows.length} 行 × ${matrix.columns.length} 列 ／ 最大 ${isPca ? '60 × 8' : '12 × 12'}`)); section.append(footer); root.append(section);
  }
  function renderPreview() {
    if (state.view !== 'tools') return;
    const tool = current(), target = document.getElementById('tool-preview'); if (!tool || !target) return;
    renderList(); target.replaceChildren(); target.classList.toggle('pending', state.analysisPending); target.setAttribute('aria-busy', String(state.analysisPending));
    const h = heading('解析とプレビュー', '入力内容に合わせて更新します。計算結果と現場の条件を照らして解釈してください。');
    h.append(node('span', 'tool-analysis-state', state.analysisPending ? '入力を反映中…' : '現在の入力から計算')); target.append(h);
    const analysis = analysisFor(tool);
    if (state.analysisError) { target.append(node('p', 'error-banner', state.analysisError)); return; }
    if (!analysis) { target.append(node('p', 'table-empty', '入力を確認しています…')); return; }
    if (!analysis.valid) {
      const errors = node('div', 'tool-errors'); errors.setAttribute('role', 'status'); errors.append(node('h4', '', 'プレビューに必要な入力'));
      const ul = node('ul'); for (const message of analysis.errors) ul.append(node('li', '', message)); errors.append(ul);
      errors.append(node('p', '', tool.included ? 'この道具を資料に含めるには、上の項目を整えてください。下書きとして保存する場合は、そのまま保存できます。' : 'この道具は資料から除外されています。入力内容は下書きとして保存できます。')); target.append(errors);
    }
    if (analysis.warnings.length) { const warnings = node('details', 'tool-warnings'); warnings.open = true; warnings.append(node('summary', '', '確認する前提・読み取りの注意')); const ul = node('ul'); analysis.warnings.forEach(message => ul.append(node('li', '', message))); warnings.append(ul); target.append(warnings); }
    if (!analysis.valid) return;
    if (analysis.metrics.length) {
      const metrics = node('div', 'tool-metric-grid');
      for (const metric of analysis.metrics) { const item = node('article', 'metric-card'); item.append(node('span', 'metric-caption', metric.label)); const value = node('div', 'tool-metric-value', typeof metric.value === 'number' ? fmt(metric.value) : text(metric.value)); if (metric.unit) value.append(node('small', '', metric.unit)); value.title = text(metric.value); item.append(value); metrics.append(item); } target.append(metrics);
    }
    for (const chart of analysis.charts) target.append(renderChart(chart, fmt));
    const scenes = buildToolScenes(tool, analysis);
    if (scenes.length) {
      const sceneIndex = Math.min(ui.scenePage.get(tool.id) || 0, scenes.length - 1), scene = scenes[sceneIndex], wrap = node('section', 'tool-scene-card');
      wrap.append(heading(scene.title, '編集できる図として資料に出力します。全文の参照ページも含まれます。'));
      const controls = node('div', 'tool-scene-controls'), previous = button('← 前のページ', 'scene-previous'), next = button('次のページ →', 'scene-next'); previous.disabled = sceneIndex === 0; next.disabled = sceneIndex === scenes.length - 1;
      controls.append(previous, node('span', '', `${sceneIndex + 1} / ${scenes.length} ページ`), next); wrap.append(controls);
      const scroll = node('div', 'tool-scene-scroll'); scroll.append(renderScene(scene)); wrap.append(scroll); target.append(wrap);
    }
    for (const table of analysis.tables) {
      const details = node('details', 'tool-results-table'); details.open = ['checksheet', 'matrix'].includes(tool.kind) || table.name !== '入力データ';
      details.append(node('summary', '', table.name)); const scroll = node('div', 'tool-table-scroll'), htmlTable = node('table'), header = node('tr'), head = node('thead'), body = node('tbody');
      table.columns.forEach(label => { const th = node('th', '', label); th.scope = 'col'; header.append(th); }); head.append(header); htmlTable.append(head);
      table.rows.forEach(row => { const tr = node('tr'); row.forEach(value => { const td = node('td', '', typeof value === 'number' ? fmt(value) : text(value)); td.title = text(value); tr.append(td); }); body.append(tr); }); htmlTable.append(body); scroll.append(htmlTable); details.append(scroll); target.append(details);
    }
    target.append(node('p', 'tool-workspace-note', '道具の入力データをExcelで変更しても、解析結果は自動更新されません。入力の変更と再計算はこのアプリで行い、再出力してください。主成分分析や日程計算の出力値は計算時点の記録です。'));
  }
  function renderPicker() {
    ui.picker?.remove();
    const dialog = node('dialog', 'tool-picker'); ui.picker = dialog;
    const head = heading('QC道具を追加', '「空の道具」は空欄から、「架空の例」は明示された練習データから作成します。');
    const close = button('閉じる ×', 'close-picker', 'button button-quiet'); head.append(close); dialog.append(head);
    for (const [family, label] of Object.entries(FAMILY)) {
      const section = node('section', 'tool-picker-group'); section.append(node('h3', '', label)); const grid = node('div', 'tool-picker-grid');
      for (const entry of state.toolCatalog.filter(item => item.family === family)) {
        const card = node('article', 'tool-picker-card'); card.append(node('h4', '', entry.name), node('p', '', entry.description));
        const buttons = node('div', 'tool-picker-actions'), blank = button('空の道具を追加', 'create', 'button button-primary'), sample = button('架空の例を追加', 'create-sample', 'button button-outline');
        blank.dataset.kind = sample.dataset.kind = entry.kind; buttons.append(blank, sample); card.append(buttons); grid.append(card);
      } section.append(grid); dialog.append(section);
    }
    dialog.addEventListener('click', handleClick); dialog.addEventListener('close', () => { dialog.remove(); if (ui.picker === dialog) ui.picker = null; }); document.body.append(dialog); dialog.showModal();
  }
  async function create(kind, sample) {
    if (tools().length >= 20) { showToast('道具は1活動につき20件までです。'); return; }
    ui.picker?.close();
    await perform('QC道具を追加しています…', async () => {
      const payload = await api('/api/tools/create', { method: 'POST', body: { kind, sample } });
      state.project.tools ||= []; state.project.tools.push(payload.tool); ui.active = payload.tool.id;
      if (state.analysis) { state.analysis.tools ||= []; state.analysis.tools.push(payload.analysis); }
      markDirty(); render(); showToast(sample ? 'サンプル（架空データ）を別の道具として追加しました。' : '空の道具を追加しました。入力データを記録しましょう。');
    });
  }
  function undoableRemove(array, index, label) {
    const owner = current(), scope = array === tools() ? 'tools' : array === owner?.rows ? 'rows' : 'matrix', ownerId = owner?.id;
    const removed = array.splice(index, 1)[0], projectId = state.project.id;
    markDirty(); render();
    showToast(`${label}を削除しました。`, '元に戻す', () => {
      if (state.project?.id !== projectId) return;
      const latest = tools().find(tool => tool.id === ownerId), target = scope === 'tools' ? tools() : scope === 'rows' ? latest?.rows : latest?.matrix.rows;
      const maximum = scope === 'tools' ? 20 : scope === 'rows' ? catalog(latest)?.maxRows : latest?.kind === 'pca' ? 60 : 12;
      if (!target || target.length >= maximum || target.some(row => row.id === removed.id)) return;
      target.splice(Math.min(index, target.length), 0, removed); markDirty(); render();
    }, 8000);
  }
  function handleClick(event) {
    const b = event.target.closest('[data-tool-action]'); if (!b || b.disabled || state.busy) return;
    const action = b.dataset.toolAction, tool = current(), index = Number(b.dataset.index);
    if (action === 'picker') return renderPicker();
    if (action === 'close-picker') return ui.picker?.close();
    if (action === 'create' || action === 'create-sample' || action === 'example') return create(b.dataset.kind, action !== 'create');
    if (action === 'select') { ui.active = b.dataset.toolId; return render(); }
    if (!tool) return;
    const definition = catalog(tool);
    if (action === 'delete') return undoableRemove(tools(), tools().indexOf(tool), '道具');
    if (action === 'row-add') {
      if (tool.rows.length >= definition.maxRows) return;
      tool.rows.push({ id: crypto.randomUUID(), ...Object.fromEntries(definition.columns.map(column => [column.key, column.type === 'number' ? null : ''])) });
    } else if (action === 'row-delete') return undoableRemove(tool.rows, index, '行');
    else if (action === 'row-up' || action === 'row-down') { const next = index + (action === 'row-up' ? -1 : 1); if (next < 0 || next >= tool.rows.length) return; [tool.rows[index], tool.rows[next]] = [tool.rows[next], tool.rows[index]]; }
    else if (action === 'matrix-row-add') { if (tool.matrix.rows.length >= (tool.kind === 'pca' ? 60 : 12)) return; tool.matrix.rows.push({ id: crypto.randomUUID(), label: '', values: tool.matrix.columns.map(() => null) }); }
    else if (action === 'matrix-row-delete') return undoableRemove(tool.matrix.rows, index, '行');
    else if (action === 'column-add') { if (tool.matrix.columns.length >= (tool.kind === 'pca' ? 8 : 12)) return; tool.matrix.columns.push(''); tool.matrix.rows.forEach(row => row.values.push(null)); }
    else if (action === 'column-delete') {
      const name = tool.matrix.columns.splice(index, 1)[0], savedValues = new Map(tool.matrix.rows.map(row => [row.id, row.values.splice(index, 1)[0]])), projectId = state.project.id, toolId = tool.id;
      markDirty(); render(); showToast('列を削除しました。', '元に戻す', () => { const latest = tools().find(item => item.id === toolId); if (state.project?.id !== projectId || !latest || latest.matrix.columns.length >= (tool.kind === 'pca' ? 8 : 12)) return; latest.matrix.columns.splice(index, 0, name); latest.matrix.rows.forEach(row => row.values.splice(index, 0, savedValues.get(row.id) ?? null)); markDirty(); render(); }, 8000); return;
    } else if (action === 'scene-previous' || action === 'scene-next') { ui.scenePage.set(tool.id, Math.max(0, (ui.scenePage.get(tool.id) || 0) + (action === 'scene-next' ? 1 : -1))); renderPreview(); return; }
    else return;
    markDirty(); render();
  }
  root.addEventListener('click', handleClick);
  root.addEventListener('change', event => {
    if (/^tools\.\d+\.settings\.mode$/.test(event.target.dataset.path || '')) queueMicrotask(render);
  });
  function markPending() { const preview = document.getElementById('tool-preview'); if (preview) { preview.classList.add('pending'); preview.setAttribute('aria-busy', 'true'); const label = preview.querySelector('.tool-analysis-state'); if (label) label.textContent = '入力を反映中…'; } }
  return { render, refreshAnalysis: renderPreview, markPending, reset: () => { ui.active = null; ui.scenePage.clear(); ui.picker?.close(); } };
}

function range(values) {
  const finite = values.filter(Number.isFinite); if (!finite.length) return [0, 1];
  let min = Math.min(0, ...finite), max = Math.max(0, ...finite); if (min === max) max = min + 1;
  const span = max - min; return [min < 0 ? min - span * .08 : min, max + span * .08];
}
function renderChart(chart, fmt) {
  const card = node('section', 'tool-chart-card'); card.append(heading(chart.title, [chart.xLabel && `横軸：${chart.xLabel}`, chart.yLabel && `縦軸：${chart.yLabel}`].filter(Boolean).join(' ／ ')));
  const svg = svgNode('svg', { viewBox: '0 0 1000 440', role: 'img', 'aria-label': chart.title }); svg.append(svgNode('title', {}, chart.title));
  const plot = { x: 85, y: 32, w: 825, h: 310 }, scatter = chart.type === 'scatter', series = chart.series || [];
  const [leftMin, leftMax] = range(scatter ? (chart.points || []).map(p => p.y) : series.filter(s => s.axis !== 'right').flatMap(s => s.values));
  const hasRight = series.some(s => s.axis === 'right'), [rightMin, rightMax] = chart.type === 'pareto' ? [0, 100] : range(series.filter(s => s.axis === 'right').flatMap(s => s.values));
  const y = (value, axis) => plot.y + plot.h - (value - (axis === 'right' ? rightMin : leftMin)) / ((axis === 'right' ? rightMax : leftMax) - (axis === 'right' ? rightMin : leftMin)) * plot.h;
  for (let i = 0; i <= 4; i++) {
    const yy = plot.y + plot.h - i / 4 * plot.h;
    svg.append(svgNode('line', { x1: plot.x, x2: plot.x + plot.w, y1: yy, y2: yy, stroke: '#e0e9dc' }), svgNode('text', { x: plot.x - 12, y: yy + 6, 'text-anchor': 'end', fill: '#71876b', 'font-size': 17 }, fmt(leftMin + (leftMax - leftMin) * i / 4)));
    if (hasRight) svg.append(svgNode('text', { x: plot.x + plot.w + 10, y: yy + 6, fill: '#a67947', 'font-size': 17 }, `${fmt(rightMin + (rightMax - rightMin) * i / 4)}${chart.type === 'pareto' ? '%' : ''}`));
  }
  if (scatter) {
    const points = (chart.points || []).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)), [xMin, xMax] = range(points.map(point => point.x)), x = value => plot.x + (value - xMin) / (xMax - xMin) * plot.w;
    for (let i = 0; i <= 5; i++) svg.append(svgNode('text', { x: plot.x + plot.w * i / 5, y: plot.y + plot.h + 30, 'text-anchor': 'middle', fill: '#71876b', 'font-size': 17 }, fmt(xMin + (xMax - xMin) * i / 5)));
    for (const point of points) { const dot = svgNode('circle', { cx: x(point.x), cy: y(point.y), r: 6, fill: '#237c70', opacity: .85, stroke: '#fff', 'stroke-width': 1.5 }); dot.append(svgNode('title', {}, `${point.label || ''}：X=${text(point.x)}, Y=${text(point.y)}`)); svg.append(dot); }
  } else {
    const categories = chart.categories || [], count = Math.max(categories.length, ...series.map(s => s.values.length), 1), band = plot.w / count;
    const x = index => plot.x + (index + .5) * band;
    const step = Math.max(1, Math.ceil(count / 10));
    categories.forEach((label, index) => { if (index % step !== 0 && index !== count - 1) return; const caption = String(label).length <= 9 ? label : `#${index + 1}`; const tick = svgNode('text', { x: x(index), y: plot.y + plot.h + 30, 'text-anchor': 'middle', fill: '#71876b', 'font-size': 16 }, caption); tick.append(svgNode('title', {}, label)); svg.append(tick); });
    const bars = series.filter(s => s.axis !== 'right'), barChart = ['bar', 'histogram', 'pareto'].includes(chart.type);
    series.forEach((item, seriesIndex) => {
      const color = COLORS[seriesIndex % COLORS.length];
      if (barChart && item.axis !== 'right') {
        const histogram = chart.type === 'histogram', span = histogram ? band : band * .8;
        const width = span / Math.max(1, bars.length), sub = bars.indexOf(item);
        item.values.forEach((value, index) => { if (!Number.isFinite(value)) return; const yy = y(value), zero = y(0), bar = svgNode('rect', { x: x(index) - span / 2 + sub * width, y: Math.min(yy, zero), width: Math.max(.5, width - (histogram ? 0 : 1)), height: Math.max(0, Math.abs(zero - yy)), fill: color, rx: histogram ? 0 : 2 }); bar.append(svgNode('title', {}, `${categories[index] || index + 1} ${item.name}：${text(value)}`)); svg.append(bar); });
      } else {
        let segment = [];
        const flush = () => { if (segment.length > 1) svg.append(svgNode('polyline', { points: segment.join(' '), stroke: color, 'stroke-width': 3, fill: 'none', ...( /^(CL|UCL|LCL)$/.test(item.name) ? { 'stroke-dasharray': '7 5' } : {}) })); segment = []; };
        item.values.forEach((value, index) => { if (!Number.isFinite(value)) { flush(); return; } segment.push(`${x(index)},${y(value, item.axis)}`); if (!/^(CL|UCL|LCL)$/.test(item.name)) { const dot = svgNode('circle', { cx: x(index), cy: y(value, item.axis), r: count > 60 ? 2.5 : 4, fill: color }); dot.append(svgNode('title', {}, `${categories[index] || index + 1} ${item.name}：${text(value)}`)); svg.append(dot); } }); flush();
      }
    });
    if (categories.some(label => String(label).length > 9) || categories.length > 10) { const labels = node('details', 'tool-axis-labels'); labels.append(node('summary', '', '横軸の全項目名を表示')); const list = node('ol'); categories.forEach(label => list.append(node('li', '', label))); labels.append(list); card.append(labels); }
  }
  const container = node('div', 'tool-chart-scroll'); container.append(svg); card.insertBefore(container, card.querySelector('.tool-axis-labels'));
  if (series.length) { const legend = node('div', 'tool-chart-legend'); series.forEach((item, index) => { const label = node('span'), dot = node('i'); dot.style.background = COLORS[index % COLORS.length]; label.append(dot, document.createTextNode(`${item.name}${item.axis === 'right' ? '（右軸）' : ''}`)); legend.append(label); }); card.append(legend); }
  return card;
}

function renderScene(scene) {
  const svg = svgNode('svg', { viewBox: `0 0 ${scene.width} ${scene.height}`, role: 'img', 'aria-label': scene.title, class: 'tool-scene-svg' }); svg.append(svgNode('title', {}, scene.title));
  const arrowId = `scene-arrow-${crypto.randomUUID()}`, defs = svgNode('defs'), marker = svgNode('marker', { id: arrowId, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' }); marker.append(svgNode('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#78917e' })); defs.append(marker); svg.append(defs);
  for (const edge of scene.lines) {
    svg.append(svgNode('line', { x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2, stroke: '#78917e', 'stroke-width': 2, ...(edge.arrow ? { 'marker-end': `url(#${arrowId})` } : {}) }));
    if (edge.label) { const label = svgNode('text', { x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2 - 7, 'text-anchor': 'middle', 'font-size': 17, fill: '#536f57', 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 5 }, edge.label); svg.append(label); }
  }
  const styles = { primary: ['#237c70', '#237c70', '#fff'], accent: ['#e8f0df', '#b8cdaa', '#3e6341'], muted: ['#f3f5ee', '#dce4d6', '#93a189'], normal: ['#fff', '#c4d6bc', '#35563c'] };
  for (const b of scene.boxes) {
    const [fill, stroke, ink] = styles[b.style || 'normal'] || styles.normal;
    svg.append(svgNode('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 5, fill, stroke, 'stroke-width': 1.5 }));
    const lines = String(b.text).split('\n'), font = Math.min(20, Math.max(14, (b.h - 8) / (lines.length * 1.22))), lineHeight = font * 1.22, baseline = b.y + (b.h - lines.length * lineHeight) / 2 + font;
    const label = svgNode('text', { x: b.x + b.w / 2, y: baseline, 'text-anchor': 'middle', fill: ink, 'font-size': font });
    lines.forEach((line, index) => label.append(svgNode('tspan', { x: b.x + b.w / 2, dy: index ? lineHeight : 0 }, line))); svg.append(label);
  }
  for (const t of scene.texts) {
    const font = t.fontSize || 20, label = svgNode('text', { x: t.x, y: t.y + font, fill: '#426247', 'font-size': font });
    String(t.text).split('\n').forEach((line, index) => label.append(svgNode('tspan', { x: t.x, dy: index ? font * 1.3 : 0 }, line))); svg.append(label);
  }
  return svg;
}
