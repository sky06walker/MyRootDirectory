
import sys
from docx import Document

def dump_content(docx_path):
    try:
        doc = Document(docx_path)
        print("--- PARAGRAPHS ---")
        for p in doc.paragraphs:
            if p.text.strip():
                print(f"P: {p.text.strip()}")
        
        print("\n--- TABLES ---")
        for i, table in enumerate(doc.tables):
            print(f"Table {i}:")
            for row in table.rows:
                cells = [c.text.strip().replace('\n', ' ') for c in row.cells]
                print(" | ".join(cells))

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        dump_content(sys.argv[1])
