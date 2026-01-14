
import sys
from docx import Document

def dump_content(docx_path, output_path):
    try:
        doc = Document(docx_path)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write("--- PARAGRAPHS ---\n")
            for p in doc.paragraphs:
                if p.text.strip():
                    f.write(f"P: {p.text.strip()}\n")
            
            f.write("\n--- TABLES ---\n")
            for i, table in enumerate(doc.tables):
                f.write(f"Table {i}:\n")
                for row in table.rows:
                    cells = [c.text.strip().replace('\n', ' ') for c in row.cells]
                    f.write(" | ".join(cells) + "\n")
        print(f"Dumped content to {output_path}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 2:
        dump_content(sys.argv[1], sys.argv[2])
