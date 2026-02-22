import json
import sqlite3
import os

DB_NAME = "bible_study.db"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEXTS_FOLDER = os.path.join(BASE_DIR, "texts")


# --------------------------------------------------
# DATABASE SETUP
# --------------------------------------------------

def init_db(conn):
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS verses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT,
            testament TEXT,
            book TEXT,
            chapter INTEGER,
            verse INTEGER,
            text TEXT,
            UNIQUE(source, book, chapter, verse)
        )
    """)

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_reference ON verses(book, chapter, verse)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_source ON verses(source)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_text ON verses(text)")

    conn.commit()


# --------------------------------------------------
# GENERIC INSERT
# --------------------------------------------------

def insert_verse(cursor, source, testament, book, chapter, verse, text):
    cursor.execute("""
        INSERT OR IGNORE INTO verses
        (source, testament, book, chapter, verse, text)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (source, testament, book, chapter, verse, text.strip()))


# --------------------------------------------------
# LOAD TANAKH (HEBREW + ENGLISH COMBINED FORMAT)
# --------------------------------------------------

def load_tanakh(cursor):
    path = os.path.join(TEXTS_FOLDER, "tanakh.json")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    for book, chapters in data.items():
        for chapter_num, entries in chapters.items():
            verse_counter = 1

            for entry in entries:
                if "verse_he" in entry:
                    insert_verse(cursor, "tanakh_hebrew", "OT",
                                 book, int(chapter_num),
                                 verse_counter,
                                 entry["verse_he"])

                elif "verse_en" in entry:
                    insert_verse(cursor, "tanakh_english", "OT",
                                 book, int(chapter_num),
                                 verse_counter,
                                 entry["verse_en"])
                    verse_counter += 1


# --------------------------------------------------
# LOAD SEPTUAGINT
# --------------------------------------------------

def load_septuagint(cursor):
    path = os.path.join(TEXTS_FOLDER, "septuagint.json")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    for book, chapters in data.items():
        for chapter_num, verses in chapters.items():
            for verse_num, text in verses.items():
                insert_verse(cursor, "septuagint", "OT",
                             book, int(chapter_num),
                             int(verse_num), text)


# --------------------------------------------------
# LOAD TEXTUS RECEPTUS (NT GREEK)
# --------------------------------------------------

def load_textus_receptus(cursor):
    path = os.path.join(TEXTS_FOLDER, "textus_receptus.json")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    for book in data["books"]:
        book_name = book["name"]

        for chapter in book["chapters"]:
            chapter_num = chapter["chapter"]

            for verse in chapter["verses"]:
                insert_verse(cursor, "textus_receptus", "NT",
                             book_name,
                             chapter_num,
                             verse["verse"],
                             verse["text"])


# --------------------------------------------------
# LOAD KJV
# --------------------------------------------------

def load_kjv(cursor):
    path = os.path.join(TEXTS_FOLDER, "kjv.json")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # List of OT books for correct classification
    OT_BOOKS = set([
        "Genesis","Exodus","Leviticus","Numbers","Deuteronomy",
        "Joshua","Judges","Ruth","1 Samuel","2 Samuel","1 Kings",
        "2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah",
        "Esther","Job","Psalms","Proverbs","Ecclesiastes",
        "Song of Solomon","Isaiah","Jeremiah","Lamentations",
        "Ezekiel","Daniel","Hosea","Joel","Amos","Obadiah",
        "Jonah","Micah","Nahum","Habakkuk","Zephaniah",
        "Haggai","Zechariah","Malachi"
    ])

    for book, chapters in data.items():
        testament = "OT" if book in OT_BOOKS else "NT"

        for chapter_num, verses in chapters.items():
            for verse_num, text in verses.items():
                insert_verse(cursor, "kjv", testament,
                             book,
                             int(chapter_num),
                             int(verse_num),
                             text)


# --------------------------------------------------
# MAIN EXECUTION
# --------------------------------------------------

def build_database():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    init_db(conn)

    print("Loading Tanakh...")
    load_tanakh(cursor)

    print("Loading Septuagint...")
    load_septuagint(cursor)

    print("Loading Textus Receptus...")
    load_textus_receptus(cursor)

    print("Loading KJV...")
    load_kjv(cursor)

    conn.commit()
    conn.close()

    print("Database successfully built.")


if __name__ == "__main__":
    build_database()