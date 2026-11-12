# COMPAS (Compás)

Reproductor multitrack local para preparar canciones y setlists.

## Ejecutar en Windows

1. Instala Node.js.
2. Instala Visual Studio Build Tools con **Desarrollo para el escritorio con C++** y CMake.
3. Desde esta carpeta, ejecuta `npm install`.
4. Ejecuta `npm start`. Esto compila el motor de audio nativo antes de abrir la aplicación.

`npm run check` comprueba la sintaxis de JavaScript y compila el motor nativo.
`npm run test:native` comprueba pitch, sincronización, ruteo, transiciones entre canciones y caché de análisis.
`npm test` ejecuta además las pruebas de IPC, preparación, transporte, pads e interfaz Electron sin reproducir por el dispositivo real.
`npm run dist:win` compila el motor y genera un instalador Windows x64 en `dist`.

## Uso inicial

- Al abrir la app, crea o elige un setlist para el servicio o evento, por ejemplo **Culto domingo AM**, **Culto domingo PM** o **Culto sábado**.
- Dentro del setlist, usa **Explorar canciones** para agregar canciones de la biblioteca. Cada setlist mantiene su propia selección y orden.
- Selecciona una canción dentro del setlist para abrir su mezcla y reproducirla. Puedes quitarla del setlist sin quitarla de la biblioteca.
- Ordena las canciones con las flechas del detalle del setlist; esos números también permiten saltar directamente con las teclas 1–9.
- Seleccionar una canción inicia su preparación en segundo plano. Espera el estado **lista** para dispararla sin decodificación ni DSP completo en Play. El dispositivo se abre al configurar el audio y entrega silencio mientras está detenido.
- Cambia de canción desde la cola o con las flechas del teclado. El motor conserva la actual mientras prepara la nueva; al terminar hace una transición de 10 ms sin cerrar el dispositivo. Después de arrancar intenta precargar la siguiente del setlist (hasta 256 MiB de PCM); las canciones más grandes se preparan al seleccionarlas.
- Detener vuelve a cero y conserva la canción cargada. Pausa, reanudación y reinicio reutilizan el PCM preparado. Un Stop durante la preparación cancela el disparo pendiente.
- El botón «Setlist actual» abre rápidamente el detalle de la lista seleccionada.
- Usa **Exportar setlist** para guardar un archivo `.compas` con el orden, la mezcla y las rutas relativas de las pistas; al exportar, elige una carpeta raíz que contenga todos los stems. **Importar .compas** incorpora una copia del setlist y, si las pistas no se encuentran, permite elegir otra carpeta raíz conservando la estructura de subcarpetas.
- El visor muestra picos de forma de onda por pista calculados y cacheados al decodificar el audio. Un Web Worker prepara el dibujo fuera del hilo principal; haz clic en el visor para buscar. Agrega puntos, marca inicio y fin de regiones y activa la repetición de una región.
- El transporte conserva el contador, Play/Pausa, Reiniciar y Detener; la posición se cambia desde el visor de onda.
- Por defecto, Espacio reproduce/pausa, las flechas recorren el setlist y los números 1–9 abren esa posición. En Configuración, Key Learn permite personalizar teclas del teclado integrado o externo.
- En **Explorar**, importa canciones con nombre, artista, BPM (30–300) y tonalidad americana —mayor o menor— y selecciona todas sus pistas.
- Busca por nombre/artista y filtra la biblioteca por artista, BPM y tonalidad.
- Usa el botón de papelera para quitar una canción de la biblioteca. Esto también la quita de los setlists, pero **no borra los archivos de audio originales**.
- El motor admite audio WAV, MP3, FLAC y OGG/Vorbis. Convierte Opus, AAC/M4A o AIFF antes de importarlos.
- También puedes crear en **Explorar** una canción solo con click y agregarla a cualquier setlist.
- Usa reproducir, pausa, detener y la barra de posición desde la mezcla de una canción.
- Las pistas aparecen como canales verticales; ajusta volumen, paneo, solo, mute y salida por pista. Desactiva **DSP canción** en una guía para excluirla tanto del pitch como del time-stretch. El click también permanece fuera de la cadena DSP.
- El canal **Click** aparece como otro fader y también permite elegir el master o una salida física mono/estéreo. Su nivel de salida es más fuerte y su volumen, activación y ruta se guardan por canción.
- Usa **MASTER CANCIÓN** para el nivel de las pistas y **MASTER SETLIST** para controlar todo el audio, incluido el click, en todas las canciones de ese setlist.
- Al reproducir, el analizador estima el BPM de cada pista y ajusta su duración al tempo de la canción sin cambiar el tono, cuando detecta un pulso fiable y el ajuste está dentro de un rango razonable. La opción **DSP canción** controla si se aplican pitch y sincronización de tempo a cada pista.
- Elige la tonalidad destino desde la tonalidad original de la canción; el pitch se procesa para conservar la duración y sincronía.
- Cada canción guarda su propia configuración de click: activación, BPM, compás y volumen.
- El metrónomo de cada canción, incluida una canción solo con click, sigue hasta que pulses **Detener**.
- En **Configuración** elige un dispositivo ASIO o WASAPI, una frecuencia admitida por ese dispositivo y el tamaño del búfer. Los búferes pequeños reducen latencia, pero pueden requerir una computadora más rápida.
- Cada pista se puede asignar al master estéreo, a una salida mono o a un par estéreo.
- Asigna MIDI Learn a Reproducir, Detener y Siguiente canción.
- Los **Pads** generan un ambiente sostenido de fundamental, quinta y octava en 12 tonalidades, sin archivos externos. Tienen volumen, salida mono/estéreo y fundidos de 0,5 a 5 segundos; las tonalidades menores usan la misma fundamental sin tercera.
- **Seguir tonalidad de canción** dispara el pad correspondiente al comenzar la canción, usando su tono de destino. Pausar o detener pistas conserva el ambiente; **Apagar pads** lo desvanece. MASTER SETLIST controla también los pads. El master de canción y el pitch de las pistas no los afectan.
- MIDI Learn y Key Learn incluyen cada pad y Apagar pads. Los ajustes se guardan; al abrir la app los pads siempre arrancan apagados.

La biblioteca, las mezclas y la caché PCM/forma de onda/tempo se guardan localmente en los datos de usuario de la aplicación (`audio-cache`). La caché se invalida si cambia el archivo fuente o el sample rate; los archivos de audio permanecen en su ubicación original.

## Instalador y GitHub

El instalador NSIS de Windows se genera en `dist/Compas-Setup-<versión>-x64.exe`. El workflow de GitHub Actions compila y prueba el motor en Windows; al publicar una etiqueta `v*` crea un Release y adjunta el instalador. Los audios locales, la biblioteca, la caché del usuario y el SDK ASIO no se incluyen en el repositorio ni en el instalador.

Para continuar el proyecto desde otra PC, clona el repositorio, instala Node.js y Visual Studio Build Tools con C++/CMake y ejecuta `npm ci`, `npm run check` y `npm start`. Las instrucciones de contexto para Copilot están en `.github/copilot-instructions.md`.

## Alcance actual

El motor nativo usa RtAudio para ASIO/WASAPI, miniaudio para decodificar audio y Signalsmith Stretch para cambiar el pitch sin cambiar la duración. El pitch/time-stretch se prepara por pista en un trabajador; no se procesa en el callback. La reproducción acumula en double y convierte a float32 para RtAudio. El callback recibe comandos mediante una cola SPSC de capacidad fija; no accede a archivos, JSON, mutex ni propietarios shared_ptr. La liberación de las canciones retiradas queda a cargo del hilo de control después de la confirmación del callback. Los cambios de transporte y marcadores usan rampas de 10 ms y los loops se ejecutan con el reloj de muestras.

La preparación actual carga el PCM completo en RAM; no hay streaming desde disco. Se retienen como máximo dos preparaciones en la caché de memoria, con límite combinado de 512 MiB cuando hay más de una; el deck activo y una transición pueden seguir reteniendo sus datos. Las canciones individuales seleccionadas no tienen ese límite. El cambio de tono todavía requiere preparación; Play antes del estado listo espera ese trabajo. No se implementó un bus DSP compartido ni WASAPI Exclusive: esta versión de RtAudio usa WASAPI Shared. Para baja latencia usa el driver ASIO del fabricante y prueba un búfer de 128 o 256 muestras antes de bajarlo más.

Configuración muestra el búfer negociado y la latencia informada por el driver; durante la reproducción se cuentan interrupciones del stream. `preparationMs` mide la preparación; `acknowledgementMs` del evento nativo `playing` mide desde la recepción del comando en Electron hasta la confirmación del callback, incluyendo preparación si estaba pendiente. Ninguna de esas métricas sustituye una medición física por loopback. Las fuentes y licencias están en `native/vendor`; el proyecto se distribuye bajo GPLv3.

MIDI Learn usa Web MIDI cuando Windows y el dispositivo lo permiten; debe probarse con el controlador real. Antes de usarla en un servicio, prueba las canciones, la sincronía y los niveles con tu equipo de audio.

## Preparación del motor nativo

Se instalaron Visual Studio Build Tools 2022 con C++ y CMake 4.4.4. El build actual usa los adaptadores ASIO de RtAudio 6.0.1; el SDK oficial ASIO 2.3 descargado se conserva bajo la opción GPLv3 elegida, pero sus archivos no forman parte del build actual. No se debe distribuir bajo la licencia propietaria de Steinberg sin el acuerdo escrito correspondiente. Ver `native/vendor/README.md` para las dependencias, sus licencias y procedencia.
