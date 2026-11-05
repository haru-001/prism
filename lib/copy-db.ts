/**
 * 棱音在数据库相关提示里的台词（休眠提示、容量看板、快满提醒）。
 * 和 lib/copy.ts 分开放，是为了平时的页面不用多下载这些只在特殊情况下才显示的文字。
 */
export const dbCopy = {
  // 数据库连不上时的提示页（Aiven 免费档长时间不用会被关机）
  dbDown: {
    title: "数据库已休眠",
    say: "Prism 的数据库目前处于关机状态。Aiven 免费档长时间不用会自动关机，数据都还在，按下面四步开机即可。",
    steps: [
      "打开 Aiven 控制台（console.aiven.io）并登录",
      "进入 Prism 用的项目，点左边的 Services，找到那个 MySQL 服务（状态显示 Powered off）",
      "点进服务的 Overview 页，右上角 Actions → Power on service",
      "等状态变成 Running（一般几分钟，久一点也正常），回来点下面的「重试」",
    ],
    busyTitle: "数据库有点忙",
    busySay: "数据库连接数已满，请稍等几秒后点「重试」。",
    configTitle: "数据库连不上",
    configSay: "数据库在线，但账号、密码或证书校验未通过。请核对 Vercel 里的 DATABASE_URL 和 DATABASE_CA_CERT，修改后 Redeploy。",
    retry: "重试",
    retrying: "正在重新连接……",
    stillDown: "仍未开机，请稍后再试（{time} 已尝试）。",
    console: "打开 Aiven 控制台",
    apiNote: "这段时间对外接口会返回 503，客户端稍后重试就行；上游的 Key 和对话都安全地存在数据库里。",
  },

  // 数据库容量看板（设置页）
  dbQuota: {
    title: "数据库容量",
    say: "Aiven 免费档共 {quota}，目前已用 {used}（{pct}）。各部分占用如下，旧数据可以在这里清理。",
    warn: "数据库已用 {pct}，接近上限。建议到设置页的「数据库容量」清理旧数据。",
    warnShort: "数据库已用 {pct}，接近上限",
    goClean: "去清理",
    later: "知道了",
    local: "当前使用本地文件存储（未配置 DATABASE_URL），没有 1GB 的限制，无需清理。",
    note: "数字来自 MySQL 的 information_schema，只算 Prism 所在库的表；Aiven 自己的系统表和日志也占一点，以 Aiven 控制台为准。",
    confirm: "确定要清理吗？删掉的数据找不回来了。",
    done: "清理完成，释放约 {freed}。",
    nothing: "这个范围内没有可清理的数据。",
  },
};
