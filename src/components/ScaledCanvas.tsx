import { useEffect, useState, type ReactNode } from 'react';

const DESIGN_WIDTH = 1920;

interface ScaledCanvasProps {
  /** Height of the Figma frame in design pixels. */
  height: number;
  background?: string;
  children: ReactNode;
}

function measure(): number {
  return document.documentElement.clientWidth / DESIGN_WIDTH;
}

/**
 * A page designed as a fixed 1920px desktop frame that scrolls. This lays the children out in design
 * pixels and scales the whole frame to the window width, so the layout matches Figma on any display.
 * (Kiosk screens, which do not scroll, use KioskStage instead.)
 */
export function ScaledCanvas({ height, background, children }: ScaledCanvasProps) {
  const [scale, setScale] = useState(measure);

  useEffect(() => {
    const onResize = () => setScale(measure());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
    </div>
  );
}
