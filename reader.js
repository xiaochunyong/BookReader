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
    document.getElementById("fileInput").addEventListener("change", handleFileImport);

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
