#include "m400_led_bare_metal.h"

volatile uint32_t g_uiNowMs = 0U;

void SysTick_Handler(void)
{
  g_uiNowMs++;
}

int main(void)
{
  static M400_LED_t xD1_1;

  SystemCoreClockUpdate();
  M400_vD1_1GPIOInit(1U);
  M400_vLEDInit(&xD1_1, GPIOC, (1UL << 13U), 1U);

  if (SysTick_Config(SystemCoreClock / 1000U) != 0U)
  {
    for (;;)
    {
      /* La fréquence système ne permet pas de créer le tick de 1 ms. */
    }
  }

  for (;;)
  {
    M400_vLEDBlinkTask(&xD1_1, g_uiNowMs, 500U, 1U);
    __WFI();
  }
}
