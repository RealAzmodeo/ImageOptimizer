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

function distributeError(data: Uint8ClampedArray, x: number, y: number, w: number, h: number, errR: number, errG: number, errB: number, factor: number) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = (y * w + x) * 4;
    data[i] = Math.max(0, Math.min(255, data[i] + errR * factor));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + errG * factor));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + errB * factor));
}

self.onmessage = async (e: MessageEvent) => {
    const { id, file, options } = e.data;
    log(`Starting ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

    try {
        const bitmap = await createImageBitmap(file);
        let currentWidth = bitmap.width;
        let currentHeight = bitmap.height;

        // --- Step 1: Detect Smart Crop (Auto-Trim) ---
        // We detect the content rect first to avoid processing transparent pixels
        let cropRect = { x: 0, y: 0, w: currentWidth, h: currentHeight };
        if (options?.smartCrop) {
            log('Experimental: Analyzing for Smart Crop...');
            const tempCanvas = new OffscreenCanvas(currentWidth, currentHeight);
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
            if (tempCtx) {
                tempCtx.drawImage(bitmap, 0, 0);
                const data = tempCtx.getImageData(0, 0, currentWidth, currentHeight).data;
                let minX = currentWidth, minY = currentHeight, maxX = 0, maxY = 0;
                let found = false;
                for (let y = 0; y < currentHeight; y++) {
                    for (let x = 0; x < currentWidth; x++) {
                        if (data[(y * currentWidth + x) * 4 + 3] > 0) {
                            if (x < minX) minX = x;
                            if (x > maxX) maxX = x;
                            if (y < minY) minY = y;
                            if (y > maxY) maxY = y;
                            found = true;
                        }
                    }
                }
                if (found) {
                    cropRect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
                    log(`Smart Crop detected core: ${cropRect.w}x${cropRect.h} at ${cropRect.x},${cropRect.y}`);
                }
            }
        }

        // --- Step 2: Scaling (Initial Resize) ---
        let scale = 1.0;
        if (options?.resizeValue && options.resizeValue !== 100) {
            scale = options.resizeValue / 100;
        }

        const coreW = Math.max(1, Math.floor(cropRect.w * scale));
        const coreH = Math.max(1, Math.floor(cropRect.h * scale));

        // --- Step 3: Core Canvas & Pre-Framing Filters ---
        // We create the core sprite here and apply color reduction BEFORE expanding to POT
        const coreCanvas = new OffscreenCanvas(coreW, coreH);
        const coreCtx = coreCanvas.getContext('2d', { willReadFrequently: true });
        if (!coreCtx) throw new Error('Could not create core canvas');

        // Draw the cropped and scaled source
        coreCtx.drawImage(bitmap, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, coreW, coreH);

        // Filter A: Mask Mode (Grayscale)
        if (options?.maskMode) {
            log('Experimental: Applying Mask Mode...');
            const idata = coreCtx.getImageData(0, 0, coreW, coreH);
            const d = idata.data;
            for (let i = 0; i < d.length; i += 4) {
                const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
                d[i] = d[i + 1] = d[i + 2] = g;
            }
            coreCtx.putImageData(idata, 0, 0);
        }

        if (file.type === 'image/png' && options?.quality && options.quality < 100) {
            log(`Posterizing core at ${options.quality}% (Dithering: ${options.enableDithering})...`);
            const idata = coreCtx.getImageData(0, 0, coreW, coreH);
            const d = idata.data;
            const levels = Math.max(2, Math.floor((options.quality / 100) * 32));
            const step = 255 / (levels - 1);

            if (options?.enableDithering) {
                for (let y = 0; y < coreH; y++) {
                    for (let x = 0; x < coreW; x++) {
                        const i = (y * coreW + x) * 4;
                        const r = d[i], g = d[i + 1], b = d[i + 2];
                        const nr = Math.round(Math.round(r / step) * step);
                        const ng = Math.round(Math.round(g / step) * step);
                        const nb = Math.round(Math.round(b / step) * step);
                        d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
                        const er = r - nr, eg = g - ng, eb = b - nb;
                        distributeError(d, x + 1, y, coreW, coreH, er, eg, eb, 7 / 16);
                        distributeError(d, x - 1, y + 1, coreW, coreH, er, eg, eb, 3 / 16);
                        distributeError(d, x, y + 1, coreW, coreH, er, eg, eb, 5 / 16);
                        distributeError(d, x + 1, y + 1, coreW, coreH, er, eg, eb, 1 / 16);
                    }
                }
            } else {
                for (let i = 0; i < d.length; i += 4) {
                    d[i] = Math.round(Math.round(d[i] / step) * step);
                    d[i + 1] = Math.round(Math.round(d[i + 1] / step) * step);
                    d[i + 2] = Math.round(Math.round(d[i + 2] / step) * step);
                }
            }
            coreCtx.putImageData(idata, 0, 0);
        }

        // --- Step 4: POT Framing & Canvas Expansion ---
        let canvasWidth = coreW;
        let canvasHeight = coreH;
        let drawX = 0;
        let drawY = 0;
        let finalFitW = coreW;
        let finalFitH = coreH;

        if (options?.enforcePOT) {
            let potW = Math.pow(2, Math.ceil(Math.log2(coreW)));
            let potH = Math.pow(2, Math.ceil(Math.log2(coreH)));

            if (options.potSize && options.potSize !== 'auto') {
                potW = parseInt(options.potSize as string);
                potH = potW;
            }

            canvasWidth = potW;
            canvasHeight = potH;

            const mode = options.potMode || 'pad';
            if (mode === 'stretch') {
                finalFitW = canvasWidth; finalFitH = canvasHeight;
            } else if (mode === 'crop' || mode === 'fit') {
                const s = (mode === 'crop')
                    ? Math.max(canvasWidth / coreW, canvasHeight / coreH)
                    : Math.min(canvasWidth / coreW, canvasHeight / coreH);
                finalFitW = Math.round(coreW * s);
                finalFitH = Math.round(coreH * s);
                drawX = Math.floor((canvasWidth - finalFitW) / 2);
                drawY = Math.floor((canvasHeight - finalFitH) / 2);
            } else {
                // Pad (Center)
                drawX = Math.floor((canvasWidth - coreW) / 2);
                drawY = Math.floor((canvasHeight - coreH) / 2);
            }
        }

        const finalCanvas = new OffscreenCanvas(canvasWidth, canvasHeight);
        const finalCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
        if (!finalCtx) throw new Error('Could not create final canvas');

        log(`Framing: Final ${canvasWidth}x${canvasHeight} | Draw core at ${drawX},${drawY} (${finalFitW}x${finalFitH})`);
        finalCtx.drawImage(coreCanvas, 0, 0, coreW, coreH, drawX, drawY, finalFitW, finalFitH);

        // --- Step 5: Post-Framing Filters (Smart Padding & Alpha Bleed) ---
        if (options?.enforcePOT && options?.smartPadding && (drawX !== 0 || drawY !== 0 || finalFitW !== canvasWidth || finalFitH !== canvasHeight)) {
            log('Experimental: Filling padding with optimized edge pixels...');
            const imageData = finalCtx.getImageData(0, 0, canvasWidth, canvasHeight);
            const data = imageData.data;
            const w = canvasWidth;

            // Fill margins by repeating edges (Safe because core is already color-optimized)
            if (drawX > 0) {
                for (let y = drawY; y < drawY + finalFitH; y++) {
                    const edgeIdx = (y * w + drawX) * 4;
                    const r = data[edgeIdx], g = data[edgeIdx + 1], b = data[edgeIdx + 2], a = data[edgeIdx + 3];
                    for (let x = 0; x < drawX; x++) {
                        const idx = (y * w + x) * 4;
                        data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
                    }
                }
            }
            if (drawX + finalFitW < w) {
                for (let y = drawY; y < drawY + finalFitH; y++) {
                    const edgeIdx = (y * w + (drawX + finalFitW - 1)) * 4;
                    const r = data[edgeIdx], g = data[edgeIdx + 1], b = data[edgeIdx + 2], a = data[edgeIdx + 3];
                    for (let x = drawX + finalFitW; x < w; x++) {
                        const idx = (y * w + x) * 4;
                        data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
                    }
                }
            }
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
            if (drawY + finalFitH < canvasHeight) {
                for (let x = 0; x < w; x++) {
                    const edgeIdx = ((drawY + finalFitH - 1) * w + x) * 4;
                    const r = data[edgeIdx], g = data[edgeIdx + 1], b = data[edgeIdx + 2], a = data[edgeIdx + 3];
                    for (let y = drawY + finalFitH; y < canvasHeight; y++) {
                        const idx = (y * w + x) * 4;
                        data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
                    }
                }
            }
            finalCtx.putImageData(imageData, 0, 0);
        }

        // Final Alpha Bleed (Cleans up edges)
        if (file.type === 'image/png' && (options?.profile === 'extreme' || options?.profile === 'sprites')) {
            log('Applying Alpha Bleed to final result...');
            const idata = finalCtx.getImageData(0, 0, canvasWidth, canvasHeight);
            const bled = applyAlphaBleed(idata.data, canvasWidth, canvasHeight);
            finalCtx.putImageData(new ImageData(bled, canvasWidth, canvasHeight), 0, 0);
        }

        // --- Step 6: Export ---
        const format = options?.outputFormat === 'webp' ? 'image/webp' : (file.type === 'image/png' ? 'image/png' : 'image/jpeg');
        const qualityValue = options?.quality ? (options.quality / 100) : 0.85;

        log(`Encoding as ${format} (${(qualityValue * 100).toFixed(0)}% quality)`);
        const resultBlob = await finalCanvas.convertToBlob({
            type: format,
            quality: (format === 'image/jpeg' || format === 'image/webp') ? qualityValue : undefined
        });

        log(`Finished: ${file.name} -> ${(resultBlob.size / 1024 / 1024).toFixed(2)}MB`);
        self.postMessage({ id, blob: resultBlob, status: 'done' });

    } catch (error) {
        console.error(`[Worker] Error optimizing ${file.name}:`, error);
        self.postMessage({ id, error: String(error), status: 'error' });
    }
};
