// ===================== IndexedDB(状態の永続化) =====================
const DB_NAME = "inkline-db";
const STORE_NAME = "state";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, value) {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("dbSet failed", err);
  }
}

async function dbGet(key) {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("dbGet failed", err);
    return undefined;
  }
}

// ===================== タブ管理 =====================
let tabs = [];
let activeTabId = null;
let saveTimer = null;
let sessionSaveTimer = null;
let tabCounter = 0;
let lastTitleClick = { id: null, time: 0 };
let showInvisibles = false;

function makeTab(opts = {}) {
  tabCounter += 1;
  return {
    id: opts.id || `tab-${Date.now()}-${tabCounter}`,
    name: opts.name || "無題のファイル",
    content: opts.content || "",
    originalContent: opts.originalContent ?? opts.content ?? "",
    fileHandle: opts.fileHandle || null,
    isDirty: !!opts.isDirty,
    scrollTop: 0,
    selectionStart: 0,
    selectionEnd: 0,
    encoding: opts.encoding || "UTF-8",
    lastKnownModified: opts.lastKnownModified || null,
    bookmarks: new Set(opts.bookmarks || []),
  };
}

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

// ===================== DOM =====================
const editor = document.getElementById("editor");
const gutter = document.getElementById("gutter");
const highlightLayer = document.getElementById("highlightLayer");
const highlightCode = document.getElementById("highlightCode");
const mdPreview = document.getElementById("mdPreview");
const tabbar = document.getElementById("tabbar");
const addTabBtn = document.getElementById("addTabBtn");
const statusMsg = document.getElementById("statusMsg");
const lineColEl = document.getElementById("lineCol");
const charCountEl = document.getElementById("charCount");
const wordCountEl = document.getElementById("wordCount");
const lineTotalEl = document.getElementById("lineTotal");
const selectionBox = document.getElementById("selectionBox");
const selectionInfo = document.getElementById("selectionInfo");
const bracketBox = document.getElementById("bracketBox");
const bracketInfo = document.getElementById("bracketInfo");

const openBtn = document.getElementById("openBtn");
const recentBtn = document.getElementById("recentBtn");
const recentMenu = document.getElementById("recentMenu");
const recentList = document.getElementById("recentList");
const newBtn = document.getElementById("newBtn");
const saveBtn = document.getElementById("saveBtn");
const saveAsBtn = document.getElementById("saveAsBtn");
const themeBtn = document.getElementById("themeBtn");
const findBtn = document.getElementById("findBtn");
const wrapBtn = document.getElementById("wrapBtn");
const mdPreviewBtn = document.getElementById("mdPreviewBtn");
const voiceBtn = document.getElementById("voiceBtn");
const invisiblesBtn = document.getElementById("invisiblesBtn");

const outlineBtn = document.getElementById("outlineBtn");
const outlineMenu = document.getElementById("outlineMenu");
const outlineList = document.getElementById("outlineList");

const bookmarksBtn = document.getElementById("bookmarksBtn");
const bookmarksMenu = document.getElementById("bookmarksMenu");
const bookmarksList = document.getElementById("bookmarksList");

const fontDownBtn = document.getElementById("fontDownBtn");
const fontUpBtn = document.getElementById("fontUpBtn");
const fontSizeLabel = document.getElementById("fontSizeLabel");

const encodingBtn = document.getElementById("encodingBtn");
const encodingMenu = document.getElementById("encodingMenu");
const encodingLabel = document.getElementById("encodingLabel");

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

const gotoPanel = document.getElementById("gotoPanel");
const gotoInput = document.getElementById("gotoInput");
const gotoGoBtn = document.getElementById("gotoGoBtn");
const gotoCloseBtn = document.getElementById("gotoCloseBtn");

const columnPanel = document.getElementById("columnPanel");
const colStartLine = document.getElementById("colStartLine");
const colEndLine = document.getElementById("colEndLine");
const colIndex = document.getElementById("colIndex");
const colInsertText = document.getElementById("colInsertText");
const colDeleteCount = document.getElementById("colDeleteCount");
const colApplyBtn = document.getElementById("colApplyBtn");
const columnCloseBtn = document.getElementById("columnCloseBtn");

const externalChangeBar = document.getElementById("externalChangeBar");
const externalChangeMsg = document.getElementById("externalChangeMsg");
const externalReloadBtn = document.getElementById("externalReloadBtn");
const externalDismissBtn = document.getElementById("externalDismissBtn");

// ===================== 初期化 =====================
let restorePromise = null;

init();

async function init() {
  applyStoredTheme();
  applyStoredWrap();
  applyStoredFontSize();
  applyStoredInvisibles();
  registerServiceWorker();
  bindStaticEvents();

  // 1. OSからのファイル受け取り(launchQueue)をアプリ起動時に最優先で登録
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async (launchParams) => {
      try {
        if (!launchParams.files || launchParams.files.length === 0) {
          console.warn("launchQueue: ファイルを受け取れませんでした", launchParams);
          setStatus("開こうとしたファイルを受け取れませんでした。もう一度お試しください", true);
          return;
        }
        // セッション復元中の場合は完了を待ってからファイルを開く
        if (restorePromise) await restorePromise;
        for (const handle of launchParams.files) {
          await openFileHandleInNewTab(handle);
        }
      } catch (err) {
        console.error("launchQueue consumer error", err);
        setStatus("ファイルを開く処理中にエラーが発生しました", true);
      }
    });
  }

  // 2. セッション復元を非同期で開始
  restorePromise = restoreSession();
  await restorePromise;
  renderRecentMenu();

  window.addEventListener("focus", () => {
    const tab = getActiveTab();
    if (tab && tab.fileHandle) checkExternalChange(tab);
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

// ===================== セッション復元 =====================
async function restoreSession() {
  const fileAlreadyLoaded = tabs.length > 0;
  const saved = await dbGet("tabs");
  const savedActiveId = await dbGet("activeTabId");

  if (Array.isArray(saved) && saved.length > 0) {
    const restoredTabs = saved.map((t) =>
      makeTab({
        id: t.id,
        name: t.name,
        content: t.content,
        originalContent: t.content,
        fileHandle: t.fileHandle || null,
        isDirty: false,
        encoding: t.encoding || "UTF-8",
        lastKnownModified: t.lastKnownModified || null,
        bookmarks: t.bookmarks || [],
      })
    );

    if (fileAlreadyLoaded) {
      // すでにファイルが開いている場合はバックグラウンドで過去タブを追加復元する
      tabs = [...tabs, ...restoredTabs];
      renderTabs();
    } else {
      tabs = restoredTabs;
      const target = tabs.find((t) => t.id === savedActiveId) || tabs[0];
      switchTab(target.id);
      setStatus("前回のタブを復元しました");
    }
  } else if (!fileAlreadyLoaded) {
    // ファイルが開かれておらず、復元データもない場合のみ空タブを作成
    const first = makeTab({});
    tabs.push(first);
    switchTab(first.id);
  }
}

function scheduleSaveSession() {
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(saveSessionNow, 600);
}

async function saveSessionNow() {
  const current = getActiveTab();
  saveEditorStateToTab(current);
  const lightweight = tabs.map((t) => ({
    id: t.id,
    name: t.name,
    content: t.content,
    fileHandle: t.fileHandle,
    encoding: t.encoding,
    lastKnownModified: t.lastKnownModified,
    bookmarks: [...t.bookmarks],
  }));
  await dbSet("tabs", lightweight);
  await dbSet("activeTabId", activeTabId);
}

// ===================== テーマ / 折り返し / フォントサイズ =====================
function applyStoredTheme() {
  const saved = localStorage.getItem("inkline-theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
}

function applyStoredWrap() {
  const on = localStorage.getItem("inkline-wrap") === "1";
  editor.classList.toggle("wrap-on", on);
  highlightLayer.classList.toggle("wrap-on", on);
}

function applyStoredInvisibles() {
  showInvisibles = localStorage.getItem("inkline-invisibles") === "1";
  invisiblesBtn.style.color = showInvisibles ? "var(--accent)" : "";
}

function applyStoredFontSize() {
  const size = parseInt(localStorage.getItem("inkline-fontsize") || "13", 10);
  setFontSize(size);
}

function setFontSize(size) {
  const clamped = Math.min(28, Math.max(10, size));
  document.documentElement.style.setProperty("--editor-font-size", `${clamped}px`);
  fontSizeLabel.textContent = `${clamped}px`;
  localStorage.setItem("inkline-fontsize", String(clamped));
}

function currentFontSize() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--editor-font-size");
  return parseInt(raw, 10) || 13;
}

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

  if (tab.id === activeTabId) updateHighlight();
  renderTabs();
  scheduleSaveSession();
}

function saveEditorStateToTab(tab) {
  if (!tab) return;
  tab.content = editor.value;
  tab.scrollTop = editor.scrollTop;
  tab.selectionStart = editor.selectionStart;
  tab.selectionEnd = editor.selectionEnd;
}

async function switchTab(id) {
  const current = getActiveTab();
  
  // 別のタブへ切替える時のみ現在の画面状態を保存する
  if (current && current.id !== id) {
    saveEditorStateToTab(current);
  }

  activeTabId = id;
  const next = getActiveTab();
  if (!next) return;

  editor.value = next.content;
  editor.scrollTop = next.scrollTop;
  editor.setSelectionRange(next.selectionStart, next.selectionEnd);
  gutter.scrollTop = next.scrollTop;
  highlightLayer.scrollTop = next.scrollTop;

  renderTabs();
  updateGutter();
  updateCounters();
  updateEncodingLabel();
  updateMdPreview();
  hideExternalChangeBar();
  editor.focus();

  if (next.fileHandle) {
    try {
      const granted = await verifyPermission(next.fileHandle);
      if (granted) {
        checkExternalChange(next);
      } else {
        setStatus("このファイルへのアクセス許可が必要です(保存時に再度確認されます)", true);
      }
    } catch {
      // 権限確認エラー時は無視
    }
  }
}

// ===================== タブ閉じる =====================
async function closeTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;

  if (tab.id === activeTabId) saveEditorStateToTab(tab);

  if (tab.isDirty && !confirm(`「${tab.name}」の変更を保存せずに閉じますか?`)) {
    return;
  }

  // 最後の1つのタブを閉じる場合
  if (tabs.length === 1) {
    tab.isDirty = false;
    tabs = [];
    renderTabs();
    editor.value = "";
    updateGutter();
    updateCounters();

    // セッション状態をクリア(window.closeで破棄される前に書き込みを完了させる)
    await dbSet("tabs", []);
    await dbSet("activeTabId", null);

    // ウィンドウを閉じる
    window.close();

    // OSやブラウザのセキュリティ制限で window.close() がブロックされた場合のみメッセージ表示
    setTimeout(() => {
      setStatus("ウィンドウを閉じるには右上の「×」ボタンを押してください", true);
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
  scheduleSaveSession();
}

addTabBtn.addEventListener("click", createNewTab);
newBtn.addEventListener("click", createNewTab);

function createNewTab() {
  const tab = makeTab({});
  tabs.push(tab);
  switchTab(tab.id);
  setStatus("新規タブを作成しました");
  scheduleSaveSession();
}

// ===================== 汎用: メニュー開閉 =====================
function setupMenuToggle(btn, menu) {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willShow = menu.hidden;
    document.querySelectorAll(".menu").forEach((m) => {
      m.hidden = true;
      m.style.transform = "";
      m.style.maxHeight = "";
      m.querySelectorAll(".menu-category.open").forEach((c) => c.classList.remove("open"));
    });
    if (willShow) {
      menu.hidden = false;
      clampMenuPosition(menu);
    }
  });
}

function clampMenuPosition(menu) {
  const margin = 8;
  const rect = menu.getBoundingClientRect();

  let dx = 0;
  if (rect.right > window.innerWidth - margin) {
    dx = window.innerWidth - margin - rect.right;
  }
  if (rect.left + dx < margin) {
    dx = margin - rect.left;
  }
  menu.style.transform = dx ? `translateX(${dx}px)` : "";

  const availableHeight = window.innerHeight - rect.top - margin;
  if (rect.height > availableHeight) {
    menu.style.maxHeight = `${Math.max(160, availableHeight)}px`;
    menu.style.overflowY = "auto";
  } else {
    menu.style.maxHeight = "";
    menu.style.overflowY = "";
  }
}

function setupToolsCategories() {
  const categories = toolsMenu.querySelectorAll(".menu-category");
  categories.forEach((cat) => {
    let hoverTimer = null;
    const submenu = cat.querySelector(".submenu");

    cat.addEventListener("mouseenter", () => {
      clearTimeout(hoverTimer);
      categories.forEach((c) => {
        if (c !== cat) c.classList.remove("open");
      });
      cat.classList.add("open");
      positionSubmenu(cat, submenu);
    });

    cat.addEventListener("mouseleave", () => {
      hoverTimer = setTimeout(() => cat.classList.remove("open"), 200);
    });

    cat.addEventListener("click", (e) => {
      if (e.target.closest(".menu-item")) return;
      const isOpen = cat.classList.contains("open");
      categories.forEach((c) => c.classList.remove("open"));
      if (!isOpen) {
        cat.classList.add("open");
        positionSubmenu(cat, submenu);
      }
    });
  });
}

function positionSubmenu(cat, submenu) {
  const margin = 8;
  const catRect = cat.getBoundingClientRect();

  submenu.style.top = `${catRect.top - 6}px`;
  submenu.style.left = `${catRect.right + 6}px`;
  const rect = submenu.getBoundingClientRect();

  let left = catRect.right + 6;
  if (left + rect.width > window.innerWidth - margin) {
    left = catRect.left - rect.width - 6;
  }
  if (left < margin) left = margin;

  let top = catRect.top - 6;
  if (top + rect.height > window.innerHeight - margin) {
    top = window.innerHeight - margin - rect.height;
  }
  if (top < margin) top = margin;

  submenu.style.left = `${left}px`;
  submenu.style.top = `${top}px`;
}

function bindStaticEvents() {
  setupMenuToggle(toolsBtn, toolsMenu);
  setupMenuToggle(recentBtn, recentMenu);
  setupMenuToggle(encodingBtn, encodingMenu);
  setupToolsCategories();

  outlineBtn.addEventListener("click", renderOutlineMenu);
  setupMenuToggle(outlineBtn, outlineMenu);
  outlineList.addEventListener("click", (e) => {
    const btn = e.target.closest(".menu-item[data-line]");
    if (!btn) return;
    outlineMenu.hidden = true;
    jumpToLine(parseInt(btn.dataset.line, 10));
  });

  bookmarksBtn.addEventListener("click", renderBookmarksMenu);
  setupMenuToggle(bookmarksBtn, bookmarksMenu);
  bookmarksList.addEventListener("click", (e) => {
    const btn = e.target.closest(".menu-item[data-line]");
    if (!btn) return;
    bookmarksMenu.hidden = true;
    jumpToLine(parseInt(btn.dataset.line, 10));
  });

  invisiblesBtn.addEventListener("click", () => {
    showInvisibles = !showInvisibles;
    localStorage.setItem("inkline-invisibles", showInvisibles ? "1" : "0");
    invisiblesBtn.style.color = showInvisibles ? "var(--accent)" : "";
    updateHighlight();
    setStatus(showInvisibles ? "空白・タブ・改行の表示: ON" : "空白・タブ・改行の表示: OFF");
  });

  document.addEventListener("click", (e) => {
    document.querySelectorAll(".menu").forEach((m) => {
      const owner = m.previousElementSibling;
      if (!m.hidden && !m.contains(e.target) && e.target !== owner && !owner?.contains(e.target)) {
        m.hidden = true;
        m.style.transform = "";
        m.style.maxHeight = "";
        m.querySelectorAll(".menu-category.open").forEach((c) => c.classList.remove("open"));
      }
    });
  });

  toolsMenu.addEventListener("click", (e) => {
    const btn = e.target.closest(".menu-item");
    if (!btn) return;
    const action = btn.dataset.action;
    toolsMenu.hidden = true;
    toolsMenu.querySelectorAll(".menu-category.open").forEach((c) => c.classList.remove("open"));
    if (action === "gotoLine") {
      setGotoPanel(true);
    } else if (action === "insertTimestamp") {
      insertTimestamp();
    } else if (action === "columnEdit") {
      openColumnPanel();
    } else if (action === "toggleBookmark") {
      toggleBookmark();
    } else {
      runTool(action);
    }
  });

  encodingMenu.addEventListener("click", (e) => {
    const btn = e.target.closest(".menu-item[data-enc]");
    if (!btn) return;
    encodingMenu.hidden = true;
    reDecodeCurrentTab(btn.dataset.enc);
  });

  themeBtn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("inkline-theme", next);
  });

  wrapBtn.addEventListener("click", () => {
    const on = editor.classList.toggle("wrap-on");
    highlightLayer.classList.toggle("wrap-on", on);
    localStorage.setItem("inkline-wrap", on ? "1" : "0");
    setStatus(on ? "折り返し: ON" : "折り返し: OFF");
  });

  fontDownBtn.addEventListener("click", () => setFontSize(currentFontSize() - 1));
  fontUpBtn.addEventListener("click", () => setFontSize(currentFontSize() + 1));

  mdPreviewBtn.addEventListener("click", toggleMdPreview);
  voiceBtn.addEventListener("click", toggleVoiceInput);

  externalReloadBtn.addEventListener("click", async () => {
    const tab = getActiveTab();
    if (!tab || !tab.fileHandle) return;
    await reloadTabFromDisk(tab);
    hideExternalChangeBar();
  });
  externalDismissBtn.addEventListener("click", async () => {
    const tab = getActiveTab();
    hideExternalChangeBar();
    if (!tab || !tab.fileHandle) return;
    try {
      const file = await tab.fileHandle.getFile();
      tab.lastKnownModified = file.lastModified;
      scheduleSaveSession();
    } catch {
      // 無視
    }
  });

  gotoCloseBtn.addEventListener("click", () => setGotoPanel(false));
  gotoGoBtn.addEventListener("click", goToLine);
  gotoInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") goToLine();
    if (e.key === "Escape") setGotoPanel(false);
  });

  columnCloseBtn.addEventListener("click", () => (columnPanel.hidden = true));
  colApplyBtn.addEventListener("click", applyColumnEdit);

  // ドラッグ＆ドロップによるファイル読み込み対応
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (!e.dataTransfer) return;

    if (e.dataTransfer.items) {
      // DataTransferItemList はドロップイベントの同期処理が終わると無効化されるため、
      // await をまたぐ前に各アイテムの取得処理を同期的に開始しておく
      const pending = [];
      for (const item of e.dataTransfer.items) {
        if (item.kind !== "file") continue;
        if (typeof item.getAsFileSystemHandle === "function") {
          pending.push({ handlePromise: item.getAsFileSystemHandle(), fallbackFile: item.getAsFile() });
        } else {
          pending.push({ handlePromise: null, fallbackFile: item.getAsFile() });
        }
      }

      for (const entry of pending) {
        const handle = entry.handlePromise ? await entry.handlePromise : null;
        if (handle && handle.kind === "file") {
          await openFileHandleInNewTab(handle);
        } else if (entry.fallbackFile) {
          await openRawFileInNewTab(entry.fallbackFile);
        }
      }
    }
  });
}

// ===================== ツール(文字変換・行操作) =====================
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

// ===================== 現在日時の挿入 =====================
function insertTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  editor.setRangeText(stamp, start, end, "end");
  editor.dispatchEvent(new Event("input"));
  editor.focus();
  setStatus("現在日時を挿入しました");
}

// ===================== 行へ移動 =====================
function setGotoPanel(show) {
  gotoPanel.hidden = !show;
  if (show) {
    gotoInput.value = "";
    gotoInput.focus();
  }
}

function moveCursorToLine(n) {
  const lines = editor.value.split("\n");
  const targetLine = Math.min(Math.max(1, n), lines.length);
  let index = 0;
  for (let i = 0; i < targetLine - 1; i++) {
    index += lines[i].length + 1;
  }
  editor.focus();
  editor.setSelectionRange(index, index + (lines[targetLine - 1]?.length || 0));
  scrollSelectionIntoView();
  updateCursorPos();
  return targetLine;
}

function goToLine() {
  const n = parseInt(gotoInput.value, 10);
  if (!n || n < 1) return;
  const targetLine = moveCursorToLine(n);
  setGotoPanel(false);
  setStatus(`${targetLine} 行目へ移動しました`);
}

function jumpToLine(n, msg) {
  if (!n || n < 1) return;
  const targetLine = moveCursorToLine(n);
  setStatus(msg || `${targetLine} 行目へ移動しました`);
}

// ===================== 簡易矩形編集(列指定 挿入/削除) =====================
function openColumnPanel() {
  const lines = editor.value.split("\n");
  const startPos = editor.selectionStart;
  const endPos = editor.selectionEnd;
  const startLine = editor.value.slice(0, startPos).split("\n").length;
  const endLine = editor.value.slice(0, endPos).split("\n").length;

  colStartLine.value = startLine;
  colEndLine.value = endLine;
  colIndex.value = 1;
  colInsertText.value = "";
  colDeleteCount.value = 0;
  colStartLine.max = lines.length;
  colEndLine.max = lines.length;

  columnPanel.hidden = false;
  colInsertText.focus();
}

function applyColumnEdit() {
  const lines = editor.value.split("\n");
  const s = Math.max(1, parseInt(colStartLine.value, 10) || 1);
  const e = Math.min(lines.length, parseInt(colEndLine.value, 10) || 1);
  const col = Math.max(1, parseInt(colIndex.value, 10) || 1);
  const insertText = colInsertText.value;
  const delCount = Math.max(0, parseInt(colDeleteCount.value, 10) || 0);

  if (s > e) {
    setStatus("開始行が終了行より後になっています", true);
    return;
  }

  for (let i = s - 1; i <= e - 1; i++) {
    const line = lines[i] ?? "";
    const idx = Math.min(col - 1, line.length);
    const before = line.slice(0, idx);
    const afterDeleted = line.slice(idx + delCount);
    lines[i] = before + insertText + afterDeleted;
  }

  editor.value = lines.join("\n");
  editor.dispatchEvent(new Event("input"));
  columnPanel.hidden = true;
  setStatus(`${s}〜${e}行目の${col}列目を編集しました`);
}

// ===================== 文字コード(エンコーディング) =====================
function decodeBuffer(buffer) {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer), encoding: "UTF-8" };
  } catch {
    try {
      return { text: new TextDecoder("shift_jis").decode(buffer), encoding: "Shift_JIS" };
    } catch {
      return { text: new TextDecoder("utf-8").decode(buffer), encoding: "UTF-8" };
    }
  }
}

function updateEncodingLabel() {
  const tab = getActiveTab();
  encodingLabel.textContent = tab ? tab.encoding : "UTF-8";
}

async function reDecodeCurrentTab(encoding) {
  const tab = getActiveTab();
  if (!tab || !tab.fileHandle) {
    setStatus("保存済みファイルのみ再読み込みできます", true);
    return;
  }
  try {
    const file = await tab.fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    const text =
      encoding === "Shift_JIS"
        ? new TextDecoder("shift_jis").decode(buffer)
        : new TextDecoder("utf-8").decode(buffer);

    tab.content = text;
    tab.originalContent = text;
    tab.encoding = encoding;
    tab.isDirty = false;

    if (tab.id === activeTabId) {
      editor.value = text;
      updateGutter();
      updateCounters();
      updateMdPreview();
    }
    updateEncodingLabel();
    renderTabs();
    setStatus(`${encoding} として読み込み直しました`);
    scheduleSaveSession();
  } catch (err) {
    console.error(err);
    setStatus("読み込み直しに失敗しました", true);
  }
}

// ===================== 権限確認 =====================
async function verifyPermission(handle, mode = "readwrite") {
  try {
    const opts = { mode };
    if ((await handle.queryPermission(opts)) === "granted") return true;
    if ((await handle.requestPermission(opts)) === "granted") return true;
    return false;
  } catch {
    return false;
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
          description: "サポートしているファイル",
          accept: {
            "text/plain": [".txt", ".md", ".log", ".csv", ".json"],
            "text/html": [".html", ".htm"],
            "text/javascript": [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"],
            "text/css": [".css"],
            "application/xml": [".xml", ".svg"],
            "application/x-sh": [".sh", ".bash", ".zsh"],
            "text/x-python": [".py", ".pyw"],
            "application/x-yaml": [".yml", ".yaml"]
          },
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
    const granted = await verifyPermission(handle, "read");
    if (!granted) {
      setStatus(`「${handle.name}」の読み取り許可が得られませんでした`, true);
      return;
    }
    const file = await handle.getFile();
    const buffer = await file.arrayBuffer();
    const { text, encoding } = decodeBuffer(buffer);

    // 未編集の空タブがあればそれを上書き利用する
    const activeTab = getActiveTab();
    const activeIsBlank = activeTab && !activeTab.fileHandle && !activeTab.isDirty && activeTab.content === "";
    const unusedBlankTab = tabs.find((t) => !t.fileHandle && !t.isDirty && t.content === "");

    let tab;
    if (activeIsBlank) {
      tab = activeTab;
    } else if (unusedBlankTab) {
      tab = unusedBlankTab;
    } else {
      tab = makeTab({ name: file.name });
      tabs.push(tab);
    }

    tab.name = file.name;
    tab.content = text;
    tab.originalContent = text;
    tab.fileHandle = handle;
    tab.isDirty = false;
    tab.encoding = encoding;
    tab.lastKnownModified = file.lastModified;

    switchTab(tab.id);
    setStatus(`「${file.name}」を開きました(${encoding})`);
    await addRecent(file.name, handle);
    renderRecentMenu();
    scheduleSaveSession();
  } catch (err) {
    console.error(err);
    setStatus("ファイルを開けませんでした", true);
  }
}

// 通常のFileオブジェクトから新規タブで開く処理（Drag & Drop用）
async function openRawFileInNewTab(file) {
  try {
    const buffer = await file.arrayBuffer();
    const { text, encoding } = decodeBuffer(buffer);

    // 未編集の空タブがあればそれを上書き利用する(openFileHandleInNewTabと同じロジック)
    const activeTab = getActiveTab();
    const activeIsBlank = activeTab && !activeTab.fileHandle && !activeTab.isDirty && activeTab.content === "";
    const unusedBlankTab = tabs.find((t) => !t.fileHandle && !t.isDirty && t.content === "");

    let tab;
    if (activeIsBlank) {
      tab = activeTab;
    } else if (unusedBlankTab) {
      tab = unusedBlankTab;
    } else {
      tab = makeTab({ name: file.name });
      tabs.push(tab);
    }

    tab.name = file.name;
    tab.content = text;
    tab.originalContent = text;
    tab.fileHandle = null;
    tab.isDirty = false;
    tab.encoding = encoding;

    switchTab(tab.id);
    setStatus(`「${file.name}」を開きました(${encoding})`);
    scheduleSaveSession();
  } catch (err) {
    console.error(err);
    setStatus("ファイルを開けませんでした", true);
  }
}

saveBtn.addEventListener("click", () => saveFile(false));
saveAsBtn.addEventListener("click", () => saveFile(true));

// ===================== ファイル保存 =====================
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
      // 拡張子が含まれていない場合は自動で .txt を付与
      let suggestedName = tab.name || "無題のファイル.txt";
      if (!suggestedName.includes(".")) {
        suggestedName += ".txt";
      }

      const ext = suggestedName.split(".").pop().toLowerCase();
      const mimeTypes = {
        js: { "text/javascript": [".js"] },
        mjs: { "text/javascript": [".mjs"] },
        cjs: { "text/javascript": [".cjs"] },
        jsx: { "text/javascript": [".jsx"] },
        ts: { "application/typescript": [".ts"] },
        tsx: { "application/typescript": [".tsx"] },
        html: { "text/html": [".html", ".htm"] },
        css: { "text/css": [".css"] },
        json: { "application/json": [".json"] },
        txt: { "text/plain": [".txt"] },
        md: { "text/markdown": [".md"] },
        xml: { "application/xml": [".xml"] },
        svg: { "application/xml": [".svg"] },
        sh: { "application/x-sh": [".sh"] },
        bash: { "application/x-sh": [".bash"] },
        zsh: { "application/x-sh": [".zsh"] },
        py: { "text/x-python": [".py"] },
        yml: { "application/x-yaml": [".yml"] },
        yaml: { "application/x-yaml": [".yaml"] }
      };
      const acceptObj = mimeTypes[ext] || { "text/plain": [`.${ext}`] };

      tab.fileHandle = await window.showSaveFilePicker({
        suggestedName: suggestedName,
        types: [{ description: "ファイル", accept: acceptObj }],
      });
    }
    const writable = await tab.fileHandle.createWritable();
    await writable.write(text);
    await writable.close();

    const savedFile = await tab.fileHandle.getFile();
    tab.originalContent = text;
    tab.name = tab.fileHandle.name;
    tab.lastKnownModified = savedFile.lastModified;
    const wasNonUtf8 = tab.encoding !== "UTF-8";
    tab.encoding = "UTF-8";

    setTabDirty(tab, false);
    updateEncodingLabel();
    hideExternalChangeBar();
    setStatus(wasNonUtf8 ? "保存しました(UTF-8に変換されました)" : "保存しました");
    await addRecent(tab.name, tab.fileHandle);
    renderRecentMenu();
    scheduleSaveSession();
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
  a.download = tab.name.includes(".") ? tab.name : `${tab.name}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  tab.originalContent = text;
  setTabDirty(tab, false);
  setStatus("ダウンロードしました(このブラウザは直接保存に非対応です)");
}

// ===================== 外部変更の検知 =====================
async function checkExternalChange(tab) {
  if (!tab || !tab.fileHandle) return;
  try {
    const granted = await verifyPermission(tab.fileHandle, "read");
    if (!granted) return;
    const file = await tab.fileHandle.getFile();
    if (tab.lastKnownModified && file.lastModified !== tab.lastKnownModified) {
      if (tab.isDirty) {
        showExternalChangeBar(tab);
      } else {
        await reloadTabFromDisk(tab, true);
      }
    }
  } catch {
    // 静かに無視
  }
}

async function reloadTabFromDisk(tab, silent) {
  try {
    const file = await tab.fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    const { text, encoding } = decodeBuffer(buffer);
    tab.content = text;
    tab.originalContent = text;
    tab.encoding = encoding;
    tab.lastKnownModified = file.lastModified;
    setTabDirty(tab, false);

    if (tab.id === activeTabId) {
      editor.value = text;
      updateGutter();
      updateCounters();
      updateMdPreview();
      updateEncodingLabel();
    }
    if (!silent) setStatus("最新の内容を読み込みました");
    scheduleSaveSession();
  } catch (err) {
    console.error(err);
  }
}

function showExternalChangeBar(tab) {
  externalChangeMsg.textContent = `「${tab.name}」は他の場所で更新されています。現在の編集内容を残しますか、最新の内容を読み込みますか?`;
  externalChangeBar.hidden = false;
}

function hideExternalChangeBar() {
  externalChangeBar.hidden = true;
}

// ===================== 最近使ったファイル =====================
async function addRecent(name, handle) {
  let list = (await dbGet("recent")) || [];
  list = list.filter((r) => r.name !== name);
  list.unshift({ name, handle, lastOpened: Date.now() });
  list = list.slice(0, 8);
  await dbSet("recent", list);
}

async function renderRecentMenu() {
  const list = (await dbGet("recent")) || [];
  recentList.innerHTML = "";
  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "menu-empty";
    empty.textContent = "まだ履歴がありません";
    recentList.appendChild(empty);
    return;
  }
  for (const item of list) {
    const btn = document.createElement("button");
    btn.className = "menu-item";
    btn.textContent = item.name;
    btn.title = item.name;
    btn.addEventListener("click", async () => {
      recentMenu.hidden = true;
      const granted = await verifyPermission(item.handle);
      if (!granted) {
        setStatus("このファイルへのアクセスが許可されませんでした", true);
        return;
      }
      await openFileHandleInNewTab(item.handle);
    });
    recentList.appendChild(btn);
  }
}

// ===================== 自動保存 & 入力監視 =====================
editor.addEventListener("input", () => {
  const tab = getActiveTab();
  if (!tab) return;
  tab.content = editor.value;
  setTabDirty(tab, tab.content !== tab.originalContent);
  updateGutter();
  updateCounters();
  updateMdPreview();
  scheduleSaveSession();

  if (tab.fileHandle) {
    clearTimeout(saveTimer);
    setStatus("自動保存を待機中…");
    saveTimer = setTimeout(() => saveFile(false), 900);
  }
});

editor.addEventListener("keyup", () => {
  updateCursorPos();
  updateSelectionInfo();
  updateBracketInfo();
});
editor.addEventListener("click", () => {
  updateCursorPos();
  updateSelectionInfo();
  updateBracketInfo();
});
editor.addEventListener("select", updateSelectionInfo);
editor.addEventListener("scroll", () => {
  gutter.scrollTop = editor.scrollTop;
  highlightLayer.scrollTop = editor.scrollTop;
  highlightLayer.scrollLeft = editor.scrollLeft;
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
  const tab = getActiveTab();
  const bookmarks = tab ? tab.bookmarks : null;
  const lines = editor.value.split("\n").length;
  let out = "";
  for (let i = 1; i <= lines; i++) {
    const bookmarked = bookmarks && bookmarks.has(i);
    out += `<span class="gutter-line${bookmarked ? " bookmarked" : ""}">${i}</span>\n`;
  }
  gutter.innerHTML = out;
  updateHighlight();
}

// ===================== シンタックスハイライト =====================
function escapeHtmlForHighlight(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// showInvisibles が有効な時だけ、エスケープ済みテキストに空白等の可視化マーカーを重ねる
// (トークナイザーが生成する <span class="tok-x"> 自体には適用しない)
function escapeAndMark(str) {
  const escaped = escapeHtmlForHighlight(str);
  return showInvisibles ? markInvisibles(escaped) : escaped;
}

const LANG_RULES = {
  javascript: [
    { type: "comment", re: /\/\/[^\n]*|\/\*[\s\S]*?\*\// },
    { type: "string", re: /`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/ },
    { type: "number", re: /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/ },
    {
      type: "keyword",
      re: /\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|default|break|continue|class|extends|new|this|super|import|export|from|as|async|await|try|catch|finally|throw|typeof|instanceof|in|of|null|undefined|true|false|void|yield|static|get|set|delete)\b/,
    },
    { type: "function", re: /\b[A-Za-z_$][\w$]*(?=\s*\()/ },
  ],
  json: [
    { type: "key", re: /"(?:\\.|[^"\\])*"(?=\s*:)/ },
    { type: "string", re: /"(?:\\.|[^"\\])*"/ },
    { type: "number", re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/ },
    { type: "keyword", re: /\b(?:true|false|null)\b/ },
  ],
  css: [
    { type: "comment", re: /\/\*[\s\S]*?\*\// },
    { type: "string", re: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/ },
    { type: "attr", re: /[A-Za-z-]+(?=\s*:)/ },
    { type: "attr", re: /@[A-Za-z-]+/ },
    { type: "number", re: /-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|vmin|vmax|deg|s|ms)?\b/ },
    { type: "tag", re: /[.#][A-Za-z_-][\w-]*/ },
  ],
  markup: [
    { type: "comment", re: /<!--[\s\S]*?-->/ },
    { type: "string", re: /"[^"]*"|'[^']*'/ },
    { type: "tag", re: /<\/?[A-Za-z][\w-]*|\/?>/ },
    { type: "attr", re: /[A-Za-z-]+(?=\s*=)/ },
  ],
  markdown: [
    { type: "comment", re: /`[^`\n]+`/ },
    { type: "heading", re: /^#{1,6}[^\n]*/ },
    { type: "keyword", re: /\*\*[^*\n]+\*\*|__[^_\n]+__/ },
    { type: "string", re: /\*[^*\n]+\*|_[^_\n]+_/ },
    { type: "link", re: /\[[^\]\n]*\]\([^)\n]*\)/ },
    { type: "comment", re: /^>[^\n]*/ },
  ],
  shell: [
    { type: "comment", re: /#[^\n]*/ },
    { type: "string", re: /"(?:\\.|[^"\\])*"|'[^'\n]*'/ },
    { type: "attr", re: /\$\{[^}\n]*\}|\$[A-Za-z_][\w]*|\$[0-9@#?*!$-]/ },
    {
      type: "keyword",
      re: /\b(?:if|then|elif|else|fi|for|while|until|do|done|case|esac|in|function|select|time|return|exit|break|continue|local|export|readonly|declare|eval|exec|source|trap|shift|unset|set|echo|read|printf|test)\b/,
    },
    { type: "number", re: /\b\d+(?:\.\d+)?\b/ },
  ],
  python: [
    { type: "comment", re: /#[^\n]*/ },
    { type: "string", re: /(?:[rRbBfFuU]{1,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/ },
    { type: "number", re: /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/ },
    {
      type: "keyword",
      re: /\b(?:def|class|return|if|elif|else|for|while|break|continue|pass|import|from|as|try|except|finally|raise|with|lambda|yield|global|nonlocal|del|assert|async|await|and|or|not|in|is|None|True|False|self)\b/,
    },
    { type: "function", re: /\b[A-Za-z_][\w]*(?=\s*\()/ },
  ],
  yaml: [
    { type: "comment", re: /#[^\n]*/ },
    { type: "key", re: /^[ \t]*-?[ \t]*[A-Za-z0-9_.-]+(?=\s*:)/m },
    { type: "string", re: /"(?:\\.|[^"\\])*"|'[^'\n]*'/ },
    { type: "keyword", re: /\b(?:true|false|null|yes|no)\b/ },
    { type: "number", re: /-?\b\d+(?:\.\d+)?\b/ },
  ],
};

const EXT_LANG_MAP = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "javascript",
  tsx: "javascript",
  json: "json",
  css: "css",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  md: "markdown",
  markdown: "markdown",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ksh: "shell",
  py: "python",
  pyw: "python",
  yml: "yaml",
  yaml: "yaml",
};

const TOKENIZER_CACHE = {};

function getTokenizer(lang) {
  const rules = LANG_RULES[lang];
  if (!rules) return null;
  if (TOKENIZER_CACHE[lang]) return TOKENIZER_CACHE[lang];

  const combined = new RegExp(rules.map((r) => `(${r.re.source})`).join("|"), "gm");

  const tokenize = (text) => {
    let html = "";
    let lastIndex = 0;
    let m;
    combined.lastIndex = 0;
    while ((m = combined.exec(text))) {
      if (m.index > lastIndex) {
        html += escapeAndMark(text.slice(lastIndex, m.index));
      }
      let type = "plain";
      for (let i = 0; i < rules.length; i++) {
        if (m[i + 1] !== undefined) {
          type = rules[i].type;
          break;
        }
      }
      html += `<span class="tok-${type}">${escapeAndMark(m[0])}</span>`;
      lastIndex = m.index + m[0].length;
      if (m[0].length === 0) combined.lastIndex += 1;
    }
    if (lastIndex < text.length) {
      html += escapeAndMark(text.slice(lastIndex));
    }
    return html;
  };

  TOKENIZER_CACHE[lang] = tokenize;
  return tokenize;
}

function detectLanguage(filename) {
  if (!filename) return null;
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_LANG_MAP[ext] || null;
}

// ===================== 空白・タブ・改行の可視化 =====================
const WS_MARKERS = {
  " ": '<span class="ws-space">·</span>',
  "\t": '<span class="ws-tab">\t</span>',
  "　": '<span class="ws-zenkaku">　</span>',
  "\n": '<span class="ws-eol">↵</span>\n',
};

function markInvisibles(html) {
  return html.replace(/[ \t　\n]/g, (ch) => WS_MARKERS[ch]);
}

function updateHighlight() {
  const tab = getActiveTab();
  const lang = detectLanguage(tab ? tab.name : "");
  const tokenize = lang ? getTokenizer(lang) : null;
  const text = editor.value;
  const html = tokenize ? tokenize(text) : escapeAndMark(text);
  highlightCode.innerHTML = html + "\n";
  highlightLayer.scrollTop = editor.scrollTop;
  highlightLayer.scrollLeft = editor.scrollLeft;
}

// ===================== アウトライン(見出し・関数一覧) =====================
function getOutlineItems(lang, text) {
  const items = [];
  const lines = text.split("\n");

  if (lang === "markdown") {
    lines.forEach((line, i) => {
      const m = line.match(/^(#{1,6})\s+(.+)$/);
      if (m) items.push({ line: i + 1, level: m[1].length, label: m[2].trim() });
    });
  } else if (lang === "javascript") {
    lines.forEach((line, i) => {
      let m = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/);
      if (m) {
        items.push({ line: i + 1, level: 1, label: `function ${m[1]}()` });
        return;
      }
      m = line.match(/^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/);
      if (m) {
        items.push({ line: i + 1, level: 1, label: `class ${m[1]}` });
        return;
      }
      m = line.match(/^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
      if (m) items.push({ line: i + 1, level: 2, label: `${m[1]} =>` });
    });
  } else if (lang === "python") {
    lines.forEach((line, i) => {
      let m = line.match(/^(\s*)def\s+([A-Za-z_]\w*)/);
      if (m) {
        items.push({ line: i + 1, level: m[1].length > 0 ? 2 : 1, label: `def ${m[2]}()` });
        return;
      }
      m = line.match(/^(\s*)class\s+([A-Za-z_]\w*)/);
      if (m) items.push({ line: i + 1, level: 1, label: `class ${m[2]}` });
    });
  } else if (lang === "shell") {
    lines.forEach((line, i) => {
      const m = line.match(/^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?\s*$/);
      if (m) items.push({ line: i + 1, level: 1, label: `${m[1]}()` });
    });
  }

  return items;
}

function renderOutlineMenu() {
  const tab = getActiveTab();
  const lang = detectLanguage(tab ? tab.name : "");
  const items = lang ? getOutlineItems(lang, editor.value) : [];

  if (items.length === 0) {
    outlineList.innerHTML = `<div class="menu-empty">${
      lang ? "アウトライン項目が見つかりません" : "この形式はアウトラインに対応していません"
    }</div>`;
    return;
  }

  outlineList.innerHTML = items
    .map(
      (item) =>
        `<button type="button" class="menu-item" data-line="${item.line}" style="padding-left:${
          10 + (item.level - 1) * 14
        }px" title="${escapeHtmlForHighlight(item.label)}">${item.line}: ${escapeHtmlForHighlight(item.label)}</button>`
    )
    .join("");
}

// ===================== ブックマーク =====================
function currentLineNumber() {
  const pos = editor.selectionStart;
  return editor.value.slice(0, pos).split("\n").length;
}

function toggleBookmark() {
  const tab = getActiveTab();
  if (!tab) return;
  const line = currentLineNumber();
  if (tab.bookmarks.has(line)) {
    tab.bookmarks.delete(line);
    setStatus(`${line} 行目のブックマークを解除しました`);
  } else {
    tab.bookmarks.add(line);
    setStatus(`${line} 行目にブックマークを設定しました`);
  }
  updateGutter();
  scheduleSaveSession();
}

function jumpToNextBookmark(reverse) {
  const tab = getActiveTab();
  if (!tab || tab.bookmarks.size === 0) {
    setStatus("ブックマークがありません", true);
    return;
  }
  const sorted = [...tab.bookmarks].sort((a, b) => a - b);
  const current = currentLineNumber();
  let target;
  if (reverse) {
    target = [...sorted].reverse().find((l) => l < current);
    if (target === undefined) target = sorted[sorted.length - 1];
  } else {
    target = sorted.find((l) => l > current);
    if (target === undefined) target = sorted[0];
  }
  jumpToLine(target, `ブックマーク: ${target} 行目`);
}

function renderBookmarksMenu() {
  const tab = getActiveTab();
  const sorted = tab ? [...tab.bookmarks].sort((a, b) => a - b) : [];

  if (sorted.length === 0) {
    bookmarksList.innerHTML = '<div class="menu-empty">ブックマークがありません(Ctrl+F2で現在行に設定)</div>';
    return;
  }

  const lines = editor.value.split("\n");
  bookmarksList.innerHTML = sorted
    .map((line) => {
      const preview = (lines[line - 1] || "").trim().slice(0, 40);
      return `<button type="button" class="menu-item" data-line="${line}" title="${escapeHtmlForHighlight(
        preview
      )}">${line}: ${escapeHtmlForHighlight(preview)}</button>`;
    })
    .join("");
}

// ===================== カウンター類 =====================
function updateCounters() {
  const text = editor.value;
  charCountEl.textContent = text.length.toLocaleString();
  const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
  wordCountEl.textContent = words.toLocaleString();
  lineTotalEl.textContent = text.split("\n").length.toLocaleString();
  updateCursorPos();
  updateSelectionInfo();
  updateBracketInfo();
}

function updateCursorPos() {
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, pos);
  const line = before.split("\n").length;
  const col = pos - before.lastIndexOf("\n");
  lineColEl.textContent = `${line}:${col}`;
}

function updateSelectionInfo() {
  const s = editor.selectionStart;
  const e = editor.selectionEnd;
  if (s === e) {
    selectionBox.hidden = true;
    return;
  }
  const selected = editor.value.slice(s, e);
  const lineCount = selected.split("\n").length;
  selectionInfo.textContent = `${selected.length}文字 / ${lineCount}行`;
  selectionBox.hidden = false;
}

// ===================== 対応する括弧の表示 =====================
const OPEN_BRACKETS = { "(": ")", "[": "]", "{": "}" };
const CLOSE_BRACKETS = { ")": "(", "]": "[", "}": "{" };

function updateBracketInfo() {
  const pos = editor.selectionStart;
  const text = editor.value;
  const charAfter = text[pos];
  const charBefore = text[pos - 1];

  let matchIndex = -1;

  if (charAfter && OPEN_BRACKETS[charAfter]) {
    matchIndex = findMatchingBracket(text, pos, charAfter, OPEN_BRACKETS[charAfter], 1);
  } else if (charBefore && CLOSE_BRACKETS[charBefore]) {
    matchIndex = findMatchingBracket(text, pos - 1, charBefore, CLOSE_BRACKETS[charBefore], -1);
  }

  if (matchIndex === -1) {
    bracketBox.hidden = true;
    return;
  }

  const before = text.slice(0, matchIndex);
  const line = before.split("\n").length;
  const col = matchIndex - before.lastIndexOf("\n");
  bracketInfo.textContent = `${line}:${col}`;
  bracketBox.hidden = false;
}

function findMatchingBracket(text, startIndex, openChar, closeChar, dir) {
  let depth = 0;
  let i = startIndex;
  while (i >= 0 && i < text.length) {
    if (text[i] === openChar) depth += 1;
    else if (text[i] === closeChar) depth -= 1;
    if (depth === 0 && i !== startIndex) return i;
    i += dir;
  }
  return -1;
}

// ===================== 自動インデント・括弧/クォートの自動補完 =====================
const QUOTE_CHARS = ['"', "'", "`"];

function insertTextAtCursor(text) {
  editor.focus();
  if (document.execCommand("insertText", false, text)) return;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  editor.setRangeText(text, start, end, "end");
  editor.dispatchEvent(new Event("input"));
}

function deleteSelectionRange(start, end) {
  editor.setSelectionRange(start, end);
  if (document.execCommand("delete")) return;
  editor.setRangeText("", start, end, "start");
  editor.dispatchEvent(new Event("input"));
}

function handleEnterAutoIndent(e) {
  const value = editor.value;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const currentIndent = (value.slice(lineStart, start).match(/^[ \t]*/) || [""])[0];
  const indentUnit = currentIndent.includes("\t") ? "\t" : "  ";

  const charBefore = value[start - 1];
  const charAfter = value[end];
  const opensBlock = !!(charBefore && OPEN_BRACKETS[charBefore]);
  const closesMatchingBlock = !!(opensBlock && CLOSE_BRACKETS[charAfter] === charBefore);

  e.preventDefault();

  if (opensBlock && closesMatchingBlock) {
    const innerIndent = currentIndent + indentUnit;
    insertTextAtCursor(`\n${innerIndent}\n${currentIndent}`);
    const caretPos = start + 1 + innerIndent.length;
    editor.setSelectionRange(caretPos, caretPos);
  } else if (opensBlock) {
    insertTextAtCursor(`\n${currentIndent}${indentUnit}`);
  } else {
    insertTextAtCursor(`\n${currentIndent}`);
  }
}

function handleOpenBracketKey(e) {
  const closeChar = OPEN_BRACKETS[e.key];
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  e.preventDefault();
  if (start !== end) {
    const selected = editor.value.slice(start, end);
    insertTextAtCursor(e.key + selected + closeChar);
    editor.setSelectionRange(start + 1, start + 1 + selected.length);
  } else {
    insertTextAtCursor(e.key + closeChar);
    editor.setSelectionRange(start + 1, start + 1);
  }
}

function handleCloseBracketKey(e) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  if (start !== end || editor.value[start] !== e.key) return;
  e.preventDefault();
  editor.setSelectionRange(start + 1, start + 1);
}

function handleQuoteKey(e) {
  const quote = e.key;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;

  if (start === end && editor.value[start] === quote) {
    e.preventDefault();
    editor.setSelectionRange(start + 1, start + 1);
    return;
  }

  if (start !== end) {
    const selected = editor.value.slice(start, end);
    e.preventDefault();
    insertTextAtCursor(quote + selected + quote);
    editor.setSelectionRange(start + 1, start + 1 + selected.length);
    return;
  }

  if (/\w/.test(editor.value[start - 1] || "") || /\w/.test(editor.value[start] || "")) return;

  e.preventDefault();
  insertTextAtCursor(quote + quote);
  editor.setSelectionRange(start + 1, start + 1);
}

function isMarkupTab() {
  const tab = getActiveTab();
  return detectLanguage(tab ? tab.name : "") === "markup";
}

function handleAngleOpenKey(e) {
  if (!isMarkupTab()) return;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  e.preventDefault();
  if (start !== end) {
    const selected = editor.value.slice(start, end);
    insertTextAtCursor("<" + selected + ">");
    editor.setSelectionRange(start + 1, start + 1 + selected.length);
  } else {
    insertTextAtCursor("<>");
    editor.setSelectionRange(start + 1, start + 1);
  }
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function getAutoCloseTagName(text, gtIndex) {
  const ltIndex = text.lastIndexOf("<", gtIndex - 1);
  if (ltIndex === -1) return null;
  const tagContent = text.slice(ltIndex + 1, gtIndex);
  if (!tagContent || /^[/!?]/.test(tagContent) || /\/\s*$/.test(tagContent)) return null;
  const m = tagContent.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
  if (!m) return null;
  return VOID_ELEMENTS.has(m[1].toLowerCase()) ? null : m[1];
}

function maybeAutoCloseTag(gtIndex) {
  const tagName = getAutoCloseTagName(editor.value, gtIndex);
  if (!tagName) return;
  const pos = gtIndex + 1;
  insertTextAtCursor(`</${tagName}>`);
  editor.setSelectionRange(pos, pos);
}

function handleAngleCloseKey(e) {
  if (!isMarkupTab()) return;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  if (start !== end) return;
  e.preventDefault();
  if (editor.value[start] === ">") {
    editor.setSelectionRange(start + 1, start + 1);
  } else {
    insertTextAtCursor(">");
  }
  maybeAutoCloseTag(start);
}

function handleBackspacePairDelete(e) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  if (start !== end || start === 0) return;

  const before = editor.value[start - 1];
  const after = editor.value[start];
  const isBracketPair = OPEN_BRACKETS[before] === after;
  const isQuotePair = QUOTE_CHARS.includes(before) && after === before;
  const isAnglePair = before === "<" && after === ">" && isMarkupTab();
  if (!isBracketPair && !isQuotePair && !isAnglePair) return;

  e.preventDefault();
  deleteSelectionRange(start - 1, start + 1);
}

editor.addEventListener("keydown", (e) => {
  // IME変換中のキー操作(変換確定のEnterなど)は横取りしない
  if (e.isComposing || e.keyCode === 229) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === "Enter") {
    handleEnterAutoIndent(e);
  } else if (OPEN_BRACKETS[e.key]) {
    handleOpenBracketKey(e);
  } else if (CLOSE_BRACKETS[e.key]) {
    handleCloseBracketKey(e);
  } else if (QUOTE_CHARS.includes(e.key)) {
    handleQuoteKey(e);
  } else if (e.key === "<") {
    handleAngleOpenKey(e);
  } else if (e.key === ">") {
    handleAngleCloseKey(e);
  } else if (e.key === "Backspace") {
    handleBackspacePairDelete(e);
  }
});

// ===================== Tab整形・行操作・コメント切替 =====================
function getLineRangeForSelection() {
  const value = editor.value;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end > start ? end - 1 : end);
  if (lineEnd === -1) lineEnd = value.length;
  return { lineStart, lineEnd };
}

function indentSelection(outdent) {
  const value = editor.value;
  const { lineStart, lineEnd } = getLineRangeForSelection();
  const lines = value.slice(lineStart, lineEnd).split("\n");

  const newLines = lines.map((line) => {
    if (outdent) {
      const m = line.match(/^(\t| {1,2})/);
      return m ? line.slice(m[0].length) : line;
    }
    return "  " + line;
  });

  const newBlock = newLines.join("\n");
  editor.setSelectionRange(lineStart, lineEnd);
  insertTextAtCursor(newBlock);
  editor.setSelectionRange(lineStart, lineStart + newBlock.length);
}

function handleTabKey(e) {
  if (e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  if (!e.shiftKey && editor.selectionStart === editor.selectionEnd) {
    insertTextAtCursor("  ");
    return;
  }
  indentSelection(e.shiftKey);
}

function duplicateLine() {
  const value = editor.value;
  const { lineStart, lineEnd } = getLineRangeForSelection();
  const block = value.slice(lineStart, lineEnd);
  editor.setSelectionRange(lineEnd, lineEnd);
  insertTextAtCursor("\n" + block);
  editor.setSelectionRange(lineEnd + 1, lineEnd + 1 + block.length);
}

function moveLines(dir) {
  const value = editor.value;
  const { lineStart, lineEnd } = getLineRangeForSelection();
  const block = value.slice(lineStart, lineEnd);

  if (dir < 0) {
    if (lineStart === 0) return;
    const prevLineStart = value.lastIndexOf("\n", lineStart - 2) + 1;
    const prevLine = value.slice(prevLineStart, lineStart - 1);
    editor.setSelectionRange(prevLineStart, lineEnd);
    insertTextAtCursor(`${block}\n${prevLine}`);
    editor.setSelectionRange(prevLineStart, prevLineStart + block.length);
  } else {
    if (lineEnd === value.length) return;
    let nextLineEnd = value.indexOf("\n", lineEnd + 1);
    if (nextLineEnd === -1) nextLineEnd = value.length;
    const nextLine = value.slice(lineEnd + 1, nextLineEnd);
    editor.setSelectionRange(lineStart, nextLineEnd);
    insertTextAtCursor(`${nextLine}\n${block}`);
    const newBlockStart = lineStart + nextLine.length + 1;
    editor.setSelectionRange(newBlockStart, newBlockStart + block.length);
  }
}

const LINE_COMMENT_TOKENS = { javascript: "//", shell: "#", python: "#", yaml: "#" };
const BLOCK_COMMENT_TOKENS = {
  css: ["/*", "*/"],
  markup: ["<!--", "-->"],
  markdown: ["<!--", "-->"],
};

function toggleLineComment(token) {
  const value = editor.value;
  const { lineStart, lineEnd } = getLineRangeForSelection();
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const commentable = lines.filter((l) => l.trim() !== "");
  const allCommented = commentable.length > 0 && commentable.every((l) => l.trim().startsWith(token));

  const newLines = lines.map((line) => {
    if (line.trim() === "") return line;
    const indent = line.match(/^\s*/)[0];
    if (allCommented) {
      const rest = line.slice(indent.length);
      const stripped = rest.startsWith(token + " ") ? rest.slice(token.length + 1) : rest.slice(token.length);
      return indent + stripped;
    }
    return indent + token + " " + line.slice(indent.length);
  });

  const newBlock = newLines.join("\n");
  editor.setSelectionRange(lineStart, lineEnd);
  insertTextAtCursor(newBlock);
  editor.setSelectionRange(lineStart, lineStart + newBlock.length);
}

function toggleBlockComment(openTok, closeTok) {
  const value = editor.value;
  let start = editor.selectionStart;
  let end = editor.selectionEnd;
  if (start === end) {
    start = value.lastIndexOf("\n", start - 1) + 1;
    end = value.indexOf("\n", end);
    if (end === -1) end = value.length;
  }
  const selected = value.slice(start, end);
  const trimmed = selected.trim();
  editor.setSelectionRange(start, end);

  if (trimmed.startsWith(openTok) && trimmed.endsWith(closeTok)) {
    const inner = trimmed.slice(openTok.length, trimmed.length - closeTok.length).trim();
    insertTextAtCursor(inner);
    editor.setSelectionRange(start, start + inner.length);
  } else {
    const wrapped = `${openTok} ${selected} ${closeTok}`;
    insertTextAtCursor(wrapped);
    editor.setSelectionRange(start, start + wrapped.length);
  }
}

function handleCommentToggle(e) {
  const tab = getActiveTab();
  const lang = detectLanguage(tab ? tab.name : "");
  if (LINE_COMMENT_TOKENS[lang]) {
    e.preventDefault();
    toggleLineComment(LINE_COMMENT_TOKENS[lang]);
  } else if (BLOCK_COMMENT_TOKENS[lang]) {
    e.preventDefault();
    toggleBlockComment(BLOCK_COMMENT_TOKENS[lang][0], BLOCK_COMMENT_TOKENS[lang][1]);
  }
}

editor.addEventListener("keydown", (e) => {
  if (e.isComposing || e.keyCode === 229) return;

  if (e.key === "Tab") {
    handleTabKey(e);
  } else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "/") {
    handleCommentToggle(e);
  } else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "d") {
    e.preventDefault();
    duplicateLine();
  } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowUp") {
    e.preventDefault();
    moveLines(-1);
  } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowDown") {
    e.preventDefault();
    moveLines(1);
  }
});

// ===================== Markdownプレビュー =====================
let mdPreviewOn = false;

function toggleMdPreview() {
  mdPreviewOn = !mdPreviewOn;
  mdPreview.hidden = !mdPreviewOn;
  mdPreviewBtn.style.color = mdPreviewOn ? "var(--accent)" : "";
  if (mdPreviewOn) updateMdPreview();
}

function updateMdPreview() {
  if (!mdPreviewOn) return;
  if (typeof marked === "undefined") {
    mdPreview.textContent = "プレビューライブラリの読み込みに失敗しました(オフラインの可能性があります)";
    return;
  }
  try {
    mdPreview.innerHTML = marked.parse(editor.value || "");
  } catch (err) {
    mdPreview.textContent = "プレビューの表示に失敗しました";
  }
}

// ===================== 音声入力 =====================
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let voiceRecording = false;
let voiceStopRequested = false;
let voiceStoppedByUser = false;

function toggleVoiceInput() {
  if (voiceRecording) {
    stopVoiceInput();
  } else {
    startVoiceInput();
  }
}

function startVoiceInput() {
  if (!SpeechRecognitionCtor) {
    setStatus("このブラウザは音声入力に対応していません", true);
    return;
  }
  if (voiceRecording) return;

  if (!recognition) {
    recognition = new SpeechRecognitionCtor();
    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.addEventListener("result", handleVoiceResult);
    recognition.addEventListener("error", handleVoiceError);
    recognition.addEventListener("end", handleVoiceEnd);
  }

  voiceStopRequested = false;
  try {
    recognition.start();
  } catch (err) {
    console.error(err);
    return;
  }
  voiceRecording = true;
  voiceBtn.classList.add("recording");
  setStatus("音声入力を開始しました…");
}

function stopVoiceInput() {
  if (!recognition || !voiceRecording) return;
  voiceStopRequested = true;
  voiceStoppedByUser = true;
  recognition.stop();
}

function handleVoiceResult(event) {
  let finalText = "";
  let interimText = "";
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i];
    if (result.isFinal) {
      finalText += result[0].transcript;
    } else {
      interimText += result[0].transcript;
    }
  }
  if (finalText) {
    insertTextAtCursor(finalText);
  }
  if (interimText) {
    setStatus(`(音声認識中) ${interimText}`);
  }
}

const VOICE_TRANSIENT_ERRORS = new Set(["no-speech", "aborted"]);

function handleVoiceError(event) {
  console.error("SpeechRecognition error:", event.error);
  // 無音タイムアウトや手動停止に伴うabortedは継続入力の一部として無視し、再開に任せる。
  // それ以外(ネットワーク不通・権限なしなど)は再試行がエラーを繰り返すだけなので停止する。
  if (VOICE_TRANSIENT_ERRORS.has(event.error)) return;

  voiceStopRequested = true;
  if (event.error === "not-allowed" || event.error === "service-not-allowed") {
    setStatus("マイクの使用が許可されていません", true);
  } else if (event.error === "audio-capture") {
    setStatus("マイクが見つかりません", true);
  } else {
    setStatus(`音声入力エラー: ${event.error}`, true);
  }
}

function handleVoiceEnd() {
  voiceRecording = false;
  voiceBtn.classList.remove("recording");

  if (!voiceStopRequested) {
    // 無音などで自動停止した場合は継続入力のため再開する
    try {
      recognition.start();
      voiceRecording = true;
      voiceBtn.classList.add("recording");
      return;
    } catch (err) {
      // 再開に失敗した場合は諦めて停止状態にする
    }
  }
  // ユーザーが停止した場合のみ上書きする(エラーによる停止時は個別のエラーメッセージを残す)
  if (voiceStoppedByUser) {
    setStatus("音声入力を終了しました");
  }
  voiceStoppedByUser = false;
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
  updateSelectionInfo();
}

function scrollSelectionIntoView() {
  const lineHeight = currentFontSize() * 1.7;
  const before = editor.value.slice(0, editor.selectionStart);
  const line = before.split("\n").length;
  editor.scrollTop = Math.max(0, (line - 4) * lineHeight);
  gutter.scrollTop = editor.scrollTop;
  highlightLayer.scrollTop = editor.scrollTop;
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
  } else if (mod && e.key.toLowerCase() === "g") {
    e.preventDefault();
    setGotoPanel(true);
  } else if (mod && (e.key === "+" || e.key === "=")) {
    e.preventDefault();
    setFontSize(currentFontSize() + 1);
  } else if (mod && e.key === "-") {
    e.preventDefault();
    setFontSize(currentFontSize() - 1);
  } else if (mod && !e.shiftKey && e.key === "F2") {
    e.preventDefault();
    toggleBookmark();
  } else if (!mod && !e.shiftKey && e.key === "F2") {
    e.preventDefault();
    jumpToNextBookmark(false);
  } else if (!mod && e.shiftKey && e.key === "F2") {
    e.preventDefault();
    jumpToNextBookmark(true);
  } else if (e.key === "Escape") {
    if (!findPanel.hidden) setFindPanel(false);
    if (!gotoPanel.hidden) setGotoPanel(false);
    if (!columnPanel.hidden) columnPanel.hidden = true;
    if (!toolsMenu.hidden) toolsMenu.hidden = true;
    if (!outlineMenu.hidden) outlineMenu.hidden = true;
    if (!bookmarksMenu.hidden) bookmarksMenu.hidden = true;
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
  saveSessionNow();
  if (tabs.some((t) => t.isDirty)) {
    e.preventDefault();
    e.returnValue = "";
  }
});
