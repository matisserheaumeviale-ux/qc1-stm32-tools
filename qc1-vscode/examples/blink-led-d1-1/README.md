# Modèle bare metal D1-1 : clignotement sur PC13

Ce modèle suppose que la LED physique D1-1 est reliée à `PC13`. Il utilise uniquement les registres STM32F103 exposés par CMSIS : aucune fonction HAL n'est appelée.

1. Copie [`m400_led_bare_metal.h`](m400_led_bare_metal.h) dans `Core/Inc/`.
2. Copie [`m400_led_bare_metal.c`](m400_led_bare_metal.c) dans `Core/Src/`.
3. Intègre [`main-bare-metal.c`](main-bare-metal.c) à ton `Core/Src/main.c`.
4. Assure-toi qu'il n'existe qu'un seul `SysTick_Handler` dans le projet.
5. Compile avec **QC1 STM32: Build Project**.
6. Branche le ST-Link et lance **QC1 STM32: Flash STM32**.

Le code suit l'architecture non bloquante de `M400_vLEDBlinkTask` : l'horodatage courant est passé à la tâche, qui ne change la LED que lorsque la période est écoulée. Contrairement à la version actuelle de la bibliothèque, `M400_vLEDSet` écrit directement dans `GPIOx->BSRR` au lieu d'appeler `HAL_GPIO_WritePin`.

La configuration fournie correspond à PC13 et à une LED active à l'état haut, comme la LED d'état du projet local inspecté. Le nom physique D1-1 n'y apparaît toutefois pas : confirme son câblage sur le schéma. Si ta LED est active à l'état bas, remplace les deux arguments `1U` d'initialisation par `0U`. Si D1-1 utilise une autre broche, adapte le masque GPIO et la configuration `CRL` ou `CRH`.

Un projet ne doit contenir qu'un seul `SysTick_Handler`. Si ce gestionnaire existe déjà dans un autre fichier, retire celui de `main-bare-metal.c`, ajoute `extern volatile uint32_t g_uiNowMs;` dans le fichier d'interruption, puis incrémente cette variable dans le gestionnaire existant.
