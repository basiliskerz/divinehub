// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
let CLAUDE_API_KEY = localStorage.getItem('claude_api_key') || '';
let currentVerse = null; // {book, chapter, verse, text}
let currentResults = null; // array of {source, text}
let alignmentGroups = [];
let alignmentTokenIndex = {};
let allUsages = [];
let currentWord = '';
let usageMode = 'all';
let bsFilter = 'all';
let bsAllResults = [];
let dvIndex = 0;
let activePlan = '90day';
let cmpActiveSrcs = new Set(['kjv','tanakh_english','septuagint','textus_receptus']);
let bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]');
let planProgress = JSON.parse(localStorage.getItem('planProgress') || '{}');

if (CLAUDE_API_KEY) document.getElementById('apikey').value = CLAUDE_API_KEY;

function updateApiKey(v) {
  CLAUDE_API_KEY = v.trim();
  localStorage.setItem('claude_api_key', CLAUDE_API_KEY);
}

// ═══════════════════════════════════════════════════
// BIBLE API (bible-api.com — free, no key needed)
// ═══════════════════════════════════════════════════
const TRANSLATIONS = {
  kjv: 'kjv',
  web: 'web', // World English Bible (open)
};

// Book slug map for BibleHub
const BOOK_SLUG = {
  "Genesis":"genesis","Exodus":"exodus","Leviticus":"leviticus","Numbers":"numbers",
  "Deuteronomy":"deuteronomy","Joshua":"joshua","Judges":"judges","Ruth":"ruth",
  "1 Samuel":"1_samuel","2 Samuel":"2_samuel","1 Kings":"1_kings","2 Kings":"2_kings",
  "1 Chronicles":"1_chronicles","2 Chronicles":"2_chronicles","Ezra":"ezra",
  "Nehemiah":"nehemiah","Esther":"esther","Job":"job","Psalms":"psalms","Psalm":"psalms",
  "Proverbs":"proverbs","Ecclesiastes":"ecclesiastes","Song of Solomon":"songs",
  "Isaiah":"isaiah","Jeremiah":"jeremiah","Lamentations":"lamentations",
  "Ezekiel":"ezekiel","Daniel":"daniel","Hosea":"hosea","Joel":"joel","Amos":"amos",
  "Obadiah":"obadiah","Jonah":"jonah","Micah":"micah","Nahum":"nahum",
  "Habakkuk":"habakkuk","Zephaniah":"zephaniah","Haggai":"haggai",
  "Zechariah":"zechariah","Malachi":"malachi",
  "Matthew":"matthew","Mark":"mark","Luke":"luke","John":"john","Acts":"acts",
  "Romans":"romans","1 Corinthians":"1_corinthians","2 Corinthians":"2_corinthians",
  "Galatians":"galatians","Ephesians":"ephesians","Philippians":"philippians",
  "Colossians":"colossians","1 Thessalonians":"1_thessalonians",
  "2 Thessalonians":"2_thessalonians","1 Timothy":"1_timothy","2 Timothy":"2_timothy",
  "Titus":"titus","Philemon":"philemon","Hebrews":"hebrews","James":"james",
  "1 Peter":"1_peter","2 Peter":"2_peter","1 John":"1_john","2 John":"2_john",
  "3 John":"3_john","Jude":"jude","Revelation":"revelation",
};

const OT_BOOKS = new Set([
  "Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth",
  "1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra",
  "Nehemiah","Esther","Job","Psalms","Psalm","Proverbs","Ecclesiastes","Song of Solomon",
  "Isaiah","Jeremiah","Lamentations","Ezekiel","Daniel","Hosea","Joel","Amos",
  "Obadiah","Jonah","Micah","Nahum","Habakkuk","Zephaniah","Haggai","Zechariah","Malachi"
]);

const SOURCE_LABELS = {
  "kjv":"English (KJV)", "tanakh_english":"English (Tanakh)", "tanakh_hebrew":"Hebrew (Masoretic)",
  "septuagint":"Greek (Septuagint)", "textus_receptus":"Greek (Textus Receptus)", "vulgate":"Latin (Vulgate)",
  "web":"English (WEB)"
};

function parseRef(ref) {
  ref = ref.trim();
  // Full: Genesis 1:1
  let m = ref.match(/^([1-3]?\s?[A-Za-z][A-Za-z ]+)\s+(\d+):(\d+)$/);
  if (m) return {book: m[1].trim(), chapter: parseInt(m[2]), verse: parseInt(m[3])};
  // Chapter: Genesis 1
  m = ref.match(/^([1-3]?\s?[A-Za-z][A-Za-z ]+)\s+(\d+)$/);
  if (m) return {book: m[1].trim(), chapter: parseInt(m[2]), verse: null};
  // Book: Genesis
  m = ref.match(/^([1-3]?\s?[A-Za-z][A-Za-z ]+)$/);
  if (m) return {book: m[1].trim(), chapter: null, verse: null};
  return null;
}

async function fetchVerses(book, chapter, verse) {
  // Use bible-api.com
  let query;
  if (verse) query = `${book} ${chapter}:${verse}`;
  else if (chapter) query = `${book} ${chapter}`;
  else query = book;

  const url = `https://bible-api.com/${encodeURIComponent(query)}?translation=kjv`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('API error');
    const data = await r.json();
    return data.verses || [];
  } catch(e) {
    return [];
  }
}

// ═══════════════════════════════════════════════════
// SEARCH / SCRIPTURE
// ═══════════════════════════════════════════════════
async function goSearch() {
  const raw = document.getElementById('verse-input').value.trim();
  const parsed = parseRef(raw);
  if (!parsed) {
    setStatus('❌ Invalid format. Try: Genesis 1:1 or Genesis 1 or Genesis');
    return;
  }
  setStatus('<span class="spinner"></span> Loading…');
  document.getElementById('scripture-body').innerHTML = '<div class="text-area loading" style="background:transparent;padding:40px 0">Loading scripture…</div>';
  alignmentGroups = []; alignmentTokenIndex = {}; currentWord = '';
  currentVerse = null; currentResults = null; allUsages = [];
  document.getElementById('study-word-lbl').textContent = '';

  const verses = await fetchVerses(parsed.book, parsed.chapter, parsed.verse);
  if (!verses.length) {
    document.getElementById('scripture-body').innerHTML = '<div class="text-area loading" style="background:transparent;padding:40px 0">No results found. Check the book name and chapter number.</div>';
    setStatus('❌ No results');
    return;
  }

  // Group by verse
  const grouped = {};
  for (const v of verses) {
    const key = `${v.book_name || parsed.book} ${v.chapter}:${v.verse}`;
    grouped[key] = {book: v.book_name || parsed.book, chapter: v.chapter, verse: v.verse, text: v.text.trim()};
  }

  currentResults = grouped;
  // Set currentVerse to first verse (or single verse)
  const keys = Object.keys(grouped);
  if (keys.length === 1) {
    currentVerse = grouped[keys[0]];
  } else if (parsed.verse) {
    const k = `${parsed.book} ${parsed.chapter}:${parsed.verse}`;
    currentVerse = grouped[k] || grouped[keys[0]];
  }

  renderScripture(grouped, parsed);
  setStatus('✅ Click any word for word study');

  if (CLAUDE_API_KEY && parsed.chapter && parsed.verse) {
    setStatus('⏳ Loading alignments…');
    fetchAlignment(parsed.book, parsed.chapter, parsed.verse, grouped[keys[0]]?.text || '');
  }

  showPlaceholderStudy();
  document.getElementById('scripture-ref-lbl').textContent = raw;
}

function renderScripture(grouped, parsed) {
  const body = document.getElementById('scripture-body');
  body.innerHTML = '';

  for (const [ref, v] of Object.entries(grouped)) {
    const hdr = document.createElement('div');
    hdr.className = 'verse-hdr';
    hdr.textContent = ref;
    body.appendChild(hdr);

    const hr = document.createElement('hr');
    hr.className = 'divider';
    body.appendChild(hr);

    // KJV line
    const srcLbl = document.createElement('span');
    srcLbl.className = 'src-lbl';
    srcLbl.textContent = 'English (KJV):';
    body.appendChild(srcLbl);

    const textDiv = document.createElement('div');
    textDiv.className = 'src-text';
    textDiv.dataset.book = v.book;
    textDiv.dataset.chapter = v.chapter;
    textDiv.dataset.verse = v.verse;
    textDiv.dataset.ref = ref;

    // Wrap each word in a span
    const words = v.text.split(/(\s+)/);
    for (const w of words) {
      if (/\S/.test(w)) {
        const span = document.createElement('span');
        span.className = 'word-span';
        span.textContent = w;
        span.dataset.word = w.replace(/[^a-zA-Z']/g,'');
        span.addEventListener('click', () => onWordClick(span, v));
        span.addEventListener('mouseover', () => onWordHover(span, v));
        span.addEventListener('mouseout', () => onWordOut());
        textDiv.appendChild(span);
      } else {
        textDiv.appendChild(document.createTextNode(w));
      }
    }
    body.appendChild(textDiv);
  }
}

function onWordClick(span, v) {
  const word = span.dataset.word;
  if (!word || word.length < 2) return;
  // Remove previous click highlights
  document.querySelectorAll('.word-span.clicked').forEach(s => s.classList.remove('clicked'));
  span.classList.add('clicked');
  currentWord = word;
  currentVerse = v;
  document.getElementById('study-word-lbl').textContent = `"${word}"`;
  document.getElementById('usages-hdr').textContent = `USAGES OF "${word.toUpperCase()}" ACROSS THE BIBLE`;
  switchTab('study');
  loadWordStudy(word, v);
}

function onWordHover(span, v) {
  if (!CLAUDE_API_KEY || !alignmentGroups.length) return;
  const word = span.dataset.word.toLowerCase();
  const token = cleanToken(word);
  const groupIds = alignmentTokenIndex[token] || [];
  if (!groupIds.length) { clearAlignmentHighlights(); hideTooltip(); return; }
  clearAlignmentHighlights();
  const tips = [];
  for (const gi of groupIds) {
    if (gi >= alignmentGroups.length) continue;
    const g = alignmentGroups[gi];
    const parts = [];
    for (const [lang, phrase] of Object.entries(g)) {
      highlightPhrase(phrase, lang);
      const labels = {kjv:'EN',hebrew:'HE',greek:'GR',latin:'LA'};
      parts.push(`${labels[lang]||lang.toUpperCase()}: ${phrase}`);
    }
    tips.push(parts.join('  |  '));
  }
  if (tips.length) showTooltip(tips.join('\n'), span);
}

function onWordOut() {
  clearAlignmentHighlights();
  hideTooltip();
}

function cleanToken(t) {
  return t.replace(/[^a-z\u0590-\u05FF\u1F00-\u1FFF\u0370-\u03FF]/g,'');
}

function clearAlignmentHighlights() {
  document.querySelectorAll('.word-span').forEach(s => {
    s.classList.remove('hl-hebrew','hl-greek','hl-latin','hl-kjv');
  });
}

function highlightPhrase(phrase, lang) {
  const cls = lang === 'hebrew' ? 'hl-hebrew' : lang === 'greek' ? 'hl-greek' : lang === 'latin' ? 'hl-latin' : 'hl-kjv';
  const spans = document.querySelectorAll('.word-span');
  const phraseWords = phrase.toLowerCase().split(/\s+/);
  for (const span of spans) {
    if (phraseWords.includes(span.dataset.word.toLowerCase())) {
      span.classList.add(cls);
    }
  }
}

function showTooltip(text, el) {
  const tt = document.getElementById('tooltip');
  tt.textContent = text;
  tt.style.display = 'block';
  const r = el.getBoundingClientRect();
  tt.style.left = Math.min(r.left, window.innerWidth - tt.offsetWidth - 10) + 'px';
  tt.style.top = (r.bottom + 6) + 'px';
}

function hideTooltip() {
  document.getElementById('tooltip').style.display = 'none';
}

// ═══════════════════════════════════════════════════
// BIBLE SEARCH (via API)
// ═══════════════════════════════════════════════════
async function bibleSearch() {
  const phrase = document.getElementById('search-input').value.trim();
  if (!phrase) return;
  switchTab('bsearch');
  document.getElementById('bs-entry').value = phrase;
  runBibleSearch();
}

async function runBibleSearch() {
  const phrase = document.getElementById('bs-entry').value.trim();
  if (!phrase) return;
  document.getElementById('bs-text').innerHTML = '<span class="loading"><span class="spinner"></span> Searching the Bible…</span>';
  document.getElementById('bs-count').textContent = '';

  // Use bible-api.com search
  const url = `https://bible-api.com/${encodeURIComponent(phrase)}?translation=kjv`;
  try {
    const r = await fetch(url);
    const data = await r.json();
    if (data.verses && data.verses.length) {
      bsAllResults = data.verses.map(v => ({
        book: v.book_name, ch: v.chapter, vs: v.verse, text: v.text.trim(), isOT: OT_BOOKS.has(v.book_name)
      }));
      applyBsFilter();
    } else {
      document.getElementById('bs-text').innerHTML = `<span class="loading">No results found for "${phrase}".</span>`;
    }
  } catch(e) {
    document.getElementById('bs-text').innerHTML = `<span class="loading">Search failed. Check your connection.</span>`;
  }
}

function applyBsFilter() {
  const phrase = document.getElementById('bs-entry').value.trim().toLowerCase();
  let results = bsAllResults;
  if (bsFilter === 'ot') results = results.filter(r => r.isOT);
  if (bsFilter === 'nt') results = results.filter(r => !r.isOT);

  document.getElementById('bs-count').textContent = `(${results.length} result${results.length!==1?'s':''})`;
  if (!results.length) {
    document.getElementById('bs-text').innerHTML = '<span class="loading">No results in this filter.</span>';
    return;
  }
  let html = '';
  let curBook = '';
  for (const r of results) {
    if (r.book !== curBook) {
      curBook = r.book;
      html += `<span class="book-hdr">${r.book}</span>`;
    }
    const hl = r.text.replace(new RegExp(`(${phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'), '<span class="hl">$1</span>');
    html += `<span class="ref">${r.ch}:${r.vs}</span> <span class="text-line" style="display:inline">${hl}</span><br>`;
  }
  document.getElementById('bs-text').innerHTML = html;
}

function setBsFilter(f) {
  bsFilter = f;
  ['all','ot','nt'].forEach(x => document.getElementById('bs-'+x).classList.toggle('active', x===f));
  applyBsFilter();
}

// ═══════════════════════════════════════════════════
// WORD STUDY (via Claude API)
// ═══════════════════════════════════════════════════
async function loadWordStudy(word, v) {
  document.getElementById('study-text').innerHTML = `<span class="loading"><span class="spinner"></span> Looking up "${word}" in ${v.book} ${v.chapter}:${v.verse}…</span>`;
  document.getElementById('usages-text').innerHTML = '<span class="loading">Searching…</span>';
  document.getElementById('usages-count').textContent = '';

  if (!CLAUDE_API_KEY) {
    renderWordStudyNoKey(word, v);
    loadUsages(word, v);
    return;
  }

  const isOT = OT_BOOKS.has(v.book);
  const langName = isOT ? 'Hebrew' : 'Greek';
  const slug = BOOK_SLUG[v.book] || v.book.toLowerCase().replace(/\s+/g,'_');
  const interUrl = `https://biblehub.com/interlinear/${slug}/${v.chapter}-${v.verse}.htm`;
  const strongsBase = isOT ? 'hebrew' : 'greek';

  // Call Claude to get word study
  const prompt = `You are a biblical scholar assistant. For the word "${word}" as found in ${v.book} ${v.chapter}:${v.verse} (KJV: "${v.text}"), provide a detailed word study.

Return JSON with this structure:
{
  "original": "Hebrew/Greek word (unicode characters)",
  "transliteration": "transliteration",
  "strongs_id": "H1234 or G1234",
  "language": "${langName}",
  "pos": "Part of speech",
  "short_def": "Short definition",
  "phonetic": "phonetic spelling",
  "kjv_translations": "Other KJV translations of this word",
  "occurrences": "number of occurrences in Bible",
  "extended_def": "2-3 sentences on theological meaning and usage",
  "webster_1828": "Webster 1828 style definition for the English word '${word}' (2-4 sentences)"
}

Return ONLY valid JSON, no markdown.`;

  try {
    const resp = await callClaude(prompt);
    let data;
    try { data = JSON.parse(resp.replace(/```[a-z]*\n?/g,'').replace(/\n?```/g,'').trim()); }
    catch(e) { data = null; }
    renderWordStudy(word, v, data);
  } catch(e) {
    renderWordStudyNoKey(word, v);
  }

  loadUsages(word, v);
}

function renderWordStudy(word, v, data) {
  let html = `<span class="word-title">${word}</span>`;
  html += `<span class="verse-ref">${v.book} ${v.chapter}:${v.verse}</span>`;
  const snip = v.text.length > 130 ? v.text.slice(0,130) + '…' : v.text;
  html += `<span class="verse-text">${escHtml(snip)}</span>`;

  if (data) {
    html += `<span class="section-hdr">ORIGINAL ${(data.language||'').toUpperCase()}</span>`;
    html += `<span class="divider">────────────────────────────</span>`;
    if (data.original) html += `<span class="orig">${escHtml(data.original)}  <span style="font-size:14px;color:var(--dim)">${escHtml(data.transliteration||'')}</span></span>`;
    if (data.strongs_id) html += `<span class="strongs">${escHtml(data.strongs_id)}  ·  ${escHtml(data.language||'')}</span>`;
    if (data.short_def) html += `<span class="gloss">Meaning:  ${escHtml(data.short_def)}</span>`;
    if (data.pos) html += `<span class="detail">Part of speech:  ${escHtml(data.pos)}</span>`;
    if (data.phonetic) html += `<span class="detail">Pronunciation:  ${escHtml(data.phonetic)}</span>`;
    if (data.kjv_translations) html += `<span class="detail">Also translated as:  ${escHtml(data.kjv_translations)}</span>`;
    if (data.occurrences) html += `<span class="detail">Appears ${escHtml(data.occurrences)}× in the Bible</span>`;
    if (data.extended_def) {
      html += `<span class="section-hdr">THEOLOGICAL NOTES</span>`;
      html += `<span class="divider">────────────────────────────</span>`;
      html += `<span class="body">${escHtml(data.extended_def)}</span>`;
    }
    if (data.webster_1828) {
      html += `<span class="section-hdr">BIBLICAL-ERA ENGLISH (Webster 1828)</span>`;
      html += `<span class="divider">────────────────────────────</span>`;
      html += `<span class="body">${escHtml(data.webster_1828)}</span>`;
    }
  } else {
    html += renderNoKey(word);
  }
  document.getElementById('study-text').innerHTML = html;
}

function renderWordStudyNoKey(word, v) {
  let html = `<span class="word-title">${word}</span>`;
  html += `<span class="verse-ref">${v.book} ${v.chapter}:${v.verse}</span>`;
  const snip = v.text.length > 130 ? v.text.slice(0,130) + '…' : v.text;
  html += `<span class="verse-text">${escHtml(snip)}</span>`;
  html += renderNoKey(word);
  document.getElementById('study-text').innerHTML = html;
}

function renderNoKey(word) {
  const slug = BOOK_SLUG[currentVerse?.book] || 'genesis';
  const ch = currentVerse?.chapter || 1;
  const vs = currentVerse?.verse || 1;
  return `<span class="section-hdr">WORD STUDY</span>
<span class="divider">────────────────────────</span>
<span class="dim">Add an Anthropic API key above to enable full Hebrew/Greek word study powered by Claude.</span>
<span class="dim" style="margin-top:8px">External links:</span>
<span class="detail">· <a href="https://biblehub.com/interlinear/${slug}/${ch}-${vs}.htm" target="_blank" style="color:var(--blue)">BibleHub Interlinear</a></span>
<span class="detail">· <a href="https://webstersdictionary1828.com/Dictionary/${encodeURIComponent(word.toUpperCase())}" target="_blank" style="color:var(--blue)">Webster 1828 — ${word.toUpperCase()}</a></span>`;
}

async function loadUsages(word, v) {
  if (!CLAUDE_API_KEY) {
    document.getElementById('usages-text').innerHTML = `<span class="dim">Add an Anthropic API key to search usages across the Bible.</span>
<span class="detail" style="margin-top:8px">· <a href="https://www.biblegateway.com/quicksearch/?quicksearch=${encodeURIComponent(word)}&translation=KJV" target="_blank" style="color:var(--blue)">Search "${word}" on BibleGateway</a></span>`;
    return;
  }

  // Fetch usages via bible-api
  try {
    const r = await fetch(`https://bible-api.com/${encodeURIComponent(word)}?translation=kjv`);
    const data = await r.json();
    const verses = data.verses || [];
    allUsages = verses.map(vv => ({
      book: vv.book_name, ch: vv.chapter, vs: vv.verse, text: vv.text.trim(),
      isOT: OT_BOOKS.has(vv.book_name)
    })).filter(vv => !(vv.book === v.book && vv.ch === v.chapter && vv.vs === v.verse));
    renderUsages(word);
  } catch(e) {
    document.getElementById('usages-text').innerHTML = '<span class="loading">Could not load usages.</span>';
  }
}

function renderUsages(word) {
  let rows = allUsages;
  if (usageMode === 'book' && currentVerse) rows = rows.filter(r => r.book === currentVerse.book);
  document.getElementById('usages-count').textContent = `(${rows.length} result${rows.length!==1?'s':''})`;
  if (!rows.length) {
    document.getElementById('usages-text').innerHTML = `<span class="loading">"${word}" not found elsewhere${usageMode==='book'?' in this book':' in the Bible'}.</span>`;
    return;
  }
  let html = '';
  let curBook = '';
  const wre = new RegExp(`\\b(${word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})\\b`, 'gi');
  for (const r of rows) {
    if (r.book !== curBook) {
      curBook = r.book;
      html += `<span class="book-hdr">${r.book}</span>`;
    }
    const hl = r.text.replace(wre, '<span class="hl">$1</span>');
    html += `<span class="ref">${r.ch}:${r.vs}</span>  <span class="text-line" style="display:inline">${hl}</span><br>`;
  }
  document.getElementById('usages-text').innerHTML = html;
}

function setUsageMode(m) {
  usageMode = m;
  document.getElementById('usage-all').classList.toggle('active', m==='all');
  document.getElementById('usage-book').classList.toggle('active', m==='book');
  if (currentWord) renderUsages(currentWord);
}

// ═══════════════════════════════════════════════════
// ALIGNMENT (Claude API)
// ═══════════════════════════════════════════════════
async function fetchAlignment(book, chapter, verse, text) {
  if (!CLAUDE_API_KEY) return;
  const isOT = OT_BOOKS.has(book);
  const prompt = `You are a biblical linguist. For ${book} ${chapter}:${verse}, the KJV text is: "${text}"
Return a JSON array of alignment groups mapping English phrases to their Hebrew/Greek equivalents.
Each group is an object with language keys: "kjv" (English phrase), and one or more of "hebrew", "greek", "latin".
Example: [{"kjv":"In the beginning","hebrew":"בְּרֵאשִׁית"},{"kjv":"God created","hebrew":"בָּרָא אֱלֹהִים"}]
Return ONLY raw JSON array.`;
  try {
    const resp = await callClaude(prompt);
    const clean = resp.replace(/^```[a-z]*\n?/,'').replace(/\n?```$/,'').trim();
    const groups = JSON.parse(clean);
    if (Array.isArray(groups)) {
      alignmentGroups = groups;
      alignmentTokenIndex = buildTokenIndex(groups);
      setStatus('✅ Click word for study · Hover for alignments');
    }
  } catch(e) { setStatus('✅ Click any word for word study'); }
}

function buildTokenIndex(groups) {
  const idx = {};
  for (let gi = 0; gi < groups.length; gi++) {
    for (const phrase of Object.values(groups[gi])) {
      for (const raw of phrase.split(/\s+/)) {
        const tok = cleanToken(raw.toLowerCase());
        if (!tok) continue;
        if (!idx[tok]) idx[tok] = [];
        if (!idx[tok].includes(gi)) idx[tok].push(gi);
      }
    }
  }
  return idx;
}

// ═══════════════════════════════════════════════════
// CLAUDE API CALL
// ═══════════════════════════════════════════════════
async function callClaude(prompt, system='You are a helpful biblical scholar assistant.') {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system,
      messages: [{role:'user',content:prompt}]
    })
  });
  const data = await resp.json();
  return data.content.map(b => b.type==='text'?b.text:'').join('');
}

// ═══════════════════════════════════════════════════
// ORTHODOX TAB
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
     "The Orthodox Church professes one God in three Persons — Father, Son, and Holy Spirit — co-equal, co-eternal, and of one essence (homoousios). This was definitively articulated at the First Ecumenical Council of Nicaea (325 AD) and expanded at Constantinople (381 AD).",
     ["The Father is unbegotten, the eternal source of divinity.",
      "The Son is eternally begotten of the Father — not created, but God from God, Light from Light.",
      "The Holy Spirit proceeds from the Father alone (the Orthodox reject the Latin filioque addition).",
      "The Cappadocian Fathers gave the Church the precise theological vocabulary to express this mystery."],
     ["Matthew 28:19","John 1:1","John 15:26","2 Corinthians 13:14"]],
    ["The Incarnation",
     "The Second Person of the Holy Trinity, the eternal Son and Word of God, took on human flesh and became man — born of the Virgin Mary, the Theotokos — without ceasing to be God. This is the central mystery of the Christian faith.",
     ["Christ is fully God and fully man — two natures in one Person (hypostasis), without confusion, change, division, or separation (Definition of Chalcedon, 451 AD).",
      "The Incarnation is not merely an event in history but the eternal purpose of creation — God becoming what we are so that we might become what He is.",
      "The doctrine of Theosis (divinisation) — the participation of human persons in the divine nature — flows directly from the Incarnation."],
     ["John 1:14","Philippians 2:5-11","Hebrews 2:14"]],
    ["Theosis — Union with God",
     "Theosis (divinisation, deification) is the goal of the Christian life in Orthodox theology: the real participation of human persons in the divine nature (2 Peter 1:4), not by becoming God by essence, but by grace.",
     ["The famous formula of Athanasius: 'God became man so that man might become god.'",
      "Theosis is not absorption into God (which would destroy the human person) but communion with God in love.",
      "It is a present reality begun in baptism and the Eucharist, and a future eschatological completion.",
      "The distinction between God's essence (unknowable) and His energies (the divine life in which we participate) — the theology of Gregory Palamas — is essential to understanding theosis."],
     ["2 Peter 1:4","John 17:21-23","1 John 3:2"]],
  ],
  "councils": [
    ["First Council of Nicaea (325 AD)",
     "Called by Emperor Constantine, the First Ecumenical Council condemned the Arian heresy, which taught that the Son is a creature — 'there was a time when He was not.' The Council defined the Son as homoousios (of one essence) with the Father.",
     ["Arius taught that the Son was the highest creature, not fully divine.",
      "Athanasius of Alexandria championed Orthodoxy against the Arians.",
      "The Nicene Creed (in its original form) was produced at this Council.",
      "The dating of Pascha was also decided here."],
     ["John 1:1","John 10:30"]],
    ["Council of Chalcedon (451 AD)",
     "The Fourth Ecumenical Council defined that Christ is one Person in two natures (divine and human), without confusion, change, division, or separation. This refuted both Nestorianism (two persons) and Monophysitism (one mixed nature).",
     ["The Chalcedonian Definition remains the Christological standard of both Orthodox and Catholic churches.",
      "The Oriental Orthodox churches (Coptic, Armenian, Ethiopian) rejected Chalcedon and are sometimes called Non-Chalcedonian.",
      "Leo the Great's Tome was a key document at the Council."],
     ["Hebrews 2:14","Philippians 2:5-11"]],
  ],
  "fathers": [
    ["Athanasius of Alexandria (c. 296–373)",
     "Called 'Athanasius contra mundum' — Athanasius against the world — for his lone defense of Nicene Orthodoxy against the Arian emperors and bishops. He was exiled five times but never compromised.",
     ["Author of On the Incarnation, one of the greatest works of patristic theology.",
      "His formula: 'God became man so that man might become god' is the foundation of theosis theology.",
      "His Life of Antony popularized monasticism throughout the Roman world."],
     ["John 1:14","2 Peter 1:4"]],
    ["John Chrysostom (c. 347–407)",
     "The 'Golden-Mouthed' Archbishop of Constantinople and Doctor of the Church, known for his brilliant preaching and his fearless denunciation of wealth and injustice — including the Empress Eudoxia.",
     ["His homilies on Matthew, John, Romans, and the Pauline letters remain among the greatest biblical commentaries.",
      "Died in exile after offending the court, but was later venerated as a saint.",
      "The Divine Liturgy of St. John Chrysostom bears his name and is the standard liturgy of the Byzantine tradition."],
     ["Matthew 25:40"]],
    ["Gregory Palamas (1296–1359)",
     "Archbishop of Thessalonica and the great theologian of hesychasm — the practice of inner prayer aimed at direct experience of God. His theology of the divine essence and energies is foundational to Orthodox mystical theology.",
     ["Palamas distinguished between God's unknowable essence and His uncreated energies — the divine life in which created beings can truly participate.",
      "The Palamite synthesis was formally affirmed by the Orthodox Church in the Councils of Constantinople (1341, 1347, 1351).",
      "His feast day (second Sunday of Lent) is called 'the Sunday of Palamas.'"],
     ["Exodus 33:20","John 14:23","2 Peter 1:4"]],
  ],
  "history": [
    ["The Great Schism (1054)",
     "The formal separation of Eastern (Orthodox) and Western (Roman Catholic) Christianity occurred on July 16, 1054, when Cardinal Humbert placed a bull of excommunication on the altar of the Hagia Sophia, and Patriarch Cerularius responded in kind.",
     ["The primary theological dispute was the filioque — the Western addition to the Creed stating the Spirit proceeds from 'the Father and the Son.'",
      "Other issues included papal primacy, clerical celibacy, and liturgical practices.",
      "The mutual excommunications were lifted in 1964 by Pope Paul VI and Patriarch Athenagoras I.",
      "The schism had been growing for centuries before 1054, with the coronation of Charlemagne (800) being a major factor."],
     ["John 15:26"]],
    ["The Fall of Constantinople (1453)",
     "On May 29, 1453, the Byzantine Empire fell to Ottoman Sultan Mehmed II. The city that had been the capital of Christian civilization for over a thousand years fell after a 53-day siege.",
     ["The last Byzantine Emperor, Constantine XI Palaiologos, died fighting on the walls.",
      "The Hagia Sophia was converted to a mosque (and later a museum, then a mosque again in 2020).",
      "Many Greek scholars fled to Italy, helping spark the Renaissance.",
      "Constantinople has not been liberated, and the Ecumenical Patriarchate remains there to this day under Turkish rule."],
     []],
  ],
  "liturgy": [
    ["The Divine Liturgy",
     "The Divine Liturgy is the central act of Orthodox Christian worship — the celebration of the Eucharist in which the faithful gather to offer thanksgiving to God, hear the Word, and receive the Body and Blood of Christ.",
     ["The most common form is the Divine Liturgy of St. John Chrysostom, celebrated on most Sundays and weekdays.",
      "The Divine Liturgy of St. Basil the Great is celebrated ten times a year.",
      "The liturgy is not merely a memorial but a participation in the heavenly worship before the throne of God.",
      "The epiclesis — invocation of the Holy Spirit upon the gifts — is the consecratory moment in the Orthodox understanding."],
     ["Revelation 4–5","1 Corinthians 11:23-26","John 6:53-56"]],
    ["The Jesus Prayer",
     "The Jesus Prayer — 'Lord Jesus Christ, Son of God, have mercy on me, a sinner' — is the central prayer of Orthodox hesychast spirituality, practiced in coordination with the breath and, for advanced practitioners, with the beating of the heart.",
     ["Based on the prayer of Bartimaeus (Mark 10:47) and the prayer of the Publican (Luke 18:13).",
      "The Philokalia, an anthology of writings by hesychast masters, is the primary guide to this prayer.",
      "Popularized in the 19th century by the anonymous Russian work The Way of a Pilgrim.",
      "Mount Athos (the 'Holy Mountain') in Greece has been the center of Orthodox monasticism since the 10th century."],
     ["Luke 18:13","1 Thessalonians 5:17","Psalm 46:10"]],
    ["Theotokos — The Mother of God",
     "The veneration of the Most Holy Theotokos (God-bearer, Mother of God) occupies a central place in Orthodox piety and theology. She is venerated above all the angels and saints.",
     ["The title Theotokos was affirmed at the Council of Ephesus (431 AD) as a Christological statement.",
      "The Orthodox Church venerates but does not worship Mary. She is a creature, the highest of all creatures, but not divine.",
      "The Dormition of the Theotokos — celebrated August 15 — commemorates her falling asleep and being taken into heaven.",
      "The Akathist Hymn to the Theotokos is one of the great liturgical poems of the Church."],
     ["Luke 1:28","Luke 1:42-43","Revelation 12:1"]],
  ],
  "ethics": [
    ["The Image of God & Human Dignity",
     "Every human being is created in the image (eikon) of God and bears an inherent, inviolable dignity. The distinction between 'image' and 'likeness' is significant: the image is given and cannot be destroyed; the likeness is the goal — theosis.",
     ["The image includes reason, freedom, creativity, and the capacity for communion with God.",
      "Sin damages but does not destroy the image.",
      "Every act of cruelty toward another human being is an offense against the image of God."],
     ["Genesis 1:26-27","Psalm 8:5","1 Corinthians 6:19-20"]],
    ["Fasting",
     "Fasting is one of the three pillars of Orthodox ascetic life (alongside prayer and almsgiving). The Orthodox fasting tradition encompasses approximately 180 days of the year.",
     ["Fasting involves abstaining from meat, dairy, fish, oil, and wine to varying degrees.",
      "The purpose is training the will, purifying the senses, and creating space for prayer.",
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
  const list = document.getElementById('oc-list');
  list.innerHTML = '';
  for (const [catKey, catLabel] of Object.entries(ORTHODOX_CATEGORIES)) {
    const h = document.createElement('div');
    h.className = 'oc-heading';
    h.textContent = catLabel;
    h.onclick = () => showOcCategory(catKey, catLabel);
    list.appendChild(h);
    const entries = ORTHODOX_DB[catKey] || [];
    for (let i = 0; i < entries.length; i++) {
      const item = document.createElement('div');
      item.className = 'oc-item';
      item.id = `oc-item-${catKey}-${i}`;
      item.textContent = entries[i][0];
      item.onclick = () => showOcEntry(catKey, i, item);
      list.appendChild(item);
    }
  }
}

function showOcCategory(catKey, catLabel) {
  document.querySelectorAll('.oc-item').forEach(el => el.classList.remove('active'));
  document.getElementById('oc-title').textContent = catLabel;
  const entries = ORTHODOX_DB[catKey] || [];
  let html = `<span class="section-hdr">Topics in this section:</span><span class="divider">────────────────────────</span>`;
  for (const e of entries) html += `<span class="bullet">${escHtml(e[0])}</span>`;
  document.getElementById('oc-text').innerHTML = html;
}

function showOcEntry(catKey, idx, el) {
  document.querySelectorAll('.oc-item').forEach(e => e.classList.remove('active'));
  if (el) el.classList.add('active');
  const entry = ORTHODOX_DB[catKey][idx];
  const [title, intro, bullets, scriptures] = [entry[0], entry[1], entry[2], entry[3]||[]];
  document.getElementById('oc-title').textContent = title;
  let html = `<span class="intro">${escHtml(intro)}</span>`;
  if (bullets.length) {
    html += `<span class="section-hdr">KEY POINTS</span><span class="divider">────────────────────────</span>`;
    for (const b of bullets) html += `<span class="bullet">${escHtml(b)}</span>`;
  }
  if (scriptures.length) {
    html += `<span class="section-hdr">SCRIPTURE REFERENCES</span><span class="divider">────────────────────────</span>`;
    html += `<span class="scripture-ref">${scriptures.join('  ·  ')}</span>`;
  }
  document.getElementById('oc-text').innerHTML = html;
}

async function runOwSearch() {
  const q = document.getElementById('ow-entry').value.trim();
  if (!q) return;
  document.getElementById('oc-title').textContent = `OrthodoxWiki: ${q}`;
  document.getElementById('oc-text').innerHTML = `<span class="loading"><span class="spinner"></span> Fetching OrthodoxWiki article for "${escHtml(q)}"…</span>`;
  if (!CLAUDE_API_KEY) {
    document.getElementById('oc-text').innerHTML = `<span class="loading">An Anthropic API key is needed to fetch OrthodoxWiki articles via Claude.<br><br>Or visit: <a href="https://orthodoxwiki.org/wiki/${encodeURIComponent(q.replace(/ /g,'_'))}" target="_blank" style="color:var(--blue)">OrthodoxWiki — ${escHtml(q)}</a></span>`;
    return;
  }
  try {
    const prompt = `You are an Orthodox Christian scholar. Provide a comprehensive summary of the following Orthodox Christian topic: "${q}".
Format your response as flowing paragraphs covering: definition, historical background, theological significance, key figures or events, and relation to Orthodox practice or belief.
Do not use bullet points. Write 3-5 well-developed paragraphs.`;
    const text = await callClaude(prompt, 'You are an Orthodox Christian scholar and historian.');
    let html = `<span class="section-hdr">ORTHODOX ARTICLE: ${escHtml(q.toUpperCase())}</span><span class="divider">────────────────────────</span>`;
    for (const para of text.split('\n\n')) {
      if (para.trim()) html += `<span class="wiki-body">${escHtml(para.trim())}</span>`;
    }
    html += `<span class="wiki-src">Source: Generated by Claude based on Orthodox theological sources</span>`;
    document.getElementById('oc-text').innerHTML = html;
  } catch(e) {
    document.getElementById('oc-text').innerHTML = `<span class="loading">Could not fetch article. Check your connection.</span>`;
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
      const schedule = [
        "Genesis 1–3","Genesis 4–7","Genesis 8–11","Genesis 12–15","Genesis 16–19",
        "Genesis 20–23","Genesis 24–27","Genesis 28–31","Genesis 32–36","Genesis 37–41",
        "Genesis 42–46","Genesis 47–50","Exodus 1–5","Exodus 6–10","Exodus 11–15",
        "Exodus 16–20","Exodus 21–25","Exodus 26–30","Exodus 31–35","Exodus 36–40",
        "Leviticus 1–7","Leviticus 8–14","Leviticus 15–20","Leviticus 21–27",
        "Numbers 1–4","Numbers 5–9","Numbers 10–14","Numbers 15–19","Numbers 20–25",
        "Numbers 26–30","Numbers 31–36","Deuteronomy 1–4","Deuteronomy 5–9",
        "Deuteronomy 10–14","Deuteronomy 15–20","Deuteronomy 21–26","Deuteronomy 27–34",
        "Joshua 1–7","Joshua 8–14","Joshua 15–21","Joshua 22–24 / Judges 1–3",
        "Judges 4–9","Judges 10–16","Judges 17–21 / Ruth","1 Samuel 1–7","1 Samuel 8–14",
        "1 Samuel 15–20","1 Samuel 21–27","1 Samuel 28–31 / 2 Samuel 1–3","2 Samuel 4–10",
        "2 Samuel 11–17","2 Samuel 18–24","Psalms 1–15","Psalms 16–30","Psalms 31–45",
        "Psalms 46–60","Psalms 61–75","Psalms 76–90","Psalms 91–106","Psalms 107–119",
        "Psalms 120–150","Proverbs 1–9","Proverbs 10–20","Proverbs 21–31 / Eccl",
        "Isaiah 1–12","Isaiah 13–27","Isaiah 28–39","Isaiah 40–52","Isaiah 53–66",
        "Jeremiah 1–12","Jeremiah 13–25","Jeremiah 26–38","Jeremiah 39–52",
        "Ezekiel 1–13","Ezekiel 14–26","Ezekiel 27–39","Ezekiel 40–48",
        "Daniel / Minor Prophets","Hosea–Micah","Nahum–Malachi",
        "Matthew 1–7","Matthew 8–14","Matthew 15–21","Matthew 22–28",
        "Mark 1–8","Mark 9–16","Luke 1–6","Luke 7–13","Luke 14–24",
        "John 1–7","John 8–14","John 15–21 / Acts 1–3","Acts 4–12","Acts 13–21",
        "Acts 22–28 / Romans 1–4","Romans 5–16","1 Corinthians","2 Cor / Galatians",
        "Ephesians–Colossians","1–2 Thess / Pastorals","Philemon–Hebrews",
        "James–2 Peter","1–3 John / Jude / Revelation 1–7","Revelation 8–22"
      ];
      return schedule.map((s,i) => ({day:`Day ${i+1}`, label:s, ref:s.split('/')[0].trim()}));
    })()
  },
  "psalms_proverbs": {
    name: "Psalms & Proverbs",
    desc: "30 days through Psalms and Proverbs.",
    days: Array.from({length:30}, (_,i) => ({day:`Day ${i+1}`, label:`Psalms ${i*5+1}–${i*5+5} · Proverbs ${i+1}`, ref:`Psalms ${i*5+1}`}))
  },
  "gospels": {
    name: "The Four Gospels",
    desc: "89 days through Matthew, Mark, Luke, and John.",
    days: [
      ...Array.from({length:28}, (_,i) => ({day:`Day ${i+1}`, label:`Matthew ${i+1}`, ref:`Matthew ${i+1}`})),
      ...Array.from({length:16}, (_,i) => ({day:`Day ${i+29}`, label:`Mark ${i+1}`, ref:`Mark ${i+1}`})),
      ...Array.from({length:24}, (_,i) => ({day:`Day ${i+45}`, label:`Luke ${i+1}`, ref:`Luke ${i+1}`})),
      ...Array.from({length:21}, (_,i) => ({day:`Day ${i+69}`, label:`John ${i+1}`, ref:`John ${i+1}`})),
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

function loadPlan(planId) {
  activePlan = planId;
  // Update radio styles
  Object.keys(READING_PLANS).forEach(pid => {
    document.getElementById(`plan-radio-${pid}`)?.classList.toggle('active', pid===planId);
  });
  const plan = READING_PLANS[planId];
  const progress = (planProgress[planId] || {});
  const completed = Object.values(progress).filter(Boolean).length;
  document.getElementById('plan-progress').textContent = `${completed} / ${plan.days.length} days completed`;

  const list = document.getElementById('plan-list');
  list.innerHTML = '';
  plan.days.forEach((d, i) => {
    const done = progress[i] || false;
    const div = document.createElement('div');
    div.className = 'plan-day' + (done?' done':'');
    div.innerHTML = `<div class="plan-day-check${done?' done':''}">${done?'✓':''}</div>
<span class="plan-day-lbl">${d.day}</span>
<span class="plan-day-text">${escHtml(d.label)}</span>`;
    div.addEventListener('click', () => {
      const newDone = !done;
      if (!planProgress[planId]) planProgress[planId] = {};
      planProgress[planId][i] = newDone;
      localStorage.setItem('planProgress', JSON.stringify(planProgress));
      // Open verse
      document.getElementById('verse-input').value = d.ref;
      goSearch();
      switchTab('study');
      setTimeout(() => loadPlan(planId), 100);
    });
    list.appendChild(div);
  });
}

function resetPlan() {
  if (confirm(`Reset progress for "${READING_PLANS[activePlan].name}"?`)) {
    planProgress[activePlan] = {};
    localStorage.setItem('planProgress', JSON.stringify(planProgress));
    loadPlan(activePlan);
  }
}

// ═══════════════════════════════════════════════════
// BOOKMARKS
// ═══════════════════════════════════════════════════
function saveBookmark() {
  if (!currentVerse) { alert('Search for a verse first.'); return; }
  const note = document.getElementById('bk-note').value.trim();
  const v = currentVerse;
  // Remove duplicate
  bookmarks = bookmarks.filter(b => !(b.book===v.book && b.chapter===v.chapter && b.verse===v.verse));
  bookmarks.unshift({book:v.book, chapter:v.chapter, verse:v.verse, text:v.text, note, date: new Date().toLocaleDateString()});
  localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
  document.getElementById('bk-note').value = '';
  renderBookmarks();
  setStatus(`🔖 Saved ${v.book} ${v.chapter}:${v.verse}`);
}

function renderBookmarks() {
  if (!bookmarks.length) {
    document.getElementById('bk-text').innerHTML = '<span class="loading">No bookmarks yet. Search for a verse and click "Bookmark Current Verse".</span>';
    return;
  }
  let html = '';
  for (let i = 0; i < bookmarks.length; i++) {
    const b = bookmarks[i];
    html += `<span class="bk-ref" onclick="openBookmark(${i})">${b.book} ${b.chapter}:${b.verse}</span>`;
    if (b.text) {
      const snip = b.text.length > 100 ? b.text.slice(0,100)+'…' : b.text;
      html += `<span class="bk-verse">${escHtml(snip)}</span>`;
    }
    if (b.note) html += `<span class="bk-note">📝 ${escHtml(b.note)}</span>`;
    html += `<span class="bk-date">${b.date || ''}</span>`;
    html += `<span class="bk-del" onclick="deleteBookmark(${i})">🗑 Delete</span><br>`;
  }
  document.getElementById('bk-text').innerHTML = html;
}

function openBookmark(i) {
  const b = bookmarks[i];
  document.getElementById('verse-input').value = `${b.book} ${b.chapter}:${b.verse}`;
  goSearch();
  switchTab('study');
}

function deleteBookmark(i) {
  bookmarks.splice(i, 1);
  localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
  renderBookmarks();
}

// ═══════════════════════════════════════════════════
// COMPARE
// ═══════════════════════════════════════════════════
function toggleCmpSrc(el) {
  const src = el.dataset.src;
  if (cmpActiveSrcs.has(src)) { cmpActiveSrcs.delete(src); el.classList.remove('active'); }
  else { cmpActiveSrcs.add(src); el.classList.add('active'); }
}

async function compareCurrent() {
  if (!currentVerse) { alert('Search for a verse first.'); return; }
  document.getElementById('cmp-entry').value = `${currentVerse.book} ${currentVerse.chapter}:${currentVerse.verse}`;
  runCompare();
}

async function runCompare() {
  const ref = document.getElementById('cmp-entry').value.trim();
  const parsed = parseRef(ref);
  if (!parsed || !parsed.chapter || !parsed.verse) {
    document.getElementById('cmp-text').innerHTML = '<span class="loading">Please enter a specific verse (e.g. John 3:16).</span>';
    return;
  }
  document.getElementById('cmp-text').innerHTML = '<span class="loading"><span class="spinner"></span> Fetching translations…</span>';

  if (!CLAUDE_API_KEY) {
    // Just show KJV
    const verses = await fetchVerses(parsed.book, parsed.chapter, parsed.verse);
    if (!verses.length) { document.getElementById('cmp-text').innerHTML = '<span class="loading">No results found.</span>'; return; }
    const kjv = verses[0].text.trim();
    let html = `<span class="verse-hdr">${ref}</span><span class="divider" style="display:block;border-top:1px solid var(--border);margin:6px 0"></span>`;
    html += `<span class="cmp-src">English (KJV)</span><span class="cmp-text">${escHtml(kjv)}</span>`;
    html += `<span class="dim">Add an Anthropic API key to compare other translations side-by-side.</span>`;
    document.getElementById('cmp-text').innerHTML = html;
    return;
  }

  try {
    const prompt = `For the verse ${parsed.book} ${parsed.chapter}:${parsed.verse}, provide the text in these translations:
${[...cmpActiveSrcs].join(', ')}

Return JSON object with keys matching the translation names and text values.
Example: {"kjv":"In the beginning God created...","septuagint":"ἐν ἀρχῇ ἐποίησεν ὁ θεός..."}

Translation names to use: kjv, tanakh_english, tanakh_hebrew, septuagint, textus_receptus, vulgate.
For tanakh_hebrew use Hebrew Unicode characters. For septuagint use Greek Unicode characters. For vulgate use Latin.
If a translation doesn't exist for a NT verse (like tanakh), omit it.
Return ONLY valid JSON.`;
    const resp = await callClaude(prompt);
    const clean = resp.replace(/```[a-z]*\n?/g,'').replace(/\n?```/g,'').trim();
    let data;
    try { data = JSON.parse(clean); } catch(e) { data = null; }

    let html = `<span class="ch-title">${parsed.book} ${parsed.chapter}:${parsed.verse}</span>`;
    html += `<span style="display:block;border-top:1px solid var(--border);margin:8px 0 12px"></span>`;

    const srcOrder = ['kjv','tanakh_english','septuagint','textus_receptus','tanakh_hebrew','vulgate'];
    if (data) {
      for (const src of srcOrder) {
        if (!cmpActiveSrcs.has(src)) continue;
        const text = data[src];
        if (!text) continue;
        html += `<span class="cmp-src">${escHtml(SOURCE_LABELS[src]||src)}</span>`;
        html += `<span class="cmp-text">${escHtml(text)}</span>`;
      }
    } else {
      html += '<span class="dim">Could not parse translations. Try again.</span>';
    }
    document.getElementById('cmp-text').innerHTML = html;
  } catch(e) {
    document.getElementById('cmp-text').innerHTML = '<span class="loading">Error fetching translations.</span>';
  }
}

// ═══════════════════════════════════════════════════
// DAILY VERSE
// ═══════════════════════════════════════════════════
const DAILY_VERSES = [
  ["Genesis 1:1","The opening of all creation — the Word that called light and life into being."],
  ["Genesis 1:27","Every human person is made in the image and likeness of the living God."],
  ["Genesis 3:15","The Protoevangelium — the first promise of a Redeemer, spoken to the serpent."],
  ["Genesis 12:3","The Abrahamic covenant: all families of the earth shall be blessed through him."],
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
  ["Isaiah 7:14","Behold, the virgin shall conceive and bear a son — the great Messianic sign."],
  ["Isaiah 40:31","Those who wait upon the LORD shall renew their strength — they shall mount up with wings."],
  ["Isaiah 41:10","Fear not, for I am with you. Be not dismayed, for I am your God."],
  ["Isaiah 53:5","He was wounded for our transgressions. With His stripes we are healed."],
  ["Isaiah 55:8","My thoughts are not your thoughts, neither are your ways my ways, declares the LORD."],
  ["Jeremiah 29:11","I know the plans I have for you — plans for welfare and not for evil."],
  ["Jeremiah 31:33","I will put my law within them, and write it on their hearts — the New Covenant."],
  ["Lamentations 3:22","The steadfast love of the LORD never ceases. His mercies never come to an end."],
  ["Ezekiel 36:26","I will give you a new heart, and a new spirit I will put within you."],
  ["Micah 6:8","What does the LORD require of you but to do justice, love kindness, and walk humbly with God?"],
  ["Matthew 5:3","Blessed are the poor in spirit, for theirs is the kingdom of heaven."],
  ["Matthew 5:8","Blessed are the pure in heart, for they shall see God."],
  ["Matthew 5:14","You are the light of the world. A city set on a hill cannot be hidden."],
  ["Matthew 5:44","Love your enemies and pray for those who persecute you."],
  ["Matthew 5:48","Be perfect, as your heavenly Father is perfect — the call to theosis."],
  ["Matthew 6:6","But when you pray, go into your room and shut the door and pray to your Father."],
  ["Matthew 6:9","Our Father in heaven, hallowed be Your name — the Lord's Prayer begins."],
  ["Matthew 6:33","Seek first the kingdom of God and His righteousness, and all these things will be added."],
  ["Matthew 7:7","Ask, and it will be given to you; seek, and you will find; knock, and it will be opened."],
  ["Matthew 11:28","Come to me, all who labor and are heavy laden, and I will give you rest."],
  ["Matthew 16:18","On this rock I will build my Church, and the gates of hell shall not prevail against it."],
  ["Matthew 25:40","Whatever you do to the least of these my brothers, you have done it to me."],
  ["Matthew 28:19","Go and make disciples of all nations — the Great Commission."],
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
  ["Galatians 5:22","But the fruit of the Spirit is love, joy, peace, patience, kindness…"],
  ["Ephesians 2:8","For by grace you have been saved through faith. And this is not your own doing."],
  ["Philippians 4:7","The peace of God, which surpasses all understanding, will guard your hearts."],
  ["Philippians 4:13","I can do all things through Christ who strengthens me."],
  ["Colossians 3:17","Whatever you do, in word or deed, do everything in the name of the Lord Jesus."],
  ["2 Timothy 3:16","All Scripture is breathed out by God and profitable for teaching."],
  ["Hebrews 11:1","Now faith is the assurance of things hoped for, the conviction of things not seen."],
  ["James 1:5","If any of you lacks wisdom, let him ask God who gives generously."],
  ["1 Peter 5:7","Cast all your anxieties on him, because he cares for you."],
  ["1 John 4:8","Anyone who does not love does not know God, because God is love."],
  ["Revelation 21:4","He will wipe away every tear from their eyes. Death shall be no more."],
  ["Revelation 22:20","Amen. Come, Lord Jesus — the great prayer of the Church."],
];

async function renderDailyVerse() {
  const today = new Date();
  const dayOfYear = Math.floor((today - new Date(today.getFullYear(),0,0)) / 86400000);
  if (dvIndex === null) dvIndex = dayOfYear % DAILY_VERSES.length;

  const [ref, reflection] = DAILY_VERSES[dvIndex % DAILY_VERSES.length];
  document.getElementById('dv-text').innerHTML = `<span class="loading"><span class="spinner"></span> Loading verse…</span>`;

  // Fetch verse text
  const verses = await fetchVerses(...ref.split(' ').reduce((a,w,i,arr) => {
    // Parse "Book ch:vs"
    if (i === arr.length - 2) return a;
    return a;
  }, []));

  // Simple parse for daily verse ref
  const parsed = parseRef(ref);
  let verseText = '';
  if (parsed) {
    const v = await fetchVerses(parsed.book, parsed.chapter, parsed.verse);
    if (v.length) verseText = v[0].text.trim();
  }

  const dateStr = today.toLocaleDateString('en-US', {weekday:'long',year:'numeric',month:'long',day:'numeric'});
  let html = `<span class="dv-date">${dateStr} · Day ${(dvIndex%DAILY_VERSES.length)+1} of ${DAILY_VERSES.length}</span>`;
  html += `<span class="dv-ref" onclick="openDailyVerse()">${escHtml(ref)}</span>`;
  if (verseText) html += `<span class="dv-verse">"${escHtml(verseText)}"</span>`;
  html += `<span class="section-hdr">REFLECTION</span><span class="divider" style="display:block;margin-bottom:6px">────────────────────────</span>`;
  html += `<span class="dv-reflect">${escHtml(reflection)}</span>`;

  if (CLAUDE_API_KEY && verseText) {
    html += `<span class="section-hdr" style="margin-top:16px">DEEPER REFLECTION</span>`;
    html += `<span class="divider" style="display:block;margin-bottom:6px">────────────────────────</span>`;
    html += `<span class="dv-reflect" id="dv-deeper"><span class="spinner"></span></span>`;
    document.getElementById('dv-text').innerHTML = html;
    // Load deeper reflection async
    callClaude(`Write a brief, spiritually rich reflection (3-4 sentences) on ${ref}: "${verseText}". Focus on Orthodox Christian spirituality and practical application. Be thoughtful and warm.`)
      .then(text => {
        const el = document.getElementById('dv-deeper');
        if (el) el.innerHTML = escHtml(text);
      }).catch(() => {
        const el = document.getElementById('dv-deeper');
        if (el) el.remove();
      });
  } else {
    document.getElementById('dv-text').innerHTML = html;
  }
}

function dvPrev() { dvIndex = (dvIndex - 1 + DAILY_VERSES.length) % DAILY_VERSES.length; renderDailyVerse(); }
function dvNext() { dvIndex = (dvIndex + 1) % DAILY_VERSES.length; renderDailyVerse(); }
function dvToday() { const d = new Date(); dvIndex = Math.floor((d - new Date(d.getFullYear(),0,0)) / 86400000) % DAILY_VERSES.length; renderDailyVerse(); }
function openDailyVerse() {
  const [ref] = DAILY_VERSES[dvIndex % DAILY_VERSES.length];
  document.getElementById('verse-input').value = ref;
  goSearch();
  switchTab('study');
}

// ═══════════════════════════════════════════════════
// CROSS REFERENCES
// ═══════════════════════════════════════════════════
function xrefsUseCurrent() {
  if (!currentVerse) { alert('Search for a verse first.'); return; }
  document.getElementById('xr-entry').value = `${currentVerse.book} ${currentVerse.chapter}:${currentVerse.verse}`;
  runXrefs();
}

async function runXrefs() {
  const ref = document.getElementById('xr-entry').value.trim();
  const parsed = parseRef(ref);
  if (!parsed || !parsed.chapter || !parsed.verse) {
    document.getElementById('xr-text').innerHTML = '<span class="loading">Please enter a specific verse reference.</span>';
    return;
  }
  document.getElementById('xr-lbl').textContent = ref;
  document.getElementById('xr-text').innerHTML = `<span class="loading"><span class="spinner"></span> Fetching cross-references for ${escHtml(ref)}…</span>`;

  if (!CLAUDE_API_KEY) {
    const slug = BOOK_SLUG[parsed.book] || parsed.book.toLowerCase().replace(/\s+/g,'_');
    document.getElementById('xr-text').innerHTML = `<span class="loading">Add an Anthropic API key to get AI-powered cross-references.<br><br>Or view on BibleHub: <a href="https://biblehub.com/${slug}/${parsed.chapter}-${parsed.verse}.htm" target="_blank" style="color:var(--blue)">${escHtml(ref)} on BibleHub</a></span>`;
    return;
  }

  try {
    const verses = await fetchVerses(parsed.book, parsed.chapter, parsed.verse);
    const srcText = verses.length ? verses[0].text.trim() : '';

    const prompt = `You are a biblical scholar. For ${parsed.book} ${parsed.chapter}:${parsed.verse}${srcText?` — "${srcText}"`:''},  provide 8-12 meaningful cross-references — verses that are thematically, typologically, or exegetically linked.

For each cross-reference return:
- ref: "Book Ch:Vs"
- text: the verse text (KJV)
- link: one sentence explaining the connection

Return as JSON array: [{"ref":"...", "text":"...", "link":"..."}]
Return ONLY valid JSON.`;

    const resp = await callClaude(prompt);
    const clean = resp.replace(/```[a-z]*\n?/g,'').replace(/\n?```/g,'').trim();
    let xrefs;
    try { xrefs = JSON.parse(clean); } catch(e) { xrefs = null; }

    if (!xrefs || !xrefs.length) {
      document.getElementById('xr-text').innerHTML = '<span class="loading">No cross-references found.</span>';
      return;
    }

    let html = '';
    if (srcText) html += `<span class="verse-text" style="display:block;margin-bottom:16px;padding-left:0;font-style:italic;color:var(--fg2)">${escHtml(parsed.book)} ${parsed.chapter}:${parsed.verse} — "${escHtml(srcText)}"</span>`;
    html += `<span class="section-hdr">CROSS-REFERENCES</span><span class="divider" style="display:block;margin-bottom:8px">────────────────────────</span>`;
    for (const xr of xrefs) {
      html += `<span class="xref-ref" onclick="document.getElementById('verse-input').value='${escAttr(xr.ref)}';goSearch();switchTab('study')">${escHtml(xr.ref)}</span>`;
      if (xr.text) html += `<span class="xref-text">${escHtml(xr.text)}</span>`;
      if (xr.link) html += `<span class="detail" style="color:var(--dim);padding-left:16px;font-size:11px;display:block;margin-bottom:8px">${escHtml(xr.link)}</span>`;
    }
    document.getElementById('xr-text').innerHTML = html;
  } catch(e) {
    document.getElementById('xr-text').innerHTML = '<span class="loading">Error fetching cross-references. Check your API key.</span>';
  }
}

// ═══════════════════════════════════════════════════
// CHAPTER OVERVIEW
// ═══════════════════════════════════════════════════
function overviewUseCurrent() {
  if (!currentVerse) { alert('Search for a verse first.'); return; }
  document.getElementById('ov-entry').value = `${currentVerse.book} ${currentVerse.chapter}`;
  runOverview();
}

async function runOverview() {
  const ref = document.getElementById('ov-entry').value.trim();
  const parsed = parseRef(ref);
  if (!parsed || !parsed.chapter) {
    document.getElementById('ov-text').innerHTML = '<span class="loading">Please enter a book + chapter (e.g. Genesis 1).</span>';
    return;
  }
  document.getElementById('ov-lbl').textContent = `${parsed.book} ${parsed.chapter}`;
  document.getElementById('ov-text').innerHTML = `<span class="loading"><span class="spinner"></span> Analysing ${escHtml(parsed.book)} ${parsed.chapter}…</span>`;

  if (!CLAUDE_API_KEY) {
    // Fetch verses and show basic info
    const verses = await fetchVerses(parsed.book, parsed.chapter, null);
    if (!verses.length) {
      document.getElementById('ov-text').innerHTML = '<span class="loading">No data found. Check the book name and chapter number.</span>';
      return;
    }
    let html = `<span class="ch-title">${parsed.book} ${parsed.chapter}</span>`;
    html += `<span class="section-hdr">AT A GLANCE</span><span class="divider" style="display:block;margin-bottom:6px">────────────────────────</span>`;
    html += `<span class="stat-key">Verses:  </span><span class="stat-val">${verses.length}</span><br>`;
    if (verses[0]) html += `<br><span style="display:block;margin-bottom:4px;font-size:13px;color:var(--dim)">Opening verse:</span><span class="first-verse">"${escHtml(verses[0].text.trim())}"</span>`;
    html += `<span class="section-hdr" style="margin-top:12px">VERSE NAVIGATOR</span><span class="divider" style="display:block;margin-bottom:6px">────────────────────────</span>`;
    for (const v of verses) {
      const snip = v.text.length > 70 ? v.text.slice(0,70)+'…' : v.text;
      html += `<span class="vs-num" onclick="document.getElementById('verse-input').value='${escAttr(parsed.book + ' ' + parsed.chapter + ':' + v.verse)}';goSearch();switchTab('study')">${v.verse}</span> <span class="vs-snip">${escHtml(snip.trim())}</span><br>`;
    }
    html += `<span class="dim" style="margin-top:12px">Add an Anthropic API key for themes, notable names, and deeper analysis.</span>`;
    document.getElementById('ov-text').innerHTML = html;
    return;
  }

  try {
    const verses = await fetchVerses(parsed.book, parsed.chapter, null);
    const verseTexts = verses.slice(0,10).map(v => `${v.verse}: ${v.text.trim()}`).join('\n');

    const prompt = `You are a biblical scholar. Analyse ${parsed.book} ${parsed.chapter}.
First verse text for context: ${verseTexts.split('\n')[0]}

Return JSON:
{
  "testament": "Old Testament" or "New Testament",
  "section": "e.g. Torah, Wisdom Literature, Pauline Epistles",
  "book_desc": "One sentence about this book",
  "verse_count": ${verses.length},
  "themes": ["theme1", "theme2", "theme3", "theme4"],
  "top_names": ["Name1", "Name2", "Name3", "Name4", "Name5"],
  "first_verse_note": "One sentence about the significance of verse 1 of this chapter"
}
Return ONLY valid JSON.`;

    const resp = await callClaude(prompt);
    const clean = resp.replace(/```[a-z]*\n?/g,'').replace(/\n?```/g,'').trim();
    let data;
    try { data = JSON.parse(clean); } catch(e) { data = null; }

    let html = `<span class="ch-title">${parsed.book} ${parsed.chapter}</span>`;
    if (data) {
      const meta = [data.testament, data.section].filter(Boolean);
      if (meta.length) html += `<span class="detail" style="color:var(--dim);margin-bottom:4px;display:block">${meta.join(' · ')}</span>`;
      if (data.book_desc) html += `<span class="dim">${escHtml(data.book_desc)}</span>`;
    }

    html += `<span class="section-hdr">AT A GLANCE</span><span class="divider" style="display:block;margin-bottom:6px">────────────────────────</span>`;
    html += `<span class="stat-key">Verses:  </span><span class="stat-val">${verses.length}</span><br>`;
    if (verses[0]) html += `<br><span style="display:block;margin-bottom:4px;font-size:13px;color:var(--dim)">Opening verse:</span><span class="first-verse">"${escHtml(verses[0].text.trim())}"</span>`;
    if (data?.first_verse_note) html += `<span class="dim">${escHtml(data.first_verse_note)}</span>`;

    if (data?.themes?.length) {
      html += `<span class="section-hdr">KEY THEMES</span><span class="divider" style="display:block;margin-bottom:6px">────────────────────────</span>`;
      for (const t of data.themes) html += `<span class="theme">• ${escHtml(t)}</span>`;
    }
    if (data?.top_names?.length) {
      html += `<span class="section-hdr">NOTABLE NAMES & WORDS</span><span class="divider" style="display:block;margin-bottom:6px">────────────────────────</span>`;
      html += `<span class="name">${data.top_names.map(n => escHtml(n)).join('  ·  ')}</span>`;
    }

    html += `<span class="section-hdr" style="margin-top:16px">VERSE NAVIGATOR  (click to jump)</span><span class="divider" style="display:block;margin-bottom:6px">────────────────────────</span>`;
    for (const v of verses) {
      const snip = v.text.length > 70 ? v.text.slice(0,70)+'…' : v.text;
      html += `<span class="vs-num" onclick="document.getElementById('verse-input').value='${escAttr(parsed.book + ' ' + parsed.chapter + ':' + v.verse)}';goSearch();switchTab('study')">${v.verse}</span> <span class="vs-snip">${escHtml(snip.trim())}</span><br>`;
    }
    document.getElementById('ov-text').innerHTML = html;
  } catch(e) {
    document.getElementById('ov-text').innerHTML = '<span class="loading">Error analysing chapter. Check your API key.</span>';
  }
}

// ═══════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════
function switchTab(key) {
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    const keys = ['study','bsearch','orthodox','plans','bookmarks','compare','daily','xrefs','overview'];
    btn.classList.toggle('active', keys[i] === key);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${key}`);
  });
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════
function setStatus(html) { document.getElementById('status').innerHTML = html; }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return String(s).replace(/'/g,"\\'"); }
function showPlaceholderStudy() {
  document.getElementById('study-text').innerHTML = '<span class="loading">Click any word in the scripture panel to open its word study.</span>';
  document.getElementById('usages-text').innerHTML = '';
  document.getElementById('usages-count').textContent = '';
  document.getElementById('study-word-lbl').textContent = '';
  document.getElementById('usages-hdr').textContent = 'USAGES ACROSS THE BIBLE';
}

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
buildOcNav();
loadPlan('90day');
renderBookmarks();
dvIndex = Math.floor((new Date() - new Date(new Date().getFullYear(),0,0)) / 86400000) % DAILY_VERSES.length;
renderDailyVerse();

// Enter key on verse input
document.getElementById('verse-input').addEventListener('keydown', e => { if (e.key==='Enter') goSearch(); });
document.getElementById('search-input').addEventListener('keydown', e => { if (e.key==='Enter') bibleSearch(); });

// Hide tooltip on click elsewhere
document.addEventListener('click', e => { if (!e.target.classList.contains('word-span')) hideTooltip(); });
