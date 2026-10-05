import JSZip from 'jszip';
import { C, COLORS, FONT, axisFormat, finite } from './office-shared.mjs';

// ExcelJS does not author charts. These standard SpreadsheetDrawing/Chart parts
// add editable native charts, with explicit cell references and cached values.
const NS = 'http://schemas.openxmlformats.org';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const xml = value => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`;
const line = color => `<a:ln w="19050"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:prstDash val="solid"/></a:ln>`;
const font = (size = 1100) => `<a:defRPr sz="${size}"><a:solidFill><a:srgbClr val="${C.ink}"/></a:solidFill><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/></a:defRPr>`;
const textProps = () => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${font()}</a:pPr><a:endParaRPr lang="ja-JP"/></a:p></c:txPr>`;
const title = value => value ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${font(1400)}</a:pPr><a:r><a:t>${esc(value)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` : '';
function cache(values, numeric) {
  return `${numeric ? '<c:formatCode>General</c:formatCode>' : ''}<c:ptCount val="${values.length}"/>${values.map((v, i) => numeric && !finite(v) ? '' : `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}`;
}
function ref(tag, formula, values, numeric = true) {
  const kind = numeric ? 'num' : 'str';
  return `<c:${tag}><c:${kind}Ref><c:f>${esc(formula)}</c:f><c:${kind}Cache>${cache(values, numeric)}</c:${kind}Cache></c:${kind}Ref></c:${tag}>`;
}
function axis({ id, cross, horizontal, scatter, plot, format, zero }) {
  const kind = horizontal && !scatter ? 'catAx' : 'valAx';
  const label = horizontal ? plot.xLabel : plot.yLabel;
  return `<c:${kind}><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/>${!horizontal && plot.percentScale ? '<c:max val="100"/><c:min val="0"/>' : !horizontal && zero === 'min' ? '<c:min val="0"/>' : !horizontal && zero === 'max' ? '<c:max val="0"/>' : ''}</c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'b' : 'l'}"/>${horizontal ? '' : `<c:majorGridlines><c:spPr>${line(C.line)}</c:spPr></c:majorGridlines>`}${title(label)}<c:numFmt formatCode="${esc(format)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${textProps()}<c:crossAx val="${cross}"/><c:crosses val="autoZero"/>${kind === 'catAx' ? '<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>' : '<c:crossBetween val="between"/>'}</c:${kind}>`;
}
function chartXml(item, index) {
  const { plot, categoryRef, series } = item, scatter = plot.type === 'scatter', kind = scatter ? 'scatterChart' : plot.type === 'line' ? 'lineChart' : 'barChart';
  const xId = 10000 + index * 2, yId = xId + 1;
  const values = series.flatMap(s => s.values).filter(finite);
  const zero = kind === 'barChart' && values.length ? Math.min(...values) >= 0 ? 'min' : Math.max(...values) <= 0 ? 'max' : '' : '';
  const seriesXml = series.map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${COLORS[i % COLORS.length]}"/></a:solidFill>${line(COLORS[i % COLORS.length])}</c:spPr>${scatter || kind === 'lineChart' ? '<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>' : ''}${scatter ? ref('xVal', s.xRef, s.xValues) + ref('yVal', s.ref, s.values) : ref('cat', categoryRef, plot.categories, false) + ref('val', s.ref, s.values)}${scatter || kind === 'lineChart' ? '<c:smooth val="0"/>' : ''}</c:ser>`).join('');
  const content = `<c:${kind}>${scatter ? '<c:scatterStyle val="marker"/>' : kind === 'barChart' ? '<c:barDir val="col"/><c:grouping val="clustered"/>' : '<c:grouping val="standard"/>'}<c:varyColors val="0"/>${seriesXml}<c:dLbls><c:showVal val="0"/></c:dLbls>${kind === 'barChart' ? `<c:gapWidth val="${plot.histogram ? 0 : 100}"/>` : ''}<c:axId val="${xId}"/><c:axId val="${yId}"/></c:${kind}>`;
  return xml(`<c:chartSpace xmlns:c="${NS}/drawingml/2006/chart" xmlns:a="${NS}/drawingml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><c:lang val="ja-JP"/><c:chart>${title(plot.title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${content}${axis({ id: xId, cross: yId, horizontal: true, scatter, plot, format: scatter ? axisFormat(series[0].xValues) : 'General' })}${axis({ id: yId, cross: xId, horizontal: false, scatter, plot, format: axisFormat(values), zero })}</c:plotArea>${series.length > 1 ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${textProps()}</c:legend>` : ''}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart>${textProps()}<c:externalData r:id="unused"/></c:chartSpace>`.replace('<c:externalData r:id="unused"/>', ''));
}
export async function addNativeCharts(buffer, charts) {
  const zip = await JSZip.loadAsync(buffer), groups = new Map();
  let types = await zip.file('[Content_Types].xml').async('string');
  for (const [i, item] of charts.entries()) {
    const number = i + 1;
    zip.file(`xl/charts/chart${number}.xml`, chartXml(item, number));
    types = types.replace('</Types>', `<Override PartName="/xl/charts/chart${number}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`);
    if (!groups.has(item.sheetId)) groups.set(item.sheetId, []);
    groups.get(item.sheetId).push({ ...item, number });
  }
  let drawingId = 0;
  for (const [sheetId, items] of groups) {
    const id = ++drawingId;
    const anchors = items.map((item, i) => `<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${item.row - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${item.endColumn ?? 8}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${item.row + 18}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="${esc(item.plot.title)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS}/drawingml/2006/chart"><c:chart xmlns:c="${NS}/drawingml/2006/chart" xmlns:r="${NS}/officeDocument/2006/relationships" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join('');
    zip.file(`xl/drawings/drawing${id}.xml`, xml(`<xdr:wsDr xmlns:xdr="${NS}/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS}/drawingml/2006/main">${anchors}</xdr:wsDr>`));
    zip.file(`xl/drawings/_rels/drawing${id}.xml.rels`, xml(`<Relationships xmlns="${NS}/package/2006/relationships">${items.map((item, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/officeDocument/2006/relationships/chart" Target="../charts/chart${item.number}.xml"/>`).join('')}</Relationships>`));
    const relPath = `xl/worksheets/_rels/sheet${sheetId}.xml.rels`;
    let relations = zip.file(relPath) ? await zip.file(relPath).async('string') : xml(`<Relationships xmlns="${NS}/package/2006/relationships"></Relationships>`);
    relations = relations.replace('</Relationships>', `<Relationship Id="rIdQCChart" Type="${NS}/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${id}.xml"/></Relationships>`);
    zip.file(relPath, relations);
    const sheetPath = `xl/worksheets/sheet${sheetId}.xml`;
    const worksheet = await zip.file(sheetPath).async('string');
    zip.file(sheetPath, worksheet.replace('</worksheet>', '<drawing r:id="rIdQCChart"/></worksheet>'));
    types = types.replace('</Types>', `<Override PartName="/xl/drawings/drawing${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  }
  zip.file('[Content_Types].xml', types);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}
