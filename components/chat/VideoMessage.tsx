"use client";

import { useEffect, useState } from "react";
import { Download, Link2, RefreshCw } from "lucide-react";
import type { ChatMsg } from "@/lib/types";
import { fmtElapsed, VIDEO_MODES } from "@/lib/video";
import { rinneLine } from "@/lib/rinne-lines";
import { imgSrc } from "@/lib/client/thumb";
import { RinneInline } from "../rinne/RinneInline";
import { useRinne } from "../rinne/RinneProvider";
import { copyText } from "../ui";

/** 每秒刷新一次的「已用时间」 */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

function fmtEta(sec: number) {
  if (sec < 60) return `约 ${Math.max(10, Math.round(sec / 5) * 5)} 秒`;
  const m = Math.floor(sec / 60);
  const s = Math.round((sec % 60) / 10) * 10;
  return s ? `约 ${m} 分 ${s} 秒` : `约 ${m} 分钟`;
}

/**
 * 生成中的视频：棱音按阶段换状态（排队时看表等候、生成时举着相机），显示已用时间、预计时间和进度。
 * 服务商没给进度时，进度条按「已用 / 预计」估算，最多走到 95%。
 */
export function VideoPending({ m }: { m: ChatMsg }) {
  const { outfit } = useRinne();
  const t = m.task;
  const now = useNow(true);
  const started = t?.startedAt || m.createdAt;
  const elapsed = now - started;
  const eta = t?.eta || 60;
  const phase = !t?.id ? "submit" : t.phase || (t.status === "queued" ? "queue" : "generate");
  const queued = phase === "submit" || phase === "queue" || phase === "upload";
  const est = Math.min(0.95, elapsed / 1000 / eta);
  const pct = t?.progress != null && t.progress > 0 ? t.progress : est;
  const slow = elapsed / 1000 > eta * 1.3;
  const phaseText =
    phase === "submit"
      ? "正在提交任务"
      : phase === "upload"
        ? "正在把参考图交给服务商"
        : phase === "queue"
          ? t?.queue
            ? `排队中，前面还有 ${t.queue} 位`
            : "排队等 GPU"
          : phase === "save"
            ? "生成好了，正在转存到本站"
            : "生成中";
  const modeName = VIDEO_MODES.find((x) => x.id === m.videoMeta?.mode)?.name || "视频";
  return (
    <RinneInline mood={queued ? "waiting" : "imaging"} testId="video-pending">
      <div className="w-full max-w-sm space-y-1.5" role="status" aria-live="polite" data-testid="video-status" data-phase={phase}>
        <div className="text-[13px] font-medium text-ink/90" data-testid="video-line">
          {rinneLine(outfit, queued ? "videoQueued" : "videoRunning")}
        </div>
        <div className="text-xs text-muted">
          {modeName} · {phaseText} · 已用 <span data-testid="video-elapsed">{fmtElapsed(elapsed)}</span> · 预计{fmtEta(eta)}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-acc/15" aria-hidden>
          <div className="h-full rounded-full bg-acc transition-[width] duration-1000" style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
        {slow && <div className="text-[11px] text-muted">比预计慢一些，Space 排队的人可能比较多，我会一直等到时限。</div>}
        <div className="text-[11px] text-muted">
          离开这个页面也没关系，生成完会自动存进对话和图库。
        </div>
      </div>
    </RinneInline>
  );
}

/** 生成好的视频：播放器 + 下载 / 复制链接 / 重新生成；没能转存时提示链接会过期 */
export function VideoResultView({ m, isLast, justDone, onRegen, rinneOn }: { m: ChatMsg; isLast: boolean; justDone: boolean; onRegen?: () => void; rinneOn: boolean }) {
  const { outfit } = useRinne();
  const v = m.video!;
  const src = imgSrc(v.url);
  const poster = v.poster ? imgSrc(v.poster) : undefined;
  const abs = () => (src.startsWith("/") ? window.location.origin + src : src);
  return (
    <div data-testid="video-result">
      <div className="max-w-[560px] overflow-hidden rounded-xl border border-rule bg-black">
        <video
          className="block max-h-[70vh] w-full"
          controls
          playsInline
          preload="metadata"
          poster={poster}
          src={poster ? src : `${src}#t=0.1`}
          data-testid="video-player"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <a className="btn-ghost btn-sm" href={src} download={`prism-${m.id}.mp4`} data-testid="video-download">
          <Download size={13} /> 下载
        </a>
        <button className="btn-ghost btn-sm" onClick={() => copyText(abs(), "视频链接已复制（带签名，不登录也能打开）")}>
          <Link2 size={13} /> 复制链接
        </button>
        {onRegen && (
          <button className="btn-ghost btn-sm" onClick={onRegen}>
            <RefreshCw size={13} /> 重新生成
          </button>
        )}
      </div>
      {v.temp && (
        <p className="mt-2 rounded-lg bg-warn/10 px-2.5 py-1.5 text-[12px] leading-relaxed text-ink/80" data-testid="video-temp">
          这段视频没能转存到本站（超过大小上限或下载失败），现在播放的是经本站转发的服务商临时链接，过一段时间会失效，请尽快下载保存。
        </p>
      )}
      {justDone && isLast && rinneOn && (
        <div className="mt-2" data-testid="video-done-scene">
          <RinneInline mood="success" clip="image-done">
            <div className="pill !mx-0">{rinneLine(outfit, "videoDone")}</div>
          </RinneInline>
        </div>
      )}
    </div>
  );
}
