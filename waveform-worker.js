self.addEventListener('message', (event) => {
  const { key, tracks, width, height, scale, duration } = event.data;
  try {
    if (typeof OffscreenCanvas !== 'function') {
      throw new Error('Este dispositivo no admite el renderizado de formas de onda en segundo plano.');
    }

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo crear el contexto de dibujo de la forma de onda.');
    context.setTransform(scale, 0, 0, scale, 0, 0);

    const cssWidth = width / scale;
    const cssHeight = height / scale;
    const left = 54;
    const right = cssWidth - 12;
    const top = 10;
    const bottom = cssHeight - 19;
    const plotWidth = Math.max(0, right - left);
    const rows = Array.isArray(tracks) ? tracks : [];

    context.fillStyle = '#111513';
    context.fillRect(0, 0, cssWidth, cssHeight);

    if (rows.length === 0) {
      context.fillStyle = '#778178';
      context.font = '11px Segoe UI, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('No hay pistas de audio para mostrar.', cssWidth / 2, cssHeight / 2);
    } else {
      const colors = ['#c1f06b', '#e9a86e', '#92a7ea', '#d28de1', '#77c9b9', '#ec8585'];
      const rowHeight = (bottom - top) / rows.length;
      context.font = '9px Segoe UI, sans-serif';

      rows.forEach((track, rowIndex) => {
        const rowTop = top + rowIndex * rowHeight;
        const center = rowTop + rowHeight / 2;
        context.fillStyle = '#9aa49b';
        context.textAlign = 'right';
        context.textBaseline = 'middle';
        const name = typeof track.name === 'string' ? track.name : '';
        const label = name.length > 10 ? `${name.slice(0, 9)}…` : name;
        context.fillText(label, left - 8, center, left - 12);

        context.strokeStyle = '#29312c';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(left, center);
        context.lineTo(right, center);
        context.stroke();

        const minimum = Array.isArray(track.minimum) ? track.minimum : [];
        const maximum = Array.isArray(track.maximum) ? track.maximum : [];
        if (minimum.length === 0 || maximum.length !== minimum.length || plotWidth <= 0) return;
        const amplitude = Math.max(2, Math.min(12, rowHeight * 0.43));
        context.strokeStyle = colors[rowIndex % colors.length];
        context.globalAlpha = 0.9;
        context.beginPath();
        for (let x = 0; x < Math.floor(plotWidth); x += 1) {
          const bin = Math.min(minimum.length - 1, Math.floor(x * minimum.length / plotWidth));
          const low = Math.min(1, Math.max(-1, minimum[bin]));
          const high = Math.min(1, Math.max(-1, maximum[bin]));
          context.moveTo(left + x + 0.5, center - high * amplitude);
          context.lineTo(left + x + 0.5, center - low * amplitude);
        }
        context.stroke();
        context.globalAlpha = 1;
      });
    }

    for (let index = 0; index <= 4; index += 1) {
      const x = left + plotWidth * index / 4;
      context.strokeStyle = '#ffffff10';
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
      context.fillStyle = '#758077';
      context.font = '8px Consolas, monospace';
      context.textAlign = index === 0 ? 'left' : index === 4 ? 'right' : 'center';
      context.textBaseline = 'bottom';
      context.fillText(formatTime(duration * index / 4), x, cssHeight - 1);
    }

    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ key, bitmap }, [bitmap]);
  } catch (error) {
    self.postMessage({ key, error: error instanceof Error ? error.message : String(error) });
  }
});

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
