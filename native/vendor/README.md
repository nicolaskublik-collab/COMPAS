# Dependencias del motor nativo de audio

Fuentes incluidas en el motor nativo de reproducción, mezcla, ruteo y cambio de pitch.

| Dependencia | Versión fijada | Licencia | Procedencia |
|---|---|---|---|
| RtAudio | 6.0.1 | MIT-like; ver `rtaudio/LICENSE` | [thestk/rtaudio](https://github.com/thestk/rtaudio/tree/6.0.1) |
| Signalsmith Stretch | `88061fd4eda56a2353c5d65c74aa3f4ccf76f9da` | MIT; ver `signalsmith-stretch/LICENSE.txt` | [Signalsmith-Audio/signalsmith-stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch/commit/88061fd4eda56a2353c5d65c74aa3f4ccf76f9da) |
| Signalsmith Linear | 0.6.6 (`7bb1c8f36794d6980080ce817c91f8da8fe56a66`) | MIT; ver `signalsmith-linear/LICENSE.txt` | [Signalsmith-Audio/linear](https://github.com/Signalsmith-Audio/linear/tree/0.6.6) |
| miniaudio | 0.11.26 | MIT or public domain; ver `MINIAUDIO-LICENSE` | [mackron/miniaudio](https://github.com/mackron/miniaudio/tree/0.11.26) |
| nlohmann/json | 3.12.0 | MIT; ver `NLOHMANN-JSON-LICENSE` | [nlohmann/json](https://github.com/nlohmann/json/tree/v3.12.0) |

El SDK oficial de Steinberg ASIO 2.3 descargado está en `asiosdk/`; su licencia dual ofrece GPLv3 o una licencia propietaria. Para esta aplicación se eligió GPLv3; la licencia del proyecto está en `../../LICENSE`. El SDK no se puede redistribuir bajo la licencia propietaria sin autorización escrita de Steinberg. El build actual usa los adaptadores ASIO incluidos con RtAudio 6.0.1, porque la lista de dispositivos del host actualizado del SDK falló con ASIO4ALL en este equipo. El SDK extraído se conserva como referencia y no forma parte del build actual.

Para compilar se instalaron Visual Studio Build Tools 2022 (MSVC 14.44) y CMake 4.4.4 desde sus distribuidores oficiales.
