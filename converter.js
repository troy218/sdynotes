(() => {
  'use strict';

  const form = document.getElementById('converterForm');
  const input = document.getElementById('pdfInput');
  const drop = document.getElementById('dropZone');
  const title = document.getElementById('dropTitle');
  const hint = document.getElementById('dropHint');
  const fileName = document.getElementById('fileName');
  const button = document.getElementById('convertButton');
  const progress = document.getElementById('progress');
  const progressTitle = document.getElementById('progressTitle');
  const progressPct = document.getElementById('progressPct');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const result = document.getElementById('result');
  const resultText = document.getElementById('resultText');
  const download = document.getElementById('downloadLink');
  const error = document.getElementById('error');
  const reset = document.getElementById('resetButton');
  let selected = null;
  let pollTimer = null;

  function setError(message) {
    error.textContent = message || '변환 중 오류가 발생했습니다.';
    error.hidden = false;
  }

  function setProgress(value, message, heading) {
    const n = Math.max(0, Math.min(100, Number(value) || 0));
    progressPct.textContent = `${Math.round(n)}%`;
    progressBar.style.width = `${n}%`;
    if (message) progressText.textContent = message;
    if (heading) progressTitle.textContent = heading;
  }

  function choose(file) {
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (!isPdf) {
      selected = null;
      button.disabled = true;
      setError('PDF 파일만 올릴 수 있습니다.');
      return;
    }
    if (file.size > 120 * 1024 * 1024) {
      selected = null;
      button.disabled = true;
      setError('PDF는 120MB 이하만 변환할 수 있습니다.');
      return;
    }
    error.hidden = true;
    selected = file;
    title.textContent = file.name;
    hint.textContent = `${formatBytes(file.size)} · 변환할 준비가 되었습니다`;
    fileName.textContent = file.name;
    fileName.hidden = false;
    button.disabled = false;
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
    return `${(bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)}MB`;
  }

  async function jsonFetch(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `서버 오류 (${response.status})`);
    return data;
  }

  async function poll(job) {
    for (;;) {
      await new Promise((resolve) => { pollTimer = setTimeout(resolve, 900); });
      const data = await jsonFetch(`/api/converter/status?id=${encodeURIComponent(job)}`, { cache: 'no-store' });
      if (data.status === 'working') {
        const total = Number(data.total) || 0;
        const page = Number(data.page) || 0;
        // Parsing is the expensive part and may not expose a page callback from
        // the child process. Keep the UI honest: it never claims completion
        // until the DOCX formatter has actually finished.
        const pct = data.phase === 'formatting'
          ? 92
          : total ? Math.min(88, 8 + (page / total) * 80) : 12;
        setProgress(pct,
          data.phase === 'formatting'
            ? '파싱 결과를 Word 서식으로 배치하는 중입니다.'
            : '같은 SDYnotes PDF 파서로 페이지를 읽는 중입니다.',
          data.phase === 'formatting' ? 'Word 파일을 만드는 중입니다' : 'PDF를 분석하고 있습니다');
        continue;
      }
      if (data.status === 'done') return data;
      throw new Error(data.error || '변환에 실패했습니다.');
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!selected || button.disabled) return;
    error.hidden = true;
    result.hidden = true;
    progress.hidden = false;
    reset.hidden = true;
    button.disabled = true;
    setProgress(4, '파일을 안전하게 업로드하는 중입니다.', '업로드 중입니다');
    try {
      const body = new FormData();
      body.append('file', selected, selected.name || 'document.pdf');
      const queued = await jsonFetch('/api/converter/convert', { method: 'POST', body });
      setProgress(8, '변환 대기열에 등록되었습니다.', 'PDF를 분석하고 있습니다');
      const done = await poll(queued.job);
      setProgress(100, '다운로드할 Word 파일이 준비되었습니다.', '변환이 끝났습니다');
      result.hidden = false;
      resultText.textContent = `${done.pages || queued.total || 1}쪽 · ${done.name || selected.name}`;
      download.href = done.download;
      reset.hidden = false;
    } catch (err) {
      setError(err?.message || '변환 중 오류가 발생했습니다.');
      progress.hidden = true;
      reset.hidden = false;
    } finally {
      button.disabled = !selected;
      pollTimer = null;
    }
  }

  function clear() {
    if (pollTimer) clearTimeout(pollTimer);
    selected = null;
    input.value = '';
    title.textContent = 'PDF를 여기에 놓거나 파일을 선택하세요';
    hint.textContent = 'PDF 파일 1개 · 최대 120MB';
    fileName.hidden = true;
    progress.hidden = true;
    result.hidden = true;
    error.hidden = true;
    reset.hidden = true;
    button.disabled = true;
    setProgress(0, '', 'PDF를 분석하고 있습니다');
  }

  input.addEventListener('change', () => choose(input.files?.[0]));
  form.addEventListener('submit', submit);
  reset.addEventListener('click', clear);
  drop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); }
  });
  ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault(); drop.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault(); drop.classList.remove('dragging');
  }));
  drop.addEventListener('drop', (event) => choose(event.dataTransfer?.files?.[0]));
})();
