
import sys
from docx import Document

def analyze_layout(docx_path):
    try:
        doc = Document(docx_path)
        print(f"Paragraphs: {len(doc.paragraphs)}")
        print(f"Tables: {len(doc.tables)}")
        
        # Check first table structure (often used for Sidebar layouts)
        if doc.tables:
            t = doc.tables[0]
            print(f"Table 1 Rows: {len(t.rows)}")
            if len(t.rows) > 0:
                print(f"Table 1 Cols: {len(t.rows[0].cells)}")
                # Get text from first row cells to guess content
                c1 = t.rows[0].cells[0].text[:50].replace('\n', ' ')
                c2 = t.rows[0].cells[1].text[:50].replace('\n', ' ') if len(t.rows[0].cells) > 1 else "N/A"
                print(f"Cell 0: {c1}")
                print(f"Cell 1: {c2}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        analyze_layout(sys.argv[1])
