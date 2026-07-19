import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Eye, ChevronLeft, ChevronRight, Trash2, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/components/BottomNav";
import { getMyId, getMyName, getRoom } from "@/lib/identity";
import { AvatarPicker } from "@/components/AvatarPicker";
import { DP_MARK, broadcastDp, cacheDp, decodeDp, isDp, readCachedDp, uploadDp } from "@/lib/dp";

export const Route = createFileRoute("/hub/status")({
  validateSearch: (s: Record<string, unknown>) => ({
    reelUrl: typeof s.reelUrl === "string" ? s.reelUrl : undefined,
    reelId: typeof s.reelId === "string" ? s.reelId : undefined,
  }),
  component: StatusPage,
});

interface Status {
  id: string;
  room_code: string;
  sender: string;
  sender_name: string;
  media_url: string;
  media_type: "image" | "video";
  created_at: string;
  expires_at: string;
}

interface StatusView {
  id: string;
  status_id: string;
  viewer: string;
  viewer_name: string;
  created_at: string;
}

const STATUS_BUCKET = "status";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function StatusPage() {
  const navigate = useNavigate();
  const { reelUrl, reelId } = Route.useSearch();
  const [ready, setReady] = useState(false);
  const [myId, setMyId] = useState("");
  const [myName, setMyName] = useState("");
  const [room, setRoom] = useState("");

  const [statuses, setStatuses] = useState<Status[]>([]);
  const [views, setViews] = useState<StatusView[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<"mine" | "partner" | null>(null);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dpOpen, setDpOpen] = useState(false);
  const [myDp, setMyDp] = useState<string>("");
  const [partnerDp, setPartnerDp] = useState<string>("");

  useEffect(() => {
    setMyId(getMyId());
    setMyName(getMyName());
    setRoom(getRoom());
    setReady(true);
  }, []);

  // Load DPs (mine from cache immediately, both from latest DP messages).
  useEffect(() => {
    if (!room || !myId) return;
    setMyDp(readCachedDp(room, myId));
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("sender,content,created_at")
        .eq("room_code", room)
        .like("content", DP_MARK + "%")
        .order("created_at", { ascending: true });
      if (!alive || !data) return;
      let mine = "";
      let theirs = "";
      for (const m of data) {
        if (!isDp(m.content)) continue;
        const url = decodeDp(m.content);
        if (m.sender === myId) mine = url;
        else theirs = url;
      }
      setMyDp(mine);
      cacheDp(room, myId, mine);
      setPartnerDp(theirs);
    })();
    const ch = supabase
      .channel(`dp:${room}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `room_code=eq.${room}` },
        (payload) => {
          const m = payload.new as { sender: string; content: string };
          if (!m?.content || !isDp(m.content)) return;
          const url = decodeDp(m.content);
          if (m.sender === myId) {
            setMyDp(url);
            cacheDp(room, myId, url);
          } else {
            setPartnerDp(url);
          }
        },
      )
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [room, myId]);

  const saveDp = async (file: File) => {
    if (!room) return;
    const url = await uploadDp(room, myId, file);
    setMyDp(url);
    cacheDp(room, myId, url);
    await broadcastDp(room, myId, url);
  };
  const removeDp = async () => {
    if (!room) return;
    setMyDp("");
    cacheDp(room, myId, "");
    await broadcastDp(room, myId, "");
  };

  const load = useCallback(async () => {
    if (!room) return;
    const nowIso = new Date().toISOString();
    const { data: st } = await supabase
      .from("statuses")
      .select("*")
      .eq("room_code", room)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: true });
    const list = (st ?? []) as Status[];
    setStatuses(list);
    if (list.length) {
      const { data: vw } = await supabase
        .from("status_views")
        .select("*")
        .in(
          "status_id",
          list.map((s) => s.id),
        );
      setViews((vw ?? []) as StatusView[]);
    } else {
      setViews([]);
    }
  }, [room]);

  useEffect(() => {
    load();
  }, [load]);

  // realtime — refresh on any status / view change in this room
  useEffect(() => {
    if (!room) return;
    const channel = supabase
      .channel(`status:${room}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "statuses" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "status_views" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [room, load]);

  const mine = useMemo(() => statuses.filter((s) => s.sender === myId), [statuses, myId]);
  const partner = useMemo(() => statuses.filter((s) => s.sender !== myId), [statuses, myId]);
  const partnerName = partner[0]?.sender_name ?? "Partner";

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !room) return;
    setError(null);
    setUploading(true);
    try {
      const isVideo = file.type.startsWith("video");
      const path = `${room}/${myId}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
      const up = await supabase.storage.from(STATUS_BUCKET).upload(path, file, { upsert: true });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from(STATUS_BUCKET).getPublicUrl(path);
      const ins = await supabase.from("statuses").insert({
        room_code: room,
        sender: myId,
        sender_name: myName || "Me",
        media_url: pub.publicUrl,
        media_type: isVideo ? "video" : "image",
      });
      if (ins.error) throw ins.error;
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const deleteStatus = async (s: Status) => {
    await supabase.from("statuses").delete().eq("id", s.id);
    await load();
  };

  // Post a reel (passed in via ?reelUrl=&reelId=) directly as a status.
  const clearShare = () =>
    navigate({ to: "/hub/status", search: { reelUrl: undefined, reelId: undefined }, replace: true });

  const postReelToStatus = async () => {
    if (!reelUrl || !room) return;
    setError(null);
    setPosting(true);
    try {
      const ins = await supabase.from("statuses").insert({
        room_code: room,
        sender: myId,
        sender_name: myName || "Me",
        media_url: reelUrl,
        media_type: "video",
      });
      if (ins.error) throw ins.error;
      await load();
      clearShare();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post reel");
    } finally {
      setPosting(false);
    }
  };

  // record a view when partner status is opened
  const recordView = useCallback(
    async (status: Status) => {
      if (status.sender === myId) return;
      const already = views.some((v) => v.status_id === status.id && v.viewer === myId);
      if (already) return;
      await supabase
        .from("status_views")
        .upsert(
          { status_id: status.id, viewer: myId, viewer_name: myName || "Partner" },
          { onConflict: "status_id,viewer" },
        );
    },
    [myId, myName, views],
  );

  if (!ready) return null;

  if (!myName || !room) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center hub-screen-bg px-6 text-center">
        <div className="ornate-card w-full max-w-sm px-6 py-8">
          <h3 className="font-heading text-lg font-bold tracking-widest text-gold">STATUS</h3>
          <p className="mt-3 text-xs text-muted-foreground">
            Connect with your partner in Chats first. Status is shared privately within your room.
          </p>
          <Link to="/hub" className="gold-btn mt-6 inline-block rounded-md px-5 py-2.5 text-sm">
            GO TO CHATS
          </Link>
        </div>
        <BottomNav active="status" />
      </div>
    );
  }

  return (
    <div className="hub-screen-bg min-h-screen pb-28">
      <div className="mx-auto max-w-2xl px-4 pt-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-heading text-2xl font-bold tracking-wide text-foreground">Status</h1>
          <button
            onClick={() => setDpOpen(true)}
            aria-label="Profile picture"
            className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 border-gold bg-secondary text-gold shadow-[0_0_16px_-4px_rgba(214,58,249,0.6)]"
          >
            {myDp ? (
              <img src={myDp} alt="Your profile" className="h-full w-full object-cover" />
            ) : (
              <Plus className="h-5 w-5" />
            )}
          </button>
        </div>

        {/* My status */}
        <button
          onClick={() => (mine.length ? setViewer("mine") : fileRef.current?.click())}
          className="ornate-card flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <span className="relative flex h-14 w-14 shrink-0 items-center justify-center">
            <Ring active={mine.length > 0}>
              {mine.length ? (
                <Thumb status={mine[mine.length - 1]} />
              ) : myDp ? (
                <img src={myDp} alt="Your profile" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center rounded-full bg-secondary font-heading text-gold">
                  {(myName || "M").charAt(0).toUpperCase()}
                </span>
              )}
            </Ring>
            <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-gold text-primary-foreground">
              <Plus className="h-3.5 w-3.5" />
            </span>
          </span>
          <span className="flex-1">
            <span className="block font-heading text-sm tracking-wide text-foreground">My Status</span>
            <span className="block text-xs text-muted-foreground">
              {mine.length ? `${mine.length} update${mine.length > 1 ? "s" : ""} · tap to view` : "Tap to add status"}
            </span>
          </span>
        </button>

        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="gold-btn mt-3 flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-xs disabled:opacity-60"
        >
          <Plus className="h-4 w-4" /> {uploading ? "UPLOADING…" : "ADD PHOTO / VIDEO"}
        </button>
        <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onUpload} />
        {error && <p className="mt-2 text-center text-xs text-rose-400">{error}</p>}

        <h2 className="mb-3 mt-7 font-heading text-sm font-semibold tracking-wide text-muted-foreground">
          Recent Updates
        </h2>

        {partner.length ? (
          <button
            onClick={() => setViewer("partner")}
            className="ornate-card flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <Ring active>
              <Thumb status={partner[partner.length - 1]} />
            </Ring>
            <span className="flex-1">
              <span className="block font-heading text-sm tracking-wide text-foreground">{partnerName}</span>
              <span className="block text-xs text-muted-foreground">
                {timeAgo(partner[partner.length - 1].created_at)} · {partner.length} update
                {partner.length > 1 ? "s" : ""}
              </span>
            </span>
          </button>
        ) : partnerDp ? (
          <div className="ornate-card flex w-full items-center gap-3 px-4 py-3 text-left">
            <Ring active={false}>
              <img src={partnerDp} alt="Partner profile" className="h-full w-full object-cover" />
            </Ring>
            <span className="flex-1">
              <span className="block font-heading text-sm tracking-wide text-foreground">
                {partnerName}
              </span>
              <span className="block text-xs text-muted-foreground">No status yet</span>
            </span>
          </div>
        ) : (
          <p className="ornate-card px-4 py-6 text-center text-xs text-muted-foreground">
            No status from your partner yet.
          </p>
        )}
      </div>

      {viewer === "partner" && partner.length > 0 && (
        <StoryViewer
          statuses={partner}
          views={views}
          mode="partner"
          onClose={() => setViewer(null)}
          onView={recordView}
        />
      )}
      {viewer === "mine" && mine.length > 0 && (
        <StoryViewer
          statuses={mine}
          views={views}
          mode="mine"
          onClose={() => setViewer(null)}
          onDelete={deleteStatus}
        />
      )}

      {reelUrl && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="font-heading text-sm tracking-widest text-gold">SHARE TO STATUS</span>
            <button onClick={clearShare} aria-label="Cancel" className="text-white">
              <X className="h-6 w-6" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center px-4">
            <video
              key={reelId ?? reelUrl}
              src={reelUrl}
              autoPlay
              playsInline
              loop
              muted
              controls={false}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          </div>
          <div className="px-5 pb-8 pt-4">
            {error && <p className="mb-3 text-center text-xs text-rose-400">{error}</p>}
            <button
              onClick={postReelToStatus}
              disabled={posting}
              className="gold-btn flex w-full items-center justify-center gap-2 rounded-md py-3 text-sm disabled:opacity-60"
            >
              <Send className="h-4 w-4" /> {posting ? "POSTING…" : "POST TO MY STATUS"}
            </button>
          </div>
        </div>
      )}

      <BottomNav active="status" />
      {dpOpen && (
        <AvatarPicker
          currentUrl={myDp || null}
          onClose={() => setDpOpen(false)}
          onSave={saveDp}
          onDelete={myDp ? removeDp : undefined}
        />
      )}
    </div>
  );
}

function Ring({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`flex h-14 w-14 items-center justify-center rounded-full p-[2px] ${
        active ? "bg-gradient-to-tr from-gold to-amber-200" : "bg-border"
      }`}
    >
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border-2 border-background bg-secondary">
        {children}
      </span>
    </span>
  );
}

function Thumb({ status }: { status: Status }) {
  if (status.media_type === "video") {
    return <video src={status.media_url} muted className="h-full w-full object-cover" preload="metadata" />;
  }
  return <img src={status.media_url} alt="status" className="h-full w-full object-cover" />;
}

function StoryViewer({
  statuses,
  views,
  mode,
  onClose,
  onView,
  onDelete,
}: {
  statuses: Status[];
  views: StatusView[];
  mode: "mine" | "partner";
  onClose: () => void;
  onView?: (s: Status) => void;
  onDelete?: (s: Status) => void;
}) {
  const [idx, setIdx] = useState(0);
  const current = statuses[idx];

  const next = useCallback(() => {
    setIdx((i) => {
      if (i + 1 >= statuses.length) {
        onClose();
        return i;
      }
      return i + 1;
    });
  }, [statuses.length, onClose]);
  const prev = () => setIdx((i) => Math.max(0, i - 1));

  useEffect(() => {
    if (mode === "partner" && current && onView) onView(current);
  }, [current, mode, onView]);

  // auto-advance images after 5s
  useEffect(() => {
    if (!current || current.media_type === "video") return;
    const t = setTimeout(next, 5000);
    return () => clearTimeout(t);
  }, [current, next]);

  if (!current) return null;
  const seenBy = views.filter((v) => v.status_id === current.id);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black">
      {/* progress bars */}
      <div className="flex gap-1 px-3 pt-3">
        {statuses.map((_, i) => (
          <span key={i} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
            <span className={`block h-full bg-white ${i <= idx ? "w-full" : "w-0"}`} />
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs text-white/80">{timeAgo(current.created_at)}</span>
        <div className="flex items-center gap-3">
          {mode === "mine" && onDelete && (
            <button onClick={() => onDelete(current)} aria-label="Delete" className="text-white/90">
              <Trash2 className="h-5 w-5" />
            </button>
          )}
          <button onClick={onClose} aria-label="Close" className="text-white">
            <X className="h-6 w-6" />
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center">
        {current.media_type === "video" ? (
          <video
            key={current.id}
            src={current.media_url}
            autoPlay
            playsInline
            controls={false}
            onEnded={next}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <img src={current.media_url} alt="status" className="max-h-full max-w-full object-contain" />
        )}

        {/* tap zones */}
        <button onClick={prev} aria-label="Previous" className="absolute inset-y-0 left-0 w-1/3" />
        <button onClick={next} aria-label="Next" className="absolute inset-y-0 right-0 w-1/3" />

        {idx > 0 && (
          <ChevronLeft className="pointer-events-none absolute left-2 top-1/2 h-6 w-6 -translate-y-1/2 text-white/50" />
        )}
        {idx < statuses.length - 1 && (
          <ChevronRight className="pointer-events-none absolute right-2 top-1/2 h-6 w-6 -translate-y-1/2 text-white/50" />
        )}
      </div>

      {/* seen receipts (only on your own status) */}
      {mode === "mine" && (
        <div className="border-t border-white/10 bg-black/60 px-5 pb-6 pt-4 text-white">
          <div className="mb-3 flex items-center gap-2">
            <Eye className="h-4 w-4 text-gold" />
            <span className="text-sm font-semibold tracking-wide">
              {seenBy.length ? `Seen by ${seenBy.length}` : "No views yet"}
            </span>
          </div>
          {seenBy.length > 0 && (
            <ul className="space-y-3">
              {seenBy
                .slice()
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .map((v) => (
                  <li key={v.id} className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-gold bg-secondary font-heading text-sm text-gold">
                      {(v.viewer_name || "?").charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{v.viewer_name || "Partner"}</span>
                      <span className="block text-xs text-white/60">
                        {new Date(v.created_at).toLocaleString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
