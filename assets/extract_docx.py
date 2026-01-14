
import sys
try:
    from docx import Document
except ImportError:
    print("python-docx not installed")
    sys.exit(1)

def getText(filename):
    doc = Document(filename)
    fullText = []
    # Extract paragraphs
    for para in doc.paragraphs:
        if para.text.strip():
            fullText.append(para.text)
    
    # Extract tables (CVs often use tables)
    for table in doc.tables:
        for row in table.rows:
            row_text = [cell.text for cell in row.cells]
            fullText.append(" | ".join(row_text))
            
    return '\n'.join(fullText)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        try:
            print(getText(sys.argv[1]))
        except Exception as e:
            print(f"Error: {e}")
    else:
        print("Usage: python extract_docx.py <filename>")
