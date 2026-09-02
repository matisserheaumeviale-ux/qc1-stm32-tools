# QC1 STM32F103 CMake Tools

QC1 est une extension VS Code autonome pour compiler un projet STM32F103 avec **CMake + Ninja**, sans `Makefile`, sans `CMakeLists.txt` dans le firmware et sans script externe.

## Commencer ici

1. Installe le VSIX :

   ```sh
   code --install-extension qc1-vscode/qc1-stm32-tools-0.3.0.vsix --force
   ```

2. Redémarre VS Code.
3. Ouvre le dossier STM32 qui contient `Core/`, `Drivers/`, le startup `.s` et le linker script `.ld`.
4. Dans la barre latérale **QC1 STM32**, lance **Show STM32 Status**, puis **Build Project**.
5. Branche le ST-Link et lance **Flash STM32**.

Les dépendances VS Code installent automatiquement CMake, Ninja et ARM GCC. Le projet firmware ne requiert aucun fichier propre à QC1.

## Documentation et exemple LED D1-1

Le [guide complet de l'extension](qc1-vscode/README.md) explique :

- l'installation et le premier démarrage;
- les fichiers requis et le fonctionnement autonome;
- la compilation et le flash avec ST-Link;
- les commandes et réglages QC1;
- le dépannage;
- un exemple bare metal prêt à copier pour faire clignoter la LED D1-1 sur PC13, sans HAL.

Le modèle seul est disponible dans [`qc1-vscode/examples/blink-led-d1-1`](qc1-vscode/examples/blink-led-d1-1/README.md).

## Artefacts de compilation

QC1 écrit les fichiers générés dans `build/qc1/` :

- `firmware.elf`;
- `firmware.bin`;
- `firmware.hex`;
- `firmware.map`.

## Autonomie et limite matérielle

L'extension embarque son interface, son moteur de build CMake, sa toolchain et ses modèles. CMake, Ninja et ARM GCC sont fournis automatiquement par la dépendance VS Code Embedded Build Tools.

Le flash physique demande toujours un ST-Link fonctionnel, un pilote compatible et OpenOCD ou `st-flash`, car ces éléments communiquent directement avec le matériel.

## Licence

MIT
