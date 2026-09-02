#ifndef M400_LED_BARE_METAL_H
#define M400_LED_BARE_METAL_H

#include "stm32f1xx.h"

#include <stdint.h>

#define M400_OFF 0U
#define M400_ON  1U

typedef struct
{
  GPIO_TypeDef *pxPort;
  uint32_t uiPinMask;
  uint32_t uiLastToggleMs;
  uint8_t ucActiveHigh;
  uint8_t ucState;
} M400_LED_t;

void M400_vD1_1GPIOInit(uint8_t ucActiveHigh);
void M400_vLEDInit(M400_LED_t *pxLED,
                   GPIO_TypeDef *pxPort,
                   uint32_t uiPinMask,
                   uint8_t ucActiveHigh);
void M400_vLEDSet(M400_LED_t *pxLED, uint8_t ucState);
void M400_vLEDToggle(M400_LED_t *pxLED);
void M400_vLEDBlinkTask(M400_LED_t *pxLED,
                        uint32_t uiNowMs,
                        uint32_t uiPeriodMs,
                        uint8_t ucEnabled);

#endif
