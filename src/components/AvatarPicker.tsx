import { useRef, useState } from "react";
import { X, Trash2, Check, Upload } from "lucide-react";

interface Props {
  currentUrl?: string | null;
  onClose: () => void;
  onSave: (file: File) => Promise<void>;
  onDelete?: () => Promise<void>;
}

// Simple profile-picture picker: gallery -> center-square crop -> preview.
// Not a full free-form cropper; the auto center crop matches how most
// messaging apps present a round DP so the result always fits the circle.
export function AvatarPicker({ currentUrl, onClose, onSave, onDelete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [cropped, setCropped] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErr(null);
    const img = new Image();
    img.onload = () => {
      const size = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - size) / 2;
      const sy = (img.naturalHeight - size) / 2;
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 512;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 512, 512);
      c.toBlob(
        (b) => {
          if (!b) return;
          setCropped(b);
          setPreview(URL.createObjectURL(b));
        },
        "image/jpeg",
        0.9,
      );
    };
    img.onerror = () => setErr("Could not read that image.");
    img.src = URL.createObjectURL(f);
  };

  const confirm = async () => {
    if (!cropped) return;
    setBusy(true);
    setErr(null);
    try {
      const file = new File([cropped], `dp-${Date.now()}.jpg`, { type: "image/jpeg" });
      await onSave(file);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!onDelete) return;
    setBusy(true);
    setErr(null);
    try {
      await onDelete();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 px-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="ornate-card w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <span className="font-heading text-sm tracking-widest text-gold">PROFILE PICTURE</span>
          <button onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="mx-auto mb-5 flex h-40 w-40 items-center justify-center overflow-hidden rounded-full border-2 border-gold bg-secondary">
          {preview ? (
            <img src={preview} alt="New profile preview" className="h-full w-full object-cover" />
          ) : currentUrl ? (
            <img src={currentUrl} alt="Current profile" className="h-full w-full object-cover" />
          ) : (
            <span className="px-3 text-[11px] text-muted-foreground">No photo yet</span>
          )}
        </div>

        <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="gold-btn flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm disabled:opacity-60"
        >
          <Upload className="h-4 w-4" /> CHOOSE FROM GALLERY
        </button>

        {cropped && (
          <button
            onClick={confirm}
            disabled={busy}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-emerald-400/70 py-2.5 text-sm text-emerald-400 transition-colors hover:bg-emerald-400/10 disabled:opacity-60"
          >
            <Check className="h-4 w-4" /> {busy ? "SAVING…" : "SAVE"}
          </button>
        )}

        {currentUrl && onDelete && !cropped && (
          <button
            onClick={del}
            disabled={busy}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-rose-500/70 py-2.5 text-sm text-rose-400 transition-colors hover:bg-rose-500/10 disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" /> REMOVE PHOTO
          </button>
        )}

        {err && <p className="mt-3 text-[11px] text-rose-400">{err}</p>}
      </div>
    </div>
  );
}