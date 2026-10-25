import { useEffect, useRef, useState } from "react";
import { api } from "../haomai/client";
interface Media {
  id?: string;
  mediaId?: string;
  mimeType?: string;
  url?: string;
}
export function MediaAttachment({ media }: { media: Media }) {
  const [url, setUrl] = useState(media.url || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const expires = useRef(0);
  const retried = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const refresh = async (autoplay = false) => {
    const mediaId = media.mediaId || media.id;
    if (!mediaId) {
      setError("媒体标识缺失");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const grant = await api(`/media/${mediaId}/download`);
      if (!active.current) return;
      if (typeof grant.url !== "string" || !/^https?:/.test(grant.url))
        throw new Error("媒体下载地址无效");
      expires.current = Date.parse(grant.expiresAt) || Date.now() + 60000;
      setUrl(grant.url);
      if (audio.current) {
        audio.current.src = grant.url;
        audio.current.load();
        if (autoplay) await audio.current.play();
      }
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : "加载媒体失败");
    } finally {
      if (active.current) setLoading(false);
    }
  };
  const failed = () => {
    if (!retried.current) {
      retried.current = true;
      void refresh();
    } else setError("链接已失效，请重新加载");
  };
  const isAudio = media.mimeType?.startsWith("audio/");
  return (
    <span className="hm-media">
      {isAudio ? (
        <audio
          ref={audio}
          controls
          preload="none"
          src={url || undefined}
          onPlay={() => {
            if (Date.now() + 10000 >= expires.current) {
              audio.current?.pause();
              void refresh(true);
            }
          }}
          onError={failed}
        />
      ) : url ? (
        <img src={url} alt="消息图片" onError={failed} />
      ) : null}
      {(error || !url) && (
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            retried.current = false;
            void refresh(isAudio);
          }}
        >
          {loading ? "加载中…" : isAudio ? "重新加载语音" : "重新加载图片"}
        </button>
      )}
      {error && <small role="status">{error}</small>}
    </span>
  );
}
