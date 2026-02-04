import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import './App.css'
import { type ImageFile, type OptimizationOptions, getFilesFromItems, formatSize } from './utils/fileHelpers'
import { OptimizationManager } from './OptimizationManager'
import JSZip from 'jszip'
import { BeforeAfterSlider } from './components/BeforeAfterSlider';


function App() {
  const [files, setFiles] = useState<ImageFile[]>([])
  const [options, setOptions] = useState<OptimizationOptions>({
    profile: 'sprites',
    resizeMode: 'percentage',
    resizeValue: 100,
    quality: 70, // Default optimal
    compressionLevel: 'optimal',
    preserveStructure: true,
    unityReady: true,
    enforcePOT: false,
    potSize: 'auto',
    potMode: 'pad',
    smartPadding: false,
    smartCrop: false,
    outputFormat: 'original',
    maskMode: false,
    namePrefix: '',
    nameSuffix: ''
  })
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLabExpanded, setIsLabExpanded] = useState(false)
  const [selectedForComparison, setSelectedForComparison] = useState<ImageFile | null>(null) // Renamed from selectedFile

  const optimizationManager = useRef(new OptimizationManager((id, updates) => { // Changed to useRef
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f))
  }))

  useEffect(() => {
    return () => optimizationManager.current.terminate() // Updated manager usage
  }, []) // Removed manager from dependency array as it's a ref

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const items = e.dataTransfer.items
    const extracted = await getFilesFromItems(items)

    const newFiles: ImageFile[] = await Promise.all(extracted.map(async item => {
      let width, height;
      try {
        const bmp = await createImageBitmap(item.file);
        width = bmp.width;
        height = bmp.height;
        bmp.close();
      } catch (e) {
        console.warn('Could not get dimensions for', item.file.name);
      }

      return {
        id: Math.random().toString(36).substr(2, 9),
        file: item.file,
        relativePath: item.relativePath,
        originalSize: item.file.size,
        status: 'pending',
        previewUrl: URL.createObjectURL(item.file),
        selected: true,
        width,
        height
      };
    }))

    setFiles(prev => [...prev, ...newFiles])
  }, [])

  const handleCompress = async () => {
    // Filter only selected files
    const filesToCompress = files.filter(f => f.selected);

    if (filesToCompress.length === 0) return;

    setIsProcessing(true);

    // Mark as processing in UI
    setFiles(prev => prev.map(f => f.selected ? { ...f, status: 'processing' } : f));

    // Create a version of files with 'pending' status for the manager to accept them
    const resetFiles = filesToCompress.map(f => ({ ...f, status: 'pending' as const }));

    // Process
    await optimizationManager.current.processBatch(resetFiles, options);

    setIsProcessing(false);
  };

  const handleDownload = useCallback(async () => {
    const zip = new JSZip()
    const processedFiles = files.filter(f => f.status === 'done' && f.compressedBlob);
    processedFiles.forEach(f => {
      if (f.compressedBlob) {
        const ext = options.outputFormat === 'webp' ? '.webp' : (f.file.type === 'image/png' ? '.png' : '.jpg');
        const nameWithoutExt = f.file.name.replace(/\.[^/.]+$/, "");
        const finalName = `${options.namePrefix}${nameWithoutExt}${options.nameSuffix}${ext}`;

        const path = options.preserveStructure
          ? f.relativePath.replace(f.file.name, finalName)
          : finalName;

        zip.file(path, f.compressedBlob)
      }
    })
    const content = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(content)
    const link = document.createElement('a')
    link.href = url
    link.download = 'unity_optimized_assets.zip'
    link.click()
  }, [files, options.preserveStructure])

  const stats = useMemo(() => {
    const original = files.reduce((acc, f) => acc + f.originalSize, 0)
    const compressed = files.reduce((acc, f) => acc + (f.compressedSize || f.originalSize), 0)
    const savings = original > 0 ? ((original - compressed) / original) * 100 : 0
    return { original, compressed, savings }
  }, [files])

  const toggleSelection = (id: string) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, selected: !f.selected } : f));
  };

  const downloadSingle = (file: ImageFile) => {
    if (file.compressedBlob) {
      const url = URL.createObjectURL(file.compressedBlob);
      const a = document.createElement('a');
      a.href = url;

      const ext = options.outputFormat === 'webp' ? '.webp' : (file.file.type === 'image/png' ? '.png' : '.jpg');
      const nameWithoutExt = file.file.name.replace(/\.[^/.]+$/, "");
      const finalName = `${options.namePrefix}${nameWithoutExt}${options.nameSuffix}${ext}`;

      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="app-container fade-in">
      <header className="header">
        <div className="logo-section">
          <div className="logo-icon">▲</div>
          <h1>Unity Image Optimizer</h1>
        </div>
        <p className="subtitle">Optimize assets for Unity. Faster, Smaller, Better.</p>
      </header>

      <main>
        <div
          className="dropzone-container glass-panel"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <input
            type="file"
            id="file-input"
            multiple
            style={{ display: 'none' }}
            onChange={async (e) => {
              if (e.target.files) {
                const filesList = Array.from(e.target.files);
                const newFiles: ImageFile[] = await Promise.all(filesList.map(async file => {
                  let width, height;
                  try {
                    const bmp = await createImageBitmap(file);
                    width = bmp.width;
                    height = bmp.height;
                    bmp.close();
                  } catch (e) {
                    console.warn('Could not get dimensions for', file.name);
                  }

                  return {
                    id: Math.random().toString(36).substr(2, 9),
                    file: file,
                    relativePath: file.name,
                    originalSize: file.size,
                    status: 'pending',
                    previewUrl: URL.createObjectURL(file),
                    selected: true,
                    width,
                    height
                  };
                }))
                setFiles(prev => [...prev, ...newFiles])
              }
            }}
          />
          <div className="dropzone-content">
            <div className="upload-icon">↑</div>
            <h3>Drag & drop folders or files here</h3>
            <p className="text-secondary">Or click to select. PNG & JPG supported.</p>
          </div>
        </div>

        <div className="controls-grid">
          <div className="settings-panel glass-panel">
            <h2>Output Settings</h2>
            <div className="settings-list">
              <div className="setting-item">
                <div className="setting-info">
                  <span className="setting-title">Unity Ready</span>
                  <span className="setting-desc">Apply texture-alignment optimizations</span>
                </div>
                <input
                  type="checkbox"
                  className="toggle-switch"
                  checked={options.unityReady}
                  onChange={(e) => setOptions(prev => ({ ...prev, unityReady: e.target.checked }))}
                />
              </div>
              <div className="setting-item">
                <div className="setting-info">
                  <span className="setting-title">Preserve Structure</span>
                  <span className="setting-desc">Maintain folder hierarchy in ZIP</span>
                </div>
                <input
                  type="checkbox"
                  className="toggle-switch"
                  checked={options.preserveStructure}
                  onChange={(e) => setOptions(prev => ({ ...prev, preserveStructure: e.target.checked }))}
                />
              </div>
            </div>
          </div>

          <div className="dimension-panel glass-panel">
            <h2>Profile & Quality</h2>
            <div className="profile-selector">
              <button
                className={`profile-btn ${options.profile === 'sprites' ? 'active' : ''}`}
                onClick={() => setOptions(prev => ({
                  ...prev,
                  profile: 'sprites',
                  compressionLevel: 'optimal',
                  quality: 70
                }))}
              >Sprites</button>
              <button
                className={`profile-btn ${options.profile === 'ui' ? 'active' : ''}`}
                onClick={() => setOptions(prev => ({
                  ...prev,
                  profile: 'ui',
                  compressionLevel: 'low',
                  quality: 85
                }))}
              >UI</button>
              <button
                className={`profile-btn ${options.profile === 'background' ? 'active' : ''}`}
                onClick={() => setOptions(prev => ({
                  ...prev,
                  profile: 'background',
                  compressionLevel: 'high',
                  quality: 50
                }))}
              >BG</button>
              <button
                className={`profile-btn extreme ${options.profile === 'extreme' ? 'active' : ''}`}
                onClick={() => setOptions(prev => ({
                  ...prev,
                  profile: 'extreme',
                  compressionLevel: 'very_high',
                  quality: 30
                }))}
              >EXTREME</button>
            </div>
            <div className="dimension-controls-mini">
              <div className="control-group">
                <span className="text-secondary">Compression Level:</span>
                <select
                  className="dropdown-select"
                  value={options.compressionLevel}
                  onChange={(e) => {
                    const level = e.target.value as any;
                    let q = 70;
                    if (level === 'very_low') q = 95;
                    if (level === 'low') q = 85;
                    if (level === 'optimal') q = 70;
                    if (level === 'high') q = 50;
                    if (level === 'very_high') q = 30;

                    setOptions(prev => ({
                      ...prev,
                      compressionLevel: level,
                      quality: q,
                      profile: 'custom'
                    }));
                  }}
                >
                  <option value="very_low">Very Low Compression (Max Quality)</option>
                  <option value="low">Low Compression</option>
                  <option value="optimal">Optimal / Balanced</option>
                  <option value="high">High Compression</option>
                  <option value="very_high">Very High Compression (Max Savings)</option>
                </select>

                <div className="quality-graph">
                  <div className="graph-bar" style={{ width: `${options.quality}%`, background: options.quality < 50 ? 'var(--danger-color)' : options.quality < 80 ? 'var(--accent-color)' : '#4ade80' }}></div>
                </div>
                <div className="graph-labels">
                  <span>Result Quality: {options.quality}%</span>
                </div>
              </div>

              <div className="input-row" style={{ marginTop: '1rem' }}>
                <span className="text-secondary">Global Scale:</span>
                <input
                  type="number"
                  value={options.resizeValue}
                  onChange={(e) => setOptions(prev => ({ ...prev, resizeValue: Number(e.target.value) }))}
                />
                <span>%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="summary-section glass-panel">
          <div className="summary-header">
            <h2>Compression Summary</h2>
            <span className="text-secondary">{files.length} files loaded.</span>
          </div>

          {files.length > 0 && (
            <div className="stats-row fade-in">
              <div className="stat-item">
                <span className="stat-label">Original</span>
                <span className="stat-value">{formatSize(stats.original)}</span>
              </div>
              <div className="stat-arrow">→</div>
              <div className="stat-item">
                <span className="stat-label">Compressed</span>
                <span className="stat-value">{formatSize(stats.compressed)}</span>
              </div>
              <div className="stat-item savings">
                <span className="stat-label">Savings</span>
                <span className="stat-value">-{stats.savings.toFixed(1)}%</span>
              </div>
            </div>
          )}

          <div className="action-bar">
            <button
              className="btn btn-primary"
              onClick={handleCompress}
              disabled={files.length === 0 || isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Compress All'}
            </button>
            <button
              className="btn btn-outline"
              onClick={handleDownload}
              disabled={files.length === 0 || !files.some(f => f.status === 'done')}
            >
              Download ZIP
            </button>
            <button className="btn btn-danger" onClick={() => setFiles([])}>Clear All</button>
          </div>
        </div>

        <div className={`experiments-panel glass-panel fade-in ${isLabExpanded ? 'expanded' : 'collapsed'}`}>
          <div
            className="panel-header"
            onClick={() => setIsLabExpanded(!isLabExpanded)}
            style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', width: '100%' }}
          >
            <div className="lab-icon">🧪</div>
            <h2 style={{ flex: 1 }}>Experimental Laboratory</h2>
            <div className="badge experimental">BETA FEATURES</div>
            <div className="expand-indicator" style={{ marginLeft: '1rem', fontSize: '1.2rem', fontWeight: 'bold' }}>
              {isLabExpanded ? '−' : '+'}
            </div>
          </div>

          {isLabExpanded && (
            <div className="experiments-grid">
              {/* Row 1: Feature Toggles (3 Columns) */}
              <div className="exp-item" title="Detects the actual content and removes transparency borders. Saves memory in Unity.">
                <div className="exp-info">
                  <div className="title-row">
                    <span className="exp-title">Smart Crop (Auto-Trim)</span>
                    <div className="info-icon">i</div>
                  </div>
                  <span className="exp-desc">Remove empty transparency space</span>
                </div>
                <input
                  type="checkbox"
                  className="toggle-switch"
                  checked={options.smartCrop}
                  onChange={(e) => setOptions(prev => ({ ...prev, smartCrop: e.target.checked }))}
                />
              </div>

              <div className="exp-item" title="Converts to high-precision grayscale. Perfect for Roughness, Metallic, or Opacity maps.">
                <div className="exp-info">
                  <div className="title-row">
                    <span className="exp-title">Mask Mode (Grayscale)</span>
                    <div className="info-icon">i</div>
                  </div>
                  <span className="exp-desc">Unity mask map optimization</span>
                </div>
                <input
                  type="checkbox"
                  className="toggle-switch"
                  checked={options.maskMode}
                  onChange={(e) => setOptions(prev => ({ ...prev, maskMode: e.target.checked }))}
                />
              </div>

              <div className="exp-item" title="Repeats the last valid edge pixels to fill gaps instead of transparency. Fixes GPU filtering 'bleeding' lines.">
                <div className="exp-info">
                  <div className="title-row">
                    <span className="exp-title">Smart Padding (Dilatation)</span>
                    <div className="info-icon">i</div>
                  </div>
                  <span className="exp-desc">Edge pixel extrapolation</span>
                </div>
                <input
                  type="checkbox"
                  className="toggle-switch"
                  checked={options.smartPadding}
                  onChange={(e) => setOptions(prev => ({ ...prev, smartPadding: e.target.checked }))}
                />
              </div>

              {/* Row 2: Settings (2 Columns) */}
              <div className="exp-item" title="Converts images to Google's WebP format. Usually 30-50% smaller than PNG at same quality.">
                <div className="exp-info">
                  <div className="title-row">
                    <span className="exp-title">WebP Magic</span>
                    <div className="info-icon">i</div>
                  </div>
                  <span className="exp-desc">Heavy .webp compression</span>
                </div>
                <select
                  className="mini-select"
                  value={options.outputFormat}
                  onChange={(e) => setOptions(prev => ({ ...prev, outputFormat: e.target.value as any }))}
                >
                  <option value="original">Keep Original (PNG/JPG)</option>
                  <option value="webp">Convert to WebP</option>
                </select>
              </div>

              <div className="exp-item naming">
                <div className="exp-info">
                  <span className="exp-title">Batch Naming Rules</span>
                  <div className="naming-inputs">
                    <input
                      type="text"
                      placeholder="Prefix"
                      value={options.namePrefix}
                      onChange={(e) => setOptions(prev => ({ ...prev, namePrefix: e.target.value }))}
                    />
                    <div className="filename-placeholder">filename</div>
                    <input
                      type="text"
                      placeholder="Suffix"
                      value={options.nameSuffix}
                      onChange={(e) => setOptions(prev => ({ ...prev, nameSuffix: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              {/* Row 3: Advanced Controller (Full Width) */}
              <div className="exp-item full-width-exp">
                <div className="exp-info">
                  <div className="title-row">
                    <span className="exp-title">Advanced POT Controller</span>
                    <div className="info-icon" title="Force specific scale modes. Critical for GPU compression (ASTC/DXT).">i</div>
                  </div>
                  <div className="pot-lab-controls">
                    <div className="pot-control-group">
                      <span className="mini-label">Enable POT:</span>
                      <input
                        type="checkbox"
                        className="toggle-switch"
                        checked={options.enforcePOT}
                        onChange={(e) => setOptions(prev => ({ ...prev, enforcePOT: e.target.checked }))}
                      />
                    </div>
                    {options.enforcePOT && (
                      <>
                        <div className="pot-control-group">
                          <span className="mini-label">Target Size:</span>
                          <select
                            className="mini-select"
                            value={options.potSize}
                            onChange={(e) => setOptions(prev => ({ ...prev, potSize: e.target.value as any }))}
                          >
                            <option value="auto">Auto (Nearest Power)</option>
                            <option value="16">16x16</option>
                            <option value="32">32x32</option>
                            <option value="64">64x64</option>
                            <option value="128">128x128</option>
                            <option value="256">256x256</option>
                            <option value="512">512x512</option>
                            <option value="1024">1024x1024</option>
                            <option value="2048">2048x2048</option>
                            <option value="4096">4096x4096</option>
                          </select>
                        </div>
                        <div className="pot-control-group">
                          <span className="mini-label">Mode:</span>
                          <select
                            className="mini-select"
                            value={options.potMode}
                            onChange={(e) => setOptions(prev => ({ ...prev, potMode: e.target.value as any }))}
                          >
                            <option value="pad">Padding (Contain)</option>
                            <option value="stretch">Stretching (Distort)</option>
                            <option value="crop">Cropping (Cut edges)</option>
                            <option value="fit">Force Scale (Resizing)</option>
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {files.length > 0 && (
          <div className="file-list-container fade-in">
            {files.map((file) => (
              <div key={file.id} className={`file-card glass-panel ${file.status} ${selectedForComparison?.id === file.id ? 'selected' : ''} ${!file.selected ? 'opacity-50' : ''}`}>
                <div className="file-card-controls">
                  <input
                    type="checkbox"
                    className="toggle-checkbox"
                    checked={file.selected}
                    onChange={() => toggleSelection(file.id)}
                  />
                </div>

                <div className="file-preview" onClick={() => file.status === 'done' && setSelectedForComparison(file)}>
                  <img src={file.previewUrl} alt={file.file.name} />
                </div>

                <div className="file-info" onClick={() => file.status === 'done' && setSelectedForComparison(file)}>
                  <div className="file-name-row">
                    <span className="file-name">{file.file.name}</span>
                    {file.width && file.height && (
                      (file.width & (file.width - 1)) !== 0 || (file.height & (file.height - 1)) !== 0
                    ) && (
                        <span className="pot-warning" title="Non-Power of Two texture (POT). Recommended to Enforce POT for Unity.">
                          ⚠️
                        </span>
                      )}
                  </div>
                  <div className="file-meta">
                    <span>{formatSize(file.originalSize)}</span>
                    {file.compressedSize && (
                      <>
                        <span className="meta-arrow">→</span>
                        <span>{formatSize(file.compressedSize)}</span>
                        {file.status === 'done' && (
                          <div className="file-savings">
                            <span className="savings-badge">
                              {Math.round(((file.originalSize - (file.compressedSize || 0)) / file.originalSize) * 100)}%
                            </span>
                            <button
                              className="icon-btn download"
                              onClick={(e) => { e.stopPropagation(); downloadSingle(file); }}
                              title="Download this file"
                            >
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="file-status-icon">
                  {file.status === 'processing' && <div className="loader"></div>}
                  {file.status === 'done' && <span className="check">✓</span>}
                  {file.status === 'error' && <span className="error">!</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {selectedForComparison && selectedForComparison.compressedBlob && (
        <div className="comparison-overlay fade-in" onClick={() => setSelectedForComparison(null)}>
          <div className="comparison-modal glass-panel" onClick={e => e.stopPropagation()}>
            <div className="comparison-header">
              <h3>Visual Comparison: {selectedForComparison.file.name}</h3>
              <button className="close-modal" onClick={() => setSelectedForComparison(null)}>×</button>
            </div>
            <div className="comparison-content">
              {selectedForComparison.compressedBlob && (
                <BeforeAfterSlider
                  originalUrl={selectedForComparison.previewUrl}
                  optimizedUrl={URL.createObjectURL(selectedForComparison.compressedBlob)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="footer">
        <p className="text-secondary">© 2026 Unity Image Optimizer. For Artists, by Antigravity.</p>
      </footer>
    </div>
  );
}

export default App;
