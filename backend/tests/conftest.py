"""Pytest configuration and fixtures."""
import sys
from pathlib import Path

# Ensure backend root is on path when running pytest from repo root or backend
backend = Path(__file__).resolve().parent.parent
if str(backend) not in sys.path:
    sys.path.insert(0, str(backend))
