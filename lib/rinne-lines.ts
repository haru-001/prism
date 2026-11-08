/**
 * 棱音的台词跟着服装走：同一个场景，穿礼服时正式一点，穿运动装时利落一点。
 * 每套服装每个场景两三句，按日期轮换（同一天里不变，刷新页面不会跳）。
 * 人设不变：简洁、礼貌、克制，不卖萌。
 */
import type { OutfitId } from "./rinne";

type BaseScene = "chat" | "login";
/** 视频生成的各个阶段：排队、生成中、完成，以及三类常见失败（配额用完、超时、Key 无效）和其他失败 */
export type VideoScene = "videoQueued" | "videoRunning" | "videoDone" | "videoQuota" | "videoTimeout" | "videoKey" | "videoFail";
type Scene = BaseScene | VideoScene;

const LINES: Record<OutfitId, Record<BaseScene, string[]>> = {
  suit: {
    chat: ["一切就绪。今天要处理什么？", "线路都在待命，请吩咐。", "今天的日程已经备好，从哪一件开始？"],
    login: ["请输入访问密码，今天的工作我已经准备好了。", "请验证身份，资料都已经整理好了。"],
  },
  gown: {
    chat: ["今晚也由我为您打点。想先聊些什么？", "晚宴之前，还有什么需要我处理的吗？"],
    login: ["请输入访问密码。今晚的安排我已经备妥。", "欢迎回来，请先验证身份。"],
  },
  summer: {
    chat: ["天气正好，今天想做点什么？", "准备好了，随时可以开始。"],
    login: ["请输入访问密码，今天我们轻装上阵。", "欢迎回来，输入密码就开工。"],
  },
  sport: {
    chat: ["热身完毕。第一项任务是？", "状态在线，说吧，从哪里开始？"],
    login: ["请输入访问密码，热身已经做好了。", "欢迎回来，输入密码我们就出发。"],
  },
  home: {
    chat: ["这么晚还在忙？我陪你把这件事做完。", "夜里也在线。要处理什么？"],
    login: ["请输入访问密码。夜深了，我们速战速决。", "欢迎回来，输入密码就好。"],
  },
  trench: {
    chat: ["外面起风了。今天要处理什么？", "出门在外也不耽误，请吩咐。"],
    login: ["请输入访问密码，路上的事我都记着。", "欢迎回来，请先验证身份。"],
  },
  qipao: {
    chat: ["茶已经沏好。今天有什么要办的？", "节日也照常值守，请吩咐。"],
    login: ["请输入访问密码，今日诸事已备。", "欢迎回来，请先验证身份。"],
  },
  bridal: {
    chat: ["今天是特别的日子，事情交给我。想先做什么？", "一切就绪，请吩咐。"],
    login: ["请输入访问密码，今天的安排我都替你记着。", "欢迎回来，请先验证身份。"],
  },
  winter: {
    chat: ["外面冷，进来暖和一下。今天要处理什么？", "热咖啡备好了，从哪件事开始？"],
    login: ["请输入访问密码，暖气已经开好了。", "欢迎回来，输入密码就开工。"],
  },
};

/** 视频台词：同样跟着服装走，每个场景两句，按日期轮换 */
const VIDEO_LINES: Record<OutfitId, Record<VideoScene, string[]>> = {
  suit: {
    videoQueued: ["已提交，正在排队等 GPU。", "任务已经递上去了，排到就开始。"],
    videoRunning: ["正在逐帧生成，进度我盯着。", "生成中，完成后第一时间通知你。"],
    videoDone: ["视频已生成，请过目。", "成片到了，可以直接播放或下载。"],
    videoQuota: ["今天的免费 GPU 额度用完了，建议改用智谱，或明天再来。", "额度已经见底。可以缩短时长，或切到智谱继续。"],
    videoTimeout: ["这次等得太久，被时限截停了。缩短时长再试一次更稳妥。", "超出了函数时限，没能等到成片。建议调短时长或换个 Space。"],
    videoKey: ["Key 没有通过验证，请到设置里重新添加。", "服务商不认这把 Key，麻烦核对一下。"],
    videoFail: ["这次没有成功，原因写在下面。", "生成失败了，我把对方的说明附在下面。"],
  },
  gown: {
    videoQueued: ["已为您递交，正在等候 GPU。", "请稍候，任务已在队列中。"],
    videoRunning: ["画面正在成形，请再稍等片刻。", "正在生成，一有结果我便呈上。"],
    videoDone: ["成片已备好，请您过目。", "视频完成了，请欣赏。"],
    videoQuota: ["今晚的免费额度已用尽，可改用智谱，或明日再续。", "额度用完了。缩短时长，或换智谱试试。"],
    videoTimeout: ["等候超过了时限，未能取回成片。调短时长会更从容。", "这一次超时了，建议缩短时长后重试。"],
    videoKey: ["这把 Key 未获认可，请在设置中更换。", "Key 验证没有通过，劳烦核对。"],
    videoFail: ["很遗憾，这次没有成功，详情附在下方。", "未能生成，原因已列在下面。"],
  },
  summer: {
    videoQueued: ["交上去了，在排队等显卡。", "排着队呢，马上轮到。"],
    videoRunning: ["正在出片，喝口水的工夫。", "生成中，进度我看着。"],
    videoDone: ["出片了，看看效果。", "视频好了，点开就能播。"],
    videoQuota: ["今天的免费额度用光了，换智谱接着来，或者明天再试。", "额度没了。把时长调短，或者切到智谱。"],
    videoTimeout: ["等太久超时了，调短一点再来一次。", "超时了，没等到成片，时长短一点更快。"],
    videoKey: ["Key 不对，去设置里重新填一下。", "对方不认这个 Key，核对一下吧。"],
    videoFail: ["这次没成，原因在下面。", "失败了，对方的说明我贴在下面了。"],
  },
  sport: {
    videoQueued: ["已出发，排队等 GPU 中。", "任务入列，轮到就开跑。"],
    videoRunning: ["全速生成中，计时器开着。", "正在冲刺出片，稍等。"],
    videoDone: ["到终点了，视频请查收。", "成片完成，可以回放了。"],
    videoQuota: ["今天的免费额度跑完了，换智谱接力，或明天再来。", "额度耗尽。缩短时长，或切换到智谱。"],
    videoTimeout: ["超过时限没跑完。缩短时长再来一组。", "这一轮超时了，时长调短会更快完成。"],
    videoKey: ["Key 验证没过，去设置里换一把。", "服务商拒收这把 Key，请核对。"],
    videoFail: ["这一轮没成功，原因在下面。", "失败了，详细情况列在下面。"],
  },
  home: {
    videoQueued: ["交上去了，在排队，不着急。", "已提交，正在等 GPU 空出来。"],
    videoRunning: ["慢慢生成中，我陪你等。", "还在出片，进度我替你看着。"],
    videoDone: ["好了，视频出来了。", "成片在这里，看完早点休息。"],
    videoQuota: ["今天的免费额度用完了，换智谱，或者明天再说。", "额度没有了。时长短一点，或者切到智谱。"],
    videoTimeout: ["等太久超时了，时长调短再试一次吧。", "超时了，没等到结果，下次短一点。"],
    videoKey: ["Key 好像不对，去设置里重新填一下。", "对方没认这个 Key，明天再核对也行。"],
    videoFail: ["这次没成，原因写在下面了。", "没生成出来，说明在下面。"],
  },
  trench: {
    videoQueued: ["已提交，正在队列里等候。", "任务送出去了，排到就开工。"],
    videoRunning: ["正在生成，路上也不耽误。", "出片中，进度我一直跟着。"],
    videoDone: ["视频到了，请查收。", "成片已取回，可以播放。"],
    videoQuota: ["今天的免费额度用完了，改用智谱，或明天再来。", "额度到头了。调短时长，或换成智谱。"],
    videoTimeout: ["等候超时，没取到成片。调短时长再走一趟。", "超过时限了，建议缩短时长重试。"],
    videoKey: ["Key 没有通过验证，请到设置里更换。", "这把 Key 不被接受，需要核对。"],
    videoFail: ["这次没有成功，原因附在下面。", "生成失败，对方的说明在下面。"],
  },
  qipao: {
    videoQueued: ["已经递交，正在候场。", "任务在列，轮到即刻开始。"],
    videoRunning: ["正在描摹成片，请稍候。", "画卷徐徐展开，生成中。"],
    videoDone: ["成片已就，请过目。", "视频已成，可以观赏。"],
    videoQuota: ["今日的免费额度已尽，可改用智谱，或明日再续。", "额度用罄。缩短时长，或换智谱一试。"],
    videoTimeout: ["候时过久，超出时限，未能取回成片。时长短些更稳妥。", "此番超时，建议调短时长再试。"],
    videoKey: ["此 Key 未获认可，请在设置中更换。", "Key 验证未过，烦请核对。"],
    videoFail: ["此番未成，缘由附在下方。", "未能生成，详情列在下面。"],
  },
  bridal: {
    videoQueued: ["已经交上去了，正在排队。", "任务已提交，稍候片刻。"],
    videoRunning: ["正在生成，美好的画面需要一点时间。", "出片中，我替你看着进度。"],
    videoDone: ["视频完成了，请过目。", "成片到了，值得收藏。"],
    videoQuota: ["今天的免费额度用完了，可以换智谱，或明天再来。", "额度用尽。时长短一点，或改用智谱。"],
    videoTimeout: ["等得太久超时了，调短时长再试一次。", "超时没能等到成片，建议缩短时长。"],
    videoKey: ["Key 没有通过验证，请到设置里重新添加。", "服务商不认这把 Key，请核对。"],
    videoFail: ["这次没有成功，原因写在下面。", "生成失败，说明附在下面。"],
  },
  winter: {
    videoQueued: ["已提交，在排队等 GPU，先暖暖手。", "任务送出去了，排到就开始。"],
    videoRunning: ["正在生成，咖啡还热着。", "出片中，进度我看着。"],
    videoDone: ["视频好了，请查收。", "成片出来了，可以播放。"],
    videoQuota: ["今天的免费额度用完了，换智谱，或明天再来。", "额度见底了。调短时长，或切到智谱。"],
    videoTimeout: ["等太久超时了，时长短一点再试。", "超出时限没等到成片，建议缩短时长。"],
    videoKey: ["Key 没通过验证，请到设置里重新添加。", "对方不认这把 Key，请核对一下。"],
    videoFail: ["这次没成功，原因在下面。", "生成失败了，详情附在下面。"],
  },
};

/** 视频失败类型 → 台词场景 */
export function videoErrorScene(kind?: string): VideoScene {
  if (kind === "quota") return "videoQuota";
  if (kind === "timeout") return "videoTimeout";
  if (kind === "key" || kind === "nokey") return "videoKey";
  return "videoFail";
}

/** offset：同一场景换另一句（比如 toast 和消息里的台词同时出现时，别说两遍同一句） */
export function rinneLine(o: OutfitId, scene: Scene, d: Date = new Date(), offset = 0): string {
  const table = (scene === "chat" || scene === "login" ? LINES : VIDEO_LINES) as Record<OutfitId, Record<Scene, string[]>>;
  const list = table[o]?.[scene] ?? table.suit[scene];
  const day = Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  return list[(day + offset) % list.length];
}
