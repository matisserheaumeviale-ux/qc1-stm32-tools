#!/bin/bash
cd qc1-vscode || exit
npx tsc
npx @vscode/vsce package --allow-missing-repository
code --install-extension qc1-0.0.2.vsix
