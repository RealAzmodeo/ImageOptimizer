export { }; // Ensure module scope

const log = (msg: string) => console.log(`[Worker] ${msg}`);

// Alpha Bleed: Extends colors from opaque pixels into adjacent transparent ones
// Optimized for performance with a single pass and boundary checks
function applyAlphaBleed(data: Uint8ClampedArray, width: number, height: number) {
    const result = new Uint8ClampedArray(data);
    const total = width * height;

    for (let i = 0; i < total; i++) {
        const idx = i * 4;
        // Only process if transparent
        if (data[idx + 3] === 0) {
            const x = i % width;
            const y = Math.floor(i / width);

            // Check neighbors (up, down, left, right)
            const neighbors = [];
            if (x > 0) neighbors.push(idx - 4);
            if (x < width - 1) neighbors.push(idx + 4);
            if (y > 0) neighbors.push(idx - (width * 4));
            if (y < height - 1) neighbors.push(idx + (width * 4));

            for (const nIdx of neighbors) {
                if (data[nIdx + 3] > 0) {
                    result[idx] = data[nIdx];
                    result[idx + 1] = data[nIdx + 1];
                    result[idx + 2] = data[nIdx + 2];
                    // We found a neighbor, no need to check others for this simple bleed
                    break;
                }
            }
        }
    }
    return result;
}

self.onmessage = async (e: MessageEvent) => {
    const { id, file, options } = e.data;
    log(`Starting ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

    try {
        const bitmap = await createImageBitmap(file);
        const { width, height } = bitmap;

        let targetWidth = width;
        let targetHeight = height;

        // Resize by percentage
        if (options?.resizeValue && options.resizeValue !== 100) {
            const scale = options.resizeValue / 100;
            targetWidth = Math.max(1, Math.floor(width * scale));
            targetHeight = Math.max(1, Math.floor(height * scale));
        }

        let canvasWidth = targetWidth;
        let canvasHeight = targetHeight;
        let drawX = 0;
        let drawY = 0;

        // Power of Two Enforcement (Pad/Contain)
        if (options?.enforcePOT) {
            canvasWidth = Math.pow(2, Math.ceil(Math.log2(targetWidth)));
            canvasHeight = Math.pow(2, Math.ceil(Math.log2(targetHeight)));

            // Center
            drawX = Math.floor((canvasWidth - targetWidth) / 2);
            drawY = Math.floor((canvasHeight - targetHeight) / 2);
        }

        log(`Target dimensions: ${canvasWidth}x${canvasHeight} (Image: ${targetWidth}x${targetHeight})`);

        const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Could not create canvas context');

        // Draw optimized image centered
        ctx.drawImage(bitmap, drawX, drawY, targetWidth, targetHeight);

        // Posterization / Color Reduction for PNG (Lossy Logic)
        if (file.type === 'image/png' && options?.quality && options.quality < 100) {
            log(`Posterizing to quality ${options.quality}%...`);
            const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
            const data = imageData.data;

            // Map quality 10-100 to levels 2-32 (aggressive reduction)
            const levels = Math.max(2, Math.floor((options.quality / 100) * 32));
            const step = 255 / (levels - 1);

            for (let i = 0; i < data.length; i += 4) {
                data[i] = Math.round(Math.round(data[i] / step) * step);
                data[i + 1] = Math.round(Math.round(data[i + 1] / step) * step);
                data[i + 2] = Math.round(Math.round(data[i + 2] / step) * step);
            }
            ctx.putImageData(imageData, 0, 0);
        }

        // Apply Alpha Bleed if requested (after posterization or independently)
        if (file.type === 'image/png' && (options?.profile === 'extreme' || options?.profile === 'sprites')) {
            log('Applying Alpha Bleed...');
            const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
            const bled = applyAlphaBleed(imageData.data, targetWidth, targetHeight);
            ctx.putImageData(new ImageData(bled, targetWidth, targetHeight), 0, 0);
        }

        // Export using native Browser API
        const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const jpegQuality = options?.quality ? Math.max(0.1, options.quality / 100) : 0.85;

        log(`Encoding to ${mimeType} with quality ${(jpegQuality * 100).toFixed(0)}%...`);

        const resultBlob = await canvas.convertToBlob({
            type: mimeType,
            quality: mimeType === 'image/jpeg' ? jpegQuality : undefined
        });

        log(`Finished ${file.name} -> ${(resultBlob.size / 1024 / 1024).toFixed(2)}MB`);
        self.postMessage({ id, blob: resultBlob, status: 'done' });

    } catch (error) {
        console.error(`[Worker] Error optimizing ${file.name}:`, error);
        self.postMessage({ id, error: String(error), status: 'error' });
    }
};
