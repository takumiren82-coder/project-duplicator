import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Download, X, Trash2, ArrowLeft, SlidersHorizontal, Settings, Lock } from "lucide-react";
import { supabase, GALLERY_BUCKET } from "@/lib/supabase";
import { BottomNav } from "@/components/BottomNav";
import { getMyId, getRoom } from "@/lib/identity";

export const Route = createFileRoute("/hub/gallery")({
  component: PrivateGallery,
});

interface GItem {
  name: string;
  url: string;
  path: string;
}

function PrivateGallery() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [room, setRoom] = useState("");
  const [myId, setMyId] = useState("");
  const [partner, setPartner] = useState<GItem[]>([]);
  const [mine, setMine] = useState<GItem[]>([]);
  const [active, setActive] = useState<GItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("All");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRoom(getRoom());
    setMyId(getMyId());
    setReady(true);
  }, []);

  const load = useCallback(async () => {
    if (!room) return;
    // Each member uploads under `${room}/${uid}/...`
    const { data: folders, error: ferr } = await supabase.storage
      .from(GALLERY_BUCKET)
      .list(room, { limit: 100 });
    if (ferr) {
      setError(ferr.message);
      return;
    }
    const uidFolders = (folders ?? []).filter((f) => f.id === null).map((f) => f.name);
    const mineItems: GItem[] = [];
    const partnerItems: GItem[] = [];
    for (const uid of uidFolders) {
      const { data: files } = await supabase.storage
        .from(GALLERY_BUCKET)
        .list(`${room}/${uid}`, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
      for (const f of files ?? []) {
        if (f.id === null) continue;
        const path = `${room}/${uid}/${f.name}`;
        const { data: pub } = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(path);
        (uid === myId ? mineItems : partnerItems).push({ name: f.name, url: pub.publicUrl, path });
      }
    }
    setMine(mineItems);
    setPartner(partnerItems);
  }, [room, myId]);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async (item: GItem) => {
    if (!window.confirm("Delete this item? This cannot be undone.")) return;
    setError(null);
    const { error: delErr } = await supabase.storage.from(GALLERY_BUCKET).remove([item.path]);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    if (active?.path === item.path) setActive(null);
    await load();
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !room) return;
    setError(null);
    setUploading(true);
    try {
      const path = `${room}/${myId}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from(GALLERY_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (!ready) return null;

  if (!room) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center hub-screen-bg px-6 text-center">
        <div className="ornate-card w-full max-w-sm px-6 py-8">
          <h3 className="font-heading text-lg font-bold tracking-widest text-gold">GALLERY</h3>
          <p className="mt-3 text-xs text-muted-foreground">
            Connect with your partner in Chats first. Your shared gallery is private to your room.
          </p>
          <Link to="/hub" className="gold-btn mt-6 inline-block rounded-md px-5 py-2.5 text-sm">
            GO TO CHATS
          </Link>
        </div>
        <BottomNav active="gallery" />
      </div>
    );
  }

  return (
    <div className="hub-screen-bg min-h-screen pb-28">
      <div className="mx-auto max-w-2xl px-4 pt-6">
        <h1 className="mb-5 text-center font-heading text-xl font-bold tracking-wide text-foreground">
          Shared Gallery
        </h1>

        <Section title="Partner's Safe Photos" items={partner} onTap={setActive} />

        <div className="my-6 flex items-center justify-center gap-3">
          <span className="h-px w-20 bg-gradient-to-r from-transparent to-gold" />
          <Heart className="h-5 w-5 fill-gold text-gold" />
          <span className="h-px w-20 bg-gradient-to-l from-transparent to-gold" />
        </div>

        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold tracking-wide text-foreground">Your Photos</h2>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="gold-btn flex items-center gap-1 rounded-md px-3 py-1.5 text-xs disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" /> {uploading ? "UPLOADING…" : "ADD"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
        </div>
        {error && <p className="mb-3 text-center text-xs text-rose-400">{error}</p>}
        <Section items={mine} onTap={setActive} onDelete={onDelete} empty="No uploads yet — tap ADD." />
      </div>

      {active && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/95 px-4">
          <button onClick={() => setActive(null)} className="absolute right-4 top-4 text-gold" aria-label="Close">
            <X className="h-7 w-7" />
          </button>
          <img src={active.url} alt={active.name} className="max-h-[75vh] max-w-full rounded-lg object-contain" />
          <a
            href={active.url}
            download={active.name}
            target="_blank"
            rel="noreferrer"
            className="gold-btn mt-5 flex items-center gap-2 rounded-md px-5 py-2 text-sm"
          >
            <Download className="h-4 w-4" /> DOWNLOAD
          </a>
        </div>
      )}
      <BottomNav active="gallery" />
    </div>
  );
}

function Section({
  title,
  items,
  onTap,
  onDelete,
  empty,
}: {
  title?: string;
  items: GItem[];
  onTap: (i: GItem) => void;
  onDelete?: (i: GItem) => void;
  empty?: string;
}) {
  return (
    <div>
      {title && (
        <h2 className="mb-3 font-heading text-base font-semibold tracking-wide text-foreground">{title}</h2>
      )}
      {items.length === 0 ? (
        <p className="ornate-card px-4 py-6 text-center text-xs text-muted-foreground">
          {empty ?? "No items yet."}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {items.map((it) => (
            <div key={it.name} className="relative">
              <button
                onClick={() => onTap(it)}
                className="ornate-card aspect-square w-full overflow-hidden p-0.5"
              >
                <img src={it.url} alt={it.name} loading="lazy" className="h-full w-full rounded object-cover" />
              </button>
              {onDelete && (
                <button
                  onClick={() => onDelete(it)}
                  aria-label="Delete"
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-rose-400 backdrop-blur transition hover:bg-black/90"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
