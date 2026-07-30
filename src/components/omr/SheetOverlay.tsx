import { useEffect, useRef } from "react";
import type { OmrResult } from "@/lib/omr";

interface Props {
  image: HTMLImageElement | null;
  result: OmrResult | null;
}

/** Draws the scanned sheet with detected bubbles highlighted. */
export function SheetOverlay({ image, result }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !result) return;
    canvas.width = result.width;
    canvas.height = result.height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const marked = getComputedStyle(canvas).getPropertyValue("--overlay-marked").trim();
    const empty = getComputedStyle(canvas).getPropertyValue("--overlay-empty").trim();
    const multi = getComputedStyle(canvas).getPropertyValue("--overlay-multi").trim();

    const all = [
      ...result.rollBubbles.map((b) => ({ b, multiple: false })),
      ...result.answers.flatMap((a) => a.bubbles.map((b) => ({ b, multiple: a.multiple }))),
    ];

    ctx.lineWidth = Math.max(1.2, result.width / 800);
    for (const { b, multiple } of all) {
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, b.r + 2, 0, Math.PI * 2);
      ctx.strokeStyle = b.marked ? (multiple ? multi : marked) : empty;
      ctx.globalAlpha = b.marked ? 1 : 0.35;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [image, result]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg border border-border bg-card [--overlay-empty:oklch(0.6_0.02_250)] [--overlay-marked:oklch(0.62_0.19_150)] [--overlay-multi:oklch(0.62_0.22_25)]"
    />
  );
}
