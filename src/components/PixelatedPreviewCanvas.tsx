'use client';

import React, { useRef, useEffect, TouchEvent, MouseEvent, useState } from 'react';
import GoldenSweepOverlay, { type GoldenSweepRequest } from './GoldenSweepOverlay';
import { MappedPixel } from '../utils/pixelation';

interface PixelatedPreviewCanvasProps {
  mappedPixelData: MappedPixel[][] | null;
  gridDimensions: { N: number; M: number } | null;
  isManualColoringMode: boolean;
  isContinuousBrush?: boolean;
  onBrushStart?: (clientX: number, clientY: number) => void;
  onBrushMove?: (clientX: number, clientY: number) => void;
  onBrushEnd?: () => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onInteraction: (
    clientX: number,
    clientY: number,
    pageX: number,
    pageY: number,
    isClick: boolean,
    isTouchEnd?: boolean
  ) => void;
  highlightRequest?: GoldenSweepRequest | null;
  onHighlightComplete?: (id: number) => void;
}

// Canvas defaults to 300×150 when it first mounts. Image upload normally
// sizes it in pixelateImage(), but CSV/cloud-code restores intentionally skip
// re-pixelation to preserve the saved beads. Without sizing the canvas here,
// a portrait grid is stretched across the default landscape drawing surface.
//
// Preserve the existing dimensions on normal image uploads when they already
// match the grid. For restored grids, choose a legible preview size while
// bounding total pixels for unusually tall/wide CSV files.
function ensureGridCanvasAspect(canvas: HTMLCanvasElement, dims: { N: number; M: number }) {
  const { N, M } = dims;
  if (!Number.isFinite(N) || !Number.isFinite(M) || N <= 0 || M <= 0) return;
  const targetAspect = N / M;
  const canvasAspect = canvas.width / Math.max(canvas.height, 1);
  if (Math.abs(canvasAspect - targetAspect) / targetAspect <= 0.01) return;

  const baseWidth = Math.min(1200, Math.max(500, N * 4));
  const baseHeight = baseWidth * M / N;
  const scale = Math.min(1, 8192 / Math.max(baseWidth, baseHeight),
    Math.sqrt(16_000_000 / (baseWidth * baseHeight)));
  canvas.width = Math.max(1, Math.round(baseWidth * scale));
  canvas.height = Math.max(1, Math.round(baseHeight * scale));
}

// 绘制像素化画布的函数
const drawPixelatedCanvas = (
  dataToDraw: MappedPixel[][],
  canvas: HTMLCanvasElement | null,
  dims: { N: number; M: number } | null
) => {
  if (!canvas || !dims || !dataToDraw) {
    console.warn("drawPixelatedCanvas: Missing required parameters");
    return;
  }
  
  const pixelatedCtx = canvas.getContext('2d');
  if (!pixelatedCtx) {
    console.error("Failed to get 2D context for pixelated canvas");
    return;
  }

  // Respect current dark mode preference
  const isDarkMode = typeof window !== 'undefined' && document.documentElement.classList.contains('dark');

  // Define colors based on mode
  const externalBackgroundColor = isDarkMode ? '#374151' : '#F3F4F6'; // gray-700 : gray-100
  const gridLineColor = isDarkMode ? '#4B5563' : '#DDDDDD'; // gray-600 : lighter gray

  const { N, M } = dims;
  const outputWidth = canvas.width;
  const outputHeight = canvas.height;
  const cellWidthOutput = outputWidth / N;
  const cellHeightOutput = outputHeight / M;

  pixelatedCtx.clearRect(0, 0, outputWidth, outputHeight);
  pixelatedCtx.lineWidth = 0.5; // Keep line width thin

  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const cellData = dataToDraw[j]?.[i];
      if (!cellData) continue;

      const drawX = i * cellWidthOutput;
      const drawY = j * cellHeightOutput;

      // Fill cell color using mode-specific background for external cells
      if (cellData.isExternal) {
        pixelatedCtx.fillStyle = externalBackgroundColor;
      } else {
        pixelatedCtx.fillStyle = cellData.color;
      }
      pixelatedCtx.fillRect(drawX, drawY, cellWidthOutput, cellHeightOutput);

      // Draw grid lines using mode-specific color
      pixelatedCtx.strokeStyle = gridLineColor;
      pixelatedCtx.strokeRect(drawX + 0.5, drawY + 0.5, cellWidthOutput, cellHeightOutput);
    }
  }
};

const PixelatedPreviewCanvas: React.FC<PixelatedPreviewCanvasProps> = ({
  mappedPixelData,
  gridDimensions,
  isManualColoringMode,
  isContinuousBrush = false,
  onBrushStart,
  onBrushMove,
  onBrushEnd,
  canvasRef,
  onInteraction,
  highlightRequest,
  onHighlightComplete,
}) => {
  const [darkModeState, setDarkModeState] = useState<boolean | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number; pageX: number; pageY: number } | null>(null);
  const touchMovedRef = useRef<boolean>(false);
  const brushPointerRef = useRef<number | null>(null);
  const [brushPreview, setBrushPreview] = useState<{ row: number; col: number } | null>(null);
  const updateBrushPreview = (clientX: number, clientY: number) => {
    if (!isContinuousBrush || !gridDimensions || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) {
      setBrushPreview(null);
      return;
    }
    const col = Math.floor((clientX - rect.left) / rect.width * gridDimensions.N);
    const row = Math.floor((clientY - rect.top) / rect.height * gridDimensions.M);
    setBrushPreview({
      col: Math.max(0, Math.min(col, Math.max(0, gridDimensions.N - 2))),
      row: Math.max(0, Math.min(row, Math.max(0, gridDimensions.M - 2)))
    });
  };

  // Effect to detect dark mode changes and update state
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkDarkMode = () => {
        const isDark = document.documentElement.classList.contains('dark');
        // Only update state if it actually changes
        if (isDark !== darkModeState) {
            setDarkModeState(isDark);
        }
    };

    // Initial check
    checkDarkMode();

    // Use MutationObserver to watch for class changes on <html>
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Cleanup observer on component unmount
    return () => observer.disconnect();

  }, [darkModeState]); // Depend on darkModeState to re-run if needed externally

  // Update useEffect for drawing to depend on darkModeState as well
  useEffect(() => {
    // Ensure darkModeState is not null before drawing
    if (mappedPixelData && gridDimensions && canvasRef.current && darkModeState !== null) {
      // CSV/cloud-code restores mount a fresh canvas (300×150 by HTML
      // default), so set the drawing surface to the stored grid's aspect
      // before painting. This does NOT recalculate or alter any bead colors.
      ensureGridCanvasAspect(canvasRef.current, gridDimensions);
      drawPixelatedCanvas(mappedPixelData, canvasRef.current, gridDimensions);
    }
  }, [mappedPixelData, gridDimensions, canvasRef, darkModeState]);

  // --- 鼠标事件处理 ---
  
  // 鼠标移动时显示提示
  const handleMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
    if (isContinuousBrush) { updateBrushPreview(event.clientX, event.clientY); return; }
    // 只有在非手动模式下才通过mousemove显示tooltip，避免干扰手动上色
    if (!isManualColoringMode) {
        onInteraction(event.clientX, event.clientY, event.pageX, event.pageY, false);
    }
  };

  // 鼠标离开时隐藏提示
  const handleMouseLeave = () => {
    setBrushPreview(null);
    // 鼠标离开时总是隐藏tooltip
    onInteraction(0, 0, 0, 0, false, true);
  };

  // 鼠标点击处理（用于手动上色模式）
  const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    // 鼠标点击行为保持不变：
    // 手动模式下：上色
    // 非手动模式下：切换tooltip
    if (isContinuousBrush) return;
    onInteraction(event.clientX, event.clientY, event.pageX, event.pageY, isManualColoringMode);
  };

  // --- 触摸事件处理 ---
  // 用于检测触摸移动的参考
  const handleTouchStart = (event: TouchEvent<HTMLCanvasElement>) => {
    if (isContinuousBrush) return;
    const touch = event.touches[0];
    if (!touch) return;

    // 记录起始位置并重置移动标志
    touchStartPosRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      pageX: touch.pageX,
      pageY: touch.pageY
    };
    touchMovedRef.current = false;

    // 在非手动模式下，触摸开始时仍然可以立即显示/切换tooltip，提供即时反馈
    if (!isManualColoringMode) {
        onInteraction(touch.clientX, touch.clientY, touch.pageX, touch.pageY, false);
    }
    // 注意：此处不再触发手动上色 (isClick: true)
  };
  
  // 触摸移动时检测是否需要隐藏提示
  const handleTouchMove = (event: TouchEvent<HTMLCanvasElement>) => {
    if (isContinuousBrush) return;
    const touch = event.touches[0];
    if (!touch || !touchStartPosRef.current) return;
    
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
    
    // 如果移动超过阈值，则标记为已移动，并隐藏tooltip
    // 增加一个稍大的阈值，以更好地区分点击和微小的手指抖动/滑动意图
    if (!touchMovedRef.current && (dx > 10 || dy > 10)) {
      touchMovedRef.current = true;
      // 一旦确定是移动，就隐藏tooltip
      onInteraction(0, 0, 0, 0, false, true);
    }
  };
  
  // 触摸结束时不再自动隐藏提示框
  const handleTouchEnd = () => {
    if (isContinuousBrush) return;
    // 检查是否是手动模式，并且触摸没有移动（判定为点击）
    if (isManualColoringMode && !touchMovedRef.current && touchStartPosRef.current) {
      // 使用触摸开始时的坐标来执行上色操作
      const { x, y, pageX, pageY } = touchStartPosRef.current;
      onInteraction(x, y, pageX, pageY, true); // isClick: true 表示执行上色
    }
    // 如果是非手动模式下的点击 (isManualColoringMode=false, touchMovedRef=false)
    // Tooltip 的显示/隐藏切换已在 touchstart 处理，touchend 时无需额外操作

    // 重置触摸状态
    touchStartPosRef.current = null;
    touchMovedRef.current = false;
  };

  // Pointer Events unify mouse and touch, with capture keeping each stroke
  // intact even if a finger briefly exits the canvas.
  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isContinuousBrush || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    brushPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateBrushPreview(event.clientX, event.clientY);
    onBrushStart?.(event.clientX, event.clientY);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isContinuousBrush) return;
    updateBrushPreview(event.clientX, event.clientY);
    if (brushPointerRef.current === event.pointerId) onBrushMove?.(event.clientX, event.clientY);
  };
  const handlePointerEnd = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (brushPointerRef.current !== event.pointerId) return;
    brushPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onBrushEnd?.();
  };
  useEffect(() => {
    if (!isContinuousBrush) setBrushPreview(null);
  }, [isContinuousBrush]);

  return (
    <div className="relative inline-block max-w-full align-middle">
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd} // 添加 onTouchCancel 以处理触摸中断的情况
      className={`border border-gray-300 dark:border-gray-600 max-w-full h-auto rounded block ${
        isContinuousBrush ? 'cursor-crosshair' : (isManualColoringMode ? 'cursor-pointer' : 'cursor-grab') // 改为 grab 光标提示可以拖动
      }`}
      style={{
        imageRendering: 'pixelated',
        touchAction: isContinuousBrush ? 'none' : 'auto'
      }}
    />
      {isContinuousBrush && brushPreview && gridDimensions && (
        <div className="absolute pointer-events-none rounded-[2px] border-2 border-[#df4f91] bg-[#f7a6cb]/30 shadow-[0_0_0_1px_#ffffffc0,0_0_12px_#f36d9b75]"
          aria-hidden="true"
          style={{
            left: `${brushPreview.col / gridDimensions.N * 100}%`,
            top: `${brushPreview.row / gridDimensions.M * 100}%`,
            width: `${Math.min(2, gridDimensions.N) / gridDimensions.N * 100}%`,
            height: `${Math.min(2, gridDimensions.M) / gridDimensions.M * 100}%`
          }}
        />
      )}
      <GoldenSweepOverlay
        sourceCanvasRef={canvasRef}
        mappedPixelData={mappedPixelData}
        gridDimensions={gridDimensions}
        request={highlightRequest || null}
        onComplete={onHighlightComplete}
      />
    </div>
  );
};

export default PixelatedPreviewCanvas; 