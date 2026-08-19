// ===================== 状態 =====================
let fileHandle = null;      // 現在開いているファイルのハンドル
let originalText = "";      // 直近保存済みの内容(差分検知用)
let saveTimer = null;
let isDirty = false;

// ===================== DOM =====================
const editor = document.getElementById("editor");
const gutter = document.getElementById("gutter");
const fileNameEl = document.getElementById("fileName");
const dirtyDot = document.getElementById("dirtyDot");
const statusMsg = document.getElementById("statusMsg");
const lineColEl = document.getElementById("lineCol");
const charCountEl = document.getElementById("charCount");
const wordCountEl = document.getElementById("wordCount");
const lineTotalEl = document.getElementById("lineTotal");

const openBtn = document.getElementById("openBtn");
const newBtn = document.getElementById("newBtn");
const saveBtn = document.getElementById("saveBtn");
const saveAsBtn = document.getElementById("saveAsBtn");
const themeBtn = document.getElementById("themeBtn");
const findBtn = document.getElementById("findBtn");

const findPanel = document.getElementById("findPanel");
const findInput = document.getElementById("findInput");
const replaceInput = document.getElementById("replaceInput");
const findPrevBtn = document.getElementById("findPrevBtn");
const findNextBtn = document.getElementById("findNextBtn");
const replaceBtn = document.getElementById("replaceBtn");
const replaceAllBtn = document.getElementById("replaceAllBtn");
const findCloseBtn = document.getElementById("findCloseBtn");
const findCount = document.getElementById("findCount");

// ===================== 初期化 =====================
init();

async function init() {
  applyStoredTheme();
  registerServiceWorker();
  bindEvents();
  updateGutter();
  updateCounters();

  // Files appなどOSから「このファイルを開く」で起動された場合
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async (launchParams) => {
      if (!launchParams.files || launchParams.files.length === 0) return;
      const handle = launchParams.files[0];
      await openFileHandle(handle);
    });
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

// ===================== テーマ =====================
function applyStoredTheme() {
  const saved = localStorage.getItem("inkline-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
}

themeBtn?.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("inkline-theme", next);
});

// ===================== ファイル操作 =====================
openBtn.addEventListener("click", async () => {
  if (!("showOpenFilePicker" in window)) {
    document.getElementById("legacyOpen")?.click();
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [
        {
          description: "テキストファイル",
          accept: {
            "text/plain": [".txt", ".md", ".log", ".csv", ".json"],
          },
        },
      ],
    });
    await openFileHandle(handle);
  } catch (err) {
    if (err.name !== "AbortError") console.error(err);
  }
});

async function openFileHandle(handle) {
  try {
    const file = await handle.getFile();
    const text = await file.text();
    fileHandle = handle;
    originalText = text;
    editor.value = text;
    fileNameEl.textContent = file.name;
    setDirty(false);
    updateGutter();
    updateCounters();
    setStatus(`「${file.name}」を開きました`);
  } catch (err) {
    console.error(err);
    setStatus("ファイルを開けませんでした", true);
  }
}

newBtn.addEventListener("click", () => {
  if (isDirty && !confirm("保存されていない変更があります。破棄して新規作成しますか?")) return;
  fileHandle = null;
  originalText = "";
  editor.value = "";
  fileNameEl.textContent = "無題のファイル";
  setDirty(false);
  updateGutter();
  updateCounters();
  editor.focus();
  setStatus("新規ファイル");
});

saveBtn.addEventListener("click", () => saveFile(false));
saveAsBtn.addEventListener("click", () => saveFile(true));

async function saveFile(forceSaveAs) {
  const text = editor.value;

  if (!("showSaveFilePicker" in window)) {
    downloadFallback(text);
    return;
  }

  try {
    if (!fileHandle || forceSaveAs) {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: fileHandle ? fileNameEl.textContent : "無題のファイル.txt",
        types: [
          {
            description: "テキストファイル",
            accept: { "text/plain": [".txt"] },
          },
        ],
      });
    }
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    originalText = text;
    fileNameEl.textContent = fileHandle.name;
    setDirty(false);
    setStatus("保存しました");
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error(err);
      setStatus("保存に失敗しました", true);
    }
  }
}

function downloadFallback(text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileNameEl.textContent.endsWith(".txt")
    ? fileNameEl.textContent
    : `${fileNameEl.textContent}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  originalText = text;
  setDirty(false);
  setStatus("ダウンロードしました(このブラウザは直接保存に非対応です)");
}

// ===================== 自動保存(既存ファイルのみ) =====================
editor.addEventListener("input", () => {
  setDirty(editor.value !== originalText);
  updateGutter();
  updateCounters();

  if (fileHandle) {
    clearTimeout(saveTimer);
    setStatus("自動保存を待機中…");
    saveTimer = setTimeout(() => saveFile(false), 900);
  }
});

editor.addEventListener("keyup", updateCursorPos);
editor.addEventListener("click", updateCursorPos);
editor.addEventListener("scroll", () => {
  gutter.scrollTop = editor.scrollTop;
});

function setDirty(dirty) {
  isDirty = dirty;
  dirtyDot.hidden = !dirty;
}

function setStatus(msg, isError) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? "var(--coral)" : "var(--teal)";
}

// ===================== 行番号ガター =====================
function updateGutter() {
  const lines = editor.value.split("\n").length;
  let out = "";
  for (let i = 1; i <= lines; i++) out += i + "\n";
  gutter.textContent = out;
}

// ===================== カウンター類 =====================
function updateCounters() {
  const text = editor.value;
  charCountEl.textContent = text.length.toLocaleString();
  const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
  wordCountEl.textContent = words.toLocaleString();
  lineTotalEl.textContent = text.split("\n").length.toLocaleString();
  updateCursorPos();
}

function updateCursorPos() {
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, pos);
  const line = before.split("\n").length;
  const col = pos - before.lastIndexOf("\n");
  lineColEl.textContent = `${line}:${col}`;
}

// ===================== 検索・置換 =====================
findBtn.addEventListener("click", toggleFindPanel);
findCloseBtn.addEventListener("click", () => setFindPanel(false));

function toggleFindPanel() {
  setFindPanel(findPanel.hidden);
}

function setFindPanel(show) {
  findPanel.hidden = !show;
  if (show) {
    findInput.focus();
    findInput.select();
    countMatches();
  }
}

findInput.addEventListener("input", countMatches);

function countMatches() {
  const q = findInput.value;
  if (!q) {
    findCount.textContent = "";
    return;
  }
  const count = editor.value.split(q).length - 1;
  findCount.textContent = `${count} 件`;
}

findNextBtn.addEventListener("click", () => jumpToMatch(1));
findPrevBtn.addEventListener("click", () => jumpToMatch(-1));

function jumpToMatch(dir) {
  const q = findInput.value;
  if (!q) return;
  const text = editor.value;
  const from = editor.selectionEnd;

  let idx;
  if (dir === 1) {
    idx = text.indexOf(q, from);
    if (idx === -1) idx = text.indexOf(q); // 先頭から再検索
  } else {
    idx = text.lastIndexOf(q, Math.max(0, editor.selectionStart - q.length - 1));
    if (idx === -1) idx = text.lastIndexOf(q); // 末尾から再検索
  }

  if (idx === -1) {
    setStatus("見つかりませんでした", true);
    return;
  }
  editor.focus();
  editor.setSelectionRange(idx, idx + q.length);
  scrollSelectionIntoView();
}

function scrollSelectionIntoView() {
  const lineHeight = 22.1; // font-size 13px * line-height 1.7 相当
  const before = editor.value.slice(0, editor.selectionStart);
  const line = before.split("\n").length;
  editor.scrollTop = Math.max(0, (line - 4) * lineHeight);
  gutter.scrollTop = editor.scrollTop;
}

replaceBtn.addEventListener("click", () => {
  const q = findInput.value;
  const r = replaceInput.value;
  if (!q) return;
  const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  if (sel === q) {
    const start = editor.selectionStart;
    editor.setRangeText(r, start, start + q.length, "end");
    editor.dispatchEvent(new Event("input"));
  }
  jumpToMatch(1);
});

replaceAllBtn.addEventListener("click", () => {
  const q = findInput.value;
  const r = replaceInput.value;
  if (!q) return;
  const count = editor.value.split(q).length - 1;
  editor.value = editor.value.split(q).join(r);
  editor.dispatchEvent(new Event("input"));
  setStatus(`${count} 件を置換しました`);
  countMatches();
});

// ===================== キーボードショートカット =====================
document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveFile(e.shiftKey);
  } else if (mod && e.key.toLowerCase() === "o") {
    e.preventDefault();
    openBtn.click();
  } else if (mod && e.key.toLowerCase() === "n") {
    e.preventDefault();
    newBtn.click();
  } else if (mod && e.key.toLowerCase() === "f") {
    e.preventDefault();
    setFindPanel(true);
  } else if (e.key === "Escape" && !findPanel.hidden) {
    setFindPanel(false);
  }
});

// ===================== 離脱前の警告 =====================
window.addEventListener("beforeunload", (e) => {
  if (isDirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

function bindEvents() {
  // 予約(将来の拡張ポイント)
}
