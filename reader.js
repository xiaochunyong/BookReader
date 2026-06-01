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
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  百: 100, 千: 1000,
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
  const CHAPTER_RE = /^[\s]*第[\s]*([一二三四五六七八九十百千\d]+)[\s]*[章回节]/;

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
      pos += line.length + (content[pos + line.length] === "\r" ? 2 : content[pos + line.length] === "\n" ? 1 : 1);
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

    pos += line.length + (content[pos + line.length] === "\r" ? 2 : content[pos + line.length] === "\n" ? 1 : 1);
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
