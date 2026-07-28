import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Camera,
  Video as VideoIcon,
  Crop as CropIcon,
  MousePointerSquareDashed,
  Check,
  ChevronLeft,
  Scissors,
  SlidersHorizontal,
  Type as TypeIcon,
  Smile,
  Play,
  Pause,
  Lock,
  UploadCloud,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  metaFromSettings,
  saveStatusMeta,
  type StatusSettings,
} from "@/lib/status-meta";

const STATUS_BUCKET = "status";

export const FILTERS: { id: string; label: string; css: string }[] = [
  { id: "natural", label: "Natural", css: "none" },
  { id: "soft", label: "Soft Glow", css: "brightness(1.08) saturate(1.1) contrast(0.96)" },
  { id: "warm", label: "Cinema Warm", css: "sepia(0.25) saturate(1.25) contrast(1.05)" },
  { id: "ember", label: "Ember Dark", css: "contrast(1.25) saturate(1.35) brightness(0.9) hue-rotate(-8deg)" },
  { id: "block", label: "Blockbuster", css: "contrast(1.3) saturate(0.85) brightness(1.02)" },
];

export function filterCss(id?: string) {
  return FILTERS.find((f) => f.id === id)?.css ?? "none";
}

const ASPECTS = [
  { id: "orig", label: "Original", ratio: 0 },
  { id: "916", label: "9:16", ratio: 9 / 16 },
  { id: "11", label: "1:1", ratio: 1 },
  { id: "169", label: "16:9", ratio: 16 / 9 },
  { id: "45", label: "4:5", ratio: 4 / 5 },
];

const STICKERS = ["❤️", "🔥", "✨", "💯", "🚀", "😍", "🌙", "🎬"];

interface Picked {
  file: File;
  url: string;
  isVideo: boolean;
}

export function CreateStatus({
  room,
  myId,
  myName,
  settings,
  onClose,
  onPosted,
}: {
  room: string;
  myId: string;
  myName: string;
  settings: StatusSettings;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [step, setStep] = useState<"pick" | "edit" | "upload">("pick");
  const [tab, setTab] = useState<"Gallery" | "Recent" | "Favorites">("Gallery");
  const [items, setItems] = useState<Picked[]>([]);
  const [sel, setSel] = useState(0);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);

  // edit state
  const [filter, setFilter] = useState("natural");
  const [caption, setCaption] = useState("");
  const [tool, setTool] = useState<"crop" | "trim" | "filter" | "text" | "sticker">("filter");
  const [aspect, setAspect] = useState("orig");
  const [trim, setTrim] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  // upload state
  const [pct, setPct] = useState(0);
  const [stepsDone, setStepsDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const current = items[sel];

  useEffect(() => {
    return () => items.forEach((i) => URL.revokeObjectURL(i.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const next = Array.from(list).map((file) => ({
      file,
      url: URL.createObjectURL(file),
      isVideo: file.type.startsWith("video"),
    }));
    setItems((p) => [...next, ...p]);
    setSel(0);
  };

  // ---------- upload ----------
  const doUpload = async () => {
    if (!current) return;
    setStep("upload");
    setError(null);
    setPct(0);
    setStepsDone(0);
    const tick = setInterval(() => {
      setPct((p) => (p < 92 ? p + Math.max(1, Math.round((92 - p) / 12)) : p));
      setStepsDone((s) => (s < 3 ? s + 1 : s));
    }, 420);
    try {
      let blob: Blob = current.file;
      if (!current.isVideo) blob = await bakeImage(current.url, filter, aspect);
      const ext = current.isVideo ? "mp4" : "jpg";
      const path = `${room}/${myId}/${Date.now()}.${ext}`;
      const up = await supabase.storage
        .from(STATUS_BUCKET)
        .upload(path, blob, { upsert: true, contentType: current.isVideo ? current.file.type : "image/jpeg" });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from(STATUS_BUCKET).getPublicUrl(path);
      const expires = new Date(Date.now() + settings.autoDeleteHours * 3600_000).toISOString();
      const ins = await supabase
        .from("statuses")
        .insert({
          room_code: room,
          sender: myId,
          sender_name: myName || "Me",
          media_url: pub.publicUrl,
          media_type: current.isVideo ? "video" : "image",
          expires_at: expires,
        })
        .select("id")
        .single();
      if (ins.error) throw ins.error;
      const sid = (ins.data as { id: string }).id;
      await saveStatusMeta(
        room,
        myId,
        metaFromSettings(sid, settings, {
          caption: caption.trim() || undefined,
          filter: current.isVideo ? filter : undefined,
        }),
      );
      clearInterval(tick);
      setStepsDone(4);
      setPct(100);
      setTimeout(() => {
        onPosted();
        onClose();
      }, 700);
    } catch (e) {
      clearInterval(tick);
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  };

  // ---------- render ----------
  if (step === "upload") {
    return (
      <UploadScreen pct={pct} stepsDone={stepsDone} error={error} onClose={onClose} />
    );
  }

  if (step === "edit" && current) {
    return (
      <div className="fixed inset-0 z-[90] flex flex-col bg-[#050506]">
        <header className="flex items-center justify-between px-4 py-3">
          <button onClick={() => setStep("pick")} aria-label="Back" className="text-foreground">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <span className="font-heading text-base font-semibold">Edit Status</span>
          <button onClick={doUpload} aria-label="Done" className="text-primary">
            <Check className="h-6 w-6" />
          </button>
        </header>

        <div className="relative mx-4 flex-1 overflow-hidden rounded-2xl border border-primary/25 bg-black">
          {current.isVideo ? (
            <video
              ref={videoRef}
              src={current.url}
              autoPlay
              loop
              playsInline
              muted
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration || 0;
                setDur(d);
                setTrim({ start: 0, end: d });
              }}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (trim.end && v.currentTime > trim.end) v.currentTime = trim.start;
              }}
              style={{ filter: filterCss(filter) }}
              className="h-full w-full object-contain"
            />
          ) : (
            <img
              src={current.url}
              alt="Preview"
              style={{ filter: filterCss(filter) }}
              className="h-full w-full object-contain"
            />
          )}
          {tool === "crop" && <CropGrid />}
          {caption && (
            <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-10 text-center text-sm text-foreground">
              {caption}
            </p>
          )}
        </div>

        {/* trim strip */}
        {current.isVideo && (
          <div className="px-4 pt-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const v = videoRef.current;
                  if (!v) return;
                  if (v.paused) {
                    v.play();
                    setPlaying(true);
                  } else {
                    v.pause();
                    setPlaying(false);
                  }
                }}
                className="text-foreground"
                aria-label="Play/Pause"
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <div className="relative h-12 flex-1 overflow-hidden rounded-md border-2 border-primary bg-secondary">
                <video src={current.url} muted className="h-full w-full object-cover opacity-70" />
              </div>
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>{fmt(trim.start)}</span>
              <span>{fmt(trim.end || dur)}</span>
            </div>
            {tool === "trim" && (
              <div className="mt-2 space-y-2">
                <input
                  type="range"
                  min={0}
                  max={Math.max(dur, 0.1)}
                  step={0.1}
                  value={trim.start}
                  onChange={(e) => setTrim((t) => ({ ...t, start: Math.min(Number(e.target.value), t.end) }))}
                  className="w-full accent-primary"
                />
                <input
                  type="range"
                  min={0}
                  max={Math.max(dur, 0.1)}
                  step={0.1}
                  value={trim.end}
                  onChange={(e) => setTrim((t) => ({ ...t, end: Math.max(Number(e.target.value), t.start) }))}
                  className="w-full accent-primary"
                />
              </div>
            )}
          </div>
        )}

        {/* tools */}
        <div className="grid grid-cols-5 gap-1 px-4 pt-4">
          {[
            { id: "crop", label: "Crop", Icon: CropIcon },
            { id: "trim", label: "Trim", Icon: Scissors },
            { id: "filter", label: "Filter", Icon: SlidersHorizontal },
            { id: "text", label: "Text", Icon: TypeIcon },
            { id: "sticker", label: "Sticker", Icon: Smile },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTool(id as typeof tool)}
              className={`flex flex-col items-center gap-1.5 py-1 text-[11px] ${
                tool === id ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-[104px] px-4 pb-5 pt-3">
          {tool === "filter" && (
            <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              {FILTERS.map((f) => (
                <button key={f.id} onClick={() => setFilter(f.id)} className="shrink-0 text-center">
                  <span
                    className={`block h-16 w-14 overflow-hidden rounded-lg border-2 ${
                      filter === f.id ? "border-primary" : "border-transparent"
                    }`}
                  >
                    <Preview item={current} css={f.css} />
                  </span>
                  <span
                    className={`mt-1 block text-[10px] ${
                      filter === f.id ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {f.label}
                  </span>
                </button>
              ))}
            </div>
          )}
          {tool === "crop" && (
            <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAspect(a.id)}
                  className={`ember-chip shrink-0`}
                  data-active={aspect === a.id}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
          {tool === "text" && (
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add a caption…"
              className="w-full rounded-xl border border-primary/25 bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          )}
          {tool === "sticker" && (
            <div className="flex flex-wrap gap-2">
              {STICKERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setCaption((c) => (c + " " + s).trim())}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-secondary text-xl"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {tool === "trim" && !current.isVideo && (
            <p className="text-center text-xs text-muted-foreground">Trim is available for videos.</p>
          )}
        </div>
      </div>
    );
  }

  // ---------- pick ----------
  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#050506]">
      <header className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose} aria-label="Close" className="text-foreground">
          <X className="h-6 w-6" />
        </button>
        <span className="font-heading text-base font-semibold">Add to Status</span>
        <button onClick={() => camRef.current?.click()} aria-label="Camera" className="text-foreground">
          <Camera className="h-5 w-5" />
        </button>
      </header>

      <div className="flex border-b border-white/8 px-6">
        {(["Gallery", "Recent", "Favorites"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 pb-2 text-sm ${
              tab === t ? "border-b-2 border-primary font-semibold text-primary" : "text-muted-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pt-3" style={{ scrollbarWidth: "none" }}>
        <p className="mb-2 text-xs text-muted-foreground">{tab === "Gallery" ? "Today" : tab}</p>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => pickRef.current?.click()}
            className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 bg-secondary text-primary"
          >
            <Sparkles className="h-6 w-6" />
            <span className="text-[11px] font-semibold">Open gallery</span>
          </button>
          {items.map((it, i) => (
            <button
              key={it.url}
              onClick={() => setSel(i)}
              className="relative aspect-[3/4] overflow-hidden rounded-lg bg-secondary"
            >
              <Preview item={it} css="none" />
              <span
                className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border ${
                  sel === i ? "border-primary bg-primary text-white" : "border-white/70 bg-black/30"
                }`}
              >
                {sel === i && <Check className="h-3 w-3" />}
              </span>
              {it.isVideo && (
                <span className="absolute bottom-1 left-1.5 text-[10px] font-semibold text-white drop-shadow">
                  Video
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1 border-t border-white/8 px-4 pt-3">
        {[
          { label: "Camera", Icon: Camera, on: () => camRef.current?.click() },
          { label: "Video", Icon: VideoIcon, on: () => vidRef.current?.click() },
          { label: "Crop", Icon: CropIcon, on: () => current && (setTool("crop"), setStep("edit")) },
          { label: "Select", Icon: MousePointerSquareDashed, on: () => pickRef.current?.click() },
        ].map(({ label, Icon, on }) => (
          <button key={label} onClick={on} className="flex flex-col items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between px-5 pb-6 pt-3">
        <span className="text-xs text-muted-foreground">{items.length ? "1 item selected" : "No item selected"}</span>
        <button
          disabled={!current}
          onClick={() => setStep("edit")}
          className="gold-btn rounded-full px-7 py-2.5 text-sm disabled:opacity-40"
        >
          Next
        </button>
      </div>

      <input ref={pickRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addFiles(e.target.files)} />
      <input ref={vidRef} type="file" accept="video/*" capture="environment" hidden onChange={(e) => addFiles(e.target.files)} />
    </div>
  );
}

function Preview({ item, css }: { item: Picked; css: string }) {
  if (item.isVideo) {
    return <video src={item.url} muted preload="metadata" style={{ filter: css }} className="h-full w-full object-cover" />;
  }
  return <img src={item.url} alt="" style={{ filter: css }} className="h-full w-full object-cover" />;
}

function CropGrid() {
  return (
    <div className="pointer-events-none absolute inset-6 border border-white/80">
      <span className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
      <span className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
      <span className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
      <span className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
      {["-left-1 -top-1", "-right-1 -top-1", "-left-1 -bottom-1", "-right-1 -bottom-1"].map((p) => (
        <span key={p} className={`absolute h-3 w-3 bg-white ${p}`} />
      ))}
    </div>
  );
}

const UP_STEPS = ["Encrypting media", "Compressing smartly", "Optimizing quality", "Securing & uploading"];

export function UploadScreen({
  pct,
  stepsDone,
  error,
  onClose,
}: {
  pct: number;
  stepsDone: number;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-[#050506] px-8">
      <h2 className="mb-10 font-heading text-lg font-semibold">Uploading Status</h2>
      <ProgressRing pct={pct} />
      <p className="mt-8 text-sm font-medium text-primary">Processing in ultra quality…</p>
      <p className="mt-1 text-xs text-muted-foreground">This may take a few seconds</p>

      <ul className="mt-9 w-full max-w-xs space-y-4">
        {UP_STEPS.map((s, i) => (
          <li key={s} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-foreground/90">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> {s}
            </span>
            {i < stepsDone ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary text-white">
                <Check className="h-3.5 w-3.5" />
              </span>
            ) : i === stepsDone ? (
              <span className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-arc" />
            ) : (
              <span className="h-5 w-5 rounded-full border border-white/20" />
            )}
          </li>
        ))}
      </ul>

      {error ? (
        <div className="mt-10 w-full max-w-xs text-center">
          <p className="text-xs text-rose-400">{error}</p>
          <button onClick={onClose} className="gold-btn mt-3 w-full rounded-xl py-2.5 text-sm">
            Close
          </button>
        </div>
      ) : (
        <div className="mt-10 flex w-full max-w-xs items-center justify-center gap-2 rounded-xl border border-primary/25 bg-[#0c0c0f] py-3 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 text-primary" /> Your status is private &amp; secure
        </div>
      )}
    </div>
  );
}

export function ProgressRing({ pct, size = 176 }: { pct: number; size?: number }) {
  return (
    <div
      className="relative flex items-center justify-center rounded-full"
      style={{
        height: size,
        width: size,
        background: `conic-gradient(var(--gold-bright) 0deg, var(--gold) ${pct * 3.6}deg, rgba(255,255,255,0.07) ${pct * 3.6}deg 360deg)`,
        filter: "drop-shadow(0 0 26px color-mix(in oklab, var(--gold) 55%, transparent))",
      }}
    >
      <div
        className="flex flex-col items-center justify-center rounded-full bg-[#050506]"
        style={{ height: size - 22, width: size - 22 }}
      >
        <UploadCloud className="h-8 w-8 text-primary" />
        <span className="mt-2 font-heading text-2xl font-bold text-foreground">{Math.round(pct)}%</span>
      </div>
    </div>
  );
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** Bake filter + crop aspect into a JPEG blob so the posted image matches the edit. */
async function bakeImage(url: string, filterId: string, aspectId: string): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const ratio = ASPECTS.find((a) => a.id === aspectId)?.ratio ?? 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  let sx = 0;
  let sy = 0;
  if (ratio > 0) {
    if (sw / sh > ratio) {
      const nw = sh * ratio;
      sx = (sw - nw) / 2;
      sw = nw;
    } else {
      const nh = sw / ratio;
      sy = (sh - nh) / 2;
      sh = nh;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.filter = filterCss(filterId);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
  if (!blob) throw new Error("Could not process image");
  return blob;
}