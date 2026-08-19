// ===================== タブ管理 =====================
let tabs = [];
let activeTabId = null;
let saveTimer = null;
let tabCounter = 0;
let lastTitleClick = { id: null, time: 0 };

function makeTab(name, content, fileHandle) {
  tabCounter += 1;
  return {
    id: `tab-${Date.now()}-${tabCounter}`,
    name,
    content,
    originalContent: content,
    fileHandle: fileHandle || null,
    isDirty: false,
    scrollTop: 0,
    selectionStart: 0,
    selectionEnd: 0,
  };
}

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

// ===================== DOM =====================
const editor = document.getElementById("editor");
const gutter = document.getElementById("gutter");
const tabbar = document.getElementById("tabbar");
const addTabBtn = document.getElementById("addTabBtn");
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

  const first = makeTab("無題のファイル", "");
  tabs.push(first);
  switchTab(first.id);

  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async (launchParams) => {
      if (!launchParams.files || launchParams.files.length === 0) return;
      for (const handle of launchParams.files) {
        await openFileHandleInNewTab(handle);
      }
    });
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

// ===================== テーマ / 折り返し =====================
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

function applyStoredWrap() {
  const on = localStorage.getItem("inkline-wrap") === "1";
  editor.classList.toggle("wrap-on", on);
}

wrapBtn.addEventListener("click", () => {
  const on = editor.classList.toggle("wrap-on");
  localStorage.setItem("inkline-wrap", on ? "1" : "0");
  setStatus(on ? "折り返し: ON" : "折り返し: OFF");
});

// ===================== タブ描画・切替 =====================
function renderTabs() {
  tabbar.innerHTML = "";
  for (const tab of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === activeTabId ? " active" : "");
    el.dataset.id = tab.id;

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.name;
    title.title = "ダブルクリックで名前を変更";

    title.addEventListener("click", (e) => {
      e.stopPropagation();
      const now = Date.now();
      const isDoubleClick =
        lastTitleClick.id === tab.id && now - lastTitleClick.time < 400;

      if (isDoubleClick) {
        lastTitleClick = { id: null, time: 0 };
        startRenameTab(tab, el);
        return;
      }

      lastTitleClick = { id: tab.id, time: now };
      if (tab.id !== activeTabId) switchTab(tab.id);
    });

    el.appendChild(title);

    if (tab.isDirty) {
      const dot = document.createElement("span");
      dot.className = "tab-dirty-dot";
      el.appendChild(dot);
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.title = "閉じる";
    closeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    el.appendChild(closeBtn);

    el.addEventListener("click", () => {
      if (tab.id !== activeTabId) switchTab(tab.id);
    });

    tabbar.appendChild(el);
  }
}

function startRenameTab(tab, tabEl) {
  const titleEl = tabEl.querySelector(".tab-title");
  if (!titleEl) return;

  const dotIdx = tab.name.lastIndexOf(".");
  const baseName = dotIdx > 0 ? tab.name.slice(0, dotIdx) : tab.name;
  const ext = dotIdx > 0 ? tab.name.slice(dotIdx) : "";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tab-rename-input";
  input.value = baseName;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;

  const commit = async () => {
    if (committed) return;
    committed = true;
    const newBase = input.value.trim();
    if (newBase) {
      await renameTab(tab, newBase + ext);
    } else {
      renderTabs();
    }
  };

  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      committed = true;
      renderTabs();
    }
  });
  input.addEventListener("blur", commit);
}

async function renameTab(tab, newName) {
  const oldName = tab.name;
  tab.name = newName;

  if (tab.fileHandle) {
    if (typeof tab.fileHandle.move === "function") {
      try {
        await tab.fileHandle.move(newName);
        setStatus(`ファイル名を「${newName}」に変更しました`);
      } catch (err) {
        console.error(err);
        tab.name = oldName;
        setStatus("ファイル名の変更に失敗しました", true);
      }
    } else {
      setStatus("表示名を変更しました(実ファイル名は「名前を付けて保存」で変更してください)");
    }
  } else {
    setStatus("タブ名を変更しました");
  }

  renderTabs();
}

function saveEditorStateToTab(tab) {
  if (!tab) return;
  tab.content = editor.value;
  tab.scrollTop = editor.scrollTop;
  tab.selectionStart = editor.selectionStart;
  tab.selectionEnd = editor.selectionEnd;
}

function switchTab(id) {
  const current = getActiveTab();
  saveEditorStateToTab(current);

  activeTabId = id;
  const next = getActiveTab();
  if (!next) return;

  editor.value = next.content;
  editor.scrollTop = next.scrollTop;
  editor.setSelectionRange(next.selectionStart, next.selectionEnd);
  gutter.scrollTop = next.scrollTop;

  renderTabs();
  updateGutter();
  updateCounters();
  editor.focus();
}

function closeTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;

  if (tab.id === activeTabId) saveEditorStateToTab(tab);

  if (tab.isDirty && !confirm(`「${tab.name}」の変更を保存せずに閉じますか?`)) {
    return;
  }

  // 最後の1つのタブを閉じる場合は、アプリ自体を終了する
  if (tabs.length === 1) {
    tab.isDirty = false; // beforeunloadでの二重確認を防ぐ
    window.close();
    setTimeout(() => {
      setStatus("このウィンドウは自動で閉じられませんでした。手動で閉じてください。", true);
    }, 300);
    return;
  }

  const idx = tabs.findIndex((t) => t.id === id);
  tabs.splice(idx, 1);

  if (activeTabId === id) {
    const nextIdx = Math.min(idx, tabs.length - 1);
    switchTab(tabs[nextIdx].id);
  } else {
    renderTabs();
  }
}

addTabBtn.addEventListener("click", createNewTab);
newBtn.addEventListener("click", createNewTab);

function createNewTab() {
  const tab = makeTab("無題のファイル", "");
  tabs.push(tab);
  switchTab(tab.id);
  setStatus("新規タブを作成しました");
}

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
    const handles = await window.showOpenFilePicker({
      multiple: true,
      types: [
        {
          description: "テキストファイル",
          accept: { "text/plain": [".txt", ".md", ".log", ".csv", ".json"] },
        },
      ],
    });
    for (const handle of handles) {
      await openFileHandleInNewTab(handle);
    }
  } catch (err) {
    if (err.name !== "AbortError") console.error(err);
  }
});

async function openFileHandleInNewTab(handle) {
  try {
    const file = await handle.getFile();
    const text = await file.text();

    const blank = tabs.find((t) => !t.fileHandle && !t.isDirty && t.content === "" && t.id !== activeTabId);
    const activeIsBlank = getActiveTab() && !getActiveTab().fileHandle && !getActiveTab().isDirty && getActiveTab().content === "" && tabs.length === 1;

    let tab;
    if (activeIsBlank) {
      tab = getActiveTab();
    } else if (blank) {
      tab = blank;
    } else {
      tab = makeTab(file.name, "");
      tabs.push(tab);
    }

    tab.name = file.name;
    tab.content = text;
    tab.originalContent = text;
    tab.fileHandle = handle;
    tab.isDirty = false;

    switchTab(tab.id);
    setStatus(`「${file.name}」を開きました`);
  } catch (err) {
    console.error(err);
    setStatus("ファイルを開けませんでした", true);
  }
}

saveBtn.addEventListener("click", () => saveFile(false));
saveAsBtn.addEventListener("click", () => saveFile(true));

async function saveFile(forceSaveAs) {
  const tab = getActiveTab();
  if (!tab) return;
  saveEditorStateToTab(tab);
  const text = tab.content;

  if (!("showSaveFilePicker" in window)) {
    downloadFallback(tab, text);
    return;
  }

  try {
    if (!tab.fileHandle || forceSaveAs) {
      tab.fileHandle = await window.showSaveFilePicker({
        suggestedName: tab.fileHandle ? tab.name : "無題のファイル.txt",
        types: [{ description: "テキストファイル", accept: { "text/plain": [".txt"] } }],
      });
    }
    const writable = await tab.fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    tab.originalContent = text;
    tab.name = tab.fileHandle.name;
    setTabDirty(tab, false);
    setStatus("保存しました");
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error(err);
      setStatus("保存に失敗しました", true);
    }
  }
}

function downloadFallback(tab, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = tab.name.endsWith(".txt") ? tab.name : `${tab.name}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  tab.originalContent = text;
  setTabDirty(tab, false);
  setStatus("ダウンロードしました(このブラウザは直接保存に非対応です)");
}

// ===================== 自動保存 & 入力監視 =====================
editor.addEventListener("input", () => {
  const tab = getActiveTab();
  if (!tab) return;
  tab.content = editor.value;
  setTabDirty(tab, tab.content !== tab.originalContent);
  updateGutter();
  updateCounters();

  if (tab.fileHandle) {
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

function setTabDirty(tab, dirty) {
  tab.isDirty = dirty;
  renderTabs();
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

function buildRegex(query) {
  if (!query) return null;
  const flags = "g" + (caseToggle.checked ? "" : "i");
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
  const re = buildRegex(findInput.value);
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
  const re = buildRegex(findInput.value);
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
  const re = buildRegex(findInput.value);
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
  const re = buildRegex(findInput.value);
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
    createNewTab();
  } else if (mod && e.key.toLowerCase() === "w") {
    e.preventDefault();
    if (activeTabId) closeTab(activeTabId);
  } else if (mod && e.key === "Tab") {
    e.preventDefault();
    cycleTab(e.shiftKey ? -1 : 1);
  } else if (mod && e.key.toLowerCase() === "f") {
    e.preventDefault();
    setFindPanel(true);
  } else if (e.key === "Escape") {
    if (!findPanel.hidden) setFindPanel(false);
    if (!toolsMenu.hidden) toolsMenu.hidden = true;
  }
});

function cycleTab(dir) {
  if (tabs.length < 2) return;
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  const nextIdx = (idx + dir + tabs.length) % tabs.length;
  switchTab(tabs[nextIdx].id);
}

// ===================== 離脱前の警告 =====================
window.addEventListener("beforeunload", (e) => {
  saveEditorStateToTab(getActiveTab());
  if (tabs.some((t) => t.isDirty)) {
    e.preventDefault();
    e.returnValue = "";
  }
});
