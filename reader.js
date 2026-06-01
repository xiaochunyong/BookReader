/* === IndexedDB === */
const DB_NAME = "HtmlReaderDB";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("books")) {
        db.createObjectStore("books", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("content")) {
        db.createObjectStore("content", { keyPath: "bookId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbStore(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function idbPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* === 数据管理 === */
const SETTINGS_KEY = "htmlreader_settings";

let books = [];
let currentBook = null;
let currentChapterIdx = 0;
let currentPage = 0;

let settings = {
  theme: "day",
  fontSize: 20,
  lineHeight: 1.8,
  scrollSpeed: 600,
  sidebarWidth: 240,
  readMode: "chapter",
};

async function loadBooks() {
  try {
    const db = await openDB();
    const list = await idbPromise(idbStore(db, "books", "readonly").getAll());
    books = list || [];
  } catch (e) {
    books = [];
  }
}

async function saveBookMeta(book) {
  const db = await openDB();
  const meta = {
    id: book.id,
    name: book.name,
    toc: book.toc,
    currentChapter: book.currentChapter,
    currentPage: book.currentPage,
    bookmarks: book.bookmarks,
  };
  await idbPromise(idbStore(db, "books", "readwrite").put(meta));
}

async function saveBookContent(book) {
  const db = await openDB();
  await idbPromise(
    idbStore(db, "content", "readwrite").put({
      bookId: book.id,
      text: book.content,
    }),
  );
}

async function deleteBookFromDB(id) {
  const db = await openDB();
  await idbPromise(idbStore(db, "books", "readwrite").delete(id));
  await idbPromise(idbStore(db, "content", "readwrite").delete(id));
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (saved) Object.assign(settings, saved);
  } catch (e) {}
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/* === 书架 === */
function renderBookshelf() {
  const grid = document.getElementById("bookGrid");
  const hint = document.getElementById("emptyHint");

  if (books.length === 0) {
    grid.innerHTML = "";
    hint.style.display = "block";
    return;
  }

  hint.style.display = "none";
  grid.innerHTML = books
    .map(
      (book, i) => {
        const chapterCount = book.toc ? book.toc.filter((t) => t.type === "chapter").length : 0;
        const progress = book.currentChapter !== undefined && chapterCount > 0
          ? Math.round((book.currentChapter / chapterCount) * 100)
          : 0;
        return (
          '<div class="book-card" data-index="' + i + '">' +
          '<button class="delete-btn" data-index="' + i + '">&times;</button>' +
          '<div class="book-title">' + escapeHtml(book.name) + "</div>" +
          '<div class="book-progress">' +
          '<span class="book-chapter-count">共 ' + chapterCount + " 章</span>" +
          (book.currentChapter !== undefined
            ? '<span class="book-read-progress">已读 ' + progress + "%</span>"
            : '<span class="book-read-progress" style="opacity:0.5">未读</span>') +
          "</div>" +
          "</div>"
        );
      },
    )
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* === 编码检测与解码 === */
async function decodeText(file) {
  const buf = await file.arrayBuffer();

  // 尝试 UTF-8
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  try {
    return utf8.decode(buf);
  } catch (e) {
    // UTF-8 失败，尝试 GBK
  }

  try {
    const gbk = new TextDecoder("gbk", { fatal: false });
    return gbk.decode(buf);
  } catch (e) {
    // GBK 不可用，回退
    const fallback = new TextDecoder("utf-8", { fatal: false });
    return fallback.decode(buf);
  }
}

/* === 导入 === */
async function handleFileImport(e) {
  const files = e.target.files;
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".txt")) {
      alert(file.name + " 不是txt文件，已跳过");
      continue;
    }
    const text = await decodeText(file);
    const toc = parseTOC(text);
    const book = {
      id: Date.now() + Math.random(),
      name: file.name.replace(/\.txt$/i, ""),
      content: text,
      currentChapter: 0,
      currentPage: 0,
      toc: toc,
    };
    await saveBookContent(book);
    await saveBookMeta(book);
    const { content: _, ...meta } = book;
    books.push(meta);
  }
  renderBookshelf();
  e.target.value = "";
}

/* === 删除 === */
async function deleteBook(index) {
  if (confirm("确定要删除《" + books[index].name + "》吗？")) {
    const id = books[index].id;
    await deleteBookFromDB(id);
    books.splice(index, 1);
    renderBookshelf();
  }
}

/* === 辅助 === */
function ensureChapterIdx(idx) {
  const entry = currentBook.toc[idx];
  if (!entry || entry.type === "chapter") return idx;
  for (let i = idx + 1; i < currentBook.toc.length; i++) {
    if (currentBook.toc[i].type === "chapter") return i;
  }
  return idx;
}

/* === 打开书籍 === */
async function openBook(index) {
  const meta = books[index];
  // 从 IndexedDB 加载正文
  const db = await openDB();
  const record = await idbPromise(
    idbStore(db, "content", "readonly").get(meta.id),
  );
  currentBook = {
    ...meta,
    content: record ? record.text : "",
  };

  // 从存储的章节位置恢复 TOC 索引
  const chapterIndices = currentBook.toc
    .map((t, i) => (t.type === "chapter" ? i : -1))
    .filter((i) => i !== -1);
  currentChapterIdx = ensureChapterIdx(
    chapterIndices[currentBook.currentChapter || 0] || 0,
  );
  currentPage = currentBook.currentPage || 0;

  document.getElementById("bookshelf").style.display = "none";
  document.getElementById("reader").style.display = "flex";
  document.getElementById("bookName").textContent = currentBook.name;

  renderTOC();
  goToChapter(currentChapterIdx);
}

/* === 返回书架 === */
async function backToShelf() {
  if (currentBook) {
    // 存储章节在全部章节中的位置（而非 TOC 索引）
    const chapterIndices = currentBook.toc
      .map((t, i) => (t.type === "chapter" ? i : -1))
      .filter((i) => i !== -1);
    const pos = chapterIndices.indexOf(currentChapterIdx);
    currentBook.currentChapter = pos >= 0 ? pos : 0;
    currentBook.currentPage = currentPage;

    // 更新元数据到 IndexedDB，释放正文内存
    await saveBookMeta(currentBook);
    const metaIdx = books.findIndex((b) => b.id === currentBook.id);
    if (metaIdx >= 0) {
      books[metaIdx].currentChapter = currentBook.currentChapter;
      books[metaIdx].currentPage = currentBook.currentPage;
    }
    clearHash();
    renderBookshelf();
  }
  document.getElementById("bookshelf").style.display = "block";
  document.getElementById("reader").style.display = "none";
  currentBook = null;
}

/* === 书架事件绑定 === */
function initBookshelf() {
  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("fileInput").click();
  });
  document
    .getElementById("fileInput")
    .addEventListener("change", handleFileImport);

  document.getElementById("bookGrid").addEventListener("click", async (e) => {
    const card = e.target.closest(".book-card");
    const delBtn = e.target.closest(".delete-btn");
    if (delBtn) {
      e.stopPropagation();
      await deleteBook(parseInt(delBtn.dataset.index));
      return;
    }
    if (card) {
      await openBook(parseInt(card.dataset.index));
    }
  });
}

/* === 中文数字转阿拉伯 === */
const CN_NUM = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  百: 100,
  千: 1000,
  零: 0,
  〇: 0,
  两: 2,
};

function cnToArabic(str) {
  // 纯阿拉伯数字
  if (/^\d+$/.test(str)) return parseInt(str);

  let result = 0,
    section = 0,
    digit = 0;

  for (const ch of str) {
    const v = CN_NUM[ch];
    if (v === undefined) continue; // 跳过不识别的字符
    if (v >= 10) {
      // 十/百/千
      digit = digit || 1;
      section += digit * v;
      digit = 0;
    } else {
      // 0-9
      digit = v;
    }
  }
  // 检查是否已累积 section（如"一千二百"），有则加上最后一位
  if (section > 0) {
    result = section + digit;
  } else {
    // 纯数字序列（如"一二" → 12），按位拼接
    let num = 0;
    for (const ch of str) {
      const v = CN_NUM[ch];
      if (v === undefined || v >= 10) continue;
      num = num * 10 + v;
    }
    return num;
  }
  return result;
}

/* === TOC 解析 === */
function parseTOC(content) {
  const VOLUME_RE =
    /^[\s]*第[\s]*([一二两三四五六七八九十百千零〇\d]+)[\s]*[卷册]/;
  const CHAPTER_RE =
    /^[\s]*第[\s]*([一二两三四五六七八九十百千零〇\d]+)[\s]*[章回节]/;

  const lines = content.split(/\r?\n/);
  const toc = [];
  let pos = 0;
  let currentVolume = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const lineLen = trimmed.length;

    // 先尝试卷匹配
    const volMatch = trimmed.match(VOLUME_RE);
    if (volMatch && lineLen <= 30) {
      const num = cnToArabic(volMatch[1]);
      if (currentVolume !== null) {
        // 关闭上一个卷的最后一个章节
        if (toc.length > 0) {
          const last = toc[toc.length - 1];
          last.length = pos - last.startPos;
        }
      }
      toc.push({
        type: "volume",
        title: trimmed,
        index: num,
        startPos: pos,
      });
      currentVolume = toc.length - 1;
      pos +=
        line.length +
        (content[pos + line.length] === "\r"
          ? 2
          : content[pos + line.length] === "\n"
            ? 1
            : 1);
      continue;
    }

    // 再尝试章节匹配
    const chMatch = trimmed.match(CHAPTER_RE);
    if (chMatch && lineLen <= 80) {
      const num = cnToArabic(chMatch[1]);
      // 关闭上一个条目
      if (toc.length > 0 && toc[toc.length - 1].length === undefined) {
        const last = toc[toc.length - 1];
        last.length = pos - last.startPos;
      }
      toc.push({
        type: "chapter",
        title: trimmed,
        index: num,
        startPos: pos,
        volumeIdx: currentVolume,
      });
    }

    pos +=
      line.length +
      (content[pos + line.length] === "\r"
        ? 2
        : content[pos + line.length] === "\n"
          ? 1
          : 1);
  }

  // 关闭最后一个条目
  if (toc.length > 0 && toc[toc.length - 1].length === undefined) {
    toc[toc.length - 1].length = content.length - toc[toc.length - 1].startPos;
  }

  // 如果没有解析出任何章节，整本书当一章
  if (toc.filter((t) => t.type === "chapter").length === 0) {
    toc.push({
      type: "chapter",
      title: "正文",
      index: 1,
      startPos: 0,
      length: content.length,
      volumeIdx: null,
    });
  }

  return toc;
}

/* === 目录渲染 === */
function renderTOC() {
  const list = document.getElementById("tocList");
  const chapters = currentBook.toc;
  let html = "";
  let volumeOpen = false;

  for (let i = 0; i < chapters.length; i++) {
    const entry = chapters[i];
    if (entry.type === "volume") {
      if (volumeOpen) html += "</div>";
      html += `<div class="toc-volume" data-idx="${i}">${escapeHtml(entry.title)}</div>`;
      html += '<div class="toc-volume-chapters">';
      volumeOpen = true;
    } else {
      const cls = i === currentChapterIdx ? " active" : "";
      const bm = isBookmarked(i)
        ? ' <span class="bookmark-indicator">★</span>'
        : "";
      html += `<div class="toc-chapter${cls}" data-idx="${i}">${escapeHtml(entry.title)}${bm}</div>`;
    }
  }
  if (volumeOpen) html += "</div>";

  list.innerHTML = html;

  // 滚动到当前章节可见
  const active = list.querySelector(".toc-chapter.active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

/* === 内容渲染 === */
function renderContent() {
  const area = document.getElementById("contentArea");
  const fontSize = settings.fontSize;
  const lineHeight = settings.lineHeight;

  if (settings.readMode === "full") {
    const chapters = currentBook.toc.filter((t) => t.type === "chapter");
    let html =
      '<div class="content-page" style="--font-size:' +
      fontSize +
      "px;--line-height:" +
      lineHeight +
      '">';
    for (const entry of chapters) {
      const chapterText = currentBook.content.substring(
        entry.startPos,
        entry.startPos + (entry.length || 0),
      );
      const paragraphs = chapterText.split(/\r?\n/).filter((p) => p.trim());
      let idx = 0;
      for (const t of currentBook.toc) {
        if (t === entry) break;
        idx++;
      }
      html +=
        '<div class="chapter-anchor" id="ch-' +
        idx +
        '">' +
        '<h2 class="chapter-heading">' +
        escapeHtml(entry.title) +
        "</h2>" +
        paragraphs.map((p) => "<p>" + escapeHtml(p) + "</p>").join("") +
        "</div>";
    }
    html += "</div>";
    area.innerHTML = html;
    updatePageInfo();
  } else {
    const entry = currentBook.toc[currentChapterIdx];
    if (!entry) return;
    const chapterText = currentBook.content.substring(
      entry.startPos,
      entry.startPos + (entry.length || 0),
    );
    const paragraphs = chapterText.split(/\r?\n/).filter((p) => p.trim());
    area.innerHTML =
      '<div class="content-page" style="--font-size:' +
      fontSize +
      "px;--line-height:" +
      lineHeight +
      '">' +
      paragraphs.map((p) => "<p>" + escapeHtml(p) + "</p>").join("") +
      "</div>";
    area.scrollTop = 0;
    updatePageInfo();
  }
}

function updatePageInfo() {
  const entry = currentBook.toc[currentChapterIdx];
  document.getElementById("pageInfo").textContent = entry ? entry.title : "";
}

function scrollToChapter(idx) {
  const el = document.getElementById("ch-" + idx);
  if (el) {
    el.scrollIntoView({ block: "start", behavior: "instant" });
    currentChapterIdx = idx;
    updatePageInfo();
    renderTOC();
    updateHash();
  }
}

/* === 全文检索 === */
let searchMatches = [];
let currentSearchIdx = -1;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function doSearch(query) {
  searchMatches = [];
  currentSearchIdx = -1;
  if (!currentBook || !query.trim()) {
    renderSearchResults();
    return;
  }

  const content = currentBook.content;
  const lower = content.toLowerCase();
  const q = query.toLowerCase();
  let pos = 0;

  while ((pos = lower.indexOf(q, pos)) !== -1) {
    const start = Math.max(0, pos - 20);
    const end = Math.min(content.length, pos + q.length + 40);
    let chapterIdx = -1;
    for (let i = currentBook.toc.length - 1; i >= 0; i--) {
      if (
        currentBook.toc[i].type === "chapter" &&
        pos >= currentBook.toc[i].startPos
      ) {
        chapterIdx = i;
        break;
      }
    }
    searchMatches.push({
      pos,
      chapterIdx,
      before: content.substring(start, pos),
      match: content.substring(pos, pos + q.length),
      after: content.substring(pos + q.length, end),
    });
    pos += q.length;
    if (searchMatches.length >= 200) break;
  }

  if (searchMatches.length > 0) currentSearchIdx = 0;
  renderSearchResults();
}

function renderSearchResults() {
  const container = document.getElementById("searchResults");
  const count = document.getElementById("searchCount");

  if (searchMatches.length === 0) {
    count.textContent = "";
    container.innerHTML =
      '<div class="search-result" style="cursor:default;color:var(--text-secondary)">无结果</div>';
    return;
  }

  count.textContent = searchMatches.length + " 个结果";

  container.innerHTML = searchMatches
    .slice(0, 100)
    .map((m, i) => {
      const chapter =
        m.chapterIdx >= 0 ? currentBook.toc[m.chapterIdx].title : "";
      const cls =
        i === currentSearchIdx ? ' style="background:var(--hover-bg)"' : "";
      return (
        '<div class="search-result" data-idx="' +
        i +
        '"' +
        cls +
        ">" +
        '<div class="result-chapter">' +
        escapeHtml(chapter) +
        "</div>" +
        '<div class="result-text">...' +
        escapeHtml(m.before) +
        "<em>" +
        escapeHtml(m.match) +
        "</em>" +
        escapeHtml(m.after) +
        "...</div>" +
        "</div>"
      );
    })
    .join("");
}

function jumpToSearchMatch(idx) {
  const m = searchMatches[idx];
  if (!m) return;
  currentSearchIdx = idx;

  if (m.chapterIdx >= 0) {
    goToChapter(m.chapterIdx);
  }

  // 渲染后在 DOM 中标记第一个匹配
  setTimeout(() => {
    highlightCurrentMatch();
  }, 100);

  renderSearchResults();
}

function highlightCurrentMatch() {
  // 清除旧高亮
  document.querySelectorAll(".content-page mark").forEach((el) => {
    el.parentNode.replaceChild(document.createTextNode(el.textContent), el);
  });

  const m = searchMatches[currentSearchIdx];
  if (!m) return;

  const page = document.querySelector(".content-page");
  if (!page) return;

  const regex = new RegExp("(" + escapeRegex(m.match) + ")", "gi");
  let found = false;

  function walk(node) {
    if (found) return;
    if (node.nodeType === 3) {
      // Text node
      const idx = node.textContent.toLowerCase().indexOf(m.match.toLowerCase());
      if (idx >= 0 && !found) {
        found = true;
        const before = node.textContent.substring(0, idx);
        const matched = node.textContent.substring(idx, idx + m.match.length);
        const after = node.textContent.substring(idx + m.match.length);

        const frag = document.createDocumentFragment();
        frag.appendChild(document.createTextNode(before));
        const mark = document.createElement("mark");
        mark.textContent = matched;
        mark.className = "current";
        frag.appendChild(mark);
        frag.appendChild(document.createTextNode(after));
        node.parentNode.replaceChild(frag, node);

        // 滚动到该位置
        mark.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    } else if (node.nodeType === 1 && node.tagName !== "MARK") {
      for (const child of Array.from(node.childNodes)) {
        walk(child);
        if (found) return;
      }
    }
  }

  walk(page);
}

/* === 书签 === */
function toggleBookmark() {
  if (!currentBook) return;
  const entry = currentBook.toc[currentChapterIdx];
  if (!entry || entry.type !== "chapter") return;

  if (!currentBook.bookmarks) currentBook.bookmarks = {};
  const key = String(currentChapterIdx);

  if (currentBook.bookmarks[key]) {
    delete currentBook.bookmarks[key];
  } else {
    currentBook.bookmarks[key] = { time: Date.now() };
  }

  // 更新元数据
  const metaIdx = books.findIndex((b) => b.id === currentBook.id);
  if (metaIdx >= 0) {
    books[metaIdx].bookmarks = currentBook.bookmarks;
  }
  saveBookMeta(currentBook);
  renderTOC();
}

function isBookmarked(idx) {
  return (
    currentBook && currentBook.bookmarks && currentBook.bookmarks[String(idx)]
  );
}

/* === 章节跳转 === */
function goToChapter(idx) {
  currentChapterIdx = ensureChapterIdx(idx);
  currentPage = 0;
  if (settings.readMode === "full") {
    if (!document.getElementById("ch-" + currentChapterIdx)) {
      renderTOC();
      renderContent();
    }
    scrollToChapter(currentChapterIdx);
  } else {
    renderTOC();
    renderContent();
    updateHash();
  }
}

function nextChapter() {
  const allChapterIndices = currentBook.toc
    .map((t, i) => (t.type === "chapter" ? i : -1))
    .filter((i) => i !== -1);
  const pos = allChapterIndices.indexOf(currentChapterIdx);
  if (pos < allChapterIndices.length - 1) {
    const nextIdx = allChapterIndices[pos + 1];
    if (settings.readMode === "full") scrollToChapter(nextIdx);
    else goToChapter(nextIdx);
  }
}

function prevChapter() {
  const allChapterIndices = currentBook.toc
    .map((t, i) => (t.type === "chapter" ? i : -1))
    .filter((i) => i !== -1);
  const pos = allChapterIndices.indexOf(currentChapterIdx);
  if (pos > 0) {
    const prevIdx = allChapterIndices[pos - 1];
    if (settings.readMode === "full") scrollToChapter(prevIdx);
    else goToChapter(prevIdx);
  }
}

/* === 阅读器事件绑定 === */
function initReader() {
  document.getElementById("backBtn").addEventListener("click", async () => {
    await backToShelf();
  });
  document
    .getElementById("prevChapterBtn")
    .addEventListener("click", prevChapter);
  document
    .getElementById("nextChapterBtn")
    .addEventListener("click", nextChapter);

  document.getElementById("tocList").addEventListener("click", (e) => {
    const chapter = e.target.closest(".toc-chapter");
    if (chapter) {
      const idx = parseInt(chapter.dataset.idx);
      goToChapter(idx);
    }
  });

  document.getElementById("tocToggleBtn").addEventListener("click", () => {
    const sidebar = document.getElementById("tocSidebar");
    const collapsed = sidebar.classList.toggle("collapsed");
    sidebar.style.width = collapsed ? "0" : settings.sidebarWidth + "px";
  });

  // 搜索
  initSearch();

  // 书签
  document
    .getElementById("bookmarkBtn")
    .addEventListener("click", toggleBookmark);

  // 侧边栏拖拽
  initSidebarResize();

  // 阅读模式切换
  const modeBtn = document.getElementById("modeToggleBtn");
  modeBtn.textContent = settings.readMode === "full" ? "章节" : "全文";
  modeBtn.addEventListener("click", () => {
    settings.readMode = settings.readMode === "chapter" ? "full" : "chapter";
    modeBtn.textContent = settings.readMode === "full" ? "章节" : "全文";
    saveSettings();
    if (currentBook) {
      renderTOC();
      renderContent();
    }
  });

  // 全文模式滚动时更新当前章节
  let scrollTick;
  document.getElementById("contentArea").addEventListener("scroll", () => {
    if (settings.readMode !== "full" || !currentBook) return;
    if (scrollTick) return;
    scrollTick = requestAnimationFrame(() => {
      scrollTick = null;
      const chapters = currentBook.toc.filter((t) => t.type === "chapter");
      const scrollTop = document.getElementById("contentArea").scrollTop + 50;
      let found = currentChapterIdx;
      for (let i = chapters.length - 1; i >= 0; i--) {
        let idx = 0;
        for (const t of currentBook.toc) {
          if (t === chapters[i]) break;
          idx++;
        }
        const el = document.getElementById("ch-" + idx);
        if (el && el.offsetTop <= scrollTop) {
          found = idx;
          break;
        }
      }
      if (found !== currentChapterIdx) {
        currentChapterIdx = found;
        updatePageInfo();
        renderTOC();
        updateHash();
      }
    });
  });

  window.addEventListener("resize", () => {
    if (currentBook) {
      renderContent();
    }
  });
}

function initSearch() {
  const searchPanel = document.getElementById("searchPanel");
  const searchInput = document.getElementById("searchInput");
  let searchDebounce;

  document.getElementById("searchBtn").addEventListener("click", () => {
    const show = searchPanel.style.display === "none";
    searchPanel.style.display = show ? "flex" : "none";
    if (show) {
      searchInput.focus();
      searchInput.select();
    }
  });

  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => doSearch(searchInput.value), 200);
  });

  document.getElementById("searchCloseBtn").addEventListener("click", () => {
    searchPanel.style.display = "none";
    document.querySelectorAll(".content-page mark").forEach((el) => {
      el.parentNode.replaceChild(document.createTextNode(el.textContent), el);
    });
  });

  document.getElementById("searchPrevBtn").addEventListener("click", () => {
    if (searchMatches.length === 0) return;
    currentSearchIdx =
      (currentSearchIdx - 1 + searchMatches.length) % searchMatches.length;
    jumpToSearchMatch(currentSearchIdx);
  });

  document.getElementById("searchNextBtn").addEventListener("click", () => {
    if (searchMatches.length === 0) return;
    currentSearchIdx = (currentSearchIdx + 1) % searchMatches.length;
    jumpToSearchMatch(currentSearchIdx);
  });

  document.getElementById("searchResults").addEventListener("click", (e) => {
    const item = e.target.closest(".search-result");
    if (item && item.dataset.idx !== undefined) {
      jumpToSearchMatch(parseInt(item.dataset.idx));
    }
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (searchMatches.length > 0) jumpToSearchMatch(currentSearchIdx);
    }
    if (e.key === "Escape") searchPanel.style.display = "none";
  });
}

function initSidebarResize() {
  const handle = document.getElementById("sidebarResizeHandle");
  const sidebar = document.getElementById("tocSidebar");
  let startX, startWidth;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (e) => {
      const w = Math.max(120, Math.min(500, startWidth + e.clientX - startX));
      sidebar.style.width = w + "px";
    };

    const onUp = () => {
      handle.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      settings.sidebarWidth = sidebar.offsetWidth;
      saveSettings();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

/* === 主题 === */
function setTheme(theme) {
  settings.theme = theme;
  document.body.setAttribute("data-theme", theme);
  saveSettings();
}

function initTheme() {
  // 书架主题按钮
  document.getElementById("shelfThemeBtn").addEventListener("click", () => {
    document.getElementById("shelfThemeDropdown").classList.toggle("show");
  });
  document
    .getElementById("shelfThemeDropdown")
    .addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-theme]");
      if (btn) {
        setTheme(btn.dataset.theme);
        document.getElementById("shelfThemeDropdown").classList.remove("show");
      }
    });

  // 阅读器主题按钮
  document.getElementById("readerThemeBtn").addEventListener("click", () => {
    document.getElementById("readerThemeDropdown").classList.toggle("show");
  });
  document
    .getElementById("readerThemeDropdown")
    .addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-theme]");
      if (btn) {
        setTheme(btn.dataset.theme);
        document.getElementById("readerThemeDropdown").classList.remove("show");
      }
    });

  // 点击其他地方关闭下拉
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".theme-switcher")) {
      document
        .querySelectorAll(".theme-dropdown.show")
        .forEach((d) => d.classList.remove("show"));
    }
  });
}

/* === 设置 === */
function initSettings() {
  const fontSizeSlider = document.getElementById("fontSizeSlider");
  const fontSizeLabel = document.getElementById("fontSizeLabel");
  const lineHeightSlider = document.getElementById("lineHeightSlider");
  const lineHeightLabel = document.getElementById("lineHeightLabel");
  const scrollSpeedSlider = document.getElementById("scrollSpeedSlider");
  const scrollSpeedLabel = document.getElementById("scrollSpeedLabel");

  fontSizeSlider.value = settings.fontSize;
  fontSizeLabel.textContent = settings.fontSize + "px";
  lineHeightSlider.value = settings.lineHeight;
  lineHeightLabel.textContent = settings.lineHeight;
  scrollSpeedSlider.value = settings.scrollSpeed;
  scrollSpeedLabel.textContent = settings.scrollSpeed;

  fontSizeSlider.addEventListener("input", () => {
    settings.fontSize = parseInt(fontSizeSlider.value);
    fontSizeLabel.textContent = settings.fontSize + "px";
    saveSettings();
    if (currentBook) renderContent();
  });

  lineHeightSlider.addEventListener("input", () => {
    settings.lineHeight = parseFloat(lineHeightSlider.value);
    lineHeightLabel.textContent = settings.lineHeight;
    saveSettings();
    if (currentBook) renderContent();
  });

  scrollSpeedSlider.addEventListener("input", () => {
    settings.scrollSpeed = parseInt(scrollSpeedSlider.value);
    scrollSpeedLabel.textContent = settings.scrollSpeed;
    saveSettings();
  });

  document.getElementById("settingsBtn").addEventListener("click", () => {
    const panel = document.getElementById("settingsPanel");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });
}

/* === 滚动 === */
function scrollDown() {
  const area = document.getElementById("contentArea");
  const atBottom = area.scrollTop + area.clientHeight >= area.scrollHeight - 10;
  if (atBottom) {
    nextChapter();
  } else {
    area.scrollBy({ top: settings.scrollSpeed, behavior: "smooth" });
  }
}

/* === 键盘快捷键 === */
function initKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (!currentBook) return;
    // 不在输入框内才响应
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        prevChapter();
        break;
      case "ArrowRight":
        e.preventDefault();
        nextChapter();
        break;
      case "ArrowUp":
        e.preventDefault();
        document
          .getElementById("contentArea")
          .scrollBy({ top: -settings.scrollSpeed, behavior: "smooth" });
        break;
      case "ArrowDown":
        e.preventDefault();
        scrollDown();
        break;
      case "Escape":
        e.preventDefault();
        (async () => {
          await backToShelf();
        })();
        break;
      case "t":
      case "T":
        e.preventDefault();
        {
          // 循环切换主题
          const themes = ["day", "night", "eye", "parchment"];
          const idx = themes.indexOf(settings.theme);
          setTheme(themes[(idx + 1) % themes.length]);
        }
        break;
      default:
        if ((e.ctrlKey || e.metaKey) && e.key === "f") {
          e.preventDefault();
          const panel = document.getElementById("searchPanel");
          panel.style.display = "flex";
          document.getElementById("searchInput").focus();
          document.getElementById("searchInput").select();
        }
        break;
    }
  });
}

/* === 路由 === */
let _routing = false;

function updateHash() {
  if (_routing || !currentBook) return;
  const newHash = "#/read/" + currentBook.id + "/" + currentChapterIdx;
  if (location.hash !== newHash) {
    history.replaceState(null, "", newHash);
  }
}

function clearHash() {
  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

async function restoreFromHash() {
  const m = location.hash.match(/^#\/read\/([^/]+)\/(\d+)$/);
  if (!m) return false;
  const bookId = parseFloat(m[1]);
  const chapterIdx = parseInt(m[2]);
  const idx = books.findIndex((b) => b.id === bookId);
  if (idx < 0) return false;
  _routing = true;
  await openBook(idx);
  if (chapterIdx > 0) goToChapter(chapterIdx);
  _routing = false;
  return true;
}

/* === 初始化 === */
async function init() {
  await loadBooks();
  loadSettings();
  setTheme(settings.theme);
  document.getElementById("tocSidebar").style.width =
    settings.sidebarWidth + "px";
  initBookshelf();
  initReader();
  initTheme();
  initSettings();
  initKeyboard();

  const restored = await restoreFromHash();
  if (!restored) {
    renderBookshelf();
  }

  window.addEventListener("hashchange", async () => {
    if (!location.hash) {
      if (currentBook) await backToShelf();
      renderBookshelf();
    } else {
      await restoreFromHash();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
