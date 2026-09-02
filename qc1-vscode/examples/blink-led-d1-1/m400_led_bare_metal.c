#include "m400_led_bare_metal.h"

#include <stddef.h>

#define M400_D1_1_PIN_MASK (1UL << 13U)

void M400_vD1_1GPIOInit(uint8_t ucActiveHigh)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;
  (void)RCC->APB2ENR;

  /* Précharge l'état OFF avant de transformer PC13 en sortie. */
  GPIOC->BSRR = (ucActiveHigh != 0U)
                  ? (M400_D1_1_PIN_MASK << 16U)
                  : M400_D1_1_PIN_MASK;

  /* PC13 : sortie push-pull, 2 MHz. CNF13=00, MODE13=10. */
  GPIOC->CRH = (GPIOC->CRH & ~(GPIO_CRH_CNF13 | GPIO_CRH_MODE13))
             | GPIO_CRH_MODE13_1;
}

void M400_vLEDInit(M400_LED_t *pxLED,
                   GPIO_TypeDef *pxPort,
                   uint32_t uiPinMask,
                   uint8_t ucActiveHigh)
{
  if ((pxLED == NULL) || (pxPort == NULL))
  {
    return;
  }

  pxLED->pxPort = pxPort;
  pxLED->uiPinMask = uiPinMask;
  pxLED->uiLastToggleMs = 0U;
  pxLED->ucActiveHigh = (ucActiveHigh != 0U) ? 1U : 0U;
  pxLED->ucState = M400_OFF;
  M400_vLEDSet(pxLED, M400_OFF);
}

void M400_vLEDSet(M400_LED_t *pxLED, uint8_t ucState)
{
  uint8_t ucTurnOn;
  uint8_t ucDriveHigh;

  if ((pxLED == NULL) || (pxLED->pxPort == NULL))
  {
    return;
  }

  ucTurnOn = (ucState != M400_OFF) ? 1U : 0U;
  ucDriveHigh = (ucTurnOn == pxLED->ucActiveHigh) ? 1U : 0U;

  /* BSRR est atomique : bits 0..15 = SET, bits 16..31 = RESET. */
  pxLED->pxPort->BSRR = (ucDriveHigh != 0U)
                          ? pxLED->uiPinMask
                          : (pxLED->uiPinMask << 16U);
  pxLED->ucState = ucTurnOn;
}

void M400_vLEDToggle(M400_LED_t *pxLED)
{
  if (pxLED == NULL)
  {
    return;
  }

  M400_vLEDSet(pxLED,
               (pxLED->ucState == M400_OFF) ? M400_ON : M400_OFF);
}

void M400_vLEDBlinkTask(M400_LED_t *pxLED,
                        uint32_t uiNowMs,
                        uint32_t uiPeriodMs,
                        uint8_t ucEnabled)
{
  if (pxLED == NULL)
  {
    return;
  }

  if (ucEnabled == 0U)
  {
    M400_vLEDSet(pxLED, M400_OFF);
    pxLED->uiLastToggleMs = uiNowMs;
    return;
  }

  if ((uint32_t)(uiNowMs - pxLED->uiLastToggleMs) >= uiPeriodMs)
  {
    pxLED->uiLastToggleMs = uiNowMs;
    M400_vLEDToggle(pxLED);
  }
}
