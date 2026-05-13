# QC1 Diagnostic Codes

Documentation officielle des codes de diagnostic utilisés par QC1 STM32 Tools.

---

# Structure des codes

| Range | Type |
|---|---|
| 200-299 | Succès |
| 300-399 | Information |
| 400-499 | Avertissement |
| 500-599 | Erreur |
| 600-699 | Système |
| 700-799 | Toolchain |
| 800-899 | Projet |
| 900-999 | Interne extension |

---

# Codes succès

| Code | Nom | Description |
|---|---|---|
| 200 | READY | Extension prête |
| 201 | COMMAND_DONE | Commande terminée |
| 202 | BUILD_SUCCESS | Compilation réussie |
| 203 | FLASH_SUCCESS | Flash réussi |
| 204 | CLEAN_SUCCESS | Nettoyage réussi |
| 205 | STATUS_SUCCESS | Vérification réussie |

---

# Codes information

| Code | Nom | Description |
|---|---|---|
| 300 | IDLE | Aucune tâche active |
| 301 | BUILD_STARTED | Compilation démarrée |
| 302 | FLASH_STARTED | Flash démarré |
| 303 | CLEAN_STARTED | Nettoyage démarré |
| 304 | STATUS_STARTED | Vérification démarrée |
| 305 | PROJECT_DETECTED | Projet STM32 détecté |
| 306 | TOOLCHAIN_DETECTED | Toolchain détecté |
| 307 | OPENOCD_DETECTED | OpenOCD détecté |
| 308 | STLINK_DETECTED | ST-Link détecté |
| 309 | NO_BUILD_YET | Aucun build effectué |
| 310 | NO_FLASH_YET | Aucun flash effectué |

---

# Codes avertissement

| Code | Nom | Description |
|---|---|---|
| 400 | NO_WORKSPACE | Aucun dossier ouvert |
| 401 | NO_MAKEFILE | Makefile introuvable |
| 402 | NO_QUICK_COMMAND | Script quick-command introuvable |
| 403 | NO_WINDOWS_MAKE | make.exe Windows introuvable |
| 404 | NO_ELF_FOUND | Fichier ELF introuvable |
| 405 | NO_BIN_FOUND | Fichier BIN introuvable |
| 406 | NO_BUILD_FOLDER | Dossier build introuvable |
| 407 | GCC_NOT_FOUND | arm-none-eabi-gcc introuvable |
| 408 | OPENOCD_NOT_FOUND | OpenOCD introuvable |
| 409 | STFLASH_NOT_FOUND | st-flash introuvable |
| 410 | SERIAL_NOT_FOUND | Aucun port série détecté |
| 411 | PROJECT_INCOMPLETE | Projet STM32 incomplet |
| 412 | OLD_BUILD_FILES | Fichiers build obsolètes |
| 413 | BUILD_WARNINGS | Warnings présents |
| 414 | FLASH_SKIPPED | Flash ignoré |

---

# Codes erreur

| Code | Nom | Description |
|---|---|---|
| 500 | BUILD_FAILED | Compilation échouée |
| 501 | FLASH_FAILED | Flash échoué |
| 502 | UNKNOWN_COMMAND | Commande QC1 inconnue |
| 503 | INVALID_PROJECT | Projet STM32 invalide |
| 504 | EXECUTION_FAILED | Exécution du script impossible |
| 505 | SCRIPT_PERMISSION_DENIED | Permission refusée |
| 506 | TOOLCHAIN_FAILED | Toolchain en erreur |
| 507 | GCC_EXECUTION_FAILED | GCC a échoué |
| 508 | OPENOCD_FAILED | OpenOCD a échoué |
| 509 | STLINK_FAILED | ST-Link a échoué |
| 510 | MAKE_FAILED | make a échoué |
| 511 | BUILD_INTERRUPTED | Build interrompu |
| 512 | FLASH_INTERRUPTED | Flash interrompu |
| 513 | SERIAL_CONNECTION_FAILED | Connexion série échouée |
| 514 | ELF_GENERATION_FAILED | ELF non généré |
| 515 | BIN_GENERATION_FAILED | BIN non généré |

---

# Codes système

| Code | Nom | Description |
|---|---|---|
| 600 | WINDOWS_DETECTED | Windows détecté |
| 601 | MACOS_DETECTED | macOS détecté |
| 602 | LINUX_DETECTED | Linux détecté |
| 603 | PATH_REBUILT | PATH reconstruit |
| 604 | BUNDLED_TOOLS_USED | Outils intégrés utilisés |
| 605 | SYSTEM_TOOLS_USED | Outils système utilisés |

---

# Codes toolchain

| Code | Nom | Description |
|---|---|---|
| 700 | GCC_READY | GCC prêt |
| 701 | OPENOCD_READY | OpenOCD prêt |
| 702 | STLINK_READY | ST-Link prêt |
| 703 | MAKE_READY | make prêt |
| 704 | TOOLCHAIN_READY | Toolchain prête |

---

# Codes projet

| Code | Nom | Description |
|---|---|---|
| 800 | STM32_PROJECT_VALID | Projet STM32 valide |
| 801 | CORE_FOLDER_FOUND | Dossier Core trouvé |
| 802 | DRIVERS_FOLDER_FOUND | Dossier Drivers trouvé |
| 803 | IOC_FOUND | Fichier IOC trouvé |
| 804 | MAKEFILE_FOUND | Makefile trouvé |
| 805 | BUILD_FOLDER_FOUND | Dossier build trouvé |

---

# Codes internes extension

| Code | Nom | Description |
|---|---|---|
| 900 | WEBVIEW_READY | Dashboard prêt |
| 901 | OUTPUT_CHANNEL_READY | Output channel prêt |
| 902 | STATUS_UPDATED | Statut mis à jour |
| 903 | UI_REFRESHED | Interface rafraîchie |
| 904 | STATE_SAVED | État sauvegardé |
| 905 | STATE_RESTORED | État restauré |

---

# Exemple d'utilisation

## Dashboard

```txt
Code: 202
Niveau: Succès
Message: Compilation réussie
```

## Avertissement

```txt
Code: 401
Niveau: Avertissement
Message: Makefile introuvable
```

## Erreur

```txt
Code: 500
Niveau: Erreur
Message: Compilation échouée
```

---

# Recommandations UI

| Niveau | Couleur |
|---|---|
| Succès | Vert |
| Information | Bleu |
| Avertissement | Orange |
| Erreur | Rouge |
| Interne | Violet |

---

# Notes

- Les codes QC1 doivent être affichés dans le dashboard.
- Les erreurs de compilation GCC ne remplacent pas les codes QC1.
- Les codes QC1 décrivent l’état de l’extension et du workflow.
- Un seul code principal devrait être actif à la fois.
