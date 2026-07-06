// Thin API client. Throws {status, message, code} on errors.

export async function api(path, { method = 'GET', body } = {}) {
  let resp;
  try {
    resp = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw { status: 0, message: 'Can’t reach Ascend — is the server running on your PC?' };
  }
  let data = null;
  try { data = await resp.json(); } catch { /* non-JSON */ }
  if (!resp.ok) {
    throw { status: resp.status, message: data?.error || `Request failed (${resp.status})`, code: data?.code };
  }
  return data;
}

// POST + Server-Sent-Events reader for the coach chat
export async function chatStream(message, today, { onDelta, onError, onDone }) {
  let resp;
  try {
    resp = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, today }),
    });
  } catch {
    onError?.({ message: 'Can’t reach Ascend — is the server running on your PC?' });
    return;
  }
  if (!resp.ok || !resp.body) {
    let data = null;
    try { data = await resp.json(); } catch {}
    onError?.({ message: data?.error || 'Chat failed.', code: data?.code });
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      try {
        const evt = JSON.parse(line.slice(5));
        if (evt.type === 'delta') onDelta?.(evt.text);
        else if (evt.type === 'error') onError?.(evt);
        else if (evt.type === 'done') onDone?.();
      } catch { /* partial frame */ }
    }
  }
  onDone?.();
}
