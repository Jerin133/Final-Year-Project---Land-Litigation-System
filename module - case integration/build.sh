#!/usr/bin/env bash
# Build script for Render.com
# Forces pre-built binary wheels to avoid Fortran/C++ compilation errors
set -e

echo "==> Installing packages with pre-built binary wheels..."
pip install --upgrade pip

# Install heavy scientific packages first using binary-only wheels
pip install --prefer-binary \
    numpy==1.26.4 \
    pandas==2.2.3 \
    scipy==1.13.1 \
    scikit-learn==1.5.2

# Install remaining packages
pip install \
    fastapi==0.115.0 \
    "uvicorn[standard]==0.30.6" \
    pdfplumber==0.11.4 \
    requests==2.32.3

echo "==> Build complete!"
