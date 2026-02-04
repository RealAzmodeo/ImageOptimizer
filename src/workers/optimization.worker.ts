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

        // Resize by percentage (Initial preprocessing)
        if (options?.resizeValue && options.resizeValue !== 100) {
            const scale = options.resizeValue / 100;
            targetWidth = Math.max(1, Math.floor(width * scale));
            targetHeight = Math.max(1, Math.floor(height * scale));
        }

        let canvasWidth = targetWidth;
        let canvasHeight = targetHeight;
        let drawX = 0;
        let drawY = 0;
        let finalFitWidth = targetWidth;
        let finalFitHeight = targetHeight;

        // --- Advanced POT / Resize Logic ---
        if (options?.enforcePOT) {
            let potW = Math.pow(2, Math.ceil(Math.log2(targetWidth)));
            let potH = Math.pow(2, Math.ceil(Math.log2(targetHeight)));

            if (options.potSize && options.potSize !== 'auto') {
                potW = parseInt(options.potSize as string);
                potH = potW; // Square for specific Sizes in this simple implementation
            }

            canvasWidth = potW;
            canvasHeight = potH;

            const mode = options.potMode || 'pad';
            if (mode === 'stretch') {
                finalFitWidth = canvasWidth;
                finalFitHeight = canvasHeight;
                drawX = 0;
                drawY = 0;
            } else if (mode === 'crop') {
                // Scale to fill, then crop
                const scale = Math.max(canvasWidth / targetWidth, canvasHeight / targetHeight);
                finalFitWidth = Math.round(targetWidth * scale);
                finalFitHeight = Math.round(targetHeight * scale);
                drawX = Math.floor((canvasWidth - finalFitWidth) / 2);
                drawY = Math.floor((canvasHeight - finalFitHeight) / 2);
            } else if (mode === 'fit') {
                // Scale to fit within
                const scale = Math.min(canvasWidth / targetWidth, canvasHeight / targetHeight);
                finalFitWidth = Math.round(targetWidth * scale);
                finalFitHeight = Math.round(targetHeight * scale);
                drawX = Math.floor((canvasWidth - finalFitWidth) / 2);
                drawY = Math.floor((canvasHeight - finalFitHeight) / 2);
            } else {
                // Default: Pad (Contain)
                drawX = Math.floor((canvasWidth - targetWidth) / 2);
                drawY = Math.floor((canvasHeight - targetHeight) / 2);
                finalFitWidth = targetWidth;
                finalFitHeight = targetHeight;
            }
        }

        log(`Target dimensions: ${canvasWidth}x${canvasHeight} (Image Fit: ${finalFitWidth}x${finalFitHeight} at ${drawX},${drawY})`);

        const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Could not create canvas context');

        // Draw image with calculated fit
        ctx.drawImage(bitmap, drawX, drawY, finalFitWidth, finalFitHeight);

        // --- Experimental: Smart Padding (Edge Stretch) ---
        if (options?.enforcePOT && options?.smartPadding && (drawX > 0 || drawY > 0 || finalFitWidth < canvasWidth || finalFitHeight < canvasHeight)) {
            log('Experimental: Applying Smart Padding (Edge Dilatation)...');
            const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
            const data = imageData.data;
            const w = canvasWidth;
            const h = canvasHeight;

            // Simple row/column repetition for padding
            // Left margin
            if (drawX > 0) {
                for (let y = drawY; y < drawY + finalFitHeight; y++) {
                    const edgeIdx = (y * w + drawX) * 4;
                    const r = data[edgeIdx], g = data[edgeIdx + 1], b = data[edgeIdx + 2], a = data[edgeIdx + 3];
                    for (let x = 0; x < drawX; x++) {
                        const idx = (y * w + x) * 4;
                        data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
                    }
                }
            }
            // Right margin
            if (drawX + finalFitWidth < w) {
                for (let y = drawY; y < drawY + finalFitHeight; y++) {
                    const edgeIdx = (y * w + (drawX + finalFitWidth - 1)) * 4;
                    const r = data[edgeIdx], g = data[edgeIdx + 1], b = data[edgeIdx + 2], a = data[edgeIdx + 3];
                    for (let x = drawX + finalFitWidth; x < w; x++) {
                        const idx = (y * w + x) * 4;
                        data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
                    }
                }
            }
            // Top margin (including corners using newly filled sides)
            if (drawY > 0) {
                for (let x = 0; x < w; x++) {
                    const edgeIdx = (drawY * w + x) * 4;
                    const r = data[edgeIdx], g = data[edgeIdx + 1], b = data[edgeIdx + 2], a = data[edgeIdx + 3];
                    for (let y = 0; y < drawY; y++) {
                        const idx = (y * w + x) * 4;
                        data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
                    }
                }
            }
            // Bottom margin
            if (drawY + finalFitHeight < h) {
                for (let x = 0; x < w; x++) {
                    const edgeIdx = ((drawY + finalFitHeight - 1) * w + x) * 4;
                    const r = data[edgeIdx], g = data[edgeIdx + 1], b = data[edgeIdx + 2], a = data[edgeIdx + 3];
                    for (let y = drawY + finalFitHeight; y < h; y++) {
                        const idx = (y * w + x) * 4;
                        data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
                    }
                }
            }

            ctx.putImageData(imageData, 0, 0);
        }

        // --- Experimental: Smart Crop (Auto-Trim) ---
        if (options?.smartCrop) {
            log('Experimental: Smart Cropping (Auto-Trim)...');
            const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
            const data = imageData.data;
            let minX = canvasWidth, minY = canvasHeight, maxX = 0, maxY = 0;
            let foundAny = false;

            for (let y = 0; y < canvasHeight; y++) {
                for (let x = 0; x < canvasWidth; x++) {
                    const alpha = data[(y * canvasWidth + x) * 4 + 3];
                    if (alpha > 0) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                        foundAny = true;
                    }
                }
            }

            if (foundAny) {
                const cropWidth = maxX - minX + 1;
                const cropHeight = maxY - minY + 1;
                log(`Smart Crop: ${canvasWidth}x${canvasHeight} -> ${cropWidth}x${cropHeight}`);

                const cropCanvas = new OffscreenCanvas(cropWidth, cropHeight);
                const cropCtx = cropCanvas.getContext('2d');
                if (cropCtx) {
                    cropCtx.putImageData(ctx.getImageData(minX, minY, cropWidth, cropHeight), 0, 0);
                    canvas.width = cropWidth;
                    canvas.height = cropHeight;
                    ctx.drawImage(cropCanvas, 0, 0);
                    canvasWidth = cropWidth;
                    canvasHeight = cropHeight;
                }
            }
        }

        // --- Experimental: Mask Mode (Grayscale) ---
        if (options?.maskMode) {
            log('Experimental: Applying Mask Mode (Grayscale)...');
            const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
                data[i] = gray;
                data[i + 1] = gray;
                data[i + 2] = gray;
            }
            ctx.putImageData(imageData, 0, 0);
        }

        // --- Standard: Posterization / Color Reduction ---
        if (file.type === 'image/png' && options?.quality && options.quality < 100) {
            log(`Posterizing to quality ${options.quality}%...`);
            const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
            const data = imageData.data;
            const levels = Math.max(2, Math.floor((options.quality / 100) * 32));
            const step = 255 / (levels - 1);

            for (let i = 0; i < data.length; i += 4) {
                data[i] = Math.round(Math.round(data[i] / step) * step);
                data[i + 1] = Math.round(Math.round(data[i + 1] / step) * step);
                data[i + 2] = Math.round(Math.round(data[i + 2] / step) * step);
            }
            ctx.putImageData(imageData, 0, 0);
        }

        // --- Standard: Alpha Bleed ---
        if (file.type === 'image/png' && (options?.profile === 'extreme' || options?.profile === 'sprites')) {
            log('Applying Alpha Bleed...');
            const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
            const bled = applyAlphaBleed(imageData.data, canvasWidth, canvasHeight);
            ctx.putImageData(new ImageData(bled, canvasWidth, canvasHeight), 0, 0);
        }

        // --- Standard: Export Logic (with Optimized WebP) ---
        const format = options?.outputFormat === 'webp' ? 'image/webp' : (file.type === 'image/png' ? 'image/png' : 'image/jpeg');
        // If webp and quality < 100, we use lossy encoding. If 100, natively it might still be lossy unless we check browser quirks.
        // For Chrome, quality < 1.0 means lossy.
        const qualityValue = options?.quality ? (options.quality / 100) : 0.85;

        log(`Encoding to ${format} with quality ${(qualityValue * 100).toFixed(0)}%...`);

        const resultBlob = await canvas.convertToBlob({
            type: format,
            quality: (format === 'image/jpeg' || format === 'image/webp') ? qualityValue : undefined
        });

        log(`Finished ${file.name} -> ${(resultBlob.size / 1024 / 1024).toFixed(2)}MB`);
        self.postMessage({ id, blob: resultBlob, status: 'done' });

    } catch (error) {
        console.error(`[Worker] Error optimizing ${file.name}:`, error);
        self.postMessage({ id, error: String(error), status: 'error' });
    }
};
