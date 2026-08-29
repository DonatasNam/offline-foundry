/**
 * Camera QR scanning. Android Chrome has the native BarcodeDetector;
 * iOS Safari does not, so frames are decoded with the vendored jsQR
 * (loaded as a classic script, global jsQR). Decoding is throttled to
 * spare batteries. Returns a stop() function that releases the camera.
 */
export async function startScanner(videoEl, onResult) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
  });
  videoEl.srcObject = stream;
  await videoEl.play();

  let stopped = false;
  let found = false;
  const detector = "BarcodeDetector" in window
    ? new BarcodeDetector({ formats: ["qr_code"] })
    : null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  async function tick() {
    if (stopped || found) return;
    if (videoEl.readyState >= 2 && videoEl.videoWidth) {
      let text = null;
      if (detector) {
        const codes = await detector.detect(videoEl).catch(() => []);
        text = codes[0]?.rawValue ?? null;
      } else if (globalThis.jsQR) {
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        ctx.drawImage(videoEl, 0, 0);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = globalThis.jsQR(image.data, image.width, image.height, {
          inversionAttempts: "dontInvert"
        });
        text = code?.data ?? null;
      }
      if (text) {
        found = true;
        onResult(text);
        return;
      }
    }
    setTimeout(tick, 250);
  }
  tick();

  return function stop() {
    stopped = true;
    stream.getTracks().forEach(track => track.stop());
    videoEl.srcObject = null;
  };
}
