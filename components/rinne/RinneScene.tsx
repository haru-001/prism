"use client";

import { HY_MAX, moodMeta, stageFit, type Mood, type StageSize } from "@/lib/rinne";
import { RinneFigure } from "./RinneFigure";
import { useRinne } from "./RinneProvider";

/**
 * 棱音的舞台场景（设计稿「界面融合」的版式）：
 *  - 右边浅灰舞台上站着完整全身立绘
 *  - 左边和她相连的界面块（link），一根渐变线从界面块接到她的手或道具前 9px
 *  - 其余内容（children）在界面块下方；手机宽度下她照样全身站在右边，其余内容移到她下方
 * ly 是界面块里连线的高度（从界面块顶端算）。界面块的上边距按连接点算，线就是水平的。
 * 「显示棱音」关掉时只留下界面块和其余内容。
 * 舞台宽度按这个状态九套里最宽的一张，图片横向偏移让头部对齐（stageFit），换装时人物不左右跳。
 * steady：居中排版的页面（登录、引导、休眠）用，按最低的连接点预留界面块下方的高度，
 * 整块高度不随连接点变，换装或换状态时舞台不上下跳。
 */
export function RinneScene({
  mood,
  size = "md",
  ly = 26,
  link,
  children,
  corner = false,
  bar = false,
  mobfull = false,
  guideMobile = false,
  priority = false,
  steady = false,
  className = "",
  testId,
  clip,
  replay,
}: {
  mood: Mood;
  size?: StageSize;
  ly?: number;
  link: React.ReactNode;
  children?: React.ReactNode;
  /** toast：小立绘，整体靠右 */
  corner?: boolean;
  /** 顶部提醒条 */
  bar?: boolean;
  /** 手机上其余内容占满整行（在她下方） */
  mobfull?: boolean;
  /** 引导页：手机上立绘高 262px */
  guideMobile?: boolean;
  priority?: boolean;
  /** 居中排版的页面：预留高度，舞台不上下跳 */
  steady?: boolean;
  className?: string;
  testId?: string;
  clip?: import("./RinneClip").ClipId;
  replay?: number;
}) {
  const { show, outfit, animate } = useRinne();
  const m = moodMeta(outfit, mood);
  if (!show) {
    return (
      <div className={`rn-plain ${className}`} data-testid={testId} data-rinne="off">
        <div className="rn-plain-link">{link}</div>
        {children}
      </div>
    );
  }
  const mobileH = guideMobile ? 262 : undefined;
  const fit = stageFit(outfit, mood);
  return (
    <div
      className={`rn-scn rn-${size} ${corner ? "rn-corner" : ""} ${bar ? "rn-bar" : ""} ${mobfull ? "rn-mobfull" : ""} ${guideMobile ? "rn-gd" : ""} ${steady ? "rn-steady" : ""} ${animate ? "" : "rn-still"} ${children ? "" : "rn-nors"} ${className}`}
      style={{ "--ar": m.ar, "--hx": m.hx, "--hy": m.hy, "--arw": fit.arw, "--ox": fit.ox, "--hymax": HY_MAX, "--ly": `${ly}px`, "--rn-fade": animate ? "240ms" : "0ms" } as React.CSSProperties}
      data-testid={testId}
      data-rinne-scene={mood}
      data-outfit={outfit}
    >
      <div className="rn-lk">
        {link}
        <span className="rn-wire" aria-hidden="true" data-rinne-wire="" />
      </div>
      <div className="rn-stg" data-rinne-stage="">
        <RinneFigure mood={mood} size={size} priority={priority} mobileH={mobileH} clip={clip} replay={replay} />
      </div>
      {children ? <div className="rn-rs">{children}</div> : null}
    </div>
  );
}
