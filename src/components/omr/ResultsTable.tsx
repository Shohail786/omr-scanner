import type { AnswerResult } from "@/lib/omr";
import { cn } from "@/lib/utils";

interface Props {
  answers: AnswerResult[];
  answerKey: Record<number, string>;
}

export function ResultsTable({ answers, answerKey }: Props) {
  const hasKey = Object.keys(answerKey).length > 0;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
      {answers.map((a) => {
        const key = answerKey[a.q];
        const correct = hasKey && key ? key === a.answer : null;
        return (
          <div
            key={a.q}
            className="flex items-center justify-between border-b border-border/60 py-1 font-mono text-sm"
          >
            <span className="text-muted-foreground">{a.q}.</span>
            <span
              className={cn(
                "ml-2 flex-1 text-right font-semibold",
                a.multiple && "text-destructive",
                !a.answer && !a.multiple && "text-muted-foreground/50",
                correct === true && "text-success",
                correct === false && "text-destructive",
              )}
            >
              {a.multiple ? "MULTI" : (a.answer ?? "—")}
            </span>
            {hasKey && key && (
              <span className="ml-2 w-6 text-right text-xs text-muted-foreground">{key}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}