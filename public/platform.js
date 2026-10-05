export const storageLabel = 'このPC';

export async function apiRequest(url, { method = 'GET', body, binary = false, csrfToken = '' } = {}) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
    if (new Blob([options.body]).size > 4 * 1024 * 1024) throw new Error('送信できるデータは4 MB以内です。長い記録を整理してから再度お試しください。');
    options.headers = { 'Content-Type': 'application/json', 'X-QC-Token': csrfToken };
  }
  let response;
  try { response = await fetch(url, options); }
  catch { throw new Error('QC Studioに接続できません。起動用ウィンドウが開いているか確認してください。入力内容はこの画面に残っています。'); }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `処理に失敗しました（${response.status}）。`);
    error.status = response.status;
    throw error;
  }
  return binary ? response : response.json();
}
