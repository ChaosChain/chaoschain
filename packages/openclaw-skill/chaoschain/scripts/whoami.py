#!/usr/bin/env python3
"""
Wrapper for whoami command - uses venv with web3 installed

OpenClaw expects separate scripts for each command.
This wrapper calls the main chaoschain_skill.py with the 'whoami' command.
"""
import sys
import os
import subprocess

scripts_dir = os.path.dirname(os.path.abspath(__file__))
skill_dir = os.path.dirname(scripts_dir)
venv_python = os.path.join(skill_dir, ".venv", "bin", "python3")
main_script = os.path.join(scripts_dir, "chaoschain_skill.py")

if os.path.exists(venv_python):
    python_exe = venv_python
else:
    python_exe = sys.executable

args = [python_exe, main_script, "whoami"] + sys.argv[1:]
sys.exit(subprocess.call(args))
