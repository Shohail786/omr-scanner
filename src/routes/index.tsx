import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Download, Loader2, ScanLine, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { SheetOverlay } from "@/components/omr/SheetOverlay";
import { ResultsTable } from "@/components/omr/ResultsTable";
import { imageDataFromImage, scanOmr, type OmrResult } from "@/lib/omr";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OMR Scanner — Read Answer Sheets & Roll Numbers" },
      {
        name: "description",
        content:
          "Upload a scanned OMR answer sheet and instantly read the darkened roll number digits and 90 answer bubbles, with scoring against an answer key.",
      },
      { property: "og:title", content: "OMR Scanner — Read Answer Sheets & Roll Numbers" },
      {
        property: "og:description",
        content:
          "Browser-based optical mark recognition: detect roll number and answers from a scanned bubble sheet in seconds.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<OmrResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [sensitivity, setSensitivity] = useState(60);
  const [keyText, setKeyText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback((img: HTMLImageElement, mark: number) => {
    setBusy(true);
    // let the spinner paint before the synchronous scan
    setTimeout(() => {
      const { data } = imageDataFromImage(img);
      setResult(scanOmr(data, { markThreshold: mark / 100 }));
      setBusy(false);
    }, 30);
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const img = new Image();
      img.onload = () => {
        setImage(img);
        setFileName(file.name);
        run(img, sensitivity);
      };
      img.src = URL.createObjectURL(file);
    },
    [run, sensitivity],
  );

  const answerKey = useMemo(() => {
    const letters = keyText.toUpperCase().replace(/[^ABCD]/g, "");
    const map: Record<number, string> = {};
    for (let i = 0; i < letters.length; i++) map[i + 1] = letters[i];
    return map;
  }, [keyText]);

  const score = useMemo(() => {
    if (!result || !Object.keys(answerKey).length) return null;
    let correct = 0;
    let wrong = 0;
    let blank = 0;
    for (const a of result.answers) {
      const k = answerKey[a.q];
      if (!k) continue;
      if (!a.answer) blank++;
      else if (a.answer === k) correct++;
      else wrong++;
    }
    return { correct, wrong, blank, total: Object.keys(answerKey).length };
  }, [result, answerKey]);

  const exportCsv = () => {
    if (!result) return;
    const rows = [
      ["roll_number", result.rollNumber],
      ["question", "answer"],
      ...result.answers.map((a) => [String(a.q), a.multiple ? "MULTI" : (a.answer ?? "")]),
    ];
    const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.rollNumber || "omr"}-result.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const answered = result?.answers.filter((a) => a.answer).length ?? 0;

  return (
    <main className="min-h-screen grid-paper">
      <header className="border-b border-border bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ScanLine className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">OMR Sheet Scanner</h1>
            <p className="text-sm text-muted-foreground">
              Reads roll number digits and answer bubbles from a scanned sheet — fully in your
              browser.
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[1.1fr_1fr]">
        <section className="space-y-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            className="rounded-xl border-2 border-dashed border-border bg-card p-6 text-center"
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Drop a scanned OMR sheet here, or
            </p>
            <Button className="mt-3" onClick={() => inputRef.current?.click()}>
              Choose image
            </Button>
            {fileName && (
              <p className="mt-3 font-mono text-xs text-muted-foreground">{fileName}</p>
            )}
          </div>

          {image && (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Mark sensitivity — {sensitivity}%</Label>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => image && run(image, sensitivity)}
                >
                  Re-scan
                </Button>
              </div>
              <Slider
                value={[sensitivity]}
                min={25}
                max={90}
                step={5}
                onValueChange={(v) => setSensitivity(v[0])}
                onValueCommit={(v) => image && run(image, v[0])}
              />
              <p className="text-xs text-muted-foreground">
                Lower it if faint pencil marks are missed, raise it if stray marks are picked up.
              </p>
            </div>
          )}

          {image && (
            <div className="relative">
              <SheetOverlay image={image} result={result} />
              {busy && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Roll number
            </p>
            <p className="mt-1 font-mono text-4xl font-semibold tracking-[0.25em]">
              {result?.rollNumber || "——————"}
            </p>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <span className="text-muted-foreground">
                Questions detected:{" "}
                <strong className="text-foreground">{result?.answers.length ?? 0}</strong>
              </span>
              <span className="text-muted-foreground">
                Answered: <strong className="text-foreground">{answered}</strong>
              </span>
            </div>
            {!!result?.warnings.length && (
              <ul className="mt-3 space-y-1 text-xs text-warning-foreground">
                {result.warnings.map((w) => (
                  <li key={w} className="rounded bg-warning/20 px-2 py-1">
                    {w}
                  </li>
                ))}
              </ul>
            )}
            {result && (
              <Button variant="outline" size="sm" className="mt-4" onClick={exportCsv}>
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <Label htmlFor="key" className="text-sm">
              Answer key (optional)
            </Label>
            <Textarea
              id="key"
              value={keyText}
              onChange={(e) => setKeyText(e.target.value)}
              placeholder="ABCDABCD… one letter per question, in order"
              className="mt-2 font-mono text-sm"
              rows={3}
            />
            {score && (
              <div className="mt-3 grid grid-cols-3 gap-2 text-center font-mono">
                <div className="rounded-md bg-success/15 p-2">
                  <p className="text-lg font-semibold text-success">{score.correct}</p>
                  <p className="text-xs text-muted-foreground">correct</p>
                </div>
                <div className="rounded-md bg-destructive/10 p-2">
                  <p className="text-lg font-semibold text-destructive">{score.wrong}</p>
                  <p className="text-xs text-muted-foreground">wrong</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <p className="text-lg font-semibold">{score.blank}</p>
                  <p className="text-xs text-muted-foreground">blank</p>
                </div>
              </div>
            )}
          </div>

          {result && result.answers.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Detected answers
              </p>
              <ResultsTable answers={result.answers} answerKey={answerKey} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
