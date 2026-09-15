
let selfieSegmentationLoader = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-bg-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load background removal script")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.bgSrc = src;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load background removal script"));
    document.head.appendChild(script);
  });
}

async function ensureSelfieSegmentation() {
  if (selfieSegmentationLoader) return selfieSegmentationLoader;
  selfieSegmentationLoader = (async () => {
    await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js");
    if (!window.SelfieSegmentation) throw new Error("Selfie Segmentation did not load");
    return window.SelfieSegmentation;
  })();
  return selfieSegmentationLoader;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image for background removal"));
    img.src = src;
  });
}

export async function removeImageBackground(src) {
  const SelfieSegmentation = await ensureSelfieSegmentation();
  const img = await loadImage(src);

  return await new Promise(async (resolve, reject) => {
    try {
      const segmenter = new SelfieSegmentation({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
      });
      segmenter.setOptions({ modelSelection: 1 });

      segmenter.onResults((results) => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
          ctx.globalCompositeOperation = "source-in";
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const out = canvas.toDataURL("image/png");
          segmenter.close();
          resolve(out);
        } catch (err) {
          reject(err);
        }
      });

      await segmenter.send({ image: img });
    } catch (err) {
      reject(err);
    }
  });
}
