cmake_minimum_required(VERSION 3.24)

project(CompasAudio LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(RTAUDIO_BUILD_STATIC_LIBS ON CACHE BOOL "" FORCE)
set(RTAUDIO_BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(RTAUDIO_API_ASIO ON CACHE BOOL "" FORCE)
set(RTAUDIO_API_WASAPI ON CACHE BOOL "" FORCE)
set(RTAUDIO_API_DS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)

add_subdirectory(vendor/rtaudio EXCLUDE_FROM_ALL)

add_executable(compas-audio src/audio_engine.cpp)
target_include_directories(compas-audio SYSTEM PRIVATE
  vendor
  vendor/signalsmith-stretch/include
  vendor/signalsmith-linear/include
)
target_link_libraries(compas-audio PRIVATE rtaudio)

if(MSVC)
  target_compile_options(compas-audio PRIVATE /W4 /permissive-)
endif()

install(TARGETS compas-audio RUNTIME DESTINATION .)
