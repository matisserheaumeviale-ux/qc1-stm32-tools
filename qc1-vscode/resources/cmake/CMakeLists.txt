cmake_minimum_required(VERSION 3.20)

project(qc1_stm32_firmware LANGUAGES C ASM)

if(NOT QC1_PROJECT_ROOT)
  message(FATAL_ERROR "QC1_PROJECT_ROOT is required")
endif()

cmake_path(ABSOLUTE_PATH QC1_PROJECT_ROOT NORMALIZE OUTPUT_VARIABLE QC1_ROOT)
if(NOT EXISTS "${QC1_ROOT}/Core/Src" AND NOT EXISTS "${QC1_ROOT}/Src")
  message(FATAL_ERROR "QC1 expects Src/ or Core/Src/ under ${QC1_ROOT}")
endif()

file(GLOB_RECURSE QC1_C_SOURCES CONFIGURE_DEPENDS
  "${QC1_ROOT}/Core/Src/*.c"
  "${QC1_ROOT}/Drivers/STM32F1xx_HAL_Driver/Src/*.c"
  "${QC1_ROOT}/Middlewares/*.c"
  "${QC1_ROOT}/USB_DEVICE/*.c"
  "${QC1_ROOT}/App/*.c"
  "${QC1_ROOT}/Src/*.c"
)
list(FILTER QC1_C_SOURCES EXCLUDE REGEX "/Templates(_LL)?/")

if(QC1_STARTUP AND EXISTS "${QC1_STARTUP}")
  set(QC1_STARTUP_SOURCES "${QC1_STARTUP}")
else()
  file(GLOB QC1_STARTUP_SOURCES CONFIGURE_DEPENDS
    "${QC1_ROOT}/Core/Startup/startup_stm32f103*.s"
    "${QC1_ROOT}/Core/Startup/startup_stm32f103*.S"
    "${QC1_ROOT}/Src/startup_stm32f103*.s"
    "${QC1_ROOT}/Src/startup_stm32f103*.S"
    "${QC1_ROOT}/startup_stm32f103*.s"
    "${QC1_ROOT}/startup_stm32f103*.S"
  )
endif()

if(QC1_LINKER_SCRIPT AND EXISTS "${QC1_LINKER_SCRIPT}")
  set(QC1_LINKER_SCRIPTS "${QC1_LINKER_SCRIPT}")
else()
  file(GLOB QC1_LINKER_SCRIPTS CONFIGURE_DEPENDS "${QC1_ROOT}/*.ld")
endif()

list(LENGTH QC1_C_SOURCES QC1_C_SOURCE_COUNT)
list(LENGTH QC1_STARTUP_SOURCES QC1_STARTUP_COUNT)
list(LENGTH QC1_LINKER_SCRIPTS QC1_LINKER_COUNT)
if(QC1_C_SOURCE_COUNT EQUAL 0)
  message(FATAL_ERROR "No C sources found in the STM32 project")
endif()
if(QC1_STARTUP_COUNT EQUAL 0)
  message(FATAL_ERROR "No STM32F1 startup assembly file found")
endif()
if(QC1_LINKER_COUNT EQUAL 0)
  message(FATAL_ERROR "No linker script (*.ld) found")
endif()

list(GET QC1_STARTUP_SOURCES 0 QC1_STARTUP)
list(GET QC1_LINKER_SCRIPTS 0 QC1_LINKER_SCRIPT)
get_filename_component(QC1_STARTUP_NAME "${QC1_STARTUP}" NAME)
string(TOLOWER "${QC1_STARTUP_NAME}" QC1_STARTUP_LOWER)

if(QC1_STARTUP_LOWER MATCHES "stm32f103x6")
  set(QC1_DEVICE_DEFINE STM32F103x6)
elseif(QC1_STARTUP_LOWER MATCHES "stm32f103x[bc]")
  set(QC1_DEVICE_DEFINE STM32F103xB)
elseif(QC1_STARTUP_LOWER MATCHES "stm32f103x[de]")
  set(QC1_DEVICE_DEFINE STM32F103xE)
elseif(QC1_STARTUP_LOWER MATCHES "stm32f103x[fg]")
  set(QC1_DEVICE_DEFINE STM32F103xG)
else()
  set(QC1_DEVICE_DEFINE STM32F103xB)
  message(WARNING "Unknown STM32F103 density in ${QC1_STARTUP_NAME}; using STM32F103xB")
endif()

file(GLOB_RECURSE QC1_HEADERS CONFIGURE_DEPENDS
  "${QC1_ROOT}/Core/*.h"
  "${QC1_ROOT}/Drivers/*.h"
  "${QC1_ROOT}/Middlewares/*.h"
  "${QC1_ROOT}/USB_DEVICE/*.h"
  "${QC1_ROOT}/App/*.h"
  "${QC1_ROOT}/Inc/*.h"
)
set(QC1_INCLUDE_DIRS "${QC1_ROOT}/Core/Inc" "${QC1_ROOT}/Inc")
foreach(QC1_HEADER IN LISTS QC1_HEADERS)
  get_filename_component(QC1_HEADER_DIR "${QC1_HEADER}" DIRECTORY)
  list(APPEND QC1_INCLUDE_DIRS "${QC1_HEADER_DIR}")
endforeach()
list(REMOVE_DUPLICATES QC1_INCLUDE_DIRS)

add_executable(firmware ${QC1_C_SOURCES} "${QC1_STARTUP}")
set_target_properties(firmware PROPERTIES OUTPUT_NAME firmware SUFFIX ".elf")

target_include_directories(firmware PRIVATE ${QC1_INCLUDE_DIRS})
target_compile_definitions(firmware PRIVATE ${QC1_DEVICE_DEFINE})
if(EXISTS "${QC1_ROOT}/Drivers/STM32F1xx_HAL_Driver")
  target_compile_definitions(firmware PRIVATE USE_HAL_DRIVER)
endif()
target_compile_options(firmware PRIVATE
  -mcpu=cortex-m3
  -mthumb
  -mfloat-abi=soft
  -ffunction-sections
  -fdata-sections
  $<$<COMPILE_LANGUAGE:C>:-Wall;-Wextra;-Wno-unused-parameter>
  $<$<COMPILE_LANGUAGE:ASM>:-x;assembler-with-cpp>
)
target_link_options(firmware PRIVATE
  -mcpu=cortex-m3
  -mthumb
  -mfloat-abi=soft
  --specs=nano.specs
  --specs=nosys.specs
  "-T${QC1_LINKER_SCRIPT}"
  "-Wl,-Map=${CMAKE_BINARY_DIR}/firmware.map,--cref"
  -Wl,--gc-sections
  -Wl,--start-group
  -lc
  -lm
  -Wl,--end-group
)

add_custom_command(TARGET firmware POST_BUILD
  COMMAND "${CMAKE_OBJCOPY}" -O ihex "$<TARGET_FILE:firmware>" "${CMAKE_BINARY_DIR}/firmware.hex"
  COMMAND "${CMAKE_OBJCOPY}" -O binary -S "$<TARGET_FILE:firmware>" "${CMAKE_BINARY_DIR}/firmware.bin"
  COMMAND "${CMAKE_SIZE}" "$<TARGET_FILE:firmware>"
  COMMENT "Generating firmware.hex and firmware.bin"
)

if(QC1_OPENOCD AND EXISTS "${QC1_OPENOCD}")
  add_custom_target(flash
    COMMAND "${QC1_OPENOCD}"
      -f interface/stlink.cfg
      -f target/stm32f1x.cfg
      -c "program $<TARGET_FILE:firmware> verify reset exit"
    DEPENDS firmware
    USES_TERMINAL
  )
elseif(QC1_STFLASH AND EXISTS "${QC1_STFLASH}")
  add_custom_target(flash
    COMMAND "${QC1_STFLASH}" --reset write "${CMAKE_BINARY_DIR}/firmware.bin" 0x08000000
    DEPENDS firmware
    USES_TERMINAL
  )
else()
  message(STATUS "Flash target disabled: OpenOCD and st-flash were not found")
endif()

message(STATUS "QC1 project: ${QC1_ROOT}")
message(STATUS "QC1 startup: ${QC1_STARTUP}")
message(STATUS "QC1 linker: ${QC1_LINKER_SCRIPT}")
message(STATUS "QC1 device define: ${QC1_DEVICE_DEFINE}")
