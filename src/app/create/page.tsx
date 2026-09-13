"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BACKEND_URL } from "@/lib/backend-api";

const VOICES = [
  { value: "bn-BD-NabanitaNeural", label: "Nabanita (Bangla, female)" },
  { value: "bn-BD-PradeepNeural", label: "Pradeep (Bangla, male)" },
  { value: "bn-IN-TanishaaNeural", label: "Tanishaa (Bangla/India, female)" },
  { value: "bn-IN-BashkarNeural", label: "Bashkar (Bangla/India, male)" },
  { value: "en-US-AriaNeural", label: "Aria (English US, female)" },
  { value: "en-US-GuyNeural", label: "Guy (English US, male)" },
];

const GRADES = [
  { value: "none", label: "Color (no grade)" },
  { value: "bw", label: "Black & white" },
  { value: "bw-punch", label: "B&W, higher contrast" },
];

interface JobStatus {
  job_id: string;
  status: "queued" | "running" | "done" | "error";
  stage: string | null;
  progress: number;
  log: string[];
  project_id: string;
}

export default function CreatePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [script, setScript] = useState("");
  const [links, setLinks] = useState("");
  const [voice, setVoice] = useState(VOICES[0].value);
  const [grade, setGrade] = useState(GRADES[0].value);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const running = job && (job.status === "queued" || job.status === "running");

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/create/${job.job_id}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const next: JobStatus = await res.json();
        setJob(next);
      } catch (err) {
        console.error("poll failed:", err);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [job]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [job?.log.length]);

  const handleGenerate = async () => {
    setError(null);
    try {
      const linkList = links
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const res = await fetch(`${BACKEND_URL}/api/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "Untitled project",
          script,
          links: linkList,
          voice,
          grade,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body);
      }
      const started: JobStatus = await res.json();
      setJob(started);
    } catch (err: any) {
      setError(String(err?.message || err));
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex justify-center py-10 px-4">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Create a video</h1>

        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Project name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Colony 2026 recap"
            disabled={!!running}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="script">Script</Label>
          <Textarea
            id="script"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="Paste your narration script here…"
            className="min-h-40"
            disabled={!!running}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="links">Source video links</Label>
          <Textarea
            id="links"
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            placeholder={"One URL per line — each gets downloaded and indexed for footage matching"}
            className="min-h-24"
            disabled={!!running}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label>Voice</Label>
            <Select value={voice} onValueChange={setVoice} disabled={!!running}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOICES.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Style</Label>
            <Select value={grade} onValueChange={setGrade} disabled={!!running}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRADES.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}

        <Button onClick={handleGenerate} disabled={!!running || !script.trim()} className="h-10">
          {running ? "Generating…" : "Generate video"}
        </Button>

        {job && (
          <div className="flex flex-col gap-3 border rounded-md p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {job.status === "error" ? "Failed" : job.stage || job.status}
              </span>
              <span className="text-muted-foreground">{job.progress}%</span>
            </div>
            <Progress value={job.progress} />
            <div
              ref={logRef}
              className="text-xs font-mono bg-muted/40 rounded p-2 max-h-48 overflow-y-auto whitespace-pre-wrap"
            >
              {job.log.join("\n")}
            </div>

            {job.status === "done" && (
              <Button onClick={() => router.push(`/?project=${job.project_id}`)}>
                Open in editor
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
