#!/usr/bin/env python3

import os
import sys
import argparse

try:
    import pathspec
except ImportError:
    print("Missing dependency 'pathspec'. Install it via 'pip install pathspec' and rerun.")
    sys.exit(1)

EXCLUDE_DIRS = {
    "node_modules", "target", "build", "dist", "migrations",
    "venv", ".venv", "tmp", "temp", "coverage", "out", ".git", ".idea", ".vscode",
    "artifacts", "typechain-types"
}

EXCLUDE_FILES = {
    "LICENSE",
    "export_project.py",
    "package-lock.json",
    "Cargo.lock",
    "jest.config.ts",
    "tsconfig.json",
    "tsconfig.lib.json",
    "tsconfig.spec.json",
}

def load_gitignore_spec(verbose=False):
    """
    Loads and parses .gitignore in the current directory (if it exists)
    and returns a pathspec object. If no .gitignore is found, returns an
    empty spec that won't match anything.
    """
    gitignore_path = os.path.join(".", ".gitignore")
    if os.path.isfile(gitignore_path):
        if verbose:
            print(f"[DEBUG] Found .gitignore at: {gitignore_path}")
        with open(gitignore_path, "r", encoding="utf-8") as f:
            gitignore_lines = f.read().splitlines()
        return pathspec.PathSpec.from_lines(
            pathspec.patterns.GitWildMatchPattern, gitignore_lines
        )
    else:
        if verbose:
            print("[DEBUG] No .gitignore found; using empty ignore spec.")
        return pathspec.PathSpec.from_lines(
            pathspec.patterns.GitWildMatchPattern, []
        )

def is_excluded_path(rel_path: str, spec: pathspec.PathSpec, verbose=False) -> bool:
    """
    Returns True if the given *relative* path should be excluded because:
      1. It matches .gitignore patterns in the pathspec
      2. It contains any directory in EXCLUDE_DIRS in its path segments
      3. The filename itself is in EXCLUDE_FILES
    """
    if spec.match_file(rel_path):
        if verbose:
            print(f"[DEBUG] '{rel_path}' EXCLUDED by .gitignore pattern.")
        return True

    parts = rel_path.split(os.sep)

    # If any segment of the path is in EXCLUDE_DIRS, exclude
    for part in parts:
        if part in EXCLUDE_DIRS:
            if verbose:
                print(f"[DEBUG] '{rel_path}' EXCLUDED because directory '{part}' is in EXCLUDE_DIRS.")
            return True

    # If the final segment (filename) is in EXCLUDE_FILES, exclude
    filename = os.path.basename(rel_path)
    if filename in EXCLUDE_FILES:
        if verbose:
            print(f"[DEBUG] '{rel_path}' EXCLUDED because file '{filename}' is in EXCLUDE_FILES.")
        return True

    return False

def export_project(directories, verbose=False):
    """
    Recursively walks the given directories, collects file contents into llms.txt,
    and excludes any paths (files or directories) based on .gitignore, EXCLUDE_DIRS,
    and EXCLUDE_FILES.
    """
    spec = load_gitignore_spec(verbose=verbose)
    output_filename = "llms.txt"
    if verbose:
        print(f"[DEBUG] Writing output to: {output_filename}")

    with open(output_filename, "w", encoding="utf-8") as outfile:
        for directory in directories:
            if verbose:
                print(f"[DEBUG] Starting walk at directory: {directory}")
            for root, subdirs, files in os.walk(directory):
                rel_root = os.path.relpath(root, start=".")

                # Check if the current directory root is excluded
                if verbose:
                    print(f"[DEBUG] Checking directory root: {root} (relative: {rel_root})")
                if is_excluded_path(rel_root, spec, verbose=verbose):
                    if verbose:
                        print(f"[DEBUG] -> Excluding directory root: {rel_root}")
                    subdirs[:] = []  # prevent descending further
                    continue

                # Filter subdirectories
                kept_subdirs = []
                for d in subdirs:
                    subdir_path = os.path.join(rel_root, d)
                    if is_excluded_path(subdir_path, spec, verbose=verbose):
                        if verbose:
                            print(f"[DEBUG] -> Excluding subdir: {subdir_path}")
                    else:
                        kept_subdirs.append(d)
                subdirs[:] = kept_subdirs

                # Now handle files in the current directory
                for fname in files:
                    full_path = os.path.join(root, fname)
                    rel_path = os.path.relpath(full_path, start=".")

                    # Check if this file is excluded
                    if is_excluded_path(rel_path, spec, verbose=verbose):
                        if verbose:
                            print(f"[DEBUG] -> Skipping file: {rel_path}")
                        continue

                    # Otherwise, read the file
                    try:
                        with open(full_path, "r", encoding="utf-8") as f:
                            content = f.read()
                    except (UnicodeDecodeError, PermissionError, IsADirectoryError) as e:
                        if verbose:
                            print(f"[DEBUG] -> Could not read file: {rel_path}. Reason: {e}")
                        continue

                    if verbose:
                        print(f"[DEBUG] -> Including file: {rel_path}")
                    outfile.write(f"==== {rel_path} ====\n")
                    outfile.write(content)
                    outfile.write("\n\n")  # blank line separator

def main():
    parser = argparse.ArgumentParser(
        description="Export project files into a single llms.txt file, "
                    "excluding generated directories, .gitignore patterns, "
                    "and specified files."
    )
    parser.add_argument(
        "dirs",
        nargs="*",
        default=["."],
        help="Directories to scan. Defaults to current directory (the entire repo)."
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose debug output (hidden by default)."
    )

    args = parser.parse_args()

    directories_to_scan = args.dirs
    export_project(directories_to_scan, verbose=args.verbose)

if __name__ == "__main__":
    main()
