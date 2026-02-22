// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
const API = "";            // empty = same-origin (served by Flask)

let currentVerse   = null; // {book, chapter, verse, text}
let currentResults = [];   // raw rows from /api/scripture
let currentWord    = "";
let allUsages      = [];
let usageMode      = "all";
let bsFilter       = "all";
let bsAllResults   = [];
let dvIndex        = 0;
let activePlan     = "90day";
let cmpActiveSrcs  = new Set(["kjv","tanakh_english","septuagint","textus_receptus"]);

const SOURCE_LABELS = {
  "kjv":              "English (KJV)",
  "tanakh_english":   "English (Tanakh)",
  "tanakh_hebrew":    "Hebrew (Masoretic)",
  "septuagint":       "Greek (Septuagint)",
  "textus_receptus":  "Greek (Textus Receptus)",
  "vulgate":          "Latin (Vulgate)",
};

const SOURCE_ORDER = ["kjv","tanakh_english","septuagint","textus_receptus","tanakh_hebrew","vulgate"];

const OT_BOOKS = new Set([
  "Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth",
  "1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra",
  "Nehemiah","Esther","Job","Psalms","Psalm","Proverbs","Ecclesiastes","Song of Solomon",
  "Isaiah","Jeremiah","Lamentations","Ezekiel","Daniel","Hosea","Joel","Amos",
  "Obadiah","Jonah","Micah","Nahum","Habakkuk","Zephaniah","Haggai","Zechariah","Malachi"
]);

// ═══════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════
async function apiFetch(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(body)
  });
  return r.json();
}

async function apiDelete(path) {
  const r = await fetch(API + path, {method:"DELETE"});
  return r.json();
}

// ═══════════════════════════════════════════════════
// SCRIPTURE SEARCH
// ═══════════════════════════════════════════════════
async function goSearch() {
  const ref = document.getElementById("verse-input").value.trim();
  if (!ref) return;
  setStatus('<span class="spinner"></span> Loading…');
  document.getElementById("scripture-body").innerHTML =
    '<div class="loading" style="padding:40px 16px">Loading scripture…</div>';
  currentVerse  = null;
  currentResults = [];
  currentWord   = "";
  allUsages     = [];
  document.getElementById("study-word-lbl").textContent = "";
  document.getElementById("scripture-ref-lbl").textContent = ref;

  try {
    const rows = await apiFetch(`/api/scripture?ref=${encodeURIComponent(ref)}`);
    if (!rows.length) {
      document.getElementById("scripture-body").innerHTML =
        '<div class="loading" style="padding:40px 16px">No results found. Check the book name and chapter number.</div>';
      setStatus("❌ No results");
      return;
    }
    currentResults = rows;
    renderScripture(rows);
    setStatus("✅ Click any word for word study");
    showPlaceholderStudy();
  } catch(e) {
    document.getElementById("scripture-body").innerHTML =
      '<div class="loading" style="padding:40px 16px">Error loading scripture. Is the server running?</div>';
    setStatus("❌ Server error");
  }
}

function renderScripture(rows) {
  const body = document.getElementById("scripture-body");
  body.innerHTML = "";

  // Group by verse, then by source within verse
  const verseMap = {};
  const verseOrder = [];
  for (const r of rows) {
    const key = `${r.book} ${r.chapter}:${r.verse}`;
    if (!verseMap[key]) { verseMap[key] = {book:r.book, chapter:r.chapter, verse:r.verse, sources:{}}; verseOrder.push(key); }
    verseMap[key].sources[r.source] = r.text;
  }

  for (const key of verseOrder) {
    const v = verseMap[key];

    const hdr = document.createElement("div");
    hdr.className = "verse-hdr";
    hdr.textContent = key;
    body.appendChild(hdr);

    const hr = document.createElement("hr");
    hr.className = "divider";
    body.appendChild(hr);

    // Render sources in order
    for (const src of SOURCE_ORDER) {
      if (!v.sources[src]) continue;
      const text = v.sources[src];

      const lbl = document.createElement("span");
      lbl.className = "src-lbl";
      lbl.textContent = SOURCE_LABELS[src] || src;
      body.appendChild(lbl);

      const textDiv = document.createElement("div");
      textDiv.className = "src-text";
      // For KJV, wrap words in clickable spans; for others, display as-is
      if (src === "kjv") {
        const tokens = text.split(/(\s+)/);
        for (const tok of tokens) {
          if (/\S/.test(tok)) {
            const span = document.createElement("span");
            span.className = "word-span";
            span.textContent = tok;
            span.dataset.word = tok.replace(/[^a-zA-Z']/g, "");
            span.addEventListener("click",     () => onWordClick(span, v));
            span.addEventListener("mouseover",  () => onWordHover(span));
            span.addEventListener("mouseout",   () => hideTooltip());
            textDiv.appendChild(span);
          } else {
            textDiv.appendChild(document.createTextNode(tok));
          }
        }
        // Track verse for single-verse views
        if (!currentVerse) {
          currentVerse = {book:v.book, chapter:v.chapter, verse:v.verse, text};
        }
      } else {
        // Hebrew, Greek, Latin — display with appropriate class
        const langClass = src === "tanakh_hebrew" ? "text-hebrew"
                        : (src === "septuagint" || src === "textus_receptus") ? "text-greek"
                        : src === "vulgate" ? "text-latin" : "";
        if (langClass) textDiv.classList.add(langClass);
        textDiv.textContent = text;
      }
      body.appendChild(textDiv);
    }
    // Gap between verses
    body.appendChild(document.createElement("br"));
  }
}

// ═══════════════════════════════════════════════════
// WORD CLICK / HOVER
// ═══════════════════════════════════════════════════
async function onWordClick(span, verseData) {
  const word = span.dataset.word;
  if (!word || word.length < 2) return;

  document.querySelectorAll(".word-span.clicked").forEach(s => s.classList.remove("clicked"));
  span.classList.add("clicked");
  currentWord   = word;
  currentVerse  = {
    book:    verseData.book,
    chapter: verseData.chapter,
    verse:   verseData.verse,
    text:    verseData.sources["kjv"] || ""
  };

  document.getElementById("study-word-lbl").textContent = `"${word}"`;
  document.getElementById("usages-hdr").textContent = `USAGES OF "${word.toUpperCase()}" ACROSS THE BIBLE`;
  switchTab("study");

  document.getElementById("study-text").innerHTML =
    `<span class="loading"><span class="spinner"></span> Looking up "${escHtml(word)}" in ${verseData.book} ${verseData.chapter}:${verseData.verse}…</span>`;
  document.getElementById("usages-text").innerHTML =
    '<span class="loading"><span class="spinner"></span> Searching…</span>';
  document.getElementById("usages-count").textContent = "";

  // Word study and usages in parallel
  loadWordStudy(word, verseData);
  loadUsages(word, verseData);
}

function onWordHover(span) {
  // No alignment without API key — just nothing
  hideTooltip();
}

// ═══════════════════════════════════════════════════
// WORD STUDY
// ═══════════════════════════════════════════════════
async function loadWordStudy(word, verseData) {
  try {
    const data = await apiFetch(
      `/api/wordstudy?word=${encodeURIComponent(word)}&book=${encodeURIComponent(verseData.book)}&chapter=${verseData.chapter}&verse=${verseData.verse}`
    );
    renderWordStudy(word, verseData, data.sections, data.verse_text);
  } catch(e) {
    document.getElementById("study-text").innerHTML =
      `<span class="loading">Error loading word study. Is the server running?</span>`;
  }
}

function renderWordStudy(word, verseData, sections, verseText) {
  let html = `<span class="word-title">${escHtml(word)}</span>`;
  html += `<span class="verse-ref">${escHtml(verseData.book)} ${verseData.chapter}:${verseData.verse}</span>`;
  if (verseText) {
    const snip = verseText.length > 130 ? verseText.slice(0,130)+"…" : verseText;
    html += `<span class="verse-text">${escHtml(snip)}</span>`;
  }
  for (const sec of sections) {
    html += `<span class="section-hdr">${escHtml(sec.header)}</span>`;
    html += `<span class="divider">────────────────────────────────────</span>`;
    for (const line of sec.lines) {
      html += `<span class="${escHtml(line.tag)}">${escHtml(line.text)}</span>`;
    }
  }
  document.getElementById("study-text").innerHTML = html;
}

async function loadUsages(word, verseData) {
  try {
    const rows = await apiFetch(
      `/api/usages?word=${encodeURIComponent(word)}&book=${encodeURIComponent(verseData.book)}&chapter=${verseData.chapter}&verse=${verseData.verse}`
    );
    allUsages = rows;
    renderUsages(word);
  } catch(e) {
    document.getElementById("usages-text").innerHTML =
      '<span class="loading">Could not load usages.</span>';
  }
}

function renderUsages(word) {
  let rows = allUsages;
  if (usageMode === "book" && currentVerse)
    rows = rows.filter(r => r.book === currentVerse.book);

  document.getElementById("usages-count").textContent =
    `(${rows.length} result${rows.length!==1?"s":""})`;

  if (!rows.length) {
    document.getElementById("usages-text").innerHTML =
      `<span class="loading">"${escHtml(word)}" not found elsewhere${usageMode==="book"?" in this book":" in the Bible"}.</span>`;
    return;
  }
  const wre = new RegExp(`\\b(${word.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")})\\b`,"gi");
  let html = "", curBook = "";
  for (const r of rows) {
    if (r.book !== curBook) {
      curBook = r.book;
      html += `<span class="book-hdr">${escHtml(r.book)}</span>`;
    }
    const hl = r.text.replace(wre, '<span class="hl">$1</span>');
    html += `<span class="ref">${r.chapter}:${r.verse}</span>  <span class="text-line" style="display:inline">${hl}</span><br>`;
  }
  document.getElementById("usages-text").innerHTML = html;
}

function setUsageMode(m) {
  usageMode = m;
  document.getElementById("usage-all").classList.toggle("active", m==="all");
  document.getElementById("usage-book").classList.toggle("active", m==="book");
  if (currentWord) renderUsages(currentWord);
}

// ═══════════════════════════════════════════════════
// BIBLE SEARCH
// ═══════════════════════════════════════════════════
function bibleSearch() {
  const phrase = document.getElementById("search-input").value.trim();
  if (!phrase) return;
  switchTab("bsearch");
  document.getElementById("bs-entry").value = phrase;
  runBibleSearch();
}

async function runBibleSearch() {
  const phrase = document.getElementById("bs-entry").value.trim();
  if (!phrase) return;
  document.getElementById("bs-text").innerHTML =
    `<span class="loading"><span class="spinner"></span> Searching for "${escHtml(phrase)}"…</span>`;
  document.getElementById("bs-count").textContent = "";

  try {
    const rows = await apiFetch(`/api/search?q=${encodeURIComponent(phrase)}`);
    bsAllResults = rows.map(r => ({...r, isOT: OT_BOOKS.has(r.book)}));
    applyBsFilter(phrase);
  } catch(e) {
    document.getElementById("bs-text").innerHTML =
      '<span class="loading">Search failed. Is the server running?</span>';
  }
}

function applyBsFilter(phrase) {
  phrase = phrase || document.getElementById("bs-entry").value.trim();
  let rows = bsAllResults;
  if (bsFilter === "ot") rows = rows.filter(r => r.isOT);
  if (bsFilter === "nt") rows = rows.filter(r => !r.isOT);
  const note = rows.length >= 200 ? " (showing first 200)" : "";
  document.getElementById("bs-count").textContent = `(${rows.length} verse${rows.length!==1?"s":""}${note})`;

  if (!rows.length) {
    document.getElementById("bs-text").innerHTML =
      `<span class="loading">No results found for "${escHtml(phrase)}" in this filter.</span>`;
    return;
  }
  const wre = new RegExp(`(${phrase.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")})`,"gi");
  let html = "", curBook = "";
  for (const r of rows) {
    if (r.book !== curBook) {
      const bookCount = rows.filter(x=>x.book===r.book).length;
      curBook = r.book;
      html += `<span class="book-hdr">${escHtml(r.book)}</span> <span style="color:var(--dim);font-size:11px">(${bookCount} verse${bookCount!==1?"s":""})</span>`;
    }
    const snip   = r.text.length > 180 ? r.text.slice(0,180)+"…" : r.text;
    const hl     = snip.replace(wre, '<span class="hl">$1</span>');
    html += `<br><span class="ref">${r.chapter}:${r.verse}</span>  <span class="text-line" style="display:inline">${hl}</span>`;
  }
  document.getElementById("bs-text").innerHTML = html;
}

function setBsFilter(f) {
  bsFilter = f;
  ["all","ot","nt"].forEach(x => document.getElementById("bs-"+x).classList.toggle("active", x===f));
  applyBsFilter();
}

// ═══════════════════════════════════════════════════
// ORTHODOX LIBRARY
// ═══════════════════════════════════════════════════
const ORTHODOX_CATEGORIES = {
  "theology": "🕊 Theology & Doctrine",
  "councils": "📜 Ecumenical Councils",
  "fathers":  "✝ Church Fathers",
  "history":  "📖 Church History",
  "liturgy":  "☩ Liturgy & Sacraments",
  "ethics":   "⚖ Ethics & Moral Theology"
};

const ORTHODOX_DB = {
  "theology": [
    ["The Holy Trinity",
     "The Orthodox Church professes one God in three Persons — Father, Son, and Holy Spirit — co-equal, co-eternal, and of one essence (homoousios). This was definitively articulated at the First Ecumenical Council of Nicaea (325 AD) and expanded at Constantinople (381 AD). The Trinity is not three gods nor three modes of one God, but one divine Nature in three distinct Persons.",
     ["The Father is unbegotten, the eternal source of divinity.",
      "The Son is eternally begotten of the Father — not created, but God from God, Light from Light.",
      "The Holy Spirit proceeds from the Father alone (the Orthodox reject the Latin filioque addition).",
      "The Cappadocian Fathers gave the Church the precise theological vocabulary to express this mystery."],
     ["Matthew 28:19","John 1:1","John 15:26","2 Corinthians 13:14"]],
    ["The Incarnation",
     "The Second Person of the Holy Trinity, the eternal Son and Word of God, took on human flesh and became man — born of the Virgin Mary, the Theotokos — without ceasing to be God. This is the central mystery of the Christian faith.",
     ["Christ is fully God and fully man — two natures in one Person, without confusion, change, division, or separation (Definition of Chalcedon, 451 AD).",
      "The Incarnation is not merely an event in history but the eternal purpose of creation.",
      "The doctrine of Theosis — the participation of human persons in the divine nature — flows directly from the Incarnation."],
     ["John 1:14","Philippians 2:5-11","Hebrews 2:14"]],
    ["Theosis — Union with God",
     "Theosis (divinisation, deification) is the goal of the Christian life in Orthodox theology: the real participation of human persons in the divine nature (2 Peter 1:4), not by becoming God by essence, but by grace.",
     ["The famous formula of Athanasius: 'God became man so that man might become god.'",
      "Theosis is not absorption into God but communion with God in love.",
      "It is a present reality begun in baptism and the Eucharist, and a future eschatological completion.",
      "The distinction between God's unknowable essence and His energies is essential to understanding theosis."],
     ["2 Peter 1:4","John 17:21-23","1 John 3:2"]],
  ],
  "councils": [
    ["First Council of Nicaea (325 AD)",
     "Called by Emperor Constantine, the First Ecumenical Council condemned the Arian heresy, which taught that the Son is a creature. The Council defined the Son as homoousios (of one essence) with the Father.",
     ["Arius taught that the Son was the highest creature, not fully divine.",
      "Athanasius of Alexandria championed Orthodoxy against the Arians.",
      "The Nicene Creed was produced at this Council.",
      "The dating of Pascha was also decided here."],
     ["John 1:1","John 10:30"]],
    ["Council of Chalcedon (451 AD)",
     "The Fourth Ecumenical Council defined that Christ is one Person in two natures — divine and human — without confusion, change, division, or separation. This refuted both Nestorianism and Monophysitism.",
     ["The Chalcedonian Definition remains the Christological standard of Orthodox and Catholic churches.",
      "The Oriental Orthodox churches rejected Chalcedon and are sometimes called Non-Chalcedonian.",
      "Leo the Great's Tome was a key document at the Council."],
     ["Hebrews 2:14","Philippians 2:5-11"]],
    ["Second Council of Nicaea (787 AD)",
     "The Seventh and final Ecumenical Council restored the veneration of icons after the iconoclast controversy, affirming that the Incarnation makes the depiction of Christ possible.",
     ["Iconoclasm had been imposed by Byzantine emperors who considered icons idolatry.",
      "The Council distinguished between worship (latria, due to God alone) and veneration (proskynesis, given to icons and saints).",
      "The Triumph of Orthodoxy — celebrated on the first Sunday of Lent — commemorates this restoration."],
     ["John 1:14"]],
  ],
  "fathers": [
    ["Athanasius of Alexandria (c. 296–373)",
     "Called 'Athanasius contra mundum' — Athanasius against the world — for his lone defense of Nicene Orthodoxy. He was exiled five times but never compromised.",
     ["Author of On the Incarnation, one of the greatest works of patristic theology.",
      "His formula: 'God became man so that man might become god' is the foundation of theosis theology.",
      "His Life of Antony popularized monasticism throughout the Roman world."],
     ["John 1:14","2 Peter 1:4"]],
    ["John Chrysostom (c. 347–407)",
     "The 'Golden-Mouthed' Archbishop of Constantinople, known for his brilliant preaching and fearless denunciation of wealth and injustice.",
     ["His homilies on Matthew, John, Romans, and the Pauline letters remain among the greatest biblical commentaries.",
      "Died in exile after offending the Empress Eudoxia, but was later venerated as a saint.",
      "The Divine Liturgy of St. John Chrysostom bears his name and is the standard liturgy of the Byzantine tradition."],
     ["Matthew 25:40"]],
    ["Basil the Great (c. 330–379)",
     "Archbishop of Caesarea and one of the three Cappadocian Fathers who formulated the definitive Orthodox doctrine of the Trinity.",
     ["With his brother Gregory of Nyssa and friend Gregory the Theologian, gave the Church the language of one essence (ousia) and three persons (hypostases).",
      "Founded the first great hospital and social welfare institution in Christian history.",
      "His Rule for monasticism became the foundation of Eastern Christian monasticism."],
     ["2 Corinthians 13:14","Matthew 22:37-39"]],
    ["Gregory Palamas (1296–1359)",
     "Archbishop of Thessalonica and the great theologian of hesychasm — the practice of inner prayer aimed at direct experience of God.",
     ["Palamas distinguished between God's unknowable essence and His uncreated energies — the divine life in which we truly participate.",
      "The Palamite synthesis was formally affirmed by the Orthodox Church in the Councils of Constantinople (1341–1351).",
      "His feast day (second Sunday of Lent) is called 'the Sunday of Palamas.'"],
     ["Exodus 33:20","John 14:23","2 Peter 1:4"]],
  ],
  "history": [
    ["The Great Schism (1054)",
     "The formal separation of Eastern (Orthodox) and Western (Roman Catholic) Christianity occurred on July 16, 1054, when Cardinal Humbert placed a bull of excommunication on the altar of the Hagia Sophia.",
     ["The primary theological dispute was the filioque — the Western addition to the Creed stating the Spirit proceeds from 'the Father and the Son.'",
      "Other issues included papal primacy, clerical celibacy, and liturgical practices.",
      "The mutual excommunications were lifted in 1964 by Pope Paul VI and Patriarch Athenagoras I."],
     ["John 15:26"]],
    ["The Fall of Constantinople (1453)",
     "On May 29, 1453, the Byzantine Empire fell to Ottoman Sultan Mehmed II after a 53-day siege.",
     ["The last Byzantine Emperor, Constantine XI Palaiologos, died fighting on the walls.",
      "The Hagia Sophia was converted to a mosque.",
      "The Ecumenical Patriarchate remains in Constantinople (Istanbul) to this day."],
     []],
    ["The Russian Orthodox Church",
     "The Russian Orthodox Church traces its origins to the Christianisation of Kievan Rus in 988 AD under Prince Vladimir. It became the largest Orthodox church in the world.",
     ["The Russian Church became autocephalous (self-governing) in 1448.",
      "Moscow became known as the 'Third Rome' after the fall of Constantinople.",
      "The Church suffered severe persecution under Soviet rule (1917–1991), with thousands of martyrs."],
     []],
  ],
  "liturgy": [
    ["The Divine Liturgy",
     "The Divine Liturgy is the central act of Orthodox Christian worship — the celebration of the Eucharist in which the faithful gather to offer thanksgiving to God, hear the Word, and receive the Body and Blood of Christ.",
     ["The most common form is the Divine Liturgy of St. John Chrysostom, celebrated on most Sundays and weekdays.",
      "The Divine Liturgy of St. Basil the Great is celebrated ten times a year.",
      "The liturgy is a participation in the heavenly worship before the throne of God.",
      "The epiclesis — invocation of the Holy Spirit upon the gifts — is the consecratory moment in the Orthodox understanding."],
     ["Revelation 4–5","1 Corinthians 11:23-26","John 6:53-56"]],
    ["The Seven Holy Mysteries (Sacraments)",
     "The Orthodox Church recognises seven Holy Mysteries: Baptism, Chrismation (Confirmation), Eucharist, Confession, Holy Orders, Marriage, and Holy Unction (Anointing of the Sick).",
     ["Baptism is by triple immersion in the name of the Holy Trinity.",
      "Chrismation immediately follows Baptism, conferring the gifts of the Holy Spirit.",
      "The Eucharist is the Body and Blood of Christ — not merely a symbol.",
      "Confession is a Mystery of healing, not merely a legal pardon."],
     ["Matthew 28:19","John 6:53-56","James 5:14-15"]],
    ["The Jesus Prayer",
     "The Jesus Prayer — 'Lord Jesus Christ, Son of God, have mercy on me, a sinner' — is the central prayer of Orthodox hesychast spirituality.",
     ["Based on the prayer of Bartimaeus (Mark 10:47) and the prayer of the Publican (Luke 18:13).",
      "The Philokalia, an anthology of hesychast masters, is the primary guide to this prayer.",
      "Mount Athos in Greece has been the center of Orthodox monasticism since the 10th century."],
     ["Luke 18:13","1 Thessalonians 5:17","Psalm 46:10"]],
    ["Theotokos — The Mother of God",
     "The veneration of the Most Holy Theotokos (God-bearer, Mother of God) occupies a central place in Orthodox piety and theology.",
     ["The title Theotokos was affirmed at the Council of Ephesus (431 AD) as a Christological statement.",
      "The Orthodox Church venerates but does not worship Mary — she is the highest of all creatures, but not divine.",
      "The Dormition of the Theotokos is celebrated on August 15.",
      "The Akathist Hymn to the Theotokos is one of the great liturgical poems of the Church."],
     ["Luke 1:28","Luke 1:42-43","Revelation 12:1"]],
  ],
  "ethics": [
    ["The Image of God & Human Dignity",
     "Every human being is created in the image (eikon) of God and bears an inherent, inviolable dignity. The distinction between 'image' and 'likeness' is significant: the image is given and cannot be destroyed; the likeness is the goal — theosis.",
     ["The image includes reason, freedom, creativity, and the capacity for communion with God.",
      "Sin damages but does not destroy the image.",
      "Every act of cruelty toward another human being is an offense against the image of God.",
      "The Incarnation is the ultimate affirmation of human dignity."],
     ["Genesis 1:26-27","Psalm 8:5","1 Corinthians 6:19-20"]],
    ["Fasting",
     "Fasting is one of the three pillars of Orthodox ascetic life (alongside prayer and almsgiving). The Orthodox fasting tradition encompasses approximately 180 days of the year.",
     ["Fasting involves abstaining from meat, dairy, fish, oil, and wine to varying degrees.",
      "The purpose is training the will, purifying the senses, and creating space for prayer and compunction.",
      "Christ fasted 40 days in the wilderness and assumed His disciples would fast: 'When you fast…'",
      "Fasting must be accompanied by charity — otherwise it is mere dieting."],
     ["Matthew 6:16-18","Isaiah 58:3-7","Matthew 4:2"]],
    ["Marriage & Family",
     "Orthodox Christian marriage is a Holy Mystery — a sacramental union of one man and one woman that is an icon of Christ's relationship with the Church.",
     ["The crowning ceremony is the central rite of the Orthodox wedding — the couple are crowned as king and queen of their household.",
      "Divorce is permitted reluctantly in cases of adultery, and remarriage is allowed with penitential prayers.",
      "The family is called the 'little church' (ekklesia kat' oikon)."],
     ["Ephesians 5:22-33","Genesis 2:24","John 2:1-11"]],
  ]
};

function buildOcNav() {
  const list = document.getElementById("oc-list");
  list.innerHTML = "";
  for (const [catKey, catLabel] of Object.entries(ORTHODOX_CATEGORIES)) {
    const h = document.createElement("div");
    h.className = "oc-heading";
    h.textContent = catLabel;
    h.onclick = () => showOcCategory(catKey, catLabel);
    list.appendChild(h);
    const entries = ORTHODOX_DB[catKey] || [];
    for (let i = 0; i < entries.length; i++) {
      const item = document.createElement("div");
      item.className = "oc-item";
      item.id = `oc-item-${catKey}-${i}`;
      item.textContent = entries[i][0];
      item.onclick = () => showOcEntry(catKey, i, item);
      list.appendChild(item);
    }
  }
}

function showOcCategory(catKey, catLabel) {
  document.querySelectorAll(".oc-item").forEach(el => el.classList.remove("active"));
  document.getElementById("oc-title").textContent = catLabel;
  const entries = ORTHODOX_DB[catKey] || [];
  let html = `<span class="section-hdr">Topics in this section:</span><span class="divider">────────────────────────</span>`;
  for (const e of entries) html += `<span class="bullet">${escHtml(e[0])}</span>`;
  document.getElementById("oc-text").innerHTML = html;
}

function showOcEntry(catKey, idx, el) {
  document.querySelectorAll(".oc-item").forEach(e => e.classList.remove("active"));
  if (el) el.classList.add("active");
  const entry = ORTHODOX_DB[catKey][idx];
  const [title, intro, bullets, scriptures] = [entry[0], entry[1], entry[2], entry[3]||[]];
  document.getElementById("oc-title").textContent = title;
  let html = `<span class="intro">${escHtml(intro)}</span>`;
  if (bullets.length) {
    html += `<span class="section-hdr">KEY POINTS</span><span class="divider">────────────────────────</span>`;
    for (const b of bullets) html += `<span class="bullet">${escHtml(b)}</span>`;
  }
  if (scriptures.length) {
    html += `<span class="section-hdr">SCRIPTURE REFERENCES</span><span class="divider">────────────────────────</span>`;
    html += `<span class="scripture-ref">${scriptures.map(escHtml).join("  ·  ")}</span>`;
  }
  document.getElementById("oc-text").innerHTML = html;
}

async function runOwSearch() {
  const q = document.getElementById("ow-entry").value.trim();
  if (!q) return;
  document.getElementById("oc-title").textContent = `OrthodoxWiki: ${q}`;
  document.getElementById("oc-text").innerHTML =
    `<span class="loading"><span class="spinner"></span> Fetching OrthodoxWiki article for "${escHtml(q)}"…</span>`;
  try {
    const data = await apiFetch(`/api/orthodoxwiki?q=${encodeURIComponent(q)}`);
    if (!data.text) {
      document.getElementById("oc-text").innerHTML =
        `<span class="loading">No article found for "${escHtml(q)}".<br><br>Try a different spelling or more specific term.</span>`;
      return;
    }
    let text = data.text, src = "";
    if (text.includes("\n\nSource: ")) {
      [text, src] = text.split("\n\nSource: ");
    }
    let html = `<span class="section-hdr">ORTHODOXWIKI ARTICLE</span><span class="divider">────────────────────────</span>`;
    for (const para of text.split("\n\n")) {
      if (para.trim()) html += `<span class="wiki-body">${escHtml(para.trim())}</span>`;
    }
    if (src) html += `<span class="wiki-src">Source: <a href="${escHtml(src.trim())}" target="_blank" style="color:var(--blue)">${escHtml(src.trim())}</a></span>`;
    document.getElementById("oc-text").innerHTML = html;
  } catch(e) {
    document.getElementById("oc-text").innerHTML =
      '<span class="loading">Could not reach OrthodoxWiki. Check your internet connection.</span>';
  }
}

// ═══════════════════════════════════════════════════
// READING PLANS
// ═══════════════════════════════════════════════════
const READING_PLANS = {
  "90day": {
    name: "90-Day Bible",
    desc: "Read through the entire Bible in 90 days.",
    days: (() => {
      const s = [
        "Genesis 1–3","Genesis 4–7","Genesis 8–11","Genesis 12–15","Genesis 16–19","Genesis 20–23",
        "Genesis 24–27","Genesis 28–31","Genesis 32–36","Genesis 37–41","Genesis 42–46","Genesis 47–50",
        "Exodus 1–5","Exodus 6–10","Exodus 11–15","Exodus 16–20","Exodus 21–25","Exodus 26–30",
        "Exodus 31–35","Exodus 36–40","Leviticus 1–7","Leviticus 8–14","Leviticus 15–20","Leviticus 21–27",
        "Numbers 1–4","Numbers 5–9","Numbers 10–14","Numbers 15–19","Numbers 20–25","Numbers 26–30",
        "Numbers 31–36","Deuteronomy 1–4","Deuteronomy 5–9","Deuteronomy 10–14","Deuteronomy 15–20",
        "Deuteronomy 21–26","Deuteronomy 27–34","Joshua 1–7","Joshua 8–14","Joshua 15–21",
        "Joshua 22–24 / Judges 1–3","Judges 4–9","Judges 10–16","Judges 17–21 / Ruth",
        "1 Samuel 1–7","1 Samuel 8–14","1 Samuel 15–20","1 Samuel 21–27","1 Samuel 28–31 / 2 Samuel 1–3",
        "2 Samuel 4–10","2 Samuel 11–17","2 Samuel 18–24","Psalms 1–15","Psalms 16–30","Psalms 31–45",
        "Psalms 46–60","Psalms 61–75","Psalms 76–90","Psalms 91–106","Psalms 107–119","Psalms 120–150",
        "Proverbs 1–9","Proverbs 10–20","Proverbs 21–31 / Eccl","Isaiah 1–12","Isaiah 13–27",
        "Isaiah 28–39","Isaiah 40–52","Isaiah 53–66","Jeremiah 1–12","Jeremiah 13–25","Jeremiah 26–38",
        "Jeremiah 39–52","Ezekiel 1–13","Ezekiel 14–26","Ezekiel 27–39","Ezekiel 40–48",
        "Daniel / Minor Prophets","Hosea–Micah","Nahum–Malachi","Matthew 1–7","Matthew 8–14",
        "Matthew 15–21","Matthew 22–28","Mark 1–8","Mark 9–16","Luke 1–6","Luke 7–13","Luke 14–24",
        "John 1–7","John 8–14","John 15–21 / Acts 1–3","Acts 4–12","Acts 13–21",
        "Acts 22–28 / Romans 1–4","Romans 5–16","1 Corinthians","2 Cor / Galatians","Ephesians–Colossians",
        "1–2 Thess / Pastorals","Philemon–Hebrews","James–2 Peter","1–3 John / Jude","Revelation 1–11","Revelation 12–22",
      ];
      return s.map((lbl,i)=>{const r=lbl.split("/")[0].trim(); return {day:`Day ${i+1}`,label:lbl,ref:r};});
    })()
  },
  "psalms_proverbs": {
    name: "Psalms & Proverbs",
    desc: "30 days through Psalms and Proverbs — 5 Psalms + 1 Proverbs chapter daily.",
    days: Array.from({length:30},(_,i)=>({day:`Day ${i+1}`,label:`Psalms ${i*5+1}–${i*5+5} · Proverbs ${i+1}`,ref:`Psalms ${i*5+1}`}))
  },
  "gospels": {
    name: "The Four Gospels",
    desc: "89 days through Matthew, Mark, Luke, and John.",
    days: [
      ...Array.from({length:28},(_,i)=>({day:`Day ${i+1}`,label:`Matthew ${i+1}`,ref:`Matthew ${i+1}`})),
      ...Array.from({length:16},(_,i)=>({day:`Day ${i+29}`,label:`Mark ${i+1}`,ref:`Mark ${i+1}`})),
      ...Array.from({length:24},(_,i)=>({day:`Day ${i+45}`,label:`Luke ${i+1}`,ref:`Luke ${i+1}`})),
      ...Array.from({length:21},(_,i)=>({day:`Day ${i+69}`,label:`John ${i+1}`,ref:`John ${i+1}`})),
    ]
  },
  "nt_30": {
    name: "New Testament in 30 Days",
    desc: "A fast-paced journey through the entire New Testament.",
    days: [
      {day:"Day 1",label:"Matthew 1–7",ref:"Matthew 1"},{day:"Day 2",label:"Matthew 8–14",ref:"Matthew 8"},
      {day:"Day 3",label:"Matthew 15–21",ref:"Matthew 15"},{day:"Day 4",label:"Matthew 22–28",ref:"Matthew 22"},
      {day:"Day 5",label:"Mark 1–8",ref:"Mark 1"},{day:"Day 6",label:"Mark 9–16",ref:"Mark 9"},
      {day:"Day 7",label:"Luke 1–6",ref:"Luke 1"},{day:"Day 8",label:"Luke 7–13",ref:"Luke 7"},
      {day:"Day 9",label:"Luke 14–20",ref:"Luke 14"},{day:"Day 10",label:"Luke 21–24",ref:"Luke 21"},
      {day:"Day 11",label:"John 1–7",ref:"John 1"},{day:"Day 12",label:"John 8–14",ref:"John 8"},
      {day:"Day 13",label:"John 15–21",ref:"John 15"},{day:"Day 14",label:"Acts 1–7",ref:"Acts 1"},
      {day:"Day 15",label:"Acts 8–14",ref:"Acts 8"},{day:"Day 16",label:"Acts 15–21",ref:"Acts 15"},
      {day:"Day 17",label:"Acts 22–28",ref:"Acts 22"},{day:"Day 18",label:"Romans",ref:"Romans 1"},
      {day:"Day 19",label:"1 Corinthians",ref:"1 Corinthians 1"},{day:"Day 20",label:"2 Cor / Galatians",ref:"Galatians 1"},
      {day:"Day 21",label:"Eph / Phil / Col",ref:"Colossians 1"},{day:"Day 22",label:"1–2 Thess",ref:"2 Thessalonians 1"},
      {day:"Day 23",label:"1–2 Tim / Titus",ref:"Titus 1"},{day:"Day 24",label:"Philemon / Heb 1–7",ref:"Hebrews 1"},
      {day:"Day 25",label:"Hebrews 8–13",ref:"Hebrews 8"},{day:"Day 26",label:"James / 1 Peter",ref:"1 Peter 1"},
      {day:"Day 27",label:"2 Peter / 1–3 John",ref:"1 John 1"},{day:"Day 28",label:"Jude / Rev 1–7",ref:"Revelation 1"},
      {day:"Day 29",label:"Revelation 8–16",ref:"Revelation 8"},{day:"Day 30",label:"Revelation 17–22",ref:"Revelation 17"},
    ]
  }
};

async function loadPlan(planId) {
  activePlan = planId;
  Object.keys(READING_PLANS).forEach(pid => {
    document.getElementById(`plan-radio-${pid}`)?.classList.toggle("active", pid===planId);
  });
  const plan     = READING_PLANS[planId];
  const progress = await apiFetch(`/api/progress/${planId}`).catch(()=>({}));
  const completed = Object.values(progress).filter(Boolean).length;
  document.getElementById("plan-progress").textContent =
    `${completed} / ${plan.days.length} days complete${completed===plan.days.length?" ✅ Finished!":""}`;

  const list = document.getElementById("plan-list");
  list.innerHTML = "";
  plan.days.forEach((d, i) => {
    const dayNum = i + 1;
    const done   = progress[dayNum] || false;
    const div    = document.createElement("div");
    div.className = "plan-day" + (done ? " done" : "");
    div.innerHTML = `<div class="plan-day-check${done?" done":""}">${done?"✓":""}</div>
<span class="plan-day-lbl">${d.day}</span>
<span class="plan-day-text">${escHtml(d.label)}</span>`;
    div.addEventListener("click", async () => {
      await apiPost(`/api/progress/${planId}`, {day: dayNum, completed: !done});
      document.getElementById("verse-input").value = d.ref;
      goSearch();
      switchTab("study");
      setTimeout(() => loadPlan(planId), 100);
    });
    list.appendChild(div);
  });
}

async function resetPlan() {
  if (confirm(`Reset progress for "${READING_PLANS[activePlan].name}"?`)) {
    await apiDelete(`/api/progress/${activePlan}`);
    loadPlan(activePlan);
  }
}

// ═══════════════════════════════════════════════════
// BOOKMARKS
// ═══════════════════════════════════════════════════
async function saveBookmark() {
  if (!currentVerse) { alert("Search for a verse first."); return; }
  const note = document.getElementById("bk-note").value.trim();
  await apiPost("/api/bookmarks", {
    book:    currentVerse.book,
    chapter: currentVerse.chapter,
    verse:   currentVerse.verse,
    note
  });
  document.getElementById("bk-note").value = "";
  setStatus(`🔖 Saved ${currentVerse.book} ${currentVerse.chapter}:${currentVerse.verse}`);
  renderBookmarks();
}

async function renderBookmarks() {
  try {
    const rows = await apiFetch("/api/bookmarks");
    if (!rows.length) {
      document.getElementById("bk-text").innerHTML =
        '<span class="loading">No bookmarks yet. Search for a verse and click "Bookmark Current Verse".</span>';
      return;
    }
    let html = "";
    for (const b of rows) {
      html += `<span class="bk-ref" onclick="openBookmark('${escAttr(b.book)}',${b.chapter},${b.verse})">${escHtml(b.book)} ${b.chapter}:${b.verse}</span>`;
      if (b.verse_text) {
        const snip = b.verse_text.length > 120 ? b.verse_text.slice(0,120)+"…" : b.verse_text;
        html += `<span class="bk-verse">${escHtml(snip)}</span>`;
      }
      if (b.note) html += `<span class="bk-note">📝 ${escHtml(b.note)}</span>`;
      html += `<span class="bk-date">${b.created_at||""}</span>`;
      html += `<span class="bk-del" onclick="deleteBookmark(${b.id})">🗑 Delete</span><br>`;
    }
    document.getElementById("bk-text").innerHTML = html;
  } catch(e) {
    document.getElementById("bk-text").innerHTML =
      '<span class="loading">Could not load bookmarks. Is the server running?</span>';
  }
}

function openBookmark(book, chapter, verse) {
  document.getElementById("verse-input").value = `${book} ${chapter}:${verse}`;
  goSearch();
  switchTab("study");
}

async function deleteBookmark(id) {
  await apiDelete(`/api/bookmarks/${id}`);
  renderBookmarks();
}

// ═══════════════════════════════════════════════════
// COMPARE
// ═══════════════════════════════════════════════════
function toggleCmpSrc(el) {
  const src = el.dataset.src;
  if (cmpActiveSrcs.has(src)) { cmpActiveSrcs.delete(src); el.classList.remove("active"); }
  else { cmpActiveSrcs.add(src); el.classList.add("active"); }
}

async function compareCurrent() {
  if (!currentVerse) { alert("Search for a verse first."); return; }
  document.getElementById("cmp-entry").value =
    `${currentVerse.book} ${currentVerse.chapter}:${currentVerse.verse}`;
  runCompare();
}

async function runCompare() {
  const ref = document.getElementById("cmp-entry").value.trim();
  const parts = ref.match(/^(.+?)\s+(\d+):(\d+)$/);
  if (!parts) {
    document.getElementById("cmp-text").innerHTML =
      '<span class="loading">Please enter a specific verse — e.g. John 3:16</span>';
    return;
  }
  const [,book, chStr, vsStr] = parts;
  const chapter = parseInt(chStr), verse = parseInt(vsStr);

  document.getElementById("cmp-text").innerHTML =
    `<span class="loading"><span class="spinner"></span> Loading translations for ${escHtml(ref)}…</span>`;

  try {
    const rows = await apiFetch(
      `/api/translations?book=${encodeURIComponent(book)}&chapter=${chapter}&verse=${verse}`
    );
    if (!rows.length) {
      document.getElementById("cmp-text").innerHTML =
        `<span class="loading">No data found for ${escHtml(ref)}.</span>`;
      return;
    }
    // Filter to selected sources
    const available = {};
    for (const r of rows) {
      if (cmpActiveSrcs.has(r.source)) available[r.source] = r.text;
    }
    const display = Object.keys(available).length ? available
      : Object.fromEntries(rows.map(r=>[r.source, r.text]));

    // Word frequency for diff highlighting
    const engSrcs = Object.entries(display).filter(([s]) => ["kjv","tanakh_english"].includes(s));
    const wordFreq = {};
    for (const [,txt] of engSrcs)
      for (const w of new Set(txt.toLowerCase().match(/[\w']+/g)||[]))
        wordFreq[w] = (wordFreq[w]||0) + 1;
    const nEng = Math.max(engSrcs.length, 1);

    let html = `<span class="ch-title">${escHtml(ref)}</span>`;
    html += `<span style="display:block;border-top:1px solid var(--border);margin:8px 0 12px"></span>`;

    for (const src of SOURCE_ORDER) {
      if (!display[src]) continue;
      const isOrig = ["tanakh_hebrew","septuagint","textus_receptus","vulgate"].includes(src);
      html += `<span class="cmp-src">${escHtml(SOURCE_LABELS[src]||src)}</span>`;
      if (isOrig) {
        html += `<span class="cmp-text" style="color:var(--green)">${escHtml(display[src])}</span>`;
      } else {
        // Highlight words unique to this translation
        const words = display[src].match(/[\w']+|[^\w']+/g) || [];
        let line = '<span class="cmp-text">';
        for (const chunk of words) {
          const w = chunk.toLowerCase().replace(/^'|'$/g,"");
          if (/[\w']/.test(chunk) && w && (wordFreq[w]||0) < nEng) {
            line += `<span style="color:#ffd700;font-weight:600">${escHtml(chunk)}</span>`;
          } else {
            line += escHtml(chunk);
          }
        }
        line += '</span>';
        html += line;
      }
    }
    if (engSrcs.length > 1)
      html += `<span style="color:var(--dim);font-size:11px;display:block;margin-top:10px">Gold = word appears in fewer translations</span>`;

    document.getElementById("cmp-text").innerHTML = html;
  } catch(e) {
    document.getElementById("cmp-text").innerHTML =
      '<span class="loading">Error loading translations. Is the server running?</span>';
  }
}

// ═══════════════════════════════════════════════════
// DAILY VERSE
// ═══════════════════════════════════════════════════
const DAILY_VERSES = [
  ["Genesis 1:1","The opening of all creation — the Word that called light and life into being."],
  ["Genesis 1:27","Every human person is made in the image and likeness of the living God."],
  ["Genesis 3:15","The Protoevangelium — the first promise of a Redeemer, spoken to the serpent."],
  ["Genesis 22:8","Abraham's answer of faith on Mount Moriah, foreshadowing the Lamb of God."],
  ["Exodus 3:14","The divine Name revealed — 'I AM WHO I AM' — the ground of all existence."],
  ["Exodus 14:14","The Lord will fight for you. You need only be still."],
  ["Deuteronomy 6:4","The Shema — the foundational confession of Israel: the LORD our God is one LORD."],
  ["Joshua 24:15","As for me and my house, we will serve the LORD."],
  ["Ruth 1:16","Ruth's declaration of loyalty and love — a model of faithful covenant."],
  ["1 Samuel 16:7","Man looks at the outward appearance, but the LORD looks at the heart."],
  ["1 Kings 19:12","God speaks not in earthquake or fire, but in a still, small voice."],
  ["Psalm 1:1","Blessed is the man who walks not in the counsel of the ungodly."],
  ["Psalm 8:4","What is man that You are mindful of him? The wonder of human dignity."],
  ["Psalm 19:1","The heavens declare the glory of God — creation as continuous doxology."],
  ["Psalm 22:1","My God, my God, why have You forsaken me — the opening of the Passion Psalm."],
  ["Psalm 23:1","The LORD is my shepherd — perhaps the best-loved verse in all of Scripture."],
  ["Psalm 23:4","Even in the valley of the shadow of death, I will fear no evil."],
  ["Psalm 27:1","The LORD is my light and my salvation — whom shall I fear?"],
  ["Psalm 34:8","O taste and see that the LORD is good — an invitation to experience God."],
  ["Psalm 46:1","God is our refuge and strength, a very present help in trouble."],
  ["Psalm 46:10","Be still and know that I am God — the call to hesychia."],
  ["Psalm 51:1","Have mercy on me, O God — David's great psalm of repentance."],
  ["Psalm 63:1","O God, You are my God. Earnestly I seek You. My soul thirsts for You."],
  ["Psalm 91:1","He who dwells in the shelter of the Most High will rest in the shadow of the Almighty."],
  ["Psalm 103:1","Bless the LORD, O my soul, and all that is within me, bless His holy name."],
  ["Psalm 119:105","Your word is a lamp to my feet and a light to my path."],
  ["Psalm 139:1","O LORD, you have searched me and known me."],
  ["Proverbs 1:7","The fear of the LORD is the beginning of wisdom."],
  ["Proverbs 3:5","Trust in the LORD with all your heart, and lean not on your own understanding."],
  ["Proverbs 4:23","Above all else, guard your heart, for it is the wellspring of life."],
  ["Isaiah 6:8","I heard the voice of the Lord: 'Whom shall I send?' I said, 'Here I am. Send me.'"],
  ["Isaiah 40:31","Those who wait upon the LORD shall renew their strength — they shall mount up with wings."],
  ["Isaiah 41:10","Fear not, for I am with you. Be not dismayed, for I am your God."],
  ["Isaiah 53:5","He was wounded for our transgressions. With His stripes we are healed."],
  ["Isaiah 55:8","My thoughts are not your thoughts, neither are your ways my ways, declares the LORD."],
  ["Jeremiah 29:11","I know the plans I have for you — plans for welfare and not for evil."],
  ["Lamentations 3:22","The steadfast love of the LORD never ceases. His mercies never come to an end."],
  ["Ezekiel 36:26","I will give you a new heart, and a new spirit I will put within you."],
  ["Micah 6:8","What does the LORD require of you but to do justice, love kindness, and walk humbly with God?"],
  ["Matthew 5:3","Blessed are the poor in spirit, for theirs is the kingdom of heaven."],
  ["Matthew 5:8","Blessed are the pure in heart, for they shall see God."],
  ["Matthew 5:44","Love your enemies and pray for those who persecute you."],
  ["Matthew 5:48","Be perfect, as your heavenly Father is perfect — the call to theosis."],
  ["Matthew 6:9","Our Father in heaven, hallowed be Your name — the Lord's Prayer begins."],
  ["Matthew 6:33","Seek first the kingdom of God and His righteousness, and all these things will be added."],
  ["Matthew 11:28","Come to me, all who labor and are heavy laden, and I will give you rest."],
  ["Matthew 25:40","Whatever you do to the least of these my brothers, you have done it to me."],
  ["John 1:1","In the beginning was the Word, and the Word was with God, and the Word was God."],
  ["John 1:14","The Word became flesh and dwelt among us — the Incarnation."],
  ["John 3:16","For God so loved the world that He gave His only Son."],
  ["John 6:35","I am the bread of life; whoever comes to me shall not hunger."],
  ["John 8:12","I am the light of the world. Whoever follows me will not walk in darkness."],
  ["John 10:10","I came that they may have life and have it abundantly."],
  ["John 11:25","I am the resurrection and the life."],
  ["John 13:34","A new commandment I give to you: love one another as I have loved you."],
  ["John 14:6","I am the way, and the truth, and the life."],
  ["John 15:5","I am the vine; you are the branches. Whoever abides in me bears much fruit."],
  ["Romans 8:28","We know that all things work together for good for those who love God."],
  ["Romans 8:38","Nothing in all creation will be able to separate us from the love of God."],
  ["1 Corinthians 13:13","And now these three remain: faith, hope and love. But the greatest is love."],
  ["Ephesians 2:8","For by grace you have been saved through faith. And this is not your own doing."],
  ["Philippians 4:7","The peace of God, which surpasses all understanding, will guard your hearts."],
  ["Philippians 4:13","I can do all things through Christ who strengthens me."],
  ["2 Timothy 3:16","All Scripture is breathed out by God and profitable for teaching."],
  ["Hebrews 11:1","Now faith is the assurance of things hoped for, the conviction of things not seen."],
  ["James 1:5","If any of you lacks wisdom, let him ask God who gives generously."],
  ["1 Peter 5:7","Cast all your anxieties on him, because he cares for you."],
  ["1 John 4:8","Anyone who does not love does not know God, because God is love."],
  ["Revelation 21:4","He will wipe away every tear from their eyes. Death shall be no more."],
  ["Revelation 22:20","Amen. Come, Lord Jesus — the great prayer of the Church."],
];

async function renderDailyVerse() {
  const [ref, reflection] = DAILY_VERSES[dvIndex % DAILY_VERSES.length];
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});

  document.getElementById("dv-text").innerHTML =
    `<span class="dv-date">${dateStr} · Day ${(dvIndex%DAILY_VERSES.length)+1} of ${DAILY_VERSES.length}</span>
<span class="dv-ref" onclick="openDailyVerse()">${escHtml(ref)}</span>
<span class="loading" style="padding:4px 0"><span class="spinner"></span> Loading verse text…</span>`;

  // Fetch verse text from DB
  const parsed = ref.match(/^(.+?)\s+(\d+):(\d+)$/);
  let verseText = "";
  if (parsed) {
    try {
      const data = await apiFetch(`/api/verse?book=${encodeURIComponent(parsed[1])}&chapter=${parsed[2]}&verse=${parsed[3]}`);
      verseText = data.text || "";
    } catch(e) {}
  }

  let html = `<span class="dv-date">${dateStr} · Day ${(dvIndex%DAILY_VERSES.length)+1} of ${DAILY_VERSES.length}</span>`;
  html += `<span class="dv-ref" onclick="openDailyVerse()">${escHtml(ref)}</span>`;
  if (verseText) html += `<span class="dv-verse">\u201c${escHtml(verseText)}\u201d</span>`;
  html += `<span style="display:block;border-top:1px solid var(--border);margin:12px 0 8px"></span>`;
  html += `<span class="section-hdr">REFLECTION</span>`;
  html += `<span class="dv-reflect">${escHtml(reflection)}</span>`;

  // Browse all verses list
  html += `<span class="section-hdr" style="margin-top:24px">ALL ${DAILY_VERSES.length} VERSES</span>`;
  html += `<span style="display:block;border-top:1px solid var(--border);margin:4px 0 10px"></span>`;
  for (let i = 0; i < DAILY_VERSES.length; i++) {
    const [vRef, vRefl] = DAILY_VERSES[i];
    html += `<span class="dv-list-ref" onclick="dvGoTo(${i})">${i===dvIndex%DAILY_VERSES.length?"▶ ":""}Day ${i+1}  ${escHtml(vRef)}</span>`;
    html += `<span class="dv-list-refl">${escHtml(vRefl)}</span>`;
  }
  document.getElementById("dv-text").innerHTML = html;
}

function dvGoTo(i) { dvIndex = i; renderDailyVerse(); }
function dvPrev()  { dvIndex = (dvIndex - 1 + DAILY_VERSES.length) % DAILY_VERSES.length; renderDailyVerse(); }
function dvNext()  { dvIndex = (dvIndex + 1) % DAILY_VERSES.length; renderDailyVerse(); }
function dvToday() {
  const d = new Date();
  dvIndex  = Math.floor((d - new Date(d.getFullYear(),0,0)) / 86400000) % DAILY_VERSES.length;
  renderDailyVerse();
}
function openDailyVerse() {
  const [ref] = DAILY_VERSES[dvIndex % DAILY_VERSES.length];
  document.getElementById("verse-input").value = ref;
  goSearch();
  switchTab("study");
}

// ═══════════════════════════════════════════════════
// CROSS REFERENCES
// ═══════════════════════════════════════════════════
function xrefsUseCurrent() {
  if (!currentVerse) { alert("Search for a verse first."); return; }
  document.getElementById("xr-entry").value =
    `${currentVerse.book} ${currentVerse.chapter}:${currentVerse.verse}`;
  runXrefs();
}

async function runXrefs() {
  const ref = document.getElementById("xr-entry").value.trim();
  const parts = ref.match(/^(.+?)\s+(\d+):(\d+)$/);
  if (!parts) {
    document.getElementById("xr-text").innerHTML =
      '<span class="loading">Please enter a specific verse — e.g. Romans 8:28</span>';
    return;
  }
  const [,book, chStr, vsStr] = parts;
  document.getElementById("xr-lbl").textContent = ref;
  document.getElementById("xr-text").innerHTML =
    `<span class="loading"><span class="spinner"></span> Fetching cross-references for ${escHtml(ref)}… (requires internet)</span>`;

  try {
    const data = await apiFetch(
      `/api/xrefs?book=${encodeURIComponent(book)}&chapter=${chStr}&verse=${vsStr}`
    );
    let html = "";
    if (data.src_text) {
      html += `<span class="section-hdr">SOURCE VERSE</span>`;
      html += `<span style="display:block;border-top:1px solid var(--border);margin:4px 0 8px"></span>`;
      html += `<span class="xref-text" style="display:block;font-style:italic;color:var(--fg2);margin-bottom:16px">\u201c${escHtml(data.src_text)}\u201d</span>`;
    }
    if (!data.xrefs || !data.xrefs.length) {
      html += '<span class="loading">No cross-references found. This may be due to network issues.</span>';
      document.getElementById("xr-text").innerHTML = html;
      return;
    }
    html += `<span class="section-hdr">CROSS-REFERENCES (${data.xrefs.length})</span>`;
    html += `<span style="display:block;border-top:1px solid var(--border);margin:4px 0 10px"></span>`;
    for (const xr of data.xrefs) {
      html += `<span class="xref-ref" onclick="document.getElementById('verse-input').value='${escAttr(xr.ref)}';goSearch();switchTab('study')">${escHtml(xr.ref)}</span>`;
      if (xr.text) html += `<span class="xref-text">${escHtml(xr.text)}</span>`;
    }
    html += `<span class="dim" style="margin-top:12px;display:block">Click any reference to open it in the Scripture panel.</span>`;
    document.getElementById("xr-text").innerHTML = html;
  } catch(e) {
    document.getElementById("xr-text").innerHTML =
      '<span class="loading">Error fetching cross-references. Is the server running?</span>';
  }
}

// ═══════════════════════════════════════════════════
// CHAPTER OVERVIEW
// ═══════════════════════════════════════════════════
function overviewUseCurrent() {
  if (!currentVerse) { alert("Search for a verse first."); return; }
  document.getElementById("ov-entry").value =
    `${currentVerse.book} ${currentVerse.chapter}`;
  runOverview();
}

async function runOverview() {
  const ref = document.getElementById("ov-entry").value.trim();
  const parts = ref.match(/^(.+?)\s+(\d+)$/);
  if (!parts) {
    document.getElementById("ov-text").innerHTML =
      '<span class="loading">Please enter a book and chapter — e.g. Psalm 23</span>';
    return;
  }
  const [,book, chStr] = parts;
  document.getElementById("ov-lbl").textContent = ref;
  document.getElementById("ov-text").innerHTML =
    `<span class="loading"><span class="spinner"></span> Analysing ${escHtml(ref)}…</span>`;

  try {
    const data = await apiFetch(`/api/overview?book=${encodeURIComponent(book)}&chapter=${chStr}`);
    if (!data || !data.verse_count) {
      document.getElementById("ov-text").innerHTML =
        `<span class="loading">No data found for ${escHtml(ref)}. Check the book name and chapter number.</span>`;
      return;
    }
    let html = `<span class="ch-title">${escHtml(book)} ${chStr}</span>`;
    const meta = [data.testament, data.section].filter(Boolean);
    if (meta.length) html += `<span style="color:var(--dim);font-size:12px;display:block;margin-bottom:4px">${escHtml(meta.join(" · "))}</span>`;
    if (data.book_desc) html += `<span class="dim">${escHtml(data.book_desc)}</span>`;

    html += `<span class="section-hdr">AT A GLANCE</span>`;
    html += `<span style="display:block;border-top:1px solid var(--border);margin:4px 0 8px"></span>`;
    html += `<span class="stat-key">Verses: </span><span class="stat-val">${data.verse_count}</span><br>`;
    if (data.first_verse) {
      html += `<br><span style="font-size:12px;color:var(--dim);display:block;margin-bottom:4px">Opening verse:</span>`;
      html += `<span class="first-verse">\u201c${escHtml(data.first_verse)}\u201d</span>`;
    }
    if (data.themes && data.themes.length) {
      html += `<span class="section-hdr">KEY THEMES</span>`;
      html += `<span style="display:block;border-top:1px solid var(--border);margin:4px 0 8px"></span>`;
      for (const t of data.themes) html += `<span class="theme">• ${escHtml(t)}</span>`;
    }
    if (data.top_names && data.top_names.length) {
      html += `<span class="section-hdr">NOTABLE NAMES & WORDS</span>`;
      html += `<span style="display:block;border-top:1px solid var(--border);margin:4px 0 8px"></span>`;
      html += `<span class="name">${data.top_names.map(escHtml).join("  ·  ")}</span>`;
    }
    html += `<span class="section-hdr" style="margin-top:16px">VERSE NAVIGATOR  (click to jump)</span>`;
    html += `<span style="display:block;border-top:1px solid var(--border);margin:4px 0 8px"></span>`;
    for (const [vsNum, vsSnip] of data.verses) {
      html += `<span class="vs-num" onclick="document.getElementById('verse-input').value='${escAttr(book+' '+chStr+':'+vsNum)}';goSearch();switchTab('study')">${vsNum}</span> <span class="vs-snip">${escHtml(vsSnip)}</span><br>`;
    }
    document.getElementById("ov-text").innerHTML = html;
  } catch(e) {
    document.getElementById("ov-text").innerHTML =
      '<span class="loading">Error loading overview. Is the server running?</span>';
  }
}

// ═══════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════
function switchTab(key) {
  const keys = ["study","bsearch","orthodox","plans","bookmarks","compare","daily","xrefs","overview"];
  document.querySelectorAll(".tab-btn").forEach((btn,i) => btn.classList.toggle("active", keys[i]===key));
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.toggle("active", p.id===`tab-${key}`));
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════
function setStatus(html) { document.getElementById("status").innerHTML = html; }
function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function escAttr(s) { return String(s).replace(/'/g,"\\'"); }
function hideTooltip() { document.getElementById("tooltip").style.display = "none"; }
function showPlaceholderStudy() {
  document.getElementById("study-text").innerHTML =
    "<span class=\"loading\">Click any word in the scripture panel to open its word study.</span>";
  document.getElementById("usages-text").innerHTML = "";
  document.getElementById("usages-count").textContent = "";
  document.getElementById("study-word-lbl").textContent = "";
  document.getElementById("usages-hdr").textContent = "USAGES ACROSS THE BIBLE";
}

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
buildOcNav();
loadPlan("90day");
renderBookmarks();
dvIndex = Math.floor((new Date() - new Date(new Date().getFullYear(),0,0)) / 86400000) % DAILY_VERSES.length;
renderDailyVerse();

document.getElementById("verse-input").addEventListener("keydown", e => { if (e.key==="Enter") goSearch(); });
document.getElementById("search-input").addEventListener("keydown", e => { if (e.key==="Enter") bibleSearch(); });
document.addEventListener("click", e => { if (!e.target.classList.contains("word-span")) hideTooltip(); });
