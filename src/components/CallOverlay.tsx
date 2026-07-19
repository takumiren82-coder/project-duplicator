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
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const channel = supabase.channel(`call:${room}`, { config: { broadcast: { self: false } } });
    chRef.current = channel;

    const pc = new RTCPeerConnection(RTC_CFG);
    pcRef.current = pc;
    pc.ontrack = (e) => {
      const stream = e.streams[0];
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
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: next },
      });
      const newTrack = newStream.getVideoTracks()[0];
      const pc = pcRef.current;
      const sender = pc?.getSenders().find((s) => s.track?.kind === "video");
      await sender?.replaceTrack(newTrack);
      // swap in local preview stream
      const old = localStreamRef.current;
      if (old) {
        old.getVideoTracks().forEach((t) => { t.stop(); old.removeTrack(t); });
        old.addTrack(newTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = old;
      }
      setFacing(next);
    } catch (e) {
      console.error("flip camera failed", e);
    }
  };

  const label =
    phase === "ringing" ? (mode === "outgoing" ? "Calling…" : "Incoming call…")
    : phase === "connecting" ? "Connecting…"
    : phase === "in-call" ? `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`
    : "Call ended";

  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-between bg-gradient-to-b from-[#2a1250] via-[#1a0a2e] to-black px-6 py-12 animate-fade-in">
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {video && (
        <>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-black/40" />
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute right-4 top-4 z-10 h-40 w-28 -scale-x-100 rounded-2xl border border-white/20 object-cover shadow-lg"
          />
        </>
      )}

      <div className="relative z-10 flex flex-col items-center gap-4 pt-10">
        {!video && (
          <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-gold bg-secondary text-4xl font-heading text-gold shadow-[0_0_60px_-10px_rgba(214,58,249,0.7)]">
            {peerName.charAt(0).toUpperCase()}
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