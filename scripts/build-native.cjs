const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function findCMake() {
  const executableName = process.platform === 'win32' ? 'cmake.exe' : 'cmake';
  const pathDirectories = (process.env.PATH ?? '').split(path.delimiter);
  for (const directory of pathDirectories) {
    const candidate = path.join(directory, executableName);
    if (fs.existsSync(candidate)) return candidate;
  }

  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const packagesDirectory = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(packagesDirectory)) {
      for (const packageName of fs.readdirSync(packagesDirectory)) {
        if (!packageName.startsWith('Kitware.CMake')) continue;
        const packageDirectory = path.join(packagesDirectory, packageName);
        const versions = [packageDirectory, ...fs.readdirSync(packageDirectory).map((name) => path.join(packageDirectory, name))];
        for (const versionDirectory of versions) {
          const candidate = path.join(versionDirectory, 'bin', executableName);
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    }
  }

  throw new Error('No se encontró CMake. Instala CMake o agrégalo al PATH para compilar el motor de audio.');
}

const cmake = findCMake();
const projectDirectory = path.resolve(__dirname, '..');
const commands = [
  ['-S', 'native', '-B', 'native/build', '-G', 'Visual Studio 17 2022', '-A', 'x64',
    '-DRTAUDIO_API_ASIO=ON', '-DRTAUDIO_API_WASAPI=ON', '-DRTAUDIO_BUILD_TESTING=OFF'],
  ['--build', 'native/build', '--config', 'Release', '--target', 'compas-audio']
];

for (const args of commands) {
  const result = spawnSync(cmake, args, { cwd: projectDirectory, stdio: 'inherit', windowsHide: true });
  if (result.error) {
    console.error(`No se pudo ejecutar CMake: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
