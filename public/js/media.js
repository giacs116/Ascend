// Client-side media prep: downscale photos and pull frames out of videos,
// so only small JPEGs ever travel to the server / AI.

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsDataURL(file);
  });
}

export async function imageFileToJpeg(file, maxDim = 1024, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return drawScaled(img, img.naturalWidth, img.naturalHeight, maxDim, quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(source, sw, sh, maxDim, quality) {
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const hgt = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  canvas.getContext('2d').drawImage(source, 0, 0, w, hgt);
  return canvas.toDataURL('image/jpeg', quality);
}

// Extract n evenly-spaced frames from a video file (all in the browser).
export function extractVideoFrames(file, n = 6, maxDim = 900, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.src = url;
    const frames = [];
    let times = [];
    let idx = 0;
    let settled = false;

    const fail = (msg) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      reject(new Error(msg));
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      frames.length ? resolve(frames) : reject(new Error('Could not read frames from that video.'));
    };

    const timeout = setTimeout(() => fail('Reading the video took too long — try a shorter clip.'), 45000);

    video.addEventListener('error', () => { clearTimeout(timeout); fail('That video format isn’t supported by this browser.'); });

    video.addEventListener('loadedmetadata', () => {
      const dur = video.duration;
      if (!isFinite(dur) || dur <= 0) { clearTimeout(timeout); return fail('Could not read that video.'); }
      const count = Math.min(n, Math.max(2, Math.round(dur * 2)));
      const start = dur * 0.06, end = dur * 0.94;
      times = Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count - 1));
      video.currentTime = times[0];
    });

    video.addEventListener('seeked', () => {
      try {
        if (video.videoWidth) {
          frames.push(drawScaled(video, video.videoWidth, video.videoHeight, maxDim, quality));
        }
      } catch { /* skip frame */ }
      idx++;
      if (idx < times.length) {
        video.currentTime = times[idx];
      } else {
        clearTimeout(timeout);
        finish();
      }
    });
  });
}
