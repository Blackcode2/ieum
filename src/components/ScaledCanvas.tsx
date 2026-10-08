import { useEffect, useState, type ReactNode } from 'react';

const DESIGN_WIDTH = 1920;

interface ScaledCanvasProps {
  /** Height of the Figma frame in design pixels. */
  height: number;
  /**
   * Design pixels from the top of the frame that must be visible without scrolling. When the window
   * is too short for them at full width, the frame is scaled down further and centred.
   */
  fitHeight?: number;
  background?: string;
  children: ReactNode;
}

function measure(fitHeight?: number): { scale: number; offset: number } {
  const width = document.documentElement.clientWidth;
  const byWidth = width / DESIGN_WIDTH;
  const scale = fitHeight ? Math.min(byWidth, window.innerHeight / fitHeight) : byWidth;
  return { scale, offset: (width - DESIGN_WIDTH * scale) / 2 };
}

/**
 * The screens are designed as fixed 1920px desktop frames. This lays the children out in design
 * pixels and scales the whole frame to the window, so the layout matches Figma on any laptop.
 */
export function ScaledCanvas({ height, fitHeight, background, children }: ScaledCanvasProps) {
  const [{ scale, offset }, setLayout] = useState(() => measure(fitHeight));

  useEffect(() => {
    const onResize = () => setLayout(measure(fitHeight));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitHeight]);

  // The page behind the frame takes the frame's colour, so nothing white shows around a dark screen.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.backgroundColor;
    root.style.backgroundColor = background ?? '';
    return () => {
      root.style.backgroundColor = previous;
    };
  }, [background]);

  return (
    <div style={{ height: height * scale, overflow: 'hidden', background }}>
      <div
        style={{
          position: 'relative',
          width: DESIGN_WIDTH,
          height,
          transform: `translateX(${offset}px) scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
    </div>
  );
}
