import React, { useState, useRef, useEffect } from 'react';
import type { MouseEvent, TouchEvent } from 'react';

interface BeforeAfterSliderProps {
    originalUrl: string;
    optimizedUrl: string;
}

export const BeforeAfterSlider: React.FC<BeforeAfterSliderProps> = ({ originalUrl, optimizedUrl }) => {
    const [sliderPosition, setSliderPosition] = useState(50);
    const containerRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);

    const handleMove = (clientX: number) => {
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
            const percentage = (x / rect.width) * 100;
            setSliderPosition(percentage);
        }
    };

    const onMouseDown = () => { isDragging.current = true; };
    const onMouseUp = () => { isDragging.current = false; };
    const onMouseMove = (e: MouseEvent) => { if (isDragging.current) handleMove(e.clientX); };

    const onTouchStart = () => { isDragging.current = true; };
    const onTouchEnd = () => { isDragging.current = false; };
    const onTouchMove = (e: TouchEvent) => { if (isDragging.current) handleMove(e.touches[0].clientX); };

    // Allow clicking anywhere on the line to jump
    const onClick = (e: MouseEvent) => {
        handleMove(e.clientX);
    };

    useEffect(() => {
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('touchend', onTouchEnd);
        return () => {
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('touchend', onTouchEnd);
        };
    }, []);

    return (
        <div
            className="ba-slider-container"
            ref={containerRef}
            onMouseMove={onMouseMove}
            onTouchMove={onTouchMove}
            onClick={onClick}
        >
            <div className="ba-image-wrapper">
                <img src={originalUrl} alt="Original" />
                <span className="ba-label original">Original</span>
            </div>

            <div
                className="ba-image-wrapper overlay"
                style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
            >
                <img src={optimizedUrl} alt="Optimized" />
                <span className="ba-label optimized">Optimized</span>
            </div>

            <div
                className="ba-handle"
                style={{ left: `${sliderPosition}%` }}
                onMouseDown={onMouseDown}
                onTouchStart={onTouchStart}
            >
                <div className="ba-line"></div>
                <div className="ba-circle">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18-6-6 6-6" /><path d="m15 6 6 6-6 6" /></svg>
                </div>
            </div>
        </div>
    );
};
