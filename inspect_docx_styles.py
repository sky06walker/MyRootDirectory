
import zipfile
import re
import sys
import xml.etree.ElementTree as ET

def extract_styles(docx_path):
    try:
        with zipfile.ZipFile(docx_path, 'r') as z:
            # List files to be sure
            # print(z.namelist())
            
            # Extract Colors from Theme
            colors = []
            if 'word/theme/theme1.xml' in z.namelist():
                xml_content = z.read('word/theme/theme1.xml').decode('utf-8')
                # Simple regex for hex codes could work, or parsing XML
                # Look for srgbClr val="..."
                found_colors = re.findall(r'srgbClr\s+val="([0-9a-fA-F]{6})"', xml_content)
                colors.extend(found_colors)
            
            # Extract Fonts
            fonts = set()
            if 'word/theme/theme1.xml' in z.namelist():
                 # Look for latin typeface="..."
                 found_fonts = re.findall(r'latin\s+typeface="([^"]+)"', xml_content)
                 fonts.update(found_fonts)
            
            print("Extracted Colors (Hex):", list(set(colors)))
            print("Extracted Fonts:", list(fonts))
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        extract_styles(sys.argv[1])
    else:
        print("Usage: python inspect_docx_styles.py <docx_path>")
