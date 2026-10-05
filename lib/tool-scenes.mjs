/** Pure, shared drawing primitives for browser SVG and editable PowerPoint. */
export function buildToolScenes(tool, analysis = {}) {
  if (!tool || !Array.isArray(tool.rows)) return [];
  return builders[tool.kind]?.(tool, analysis) || [];
}

const str = value => value === null || value === undefined || value === '' ? '未入力' : String(value);
const chunks = (array, size) => Array.from({ length: Math.ceil(array.length / size) }, (_, i) => array.slice(i * size, (i + 1) * size));
const code = (prefix, index) => `${prefix}${String(index + 1).padStart(2, '0')}`;
function wrap(text, maximum = 39) {
  const result = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '', width = 0;
    for (const character of paragraph) {
      const unit = /[\x20-\x7e]/.test(character) ? 0.55 : 1;
      if (width + unit > maximum && line) { result.push(line); line = ''; width = 0; }
      line += character; width += unit;
    }
    result.push(line);
  }
  return result.join('\n');
}
function page(tool, suffix) { return { title: `${tool.isSample ? 'サンプル（架空）｜' : ''}${tool.title || tool.kind}${suffix ? ` — ${suffix}` : ''}`, width: 1000, height: 600, boxes: [], lines: [], texts: [] }; }
function box(scene, id, x, y, w, h, text, style = 'normal') { scene.boxes.push({ id, x, y, w, h, text, style }); }
function line(scene, x1, y1, x2, y2, arrow = false, label) { scene.lines.push({ x1, y1, x2, y2, ...(arrow ? { arrow: true } : {}), ...(label ? { label } : {}) }); }
function note(scene, text, y = 560) { scene.texts.push({ x: 25, y, w: 950, h: 36, text, fontSize: 20 }); }
function shortLabel(reference, label, limit = 25) {
  const full = str(label);
  return [...full].length <= limit ? `${reference}\n${wrap(full, Math.max(10, limit / 2))}` : `${reference}\n全文は参照ページ`;
}
/** Keep every label: references are explicit substitutions, never ellipses. */
function referencePages(tool, heading, entries) {
  const result = []; let scene = page(tool, heading), y = 22;
  const flush = () => { if (scene.texts.length) result.push(scene); scene = page(tool, `${heading}（続き）`); y = 22; };
  for (const entry of entries) {
    const lines = wrap(entry, 40).split('\n');
    let offset = 0;
    while (offset < lines.length) {
      const capacity = Math.floor((550 - y) / 30);
      if (capacity < 2) { flush(); continue; }
      const count = Math.min(lines.length - offset, capacity), text = lines.slice(offset, offset + count).join('\n');
      scene.texts.push({ x: 28, y, w: 944, h: count * 30 + 4, text, fontSize: 23 });
      y += count * 30 + 24; offset += count;
      if (offset < lines.length) flush();
    }
  }
  flush(); return result;
}
function grouped(rows, field = 'group') {
  const map = new Map();
  rows.forEach((row, index) => { const name = str(row[field]); if (!map.has(name)) map.set(name, []); map.get(name).push({ ...row, index }); });
  return [...map].map(([name, rows]) => ({ name, rows }));
}
function fishbone(tool) {
  const groups = grouped(tool.rows), sections = groups.flatMap((group, groupIndex) => chunks(group.rows, 2).map((rows, i) => ({ ...group, rows, groupIndex, continuation: i > 0 })));
  const pages = chunks(sections, 6).map((sections, pageIndex) => {
    const scene = page(tool, `特性要因図 ${pageIndex + 1}`);
    line(scene, 30, 300, 840, 300, true);
    box(scene, 'effect', 840, 254, 142, 92, shortLabel('結果', tool.settings?.effect, 14), 'primary');
    sections.forEach((group, index) => {
      const top = index % 2 === 0, column = Math.floor(index / 2), x = 24 + column * 270;
      box(scene, `group-${index}`, x, top ? 8 : 514, 224, 78, shortLabel(code('G', group.groupIndex), group.name, 20), 'accent');
      const branchX = x + 232; line(scene, branchX, top ? 84 : 514, branchX + 25, 300);
      group.rows.forEach((row, itemIndex) => {
        const y = top ? 104 + itemIndex * 86 : 334 + itemIndex * 86;
        box(scene, row.id || code('C', row.index), x, y, 217, 74, shortLabel(code('C', row.index), row.label, 22));
        const lineY = y + 37, branchAtY = branchX + (300 - lineY) / (top ? 216 : -214) * -25 + 25;
        line(scene, x + 217, lineY, branchAtY, lineY);
      });
    });
    return scene;
  });
  return [...pages, ...referencePages(tool, '要因の全文・検討メモ', [`結果：${str(tool.settings?.effect)}`, ...tool.rows.map((row, i) => `${code('C', i)}　${str(row.label)}\n分類：${str(row.group)}\n詳細：${str(row.detail)}`)])];
}
function affinity(tool) {
  const sections = grouped(tool.rows).flatMap((group, groupIndex) => chunks(group.rows, 5).map(rows => ({ ...group, groupIndex, rows })));
  const pages = chunks(sections, 2).map((groups, pageIndex) => {
    const scene = page(tool, `親和図 ${pageIndex + 1}`);
    groups.forEach((group, index) => {
      const x = 24 + index * 494;
      box(scene, `group-${group.groupIndex}`, x, 20, 466, 76, shortLabel(code('G', group.groupIndex), group.name, 38), 'primary');
      group.rows.forEach((row, i) => box(scene, row.id || code('N', row.index), x + 14, 112 + i * 86, 438, 74, shortLabel(code('N', row.index), row.label, 36)));
    }); note(scene, '入力したグループをそのまま配置しています（自動分類ではありません）。'); return scene;
  });
  return [...pages, ...referencePages(tool, 'カード全文', tool.rows.map((row, i) => `${code('N', i)}　${str(row.label)}\nグループ：${str(row.group)}`))];
}
const destinations = value => String(value || '').split(/[,，、\n]/).map(value => value.trim()).filter(Boolean);
function relations(tool) {
  if (!tool.rows.length) return [];
  const scene = page(tool, '連関図・全体構造'), positions = new Map();
  const named = tool.rows.length <= 10 && tool.rows.every(row => [...str(row.label)].length <= 18), halfW = named ? 95 : 35, halfH = named ? 47 : 22;
  tool.rows.forEach((row, index) => {
    const angle = -Math.PI / 2 + index / tool.rows.length * Math.PI * 2;
    positions.set(row.key, { x: 500 + Math.cos(angle) * (named ? 385 : 418), y: 282 + Math.sin(angle) * (named ? 202 : 224), reference: code('N', index) });
  });
  for (const row of tool.rows) {
    const from = positions.get(row.key);
    for (const key of destinations(row.to)) {
      const to = positions.get(key);
      if (!from || !to) continue;
      if (from === to) {
        line(scene, from.x + 35, from.y, from.x + 54, from.y - 46);
        line(scene, from.x + 54, from.y - 46, from.x - 54, from.y - 46);
        line(scene, from.x - 54, from.y - 46, from.x - 35, from.y, true);
      } else {
        const dx = to.x - from.x, dy = to.y - from.y, scale = Math.min(halfW / Math.max(Math.abs(dx), .001), halfH / Math.max(Math.abs(dy), .001), .45);
        line(scene, from.x + dx * scale, from.y + dy * scale, to.x - dx * scale, to.y - dy * scale, true);
      }
    }
  }
  tool.rows.forEach((row, i) => { const p = positions.get(row.key); box(scene, row.id || code('N', i), p.x - halfW, p.y - halfH, halfW * 2, halfH * 2, named ? `${code('N', i)}\n${wrap(row.label, 9)}` : code('N', i), 'accent'); });
  note(scene, '矢印は「原因 → 結果」。各節点の名称と全リンクは参照ページに記載。');
  return [scene, ...referencePages(tool, '節点・関係の全文', tool.rows.map((row, i) => `${code('N', i)}　${str(row.label)}\n識別キー：${str(row.key)}\n接続先：${destinations(row.to).map(key => `${positions.get(key)?.reference || '未定義'}［${key}］`).join('、') || 'なし'}`))];
}
function tree(tool) {
  if (!tool.rows.length) return [];
  const rows = tool.rows, keys = new Map(rows.map((row, i) => [row.key, i])), depths = new Map();
  function depth(index, seen = new Set()) {
    if (depths.has(index)) return depths.get(index);
    if (seen.has(index) || seen.size > rows.length) return 0;
    seen.add(index); const parent = keys.get(rows[index].parent), result = parent === undefined ? 0 : depth(parent, seen) + 1;
    depths.set(index, result); return result;
  }
  rows.forEach((_, i) => depth(i));
  const leaves = rows.map((_, i) => i).filter(i => !rows.some(row => row.parent && row.parent === rows[i].key));
  const positions = new Map(), leafCount = Math.max(1, leaves.length);
  leaves.forEach((index, i) => positions.set(index, 40 + (i + .5) / leafCount * 920));
  function position(index, seen = new Set()) {
    if (positions.has(index)) return positions.get(index);
    if (seen.has(index)) return 500; seen.add(index);
    const children = rows.map((_, i) => i).filter(i => rows[i].parent === rows[index].key && rows[i].parent);
    const value = children.length ? children.reduce((sum, i) => sum + position(i, seen), 0) / children.length : 500;
    positions.set(index, value); return value;
  }
  rows.forEach((_, i) => position(i));
  const named = rows.length <= 10 && leafCount <= 5 && rows.every(row => [...str(row.label)].length <= 16), halfHeight = named ? 43 : 22;
  const pageCount = Math.floor(Math.max(...depths.values()) / 5) + 1, pages = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const scene = page(tool, `系統図・階層 ${pageIndex * 5 + 1}〜${pageIndex * 5 + 5}`), selected = rows.map((_, i) => i).filter(i => Math.floor(depths.get(i) / 5) === pageIndex);
    for (const i of selected) {
      const parentIndex = keys.get(rows[i].parent), x = positions.get(i), y = 54 + (depths.get(i) % 5) * 107;
      if (parentIndex !== undefined) {
        const samePage = Math.floor(depths.get(parentIndex) / 5) === pageIndex;
        line(scene, samePage ? positions.get(parentIndex) : x, samePage ? 54 + halfHeight + (depths.get(parentIndex) % 5) * 107 : 2, x, y - halfHeight, true, samePage ? undefined : `上位 ${code('N', parentIndex)}`);
      }
    }
    for (const i of selected) {
      const x = positions.get(i), y = 54 + (depths.get(i) % 5) * 107, width = named ? 174 : Math.min(126, Math.max(35, 850 / leafCount));
      box(scene, rows[i].id || code('N', i), x - width / 2, y - halfHeight, width, halfHeight * 2, named ? `${code('N', i)}\n${wrap(rows[i].label, 8)}` : code('N', i), depths.get(i) === 0 ? 'primary' : 'normal');
    }
    note(scene, '上位 → 下位の階層構造。コードに対応する名称・親キーは参照ページに記載。'); pages.push(scene);
  }
  return [...pages, ...referencePages(tool, '項目の全文・親子関係', rows.map((row, i) => `${code('N', i)}　${str(row.label)}\n識別キー：${str(row.key)}\n上位：${row.parent ? `${keys.has(row.parent) ? code('N', keys.get(row.parent)) : '参照先未定義'}［${row.parent}］` : '最上位'}`))];
}
function matrix(tool) {
  const rows = tool.matrix?.rows || [], columns = tool.matrix?.columns || [];
  if (!rows.length || !columns.length) return [];
  const named = rows.length <= 6 && columns.length <= 6 && [...rows.map(row => row.label), ...columns].every(label => [...str(label)].length <= 10);
  const scene = page(tool, 'マトリックス図'), x0 = named ? 256 : 136, y0 = named ? 154 : 88, cellW = Math.min(named ? 160 : 74, (named ? 718 : 840) / columns.length), cellH = Math.min(named ? 76 : 51, (named ? 374 : 445) / rows.length), labelW = named ? 220 : 100;
  box(scene, 'axes', 24, 24, labelW, named ? 118 : 54, '行 × 列', 'primary');
  columns.forEach((label, i) => box(scene, `column-${i}`, x0 + i * cellW, 24, cellW - 3, named ? 118 : 54, named ? `${code('C', i)}\n${wrap(label, Math.floor((cellW - 12) / 20))}` : code('C', i), 'accent'));
  rows.forEach((row, i) => {
    box(scene, row.id || `row-${i}`, 24, y0 + i * cellH, labelW, cellH - 3, named ? `${code('R', i)}\n${wrap(row.label, 10)}` : code('R', i), 'accent');
    columns.forEach((_, j) => { const value = row.values[j]; box(scene, `cell-${i}-${j}`, x0 + j * cellW, y0 + i * cellH, cellW - 3, cellH - 3, value === null || value === undefined ? '—' : String(value), value === 9 ? 'primary' : value === 3 ? 'accent' : value === 1 ? 'normal' : 'muted'); });
  });
  note(scene, '関係の重み：9＝強い、3＝中程度、1＝弱い、0＝関係なし、—＝未記入');
  return [scene, ...referencePages(tool, '行・列の全文', [`行軸：${str(tool.settings?.rowAxis)}\n列軸：${str(tool.settings?.columnAxis)}`, ...rows.map((row, i) => `${code('R', i)}　${str(row.label)}`), ...columns.map((label, i) => `${code('C', i)}　${str(label)}`)])];
}
function arrow(tool, analysis) {
  if (!tool.rows.length) return [];
  const events = [...new Set(tool.rows.flatMap(row => [row.from, row.to]).filter(Boolean))], eventIndex = new Map(events.map((key, i) => [key, i])), depths = new Map(events.map(key => [key, 0]));
  for (let pass = 0; pass < events.length; pass++) {
    let changed = false;
    for (const row of tool.rows) if (depths.has(row.from) && depths.has(row.to) && depths.get(row.to) < depths.get(row.from) + 1) { depths.set(row.to, Math.min(events.length, depths.get(row.from) + 1)); changed = true; }
    if (!changed) break;
  }
  const layerRows = new Map(); for (const key of events) { const d = depths.get(key); if (!layerRows.has(d)) layerRows.set(d, []); layerRows.get(d).push(key); }
  const nodeResults = new Map((analysis.details?.nodes || []).map(row => [row.key, row])), activities = new Map((analysis.details?.activities || []).map(row => [row.key, row]));
  const named = events.length <= 8 && events.every(key => [...key].length <= 4) && [...layerRows.values()].every(layer => layer.length <= 4);
  const pos = key => { const d = depths.get(key), layer = layerRows.get(d); return { x: 80 + d % 5 * 205, y: 50 + (layer.indexOf(key) + .5) / layer.length * 460, page: Math.floor(d / 5) }; };
  const maxPage = Math.floor(Math.max(...depths.values()) / 5), pages = [];
  for (let pageIndex = 0; pageIndex <= maxPage; pageIndex++) {
    const scene = page(tool, `アローダイアグラム ${pageIndex + 1}`);
    let routed = 0;
    tool.rows.forEach((row, i) => {
      if (!eventIndex.has(row.from) || !eventIndex.has(row.to)) return;
      const from = pos(row.from), to = pos(row.to);
      const critical = activities.get(row.key)?.critical ? '★' : '', label = `${critical}${code('A', i)} (${str(row.value)})`, halfW = named ? 56 : 32;
      if (from.page !== pageIndex && to.page !== pageIndex) return;
      if (from.page === pageIndex && to.page === pageIndex) {
        const skipsLayer = depths.get(row.to) - depths.get(row.from) > 1, parallel = tool.rows.filter(other => other.from === row.from && other.to === row.to).length > 1;
        if (skipsLayer || parallel) {
          const below = routed % 2 === 1, lane = below ? 502 - Math.floor(routed / 2) * 42 : 72 + Math.floor(routed / 2) * 42, halfH = named ? 54 : 22;
          routed++;
          line(scene, from.x, from.y + (below ? halfH : -halfH), from.x, lane);
          line(scene, from.x, lane, to.x, lane, false, label);
          line(scene, to.x, lane, to.x, to.y + (below ? halfH : -halfH), true);
        } else line(scene, from.x + halfW, from.y, to.x - halfW, to.y, true, label);
      }
      else if (from.page === pageIndex) line(scene, from.x + halfW, from.y, 976, from.y, true, `${critical}${code('A', i)} → ${code('E', eventIndex.get(row.to))}`);
      else line(scene, 10, to.y, to.x - halfW, to.y, true, `${critical}${code('A', i)} ← ${code('E', eventIndex.get(row.from))}`);
    });
    for (const key of events) { const p = pos(key), timing = nodeResults.get(key); if (p.page === pageIndex) box(scene, `event-${eventIndex.get(key)}`, p.x - (named ? 56 : 32), p.y - (named ? 54 : 22), named ? 112 : 64, named ? 108 : 44, named ? `${code('E', eventIndex.get(key))}［${key}］${timing ? `\n最早 ${str(timing.earliest)}\n最遅 ${str(timing.latest)}` : ''}` : code('E', eventIndex.get(key)), 'accent'); }
    note(scene, '★＝クリティカル作業、E＝結合点、A＝作業、括弧内＝所要時間。'); pages.push(scene);
  }
  return [...pages, ...referencePages(tool, '結合点・作業の全文', [...events.map((key, i) => `${code('E', i)}　結合点：${key}`), ...tool.rows.map((row, i) => `${code('A', i)}　${str(row.label)}\n作業キー：${str(row.key)}\n始点：${str(row.from)} → 終点：${str(row.to)}\n所要時間：${str(row.value)}`)])];
}
function pdpc(tool) {
  const pages = chunks(tool.rows.map((row, index) => ({ ...row, index })), 4).map((rows, pageIndex) => {
    const scene = page(tool, `PDPC ${pageIndex + 1}`), labels = ['計画の段階', '実施する行動', '予想される問題', '対応策'];
    labels.forEach((label, i) => scene.texts.push({ x: 20 + i * 248, y: 15, w: 230, h: 40, text: label, fontSize: 23 }));
    rows.forEach((row, index) => {
      const values = [row.group, row.label, row.risk, row.response], y = 74 + index * 121;
      values.forEach((value, column) => {
        const x = 16 + column * 248; box(scene, `${row.id || row.index}-${column}`, x, y, 224, 102, shortLabel(`${code('P', row.index)}-${column + 1}`, value, 24), column === 0 ? 'primary' : column === 2 ? 'accent' : 'normal');
        if (column < 3) line(scene, x + 224, y + 51, x + 248, y + 51, true);
      });
    }); return scene;
  });
  return [...pages, ...referencePages(tool, '計画・問題・対応策の全文', tool.rows.map((row, i) => `${code('P', i)}\n段階：${str(row.group)}\n行動：${str(row.label)}\n予想される問題：${str(row.risk)}\n対応策：${str(row.response)}`))];
}

const builders = { fishbone, affinity, relations, tree, matrix, arrow, pdpc };
