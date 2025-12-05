#!/usr/bin/env python3
"""
build.py - Merges modular source files into a single spihelper.js for Wikipedia deployment

Usage: python3 build.py
"""

import os

# Source files in dependency order
SOURCE_FILES = [
    'src/config-and-globals.js',
    'src/api-and-utilities.js',
    'src/ui-and-forms.js',
    'src/actions-blocking-tagging.js',
    'src/actions-archive-move.js',
    'src/main-orchestration.js'
]

OUTPUT_FILE = 'spihelper.js'

def build():
    """Merge all source files into a single output file."""
    print(f"Building {OUTPUT_FILE}...")

    # Check that all source files exist
    for src_file in SOURCE_FILES:
        if not os.path.exists(src_file):
            print(f"ERROR: Source file not found: {src_file}")
            return False

    # Read and concatenate all source files
    combined_content = []

    # Prepend nowiki
    combined_content.append("// <nowiki>\n")

    for src_file in SOURCE_FILES:
        print(f"  Reading {src_file}...")
        with open(src_file, 'r', encoding='utf-8') as f:
            content = f.read()
            combined_content.append(content)
            # Add a newline between modules for readability
            combined_content.append('\n')

    # Append close nowiki
    combined_content.append("// </nowiki>\n")

    # Write the combined content
    print(f"  Writing {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(''.join(combined_content))

    print(f"✓ Build complete! Generated {OUTPUT_FILE}")
    return True

if __name__ == '__main__':
    success = build()
    exit(0 if success else 1)
