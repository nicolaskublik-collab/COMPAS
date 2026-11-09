# COMPAS (Compás)

Reproductor multitrack local para preparar canciones y setlists.

## Ejecutar en Windows

1. Instala Node.js.
2. Instala Visual Studio Build Tools con **Desarrollo para el escritorio con C++** y CMake.
3. Desde esta carpeta, ejecuta `npm install`.
4. Ejecuta `npm start`. Esto compila el motor de audio nativo antes de abrir la aplicación.

`npm run check` comprueba la sintaxis de JavaScript y compila el motor nativo.
`npm run test:native` comprueba la preservación del pitch y la detección/sincronización de tempo.
`npm run dist:win` compila el motor y genera un instalador Windows x64 en `dist`.

## Uso inicial

- Al abrir la app, crea o elige un setlist para el servicio o evento, por ejemplo **Culto domingo AM**, **Culto domingo PM** o **Culto sábado**.
- Dentro del setlist, usa **Explorar canciones** para agregar canciones de la biblioteca. Cada setlist mantiene su propia selección y orden.
- Selecciona una canción dentro del setlist para abrir su mezcla y reproducirla. Puedes quitarla del setlist sin quitarla de la biblioteca.
- Cambia de canción desde la cola lateral o el selector superior; al elegir otra durante la reproducción, el motor prepara sus pistas sin cerrar el dispositivo de audio.
- El visor muestra la forma de onda RMS de cada pista y permite buscar con un clic o con las flechas del teclado.
- En **Explorar**, importa canciones con nombre, artista, BPM (30–300) y tonalidad americana —mayor o menor— y selecciona todas sus pistas.
- Busca por nombre/artista y filtra la biblioteca por artista, BPM y tonalidad.
- Usa el botón de papelera para quitar una canción de la biblioteca. Esto también la quita de los setlists, pero **no borra los archivos de audio originales**.
- El motor admite audio WAV, MP3, FLAC y OGG/Vorbis. Convierte Opus, AAC/M4A o AIFF antes de importarlos.
- También puedes crear en **Explorar** una canción solo con click y agregarla a cualquier setlist.
- Usa reproducir, pausa, detener y la barra de posición desde la mezcla de una canción.
- Las pistas aparecen como canales verticales; ajusta volumen, paneo, solo y mute por pista.
- El canal **Click** aparece como otro fader. Su volumen y activación se guardan por canción; el tempo y el compás están junto al visor.
- Al reproducir, el analizador estima el BPM de cada pista y ajusta su duración al tempo de la canción sin cambiar el tono, cuando detecta un pulso fiable y el ajuste está dentro de un rango razonable.
- El pitch se guarda por canción y se procesa para conservar la duración y sincronía de las pistas.
- Cada canción guarda su propia configuración de click: activación, BPM, compás y volumen.
- El metrónomo de cada canción, incluida una canción solo con click, sigue hasta que pulses **Detener**.
- En **Configuración** elige un dispositivo ASIO o WASAPI y consulta sus salidas reales.
- Cada pista se puede asignar al master estéreo, a una salida mono o a un par estéreo.
- Asigna MIDI Learn a Reproducir, Detener y Siguiente canción.

La biblioteca y las mezclas se guardan localmente en los datos de usuario de la aplicación. Los archivos de audio permanecen en su ubicación original.

## Instalador y GitHub

El instalador NSIS de Windows se genera en `dist/Compas-Setup-<versión>-x64.exe`. El workflow de GitHub Actions compila y prueba el motor en Windows; al publicar una etiqueta `v*` crea un Release y adjunta el instalador. Los audios locales, la biblioteca del usuario y el SDK ASIO no se incluyen en el repositorio ni en el instalador.

Para continuar el proyecto desde otra PC, clona el repositorio, instala Node.js y Visual Studio Build Tools con C++/CMake y ejecuta `npm ci`, `npm run check` y `npm start`. Las instrucciones de contexto para Copilot están en `.github/copilot-instructions.md`.

## Alcance actual

El motor nativo usa RtAudio para ASIO/WASAPI, miniaudio para decodificar audio y Signalsmith Stretch para cambiar el pitch sin cambiar la duración. Las fuentes y licencias están en `native/vendor`; el proyecto se distribuye bajo GPLv3. El cambio de tono requiere tiempo de preparación al iniciar la canción y el consumo de CPU depende de la cantidad de pistas.

MIDI Learn usa Web MIDI cuando Windows y el dispositivo lo permiten; debe probarse con el controlador real. Antes de usarla en un servicio, prueba las canciones, la sincronía y los niveles con tu equipo de audio.

## Preparación del motor nativo

Se instalaron Visual Studio Build Tools 2022 con C++ y CMake 4.4.4. El build actual usa los adaptadores ASIO de RtAudio 6.0.1; el SDK oficial ASIO 2.3 descargado se conserva bajo la opción GPLv3 elegida, pero sus archivos no forman parte del build actual. No se debe distribuir bajo la licencia propietaria de Steinberg sin el acuerdo escrito correspondiente. Ver `native/vendor/README.md` para las dependencias, sus licencias y procedencia.
