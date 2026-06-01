/* === 数据管理 === */
const BOOKS_KEY = "htmlreader_books";
const SETTINGS_KEY = "htmlreader_settings";

let books = [];
let currentBook = null;
let currentChapterIdx = 0;
let currentPage = 0;
let totalChapterPages = 0;

let settings = {
  theme: "day",
  fontSize: 20,
  lineHeight: 1.8,
};

function loadBooks() {
  try {
    books = JSON.parse(localStorage.getItem(BOOKS_KEY) || "[]");
  } catch (e) {
    books = [];
  }
}

function saveBooks() {
  localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
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
      (book, i) =>
        `<div class="book-card" data-index="${i}">
                    <button class="delete-btn" data-index="${i}">&times;</button>
                    <div class="book-title">${escapeHtml(book.name)}</div>
                    <div class="book-progress">
                        共 ${book.toc ? book.toc.filter((t) => t.type === "chapter").length : "?"} 章
                        ${book.currentChapter !== undefined ? "| 看到第 " + (book.currentChapter + 1) + " 章" : ""}
                    </div>
                </div>`,
    )
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* === 导入 === */
async function handleFileImport(e) {
  const files = e.target.files;
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".txt")) {
      alert(file.name + " 不是txt文件，已跳过");
      continue;
    }
    const text = await file.text();
    const book = {
      id: Date.now() + Math.random(),
      name: file.name.replace(/\.txt$/i, ""),
      content: text,
      currentChapter: 0,
      toc: [],
    };
    book.toc = parseTOC(text);
    books.push(book);
  }
  saveBooks();
  renderBookshelf();
  e.target.value = "";
}

/* === 删除 === */
function deleteBook(index) {
  if (confirm("确定要删除《" + books[index].name + "》吗？")) {
    books.splice(index, 1);
    saveBooks();
    renderBookshelf();
  }
}

/* === 打开书籍 === */
function openBook(index) {
  currentBook = books[index];
  currentChapterIdx = currentBook.currentChapter || 0;
  currentPage = currentBook.currentPage || 0;

  document.getElementById("bookshelf").style.display = "none";
  document.getElementById("reader").style.display = "flex";
  document.getElementById("bookName").textContent = currentBook.name;

  renderTOC();
  goToChapter(currentChapterIdx);
}

/* === 返回书架 === */
function backToShelf() {
  if (currentBook) {
    currentBook.currentChapter = currentChapterIdx;
    currentBook.currentPage = currentPage;
    saveBooks();
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

  document.getElementById("bookGrid").addEventListener("click", (e) => {
    const card = e.target.closest(".book-card");
    const delBtn = e.target.closest(".delete-btn");
    if (delBtn) {
      e.stopPropagation();
      deleteBook(parseInt(delBtn.dataset.index));
      return;
    }
    if (card) {
      openBook(parseInt(card.dataset.index));
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
};

function cnToArabic(str) {
  let result = 0;
  let current = 0;
  for (const ch of str) {
    const v = CN_NUM[ch];
    if (v === 100 || v === 1000) {
      current = (current || 1) * v;
      result += current;
      current = 0;
    } else if (v === 10) {
      current = (current || 1) * 10;
      result += current;
      current = 0;
    } else if (v !== undefined) {
      current = v;
    } else {
      // 阿拉伯数字字符
      if (ch >= "0" && ch <= "9") {
        current = current * 10 + parseInt(ch);
      }
    }
  }
  result += current;
  return result;
}

/* === TOC 解析 === */
function parseTOC(content) {
  const VOLUME_RE = /^[\s]*第[\s]*([一二三四五六七八九十百千\d]+)[\s]*[卷册]/;
  const CHAPTER_RE =
    /^[\s]*第[\s]*([一二三四五六七八九十百千\d]+)[\s]*[章回节]/;

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
    if (chMatch && lineLen <= 50) {
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
      html += `<div class="toc-chapter${cls}" data-idx="${i}">${escapeHtml(entry.title)}</div>`;
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
  const entry = currentBook.toc[currentChapterIdx];
  if (!entry) return;

  const content = currentBook.content;
  const chapterText = content.substring(
    entry.startPos,
    entry.startPos + (entry.length || 0),
  );
  const paragraphs = chapterText.split(/\r?\n/).filter((p) => p.trim());

  const fontSize = settings.fontSize;
  const lineHeight = settings.lineHeight;

  // 计算每页容纳段落数
  const areaWidth = area.clientWidth * 0.7; // padding 15% 两侧
  const areaHeight = area.clientHeight - 40;
  const charWidth = fontSize * 0.6;
  const lineHeightPx = fontSize * lineHeight;
  const charsPerLine = Math.floor(areaWidth / charWidth);
  const linesPerPage = Math.floor(areaHeight / lineHeightPx);

  // 按段落分页
  const pages = [];
  let currentPageLines = [];
  let currentLineCount = 0;

  for (const para of paragraphs) {
    // 计算该段落占多少行
    const paraLines = Math.ceil((para.length * charWidth) / areaWidth) || 1;

    if (
      currentLineCount + paraLines > linesPerPage &&
      currentPageLines.length > 0
    ) {
      pages.push(currentPageLines.join("\n"));
      currentPageLines = [];
      currentLineCount = 0;
    }
    currentPageLines.push(para);
    currentLineCount += paraLines;
  }
  if (currentPageLines.length > 0) {
    pages.push(currentPageLines.join("\n"));
  }

  totalChapterPages = pages.length || 1;

  area.innerHTML = pages
    .map(
      (page) =>
        `<div class="content-page" style="--font-size:${fontSize}px;--line-height:${lineHeight}">${page
          .split("\n")
          .map((p) => `<p>${escapeHtml(p)}</p>`)
          .join("")}</div>`,
    )
    .join("");

  area.scrollLeft = currentPage * area.clientWidth;
  updatePageInfo();
}

function updatePageInfo() {
  document.getElementById("pageInfo").textContent =
    "第 " + (currentPage + 1) + " / " + totalChapterPages + " 页";
}

/* === 章节跳转 === */
function goToChapter(idx) {
  currentChapterIdx = idx;
  currentPage = 0;
  renderTOC();
  renderContent();
}

function nextChapter() {
  const allChapterIndices = currentBook.toc
    .map((t, i) => (t.type === "chapter" ? i : -1))
    .filter((i) => i !== -1);
  const pos = allChapterIndices.indexOf(currentChapterIdx);
  if (pos < allChapterIndices.length - 1) {
    goToChapter(allChapterIndices[pos + 1]);
  }
}

function prevChapter() {
  const allChapterIndices = currentBook.toc
    .map((t, i) => (t.type === "chapter" ? i : -1))
    .filter((i) => i !== -1);
  const pos = allChapterIndices.indexOf(currentChapterIdx);
  if (pos > 0) {
    goToChapter(allChapterIndices[pos - 1]);
  }
}

/* === 翻页 === */
function nextPage() {
  if (currentPage < totalChapterPages - 1) {
    currentPage++;
    const area = document.getElementById("contentArea");
    area.scrollLeft = currentPage * area.clientWidth;
    updatePageInfo();
  } else {
    nextChapter();
  }
}

function prevPage() {
  if (currentPage > 0) {
    currentPage--;
    const area = document.getElementById("contentArea");
    area.scrollLeft = currentPage * area.clientWidth;
    updatePageInfo();
  } else {
    prevChapter();
    // 跳到上一章最后一页
    setTimeout(() => {
      currentPage = totalChapterPages - 1;
      const area = document.getElementById("contentArea");
      area.scrollLeft = currentPage * area.clientWidth;
      updatePageInfo();
    }, 50);
  }
}

/* === 滚动监听 === */
function initScrollListener() {
  const area = document.getElementById("contentArea");
  area.addEventListener("scroll", () => {
    const pageWidth = area.clientWidth;
    const newPage = Math.round(area.scrollLeft / pageWidth);
    if (
      newPage !== currentPage &&
      newPage >= 0 &&
      newPage < totalChapterPages
    ) {
      currentPage = newPage;
      updatePageInfo();
    }
  });
}

/* === 阅读器事件绑定 === */
function initReader() {
  document.getElementById("backBtn").addEventListener("click", backToShelf);
  document.getElementById("prevChapterBtn").addEventListener("click", prevPage);
  document.getElementById("nextChapterBtn").addEventListener("click", nextPage);

  document.getElementById("tocList").addEventListener("click", (e) => {
    const chapter = e.target.closest(".toc-chapter");
    if (chapter) {
      const idx = parseInt(chapter.dataset.idx);
      goToChapter(idx);
    }
  });

  document.getElementById("tocToggleBtn").addEventListener("click", () => {
    document.getElementById("tocSidebar").classList.toggle("collapsed");
  });

  initScrollListener();

  window.addEventListener("resize", () => {
    if (currentBook) {
      renderContent();
    }
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
    document.getElementById("shelfThemeDropdown").addEventListener("click", (e) => {
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
    document.getElementById("readerThemeDropdown").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-theme]");
        if (btn) {
            setTheme(btn.dataset.theme);
            document.getElementById("readerThemeDropdown").classList.remove("show");
        }
    });

    // 点击其他地方关闭下拉
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".theme-switcher")) {
            document.querySelectorAll(".theme-dropdown.show").forEach((d) => d.classList.remove("show"));
        }
    });
}

/* === 设置 === */
function initSettings() {
    const fontSizeSlider = document.getElementById("fontSizeSlider");
    const fontSizeLabel = document.getElementById("fontSizeLabel");
    const lineHeightSlider = document.getElementById("lineHeightSlider");
    const lineHeightLabel = document.getElementById("lineHeightLabel");

    fontSizeSlider.value = settings.fontSize;
    fontSizeLabel.textContent = settings.fontSize + "px";
    lineHeightSlider.value = settings.lineHeight;
    lineHeightLabel.textContent = settings.lineHeight;

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

    document.getElementById("settingsBtn").addEventListener("click", () => {
        const panel = document.getElementById("settingsPanel");
        panel.style.display = panel.style.display === "none" ? "block" : "none";
    });
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
                prevPage();
                break;
            case "ArrowRight":
                e.preventDefault();
                nextPage();
                break;
            case "ArrowUp":
                e.preventDefault();
                prevChapter();
                break;
            case "ArrowDown":
                e.preventDefault();
                nextChapter();
                break;
            case "Escape":
                e.preventDefault();
                backToShelf();
                break;
            case "t":
            case "T":
                e.preventDefault();
                // 循环切换主题
                const themes = ["day", "night", "eye", "parchment"];
                const idx = themes.indexOf(settings.theme);
                setTheme(themes[(idx + 1) % themes.length]);
                break;
        }
    });
}

/* === 初始化 === */
function init() {
    loadBooks();
    loadSettings();
    setTheme(settings.theme);
    initBookshelf();
    initReader();
    initTheme();
    initSettings();
    initKeyboard();
    renderBookshelf();
}

document.addEventListener("DOMContentLoaded", init);
