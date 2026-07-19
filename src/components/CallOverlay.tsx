import { useEffect, useRef, useState } from "react";
import { PhoneOff, Mic, MicOff, Video as VideoIcon, VideoOff, SwitchCamera } from "lucide-react";
import { supabase } from "@/lib/supabase";

// WebRTC audio call over Supabase realtime broadcast for SDP/ICE exchange.
// Uses public STUN only, so it works on same-network / non-symmetric-NAT setups;
// enterprise-grade calling would need a TURN server (not free).

type Mode = "outgoing" | "incoming";
type Phase = "ringing" | "connecting" | "in-call" | "ended";

interface Props {
  room: string;
  myId: string;
  peerName: string;
  mode: Mode;
  onClose: () => void;
  // for incoming, the offer is passed in
  incomingOffer?: RTCSessionDescriptionInit;
  // true = video call, false = audio call
  video?: boolean;
}

const RTC_CFG: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

export function CallOverlay({ room, myId, peerName, mode, onClose, incomingOffer, video = false }: Props) {
  const [phase, setPhase] = useState<Phase>(mode === "outgoing" ? "ringing" : "ringing");
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [secs, setSecs] = useState(0);
  const [swapped, setSwapped] = useState(false);
  const [pipPos, setPipPos] = useState<{ x: number; y: number }>({ x: 16, y: 16 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const channel = supabase.channel(`call:${room}`, { config: { broadcast: { self: false } } });
    chRef.current = channel;

    const pc = new RTCPeerConnection(RTC_CFG);
    pcRef.current = pc;
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      remoteStreamRef.current = stream;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      setPhase("in-call");
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        channel.send({ type: "broadcast", event: "ice", payload: { from: myId, candidate: e.candidate } });
      }
    };

    channel
      .on("broadcast", { event: "answer" }, async ({ payload }) => {
        if (payload.from === myId) return;
        if (!pc.currentRemoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
          setPhase("connecting");
        }
      })
      .on("broadcast", { event: "ice" }, async ({ payload }) => {
        if (payload.from === myId) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch { /* ignore */ }
      })
      .on("broadcast", { event: "bye" }, ({ payload }) => {
        if (payload.from === myId) return;
        endCall(true);
      })
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: video ? { facingMode: "user" } : false,
          });
          localStreamRef.current = stream;
          stream.getTracks().forEach((t) => pc.addTrack(t, stream));
          if (video && localVideoRef.current) localVideoRef.current.srcObject = stream;

          if (mode === "outgoing") {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            channel.send({ type: "broadcast", event: "offer", payload: { from: myId, offer, peerName, video } });
          } else if (incomingOffer) {
            await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            channel.send({ type: "broadcast", event: "answer", payload: { from: myId, answer } });
            setPhase("connecting");
          }
        } catch (e) {
          console.error("call setup failed", e);
          endCall(true);
        }
      });

    return () => {
      pc.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "in-call") return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const endCall = (skipBye = false) => {
    if (!skipBye) chRef.current?.send({ type: "broadcast", event: "bye", payload: { from: myId } });
    setPhase("ended");
    setTimeout(onClose, 400);
  };

  const toggleMute = () => {
    const enabled = localStreamRef.current?.getAudioTracks()[0]?.enabled;
    if (localStreamRef.current) localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !enabled));
    setMuted(!!enabled);
  };

  const toggleCam = () => {
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    if (!tracks.length) return;
    const enabled = tracks[0].enabled;
    tracks.forEach((t) => (t.enabled = !enabled));
    setCamOff(enabled);
  };

  const flipCamera = async () => {
    if (!video) return;
    const next = facing === "user" ? "environment" : "user";
    const oldTracks = localStreamRef.current?.getVideoTracks() ?? [];
    // Stop existing video tracks first so the OS releases the camera before
    // we ask for the other lens — otherwise some devices hand back a dead
    // track and the preview stays black.
    oldTracks.forEach((t) => t.stop());
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: next } },
      });
      const newTrack = newStream.getVideoTracks()[0];
      const pc = pcRef.current;
      const sender = pc?.getSenders().find((s) => s.track?.kind === "video");
      await sender?.replaceTrack(newTrack);
      const old = localStreamRef.current;
      if (old) {
        old.getVideoTracks().forEach((t) => old.removeTrack(t));
        old.addTrack(newTrack);
        if (localVideoRef.current) {
          // Force the <video> to pick up the new track by re-assigning srcObject.
          localVideoRef.current.srcObject = null;
          localVideoRef.current.srcObject = old;
          try { await localVideoRef.current.play(); } catch { /* ignore */ }
        }
      }
      // sync toggle-state with the new track
      newTrack.enabled = !camOff ? true : false;
      setFacing(next);
    } catch (e) {
      console.error("flip camera failed", e);
      // Try to recover the previous facing so we don't get stuck with no camera.
      try {
        const recover = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing } },
        });
        const rt = recover.getVideoTracks()[0];
        const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "video");
        await sender?.replaceTrack(rt);
        const s = localStreamRef.current;
        if (s) {
          s.getVideoTracks().forEach((t) => s.removeTrack(t));
          s.addTrack(rt);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
            localVideoRef.current.srcObject = s;
          }
        }
      } catch { /* ignore */ }
    }
  };

  const label =
    phase === "ringing" ? (mode === "outgoing" ? "Calling…" : "Incoming call…")
    : phase === "connecting" ? "Connecting…"
    : phase === "in-call" ? `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`
    : "Call ended";

  // PiP drag handlers — clamped to viewport with a small safe margin.
  const onPipPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pipPos.x,
      origY: pipPos.y,
      moved: false,
    };
  };
  const onPipPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pipW = 112; // matches w-28
    const pipH = 160; // matches h-40
    const nx = Math.min(Math.max(8, d.origX + dx), w - pipW - 8);
    const ny = Math.min(Math.max(8, d.origY + dy), h - pipH - 8);
    setPipPos({ x: nx, y: ny });
  };
  const onPipPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (d && !d.moved) {
      // Treated as a tap → swap large/small views.
      setSwapped((s) => !s);
    }
  };

  const selfInitial = "Y"; // "You"
  const peerInitial = peerName.charAt(0).toUpperCase();

  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-between bg-gradient-to-b from-[#2a1250] via-[#1a0a2e] to-black px-6 py-12 animate-fade-in">
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {video && (
        <>
          {/* Large view (background). Contains whichever stream is currently "big". */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`absolute inset-0 h-full w-full object-cover ${swapped ? "hidden" : ""}`}
          />
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 h-full w-full -scale-x-100 object-cover ${swapped ? "" : "hidden"} ${camOff && swapped ? "invisible" : ""}`}
          />
          {/* When the big view is local and cam is off, show a full-screen avatar. */}
          {swapped && camOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#2a1250] via-[#1a0a2e] to-black">
              <div className="flex h-40 w-40 items-center justify-center rounded-full border-2 border-gold bg-secondary text-6xl font-heading text-gold shadow-[0_0_60px_-10px_rgba(214,58,249,0.7)]">
                {selfInitial}
              </div>
            </div>
          )}
          <div className="absolute inset-0 bg-black/40" />

          {/* Draggable PiP (small view). Contains whichever stream is currently "small". */}
          <div
            onPointerDown={onPipPointerDown}
            onPointerMove={onPipPointerMove}
            onPointerUp={onPipPointerUp}
            onPointerCancel={onPipPointerUp}
            style={{ left: pipPos.x, top: pipPos.y, touchAction: "none" }}
            className="absolute z-20 h-40 w-28 overflow-hidden rounded-2xl border border-white/20 bg-black shadow-lg"
          >
            {/* small = local when not swapped, remote when swapped */}
            {!swapped ? (
              camOff ? (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-[#2a1250] to-black">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-gold bg-secondary text-2xl font-heading text-gold">
                    {selfInitial}
                  </div>
                </div>
              ) : (
                <video
                  autoPlay
                  playsInline
                  muted
                  className="pointer-events-none h-full w-full -scale-x-100 object-cover"
                  ref={(el) => {
                    if (el && localStreamRef.current && el.srcObject !== localStreamRef.current) {
                      el.srcObject = localStreamRef.current;
                    }
                  }}
                />
              )
            ) : (
              <video
                autoPlay
                playsInline
                className="pointer-events-none h-full w-full object-cover"
                ref={(el) => {
                  if (el && remoteStreamRef.current && el.srcObject !== remoteStreamRef.current) {
                    el.srcObject = remoteStreamRef.current;
                  }
                }}
              />
            )}
          </div>
        </>
      )}

      <div className="relative z-10 flex flex-col items-center gap-4 pt-10">
        {(!video || (!swapped && camOff)) && (
          <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-gold bg-secondary text-4xl font-heading text-gold shadow-[0_0_60px_-10px_rgba(214,58,249,0.7)]">
            {peerInitial}
          </div>
        )}
        <span className="font-heading text-xl font-semibold tracking-wide text-foreground">{peerName}</span>
        <span className="text-sm tracking-wide text-muted-foreground">{label}</span>
      </div>

      <div className="relative z-10 flex items-center gap-5 pb-6">
        <button
          onClick={toggleMute}
          aria-label="Mute"
          className={`flex h-14 w-14 items-center justify-center rounded-full border ${muted ? "border-red-400 bg-red-500/20 text-red-300" : "border-border/60 bg-card/60 text-foreground"}`}
        >
          {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </button>
        {video && (
          <>
            <button
              onClick={toggleCam}
              aria-label="Toggle camera"
              className={`flex h-14 w-14 items-center justify-center rounded-full border ${camOff ? "border-red-400 bg-red-500/20 text-red-300" : "border-border/60 bg-card/60 text-foreground"}`}
            >
              {camOff ? <VideoOff className="h-6 w-6" /> : <VideoIcon className="h-6 w-6" />}
            </button>
            <button
              onClick={flipCamera}
              aria-label="Flip camera"
              className="flex h-14 w-14 items-center justify-center rounded-full border border-border/60 bg-card/60 text-foreground"
            >
              <SwitchCamera className="h-6 w-6" />
            </button>
          </>
        )}
        <button
          onClick={() => endCall()}
          aria-label="End call"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-red-500/40 active:scale-95"
        >
          <PhoneOff className="h-7 w-7" />
        </button>
      </div>
    </div>
  );
}