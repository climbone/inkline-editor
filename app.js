// ===================== 状態 =====================
let fileHandle = null;
let originalText = "";
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
const wrapBtn = document.getElementById("wrapBtn");

const toolsBtn = document.getElementById("toolsBtn");
const toolsMenu = document.getElementById("toolsMenu");

const findPanel = document.getElementById("findPanel");
const findInput = document.getElementById("findInput");
const replaceInput = document.getElementById("replaceInput");
const regexToggle = document.getElementById("regexToggle");
const caseToggle = document.getElementById("caseToggle");
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
  applyStoredWrap();
  registerServiceWorker();
  updateGutter();
  updateCounters();

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
  const saved = localStorage.getItem("inkline-theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
}

themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("inkline-theme", next);
});

// ===================== 折り返し =====================
function applyStoredWrap() {
  const on = localStorage.getItem("inkline-wrap") === "1";
  editor.classList.toggle("wrap-on", on);
}

wrapBtn.addEventListener("click", () => {
  const on = editor.classList.toggle("wrap-on");
  localStorage.setItem("inkline-wrap", on ? "1" : "0");
  setStatus(on ? "折り返し: ON" : "折り返し: OFF");
});

// ===================== ツールメニュー =====================
toolsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toolsMenu.hidden = !toolsMenu.hidden;
});

document.addEventListener("click", (e) => {
  if (!toolsMenu.hidden && !toolsMenu.contains(e.target) && e.target !== toolsBtn) {
    toolsMenu.hidden = true;
  }
});

toolsMenu.addEventListener("click", (e) => {
  const btn = e.target.closest(".menu-item");
  if (!btn) return;
  runTool(btn.dataset.action);
  toolsMenu.hidden = true;
});

function runTool(action) {
  const text = editor.value;
  const lines = text.split(/\r\n|\n/);
  let result = text;

  switch (action) {
    case "upper":
      result = text.toUpperCase();
      break;
    case "lower":
      result = text.toLowerCase();
      break;
    case "title":
      result = text.replace(/\b\w/g, (c) => c.toUpperCase());
      break;
    case "sortAsc":
      result = lines.slice().sort((a, b) => a.localeCompare(b, "ja")).join("\n");
      break;
    case "sortDesc":
      result = lines.slice().sort((a, b) => b.localeCompare(a, "ja")).join("\n");
      break;
    case "reverseLines":
      result = lines.slice().reverse().join("\n");
      break;
    case "dedupe": {
      const seen = new Set();
      const out = [];
      for (const l of lines) {
        if (!seen.has(l)) {
          seen.add(l);
          out.push(l);
        }
      }
      result = out.join("\n");
      setStatus(`${lines.length - out.length} 行の重複を削除しました`);
      break;
    }
    case "removeBlank":
      result = lines.filter((l) => l.trim() !== "").join("\n");
      break;
    case "trimTrailing":
      result = lines.map((l) => l.replace(/[ \t]+$/, "")).join("\n");
      break;
    case "insertLineNumbers":
      result = lines.map((l, i) => `${i + 1}: ${l}`).join("\n");
      break;
    case "tabToSpace":
      result = text.replace(/\t/g, "    ");
      break;
    case "spaceToTab":
      result = lines.map((l) => l.replace(/^( {4})+/g, (m) => "\t".repeat(m.length / 4))).join("\n");
      break;
    case "eolToLF":
      result = text.replace(/\r\n/g, "\n");
      setStatus("改行コードをLFに統一しました");
      break;
    case "eolToCRLF":
      result = text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
      setStatus("改行コードをCRLFに統一しました");
      break;
  }

  if (result !== text) {
    const pos = editor.selectionStart;
    editor.value = result;
    editor.selectionStart = editor.selectionEnd = Math.min(pos, result.length);
    editor.dispatchEvent(new Event("input"));
    if (!statusMsg.textContent.includes("削除") && !statusMsg.textContent.includes("統一")) {
      setStatus("変換しました");
    }
  }
}

// ===================== ファイル操作 =====================
openBtn.addEventListener("click", async () => {
  if (!("showOpenFilePicker" in window)) {
    setStatus("このブラウザはファイル直接読み込みに対応していません", true);
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [
        {
          description: "テキストファイル",
          accept: { "text/plain": [".txt", ".md", ".log", ".csv", ".json"] },
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
        types: [{ description: "テキストファイル", accept: { "text/plain": [".txt"] } }],
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
  a.download = fileNameEl.textContent.endsWith(".txt") ? fileNameEl.textContent : `${fileNameEl.textContent}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  originalText = text;
  setDirty(false);
  setStatus("ダウンロードしました(このブラウザは直接保存に非対応です)");
}

// ===================== 自動保存 =====================
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
  statusMsg.style.color = isError ? "var(--danger)" : "var(--text-dim)";
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

function buildRegex(query, forGlobalCount) {
  if (!query) return null;
  const flags = "g" + (caseToggle.checked ? "" : "i") + (forGlobalCount ? "" : "");
  if (regexToggle.checked) {
    try {
      return new RegExp(query, flags);
    } catch {
      return null;
    }
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, flags);
}

findInput.addEventListener("input", countMatches);
regexToggle.addEventListener("change", countMatches);
caseToggle.addEventListener("change", countMatches);

function countMatches() {
  const re = buildRegex(findInput.value, true);
  if (!re) {
    findCount.textContent = regexToggle.checked && findInput.value ? "正規表現エラー" : "";
    return;
  }
  const matches = editor.value.match(re);
  findCount.textContent = matches ? `${matches.length} 件` : "0 件";
}

findNextBtn.addEventListener("click", () => jumpToMatch(1));
findPrevBtn.addEventListener("click", () => jumpToMatch(-1));

function jumpToMatch(dir) {
  const re = buildRegex(findInput.value, true);
  if (!re) return;
  const text = editor.value;
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) {
    setStatus("見つかりませんでした", true);
    return;
  }

  const cur = editor.selectionEnd;
  let target;
  if (dir === 1) {
    target = matches.find((m) => m.index >= cur) || matches[0];
  } else {
    const before = matches.filter((m) => m.index < editor.selectionStart);
    target = before.length ? before[before.length - 1] : matches[matches.length - 1];
  }

  editor.focus();
  editor.setSelectionRange(target.index, target.index + target[0].length);
  scrollSelectionIntoView();
}

function scrollSelectionIntoView() {
  const lineHeight = 22.1;
  const before = editor.value.slice(0, editor.selectionStart);
  const line = before.split("\n").length;
  editor.scrollTop = Math.max(0, (line - 4) * lineHeight);
  gutter.scrollTop = editor.scrollTop;
}

replaceBtn.addEventListener("click", () => {
  const re = buildRegex(findInput.value, true);
  if (!re) return;
  const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  const singleRe = new RegExp(re.source, re.flags.replace("g", ""));
  if (singleRe.test(sel)) {
    const start = editor.selectionStart;
    const replaced = sel.replace(singleRe, replaceInput.value);
    editor.setRangeText(replaced, start, start + sel.length, "end");
    editor.dispatchEvent(new Event("input"));
  }
  jumpToMatch(1);
});

replaceAllBtn.addEventListener("click", () => {
  const re = buildRegex(findInput.value, true);
  if (!re) return;
  const matches = editor.value.match(re);
  const count = matches ? matches.length : 0;
  editor.value = editor.value.replace(re, replaceInput.value);
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
  } else if (e.key === "Escape") {
    if (!findPanel.hidden) setFindPanel(false);
    if (!toolsMenu.hidden) toolsMenu.hidden = true;
  }
});

// ===================== 離脱前の警告 =====================
window.addEventListener("beforeunload", (e) => {
  if (isDirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
