import os
import sys
import re
import argparse

# Exclude these directories regardless of location.
EXCLUDE_DIRS = {
    "node_modules", "target", "build", "dist", "migrations", "tests",
    "venv", ".venv", "tmp", "temp", "coverage", "out", ".git", ".idea", ".vscode"
}

# Exclude these files regardless of location.
EXCLUDE_FILES = {
    "LICENSE",
    "export_project.py",
    "package-lock.json",
    "Cargo.lock",
    "README.md",
    "jest.config.ts",
    "tsconfig.json",
    "tsconfig.lib.json",
    "tsconfig.spec.json"
}

def is_hidden(name):
    """Return True if the name indicates a hidden file or directory."""
    return name.startswith('.')

def should_exclude_dir(name):
    """Return True if a directory should be excluded."""
    return name in EXCLUDE_DIRS or is_hidden(name)

def should_exclude_file(name):
    """Return True if a file should be excluded."""
    return name in EXCLUDE_FILES or is_hidden(name)

def build_tree(start_path, prefix=""):
    """
    Recursively builds a list of strings representing a tree diagram of the
    directory structure under start_path, excluding hidden or filtered items.
    """
    lines = []
    try:
        entries = sorted(os.listdir(start_path))
    except Exception:
        return lines
    filtered_entries = []
    for entry in entries:
        full_entry = os.path.join(start_path, entry)
        if os.path.isdir(full_entry):
            if should_exclude_dir(entry):
                continue
        else:
            if should_exclude_file(entry):
                continue
        filtered_entries.append(entry)

    for i, entry in enumerate(filtered_entries):
        connector = "└── " if i == len(filtered_entries) - 1 else "├── "
        lines.append(prefix + connector + entry)
        full_path = os.path.join(start_path, entry)
        if os.path.isdir(full_path):
            extension = "    " if i == len(filtered_entries) - 1 else "│   "
            lines.extend(build_tree(full_path, prefix + extension))
    return lines

def shorten_python_functions(content, threshold=3):
    """
    Processes Python source code and shortens function bodies.
    For each function definition (lines starting with 'def' or 'async def'),
    if its body spans more than 'threshold' non-empty lines, only the signature
    is output followed by an ellipsis.
    """
    lines = content.splitlines(keepends=True)
    output_lines = []
    i = 0
    function_def_regex = re.compile(r'^(\s*)(async\s+)?def\s+\w+\(.*\):')
    while i < len(lines):
        line = lines[i]
        match = function_def_regex.match(line)
        if match:
            indent = match.group(1)
            output_lines.append(line)
            j = i + 1
            function_body_lines = []
            while j < len(lines):
                current_line = lines[j]
                if current_line.strip() == "":
                    function_body_lines.append(current_line)
                    j += 1
                    continue
                current_indent = len(current_line) - len(current_line.lstrip())
                if current_indent > len(indent):
                    function_body_lines.append(current_line)
                    j += 1
                else:
                    break
            if len([l for l in function_body_lines if l.strip()]) > threshold:
                output_lines.append(indent + "    ...\n")
            else:
                output_lines.extend(function_body_lines)
            i = j
        else:
            output_lines.append(line)
            i += 1
    return ''.join(output_lines)

def shorten_js_functions(content, threshold=3):
    """
    Processes TypeScript/JavaScript source code and shortens function bodies.
    It detects function declarations (traditional, function expressions, or arrow functions)
    by matching typical patterns and then uses a simple brace counting method.
    If the function body (excluding the first and last lines) has more than 'threshold'
    non-empty lines, it outputs just the signature followed by an ellipsis and the closing brace.
    """
    lines = content.splitlines(keepends=True)
    output_lines = []
    i = 0

    # Regex patterns for different JS/TS function definitions.
    pattern_traditional = re.compile(r'^\s*(async\s+)?function\s+\w+\s*\(.*\)\s*\{')
    pattern_arrow = re.compile(r'^\s*const\s+\w+\s*=\s*(async\s+)?\([^)]*\)\s*=>\s*\{')
    pattern_expr = re.compile(r'^\s*const\s+\w+\s*=\s*(async\s+)?function\s*\(.*\)\s*\{')

    while i < len(lines):
        line = lines[i]
        if pattern_traditional.match(line) or pattern_arrow.match(line) or pattern_expr.match(line):
            signature_line = line
            start_indent = len(line) - len(line.lstrip())
            block_lines = [line]
            # Start brace counting using the current line.
            brace_count = line.count('{') - line.count('}')
            i += 1
            while i < len(lines) and brace_count > 0:
                current_line = lines[i]
                block_lines.append(current_line)
                brace_count += current_line.count('{') - current_line.count('}')
                i += 1
            # Separate out the first and last lines from the body.
            body_lines = block_lines[1:-1]
            non_empty_body = [l for l in body_lines if l.strip()]
            if len(non_empty_body) > threshold:
                output_lines.append(signature_line)
                output_lines.append(" " * (start_indent + 4) + "...\n")
                # Append the final closing brace line.
                output_lines.append(block_lines[-1])
            else:
                output_lines.extend(block_lines)
        else:
            output_lines.append(line)
            i += 1
    return ''.join(output_lines)

def remove_python_imports(content):
    """
    Removes Python import statements from the content.
    """
    lines = content.splitlines(keepends=True)
    filtered = [line for line in lines if not re.match(r'^\s*(import|from)\s+', line)]
    return ''.join(filtered)

def remove_js_imports(content):
    """
    Removes JavaScript/TypeScript import statements from the content.
    This removes ES module imports as well as common require() calls.
    """
    lines = content.splitlines(keepends=True)
    filtered = [line for line in lines if not re.match(r'^\s*(import\s|const\s+\w+\s*=\s*require\()', line)]
    return ''.join(filtered)

def process_directory(export_root, base_dir, out_f, sig=False):
    """
    Walk through base_dir (a subdirectory of export_root) and write its structure
    and file contents to out_f. The relative paths are computed with respect to export_root.
    If sig is True and the file is a Python, JavaScript, or TypeScript file,
    long function bodies are shortened and import statements removed.
    """
    for dirpath, dirnames, filenames in os.walk(base_dir):
        # Filter out directories to be excluded.
        dirnames[:] = [d for d in dirnames if not should_exclude_dir(d)]
        
        # Write header for the current directory.
        relative_dir = os.path.relpath(dirpath, export_root)
        out_f.write("\n" + "=" * 80 + "\n")
        out_f.write(f"Directory: {relative_dir}\n")
        out_f.write("=" * 80 + "\n")
        
        for filename in filenames:
            if should_exclude_file(filename):
                continue
            file_path = os.path.join(dirpath, filename)
            relative_file = os.path.relpath(file_path, export_root)
            out_f.write("\n" + "-" * 60 + "\n")
            out_f.write(f"File: {relative_file}\n")
            out_f.write("-" * 60 + "\n")
            
            try:
                with open(file_path, 'r', encoding='utf-8') as file_content:
                    content = file_content.read()
                    ext = os.path.splitext(filename)[1].lower()
                    if sig and ext in {'.py', '.js', '.ts'}:
                        if ext == '.py':
                            content = shorten_python_functions(content)
                            content = remove_python_imports(content)
                        else:
                            content = shorten_js_functions(content)
                            content = remove_js_imports(content)
                    out_f.write(content)
            except Exception as e:
                out_f.write(f"[Error reading file: {e}]\n")

def main():
    parser = argparse.ArgumentParser(
        description="Export monorepo structure to llms.txt with optional function signature extraction and import removal."
    )
    parser.add_argument("targets", nargs="*", default=["."],
                        help="Directories to export (relative to monorepo root)")
    parser.add_argument("-s", "--sig", action="store_true",
                        help="Shorten long function bodies and remove imports (for .py, .js, .ts files)")
    args = parser.parse_args()

    export_root = os.getcwd()
    output_text_file = os.path.join(export_root, "llms.txt")
    
    with open(output_text_file, 'w', encoding='utf-8') as out_f:
        # Write the structure diagram at the top.
        out_f.write("STRUCTURE DIAGRAM\n")
        out_f.write("=" * 80 + "\n")
        for target in args.targets:
            target_path = os.path.join(export_root, target)
            if not os.path.exists(target_path):
                print(f"Warning: {target_path} does not exist. Skipping diagram for this target.")
                continue
            out_f.write(f"{os.path.relpath(target_path, export_root)}\n")
            diagram_lines = build_tree(target_path)
            for line in diagram_lines:
                out_f.write(line + "\n")
            out_f.write("\n")
        out_f.write("=" * 80 + "\n\n")
        
        # Process each target directory and export its contents.
        for target in args.targets:
            target_path = os.path.join(export_root, target)
            if not os.path.exists(target_path):
                print(f"Warning: {target_path} does not exist. Skipping.")
                continue
            out_f.write("\n" + "#" * 80 + "\n")
            out_f.write(f"EXPORTING: {os.path.relpath(target_path, export_root)}\n")
            out_f.write("#" * 80 + "\n")
            process_directory(export_root, target_path, out_f, sig=args.sig)
    
    print(f"Structure file created: {output_text_file}")

if __name__ == "__main__":
    main()
