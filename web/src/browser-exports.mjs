import { prepare } from './office-shared.mjs';

/** Generate an editable Office file entirely in memory. No network calls. */
export async function createOfficeBlob({ project, format }) {
  if (!['pptx', 'xlsx'].includes(format)) throw new Error('出力形式は pptx または xlsx を指定してください。');
  // Recompute from the current input; an earlier UI preview may be stale.
  const context = prepare(project);
  if (format === 'xlsx') {
    const { createWorkbookBlob } = await import('./office-xlsx.mjs');
    return createWorkbookBlob(project, context);
  }
  const { createPresentationBlob } = await import('./office-pptx.mjs');
  return createPresentationBlob(project, context);
}
