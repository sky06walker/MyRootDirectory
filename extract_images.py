
import zipfile
import os
import sys

def extract_images(docx_path, output_dir):
    try:
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        with zipfile.ZipFile(docx_path, 'r') as z:
            for file in z.namelist():
                if file.startswith('word/media/'):
                    z.extract(file, output_dir)
                    print(f"Extracted: {file}")
                    
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 2:
        extract_images(sys.argv[1], sys.argv[2])
