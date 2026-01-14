
import sys
from docx import Document

def list_sections(docx_path):
    try:
        doc = Document(docx_path)
        print("--- EXTRACTED HEADERS/FIELDS ---")
        for para in doc.paragraphs:
            # simple heuristic: bold text or short uppercase lines or specific styles
            if para.text.strip():
                # print first few words to identify sections
                is_bold = any(run.bold for run in para.runs)
                if is_bold or len(para.text) < 30: # likely a header
                    print(f"Header?: {para.text.strip()}")
        
        print("\n--- TABLE CONTENT (First Row/Col) ---")
        for i, table in enumerate(doc.tables):
            print(f"Table {i}:")
            for row in table.rows[:3]: # first 3 rows
                print(" | ".join([c.text.strip()[:20] for c in row.cells]))

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        list_sections(sys.argv[1])
