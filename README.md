English
Overview

QC1 STM32 Tools is an all-in-one STM32 development environment extension for Visual Studio Code.

It simplifies embedded STM32 development by integrating:

Automatic STM32 project detection
Build and flashing tools
OpenOCD integration
ST-Link support
Serial monitoring
Portable configuration
AI integration
Diagnostics and error reporting

The goal is to provide a fast, portable, and beginner-friendly workflow for STM32 projects.

Features
Automatic STM32 Project Detection

QC1 automatically detects:

Core/
Drivers/
Makefile
STM32CubeMX projects
ARM GCC Toolchain
OpenOCD
ST-Link devices

No hardcoded paths required.

Integrated Commands
Build Project
qc1 make
Flash Firmware
qc1 flash
Complete Workflow
qc1 run
Project Status
qc1 status
Serial Monitor
qc1 ds
Error Diagnostics
qc1 errors
AI Integration

QC1 STM32 Tools supports local AI integration for embedded development assistance.

Compatible with:

Ollama
LM Studio
Local LLM servers

Supported models:

Mistral
Qwen
Devstral
Custom local models

Possible AI features:

Code assistance
Embedded debugging help
Error explanations
Project analysis
Embedded workflow automation
Cross-Platform Support

Supported operating systems:

Windows
macOS
Linux

Designed for:

Portable development
Shared classroom environments
USB workspaces
Student labs
Personal embedded projects
Included Tools

Integrated support for:

ARM GNU Toolchain
OpenOCD
ST-Link
Make
Serial communication
VSCode commands
Embedded diagnostics
Supported Hardware

Tested hardware:

STM32F103C8T6 (Blue Pill)
ST-Link V2

Other STM32 boards may also work.

Installation
Install from VSIX
code --install-extension qc1-stm32-tools-x.x.x.vsix
Requirements

Recommended:

ARM GNU Toolchain
OpenOCD
STM32CubeMX

Optional:

Ollama
LM Studio
Example Workflow
qc1 make
qc1 flash
qc1 ds
Project Structure Example
Project/
├── Core/
├── Drivers/
├── build/
├── scripts/
├── Makefile
└── qc1-config.json
Roadmap

Planned features:

Automatic dependency installation
Advanced STM32 diagnostics
CubeMX live integration
Multi-board support
Embedded project templates
AI-assisted debugging
Portable SDK packages
Automatic serial port detection
Contributing

Contributions are welcome.

Please:

Fork the repository
Create a feature branch
Commit changes
Open a pull request
License

This project is licensed under the MIT License.

Author

Matisse Rhéaume Viale

Electrical Engineering Student
Embedded Systems Developer
STM32 / PCB / AI Tooling

Français
Présentation

QC1 STM32 Tools est une extension tout-en-un pour le développement STM32 dans Visual Studio Code.

Elle simplifie le développement embarqué STM32 grâce à :

Détection automatique des projets STM32
Outils de compilation et de flash
Intégration OpenOCD
Support ST-Link
Moniteur série
Configuration portable
Intégration IA
Diagnostics et rapports d’erreurs

L’objectif est d’offrir un environnement rapide, portable et simple pour les projets STM32.

Fonctionnalités
Détection automatique des projets STM32

QC1 détecte automatiquement :

Core/
Drivers/
Makefile
Projets STM32CubeMX
Toolchain ARM GCC
OpenOCD
ST-Link

Aucun chemin codé en dur.

Commandes intégrées
Compiler le projet
qc1 make
Flasher le microcontrôleur
qc1 flash
Workflow complet
qc1 run
État du projet
qc1 status
Moniteur série
qc1 ds
Diagnostics d’erreurs
qc1 errors
Intégration IA

QC1 STM32 Tools supporte l’intégration d’IA locale pour assister le développement embarqué.

Compatible avec :

Ollama
LM Studio
Serveurs LLM locaux

Modèles supportés :

Mistral
Qwen
Devstral
Modèles personnalisés

Fonctionnalités possibles :

Assistance de code
Aide au débogage
Explication d’erreurs
Analyse de projets
Automatisation de workflow embarqué
Compatibilité multiplateforme

Systèmes supportés :

Windows
macOS
Linux

Conçu pour :

Développement portable
Laboratoires scolaires
Workspaces USB
Étudiants
Projets embarqués personnels
Outils inclus

Support intégré pour :

ARM GNU Toolchain
OpenOCD
ST-Link
Make
Communication série
Commandes VSCode
Diagnostics embarqués
Matériel supporté

Matériel testé :

STM32F103C8T6 (Blue Pill)
ST-Link V2

D’autres cartes STM32 peuvent aussi fonctionner.

Installation
Installation depuis un VSIX
code --install-extension qc1-stm32-tools-x.x.x.vsix
Prérequis

Recommandé :

ARM GNU Toolchain
OpenOCD
STM32CubeMX

Optionnel :

Ollama
LM Studio
Exemple de workflow
qc1 make
qc1 flash
qc1 ds
Exemple de structure de projet
Projet/
├── Core/
├── Drivers/
├── build/
├── scripts/
├── Makefile
└── qc1-config.json
Feuille de route

Fonctionnalités prévues :

Installation automatique des dépendances
Diagnostics STM32 avancés
Intégration CubeMX en direct
Support multi-cartes
Templates de projets embarqués
Débogage assisté par IA
SDK embarqué portable
Détection automatique des ports série
Contribution

Les contributions sont les bienvenues.

Étapes :

Fork du projet
Création d’une branche
Commit des modifications
Pull request
Licence

Ce projet est distribué sous licence MIT.

Auteur

Matisse Rhéaume Viale

Étudiant en génie électrique
Développeur systèmes embarqués
STM32 / PCB / Outils IA
