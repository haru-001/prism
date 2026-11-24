// @ts-nocheck
/* 移植自 haru（用户自己的提示词项目）assets/r18zh.js，只在打开 R18 库时按需加载 */
/* haru · R18 英文提示词的中文重点：词表匹配，纯本地，不调用任何翻译接口
 * 每条：[英文正则, 中文, 类别]。类别决定「中文要点」里的顺序；同一类别里先出现的优先。 */

  const G = [
    // 人数 / 身体状态
    ['two (?:women|woman|females)', '两名女性', 0], ['(?:a )?(?:man|male) and (?:a )?(?:woman|female)', '一男一女', 0],
    ['(?:fully|completely) nude|stands nude|nude form|naked', '全裸', 1], ['topless', '上身赤裸', 1], ['bare (?:back|shoulders?|skin|breasts?|chest)', '裸露', 1],
    ['partially (?:nude|clothed|covered)|semi-nude', '半裸', 1], ['nude', '裸体', 1], ['wet (?:skin|body|hair)|glistening|water droplets|droplets', '湿身', 1],
    ['sweat', '汗珠', 1], ['oiled|oily', '涂油', 1],
    // 姿势
    ['reclin\\w*', '斜躺', 2], ['lies|lying|lays', '躺着', 2], ['kneel\\w*', '跪姿', 2], ['squat\\w*|crouch\\w*', '蹲姿', 2],
    ['sits|seated|sitting', '坐姿', 2], ['stands|standing', '站姿', 2], ['lean(?:s|ing)\\b', '倚靠', 2], ['on all fours|hands and knees', '四肢着地', 2],
    ['bend(?:s|ing)? over|bent over', '俯身', 2], ['arched back|back arched|arches? her back|arched', '弓背', 2], ['straddl\\w*', '跨坐', 2],
    ['legs spread|spread legs|legs apart', '双腿分开', 2], ['legs crossed|crossed legs', '双腿交叉', 2], ['on her side|side-lying', '侧卧', 2],
    ['on her stomach|prone|face down', '趴着', 2], ['on her back|supine', '仰卧', 2], ['stretch\\w*', '伸展', 2], ['curled', '蜷身', 2],
    ['looking over (?:her|his) shoulder|over (?:her|his) shoulder', '回眸', 2], ['hands? (?:raised )?(?:above|behind) (?:her|his) head|arms? raised', '举臂', 2],
    ['embrac\\w*|hug\\w*', '拥抱', 2], ['kiss\\w*', '亲吻', 2], ['bath(?:ing|es)\\b', '沐浴', 2], ['shower(?:ing)?', '淋浴', 2], ['swim\\w*', '游泳', 2],
    // 表情 / 视线
    ['eyes closed|closed eyes', '闭眼', 3], ['smil\\w*|grin\\w*', '微笑', 3], ['gaz\\w* directly|looks? directly|toward the (?:viewer|camera)|at the (?:viewer|camera)', '直视镜头', 3],
    ['parted lips|lips parted', '唇微张', 3], ['serene|calm', '神情平静', 3], ['sensual', '性感', 3], ['seductive', '诱惑', 3], ['playful', '俏皮', 3],
    ['contemplative|pensive|thoughtful', '若有所思', 3], ['confident', '自信', 3], ['looking down|gaze downward', '低头', 3],
    // 外貌
    ['blonde|blond', '金发', 4], ['brunette|brown hair', '棕发', 4], ['red hair|redhead|auburn|ginger', '红发', 4], ['black hair|dark hair', '黑发', 4],
    ['platinum|silver hair|white hair', '银白发', 4], ['pink hair', '粉发', 4], ['blue hair', '蓝发', 4],
    ['long (?:\\w+ )?hair|hair cascad\\w*|cascading', '长发', 4], ['short hair|pixie|bob cut', '短发', 4], ['shoulder-length', '及肩发', 4],
    ['wavy|waves|curls|curly', '卷发', 4], ['straight hair', '直发', 4], ['ponytail', '马尾', 4], ['updo|\\bbun\\b', '盘发', 4], ['braid\\w*', '辫子', 4], ['wet hair', '湿发', 4],
    ['freckle\\w*', '雀斑', 4], ['tattoo\\w*', '纹身', 4], ['pierc\\w*', '穿孔', 4], ['tan(?:ned)? skin|tanned|sun-kissed', '小麦肤色', 4],
    ['pale skin|fair skin|porcelain', '白皙', 4], ['dark skin|ebony', '深肤色', 4], ['curvy|voluptuous', '丰满', 4], ['athletic|toned|muscular', '健美', 4], ['slender|slim', '纤细', 4],
    ['red lipstick|red lips', '红唇', 4], ['makeup', '妆容', 4], ['glasses|spectacles', '眼镜', 4],
    // 服饰（与 manifest 的 clothZh 互补，这里只放描述里常见的）
    ['lingerie', '内衣', 5], ['thigh-high stockings|thigh-highs?|stockings', '丝袜', 5], ['fishnet', '渔网袜', 5], ['garter(?: belt)?', '吊袜带', 5],
    ['black lace|lace', '蕾丝', 5], ['sheer', '透明薄纱', 5], ['satin|silk', '丝缎', 5], ['corset', '束身衣', 5], ['bikini', '比基尼', 5], ['thong', '丁字裤', 5],
    ['high-heeled|high heels|heels', '高跟鞋', 5], ['choker', '项圈', 5], ['necklace|pendant', '项链', 5], ['earrings?', '耳环', 5], ['bracelet', '手链', 5],
    ['towel', '浴巾', 5], ['robe', '睡袍', 5], ['kimono', '和服', 5], ['shirt', '衬衫', 5], ['dress', '连衣裙', 5], ['jeans', '牛仔裤', 5], ['boots', '靴子', 5],
    ['leather', '皮革', 5], ['latex', '乳胶', 5], ['harness', '绑带', 5], ['bodysuit', '连体衣', 5], ['barefoot', '赤脚', 5],
    // 场景
    ['bedroom', '卧室', 6], ['headboard|bedding|bed\\b|sheets', '床上', 6], ['sofa|couch|chaise|loveseat', '沙发', 6], ['armchair|chair', '椅子', 6],
    ['bathtub|tub\\b|bath\\b', '浴缸', 6], ['shower', '淋浴间', 6], ['bathroom', '浴室', 6], ['pool', '泳池', 6], ['beach|shore|sand', '海滩', 6],
    ['ocean|sea\\b|waves crash', '海边', 6], ['lake|river|stream|waterfall', '水边', 6], ['forest|woods|trees', '森林', 6], ['garden|flowers|floral', '花园花卉', 6],
    ['field|meadow|grass', '草地', 6], ['desert', '沙漠', 6], ['rocks?\\b|cliff', '岩石', 6], ['mirror', '镜子', 6], ['window', '窗边', 6], ['balcony|terrace', '阳台', 6],
    ['kitchen', '厨房', 6], ['office|desk', '办公室', 6], ['hotel', '酒店', 6], ['studio', '摄影棚', 6], ['car\\b|vehicle', '车内', 6], ['staircase|stairs', '楼梯', 6],
    ['library|bookshelf|books', '书房', 6], ['brick', '砖墙', 6], ['curtains?|drapes', '窗帘', 6], ['candles?', '蜡烛', 6], ['rug|carpet', '地毯', 6], ['velvet', '天鹅绒', 6],
    ['outdoor\\w*|outside', '户外', 6], ['indoor\\w*|interior', '室内', 6], ['luxurious|opulent|ornate', '奢华', 6], ['rustic', '质朴', 6], ['vintage|retro', '复古', 6], ['modern|minimalist', '现代简约', 6],
    ['black background|dark background|plain background|backdrop', '纯色背景', 6], ['night|moonlight', '夜晚', 6],
    // 光线
    ['golden hour|sunset|sunrise', '黄金时刻', 7], ['sunlight|sunlit|sun\\b', '阳光', 7], ['natural light(?:ing)?|daylight', '自然光', 7], ['window light', '窗光', 7],
    ['candlelight|candle-lit', '烛光', 7], ['neon', '霓虹', 7], ['backlit|backlighting|rim light\\w*|silhouette', '逆光', 7], ['dramatic lighting|dramatic', '戏剧光', 7],
    ['low-key|chiaroscuro|deep shadows|dimly lit|moody', '暗调', 7], ['high-key|bright', '明亮', 7], ['diffused|soft (?:\\w+ )?light(?:ing)?', '柔光', 7], ['warm (?:\\w+ )?light(?:ing)?|warm golden|warm', '暖光', 7],
    ['cool (?:\\w+ )?light(?:ing)?|cool tones|blue light', '冷光', 7], ['spotlight', '聚光', 7], ['studio lighting', '棚拍光', 7],
    // 镜头
    ['extreme close-up', '大特写', 8], ['medium close-up', '中近景', 8], ['close-up', '特写', 8], ['medium shot|waist up', '中景', 8], ['full-body|full-length|full body', '全身', 8],
    ['portrait', '人像', 8], ['low[- ]angle', '仰拍', 8], ['high[- ]angle|overhead|from above|bird', '俯拍', 8], ['from behind|rear view|back view', '背影', 8],
    ['profile|side view', '侧面', 8], ['three-quarter', '四分之三侧', 8], ['eye[- ]level', '平视', 8], ['shallow depth of field|bokeh|blurred background|softly blurred', '浅景深', 8],
    ['wide shot|wide-angle|wide angle', '广角', 8], ['vertical composition', '竖构图', 8], ['horizontal composition', '横构图', 8], ['pov|point of view|first-person', '第一人称', 8],
    // 风格
    ['black and white|black-and-white|monochrome|grayscale', '黑白', 9], ['film grain|grainy|analog|35mm', '胶片感', 9], ['polaroid', '拍立得', 9], ['cinematic', '电影感', 9],
    ['oil painting|painting', '油画', 9], ['illustration|drawing|sketch', '插画', 9], ['anime|manga', '动漫', 9], ['3d render|cgi', '3D 渲染', 9], ['watercolor', '水彩', 9],
    ['photorealistic|realistic|photograph', '写实摄影', 9], ['boudoir', '私房', 9], ['fine art|artistic', '艺术人像', 9], ['erotic', '情色', 9], ['glamour', '魅力写真', 9],
  ];
  const RX = G.map(([s, zh, c]) => [new RegExp('\\b(?:' + s + ')', 'gi'), zh, c]);
  const NUD = ['着装', '半裸', '全裸'];

  /** 中文要点：[{zh, c}]，按类别排序、去重，最多 n 个 */
  function points(text, n = 10) {
    const seen = new Set(), out = [];
    for (const [re, zh, c] of RX) {
      if (seen.has(zh)) continue;
      re.lastIndex = 0; const m = re.exec(text);
      if (m) { seen.add(zh); out.push({ zh, c, at: m.index }); }
    }
    // 同类只保留前 2 个（按在原文中出现的先后）
    const by = {}; out.sort((a, b) => a.c - b.c || a.at - b.at);
    return out.filter(x => (by[x.c] = (by[x.c] || 0) + 1) <= (x.c === 6 || x.c === 7 ? 2 : x.c === 2 || x.c === 4 || x.c === 5 ? 3 : 2)).filter(x => !['全裸', '裸体', '半裸'].includes(x.zh)).slice(0, n);
  }

  /** 在已转义的 HTML 上给关键词加中文小注（紧跟在英文后面，复制时不包含） */
  function annotate(html) {
    const spans = [];
    for (const [re, zh] of RX) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(html))) {
        const s = m.index, e = s + m[0].length;
        if (!spans.some(x => s < x.e && e > x.s) && !/[&<]/.test(m[0])) spans.push({ s, e, zh });
      }
    }
    spans.sort((a, b) => b.s - a.s);
    for (const x of spans) html = html.slice(0, x.s) + `<u>${html.slice(x.s, x.e)}</u><span class="zt">${x.zh}</span>` + html.slice(x.e);
    return html;
  }

  /** 中文版提示词：给中文模型（即梦 / Seedream / 可图 / 通义 / Qwen-Image）直接用 */
  function zhPrompt(r, clothZh) {
    const p = points(r[0], 16).map(x => x.zh);
    const who = r[3] + r[4] > 1 ? (r[3] && r[4] ? `${r[4]} 名成年女性与 ${r[3]} 名成年男性` : `${r[4]} 名成年女性`) : '一名成年女性';
    const cloth = r[1] < 2 ? r[5].map(clothZh).filter(c => !p.includes(c)) : [];
    return [who, NUD[r[1]], ...p, ...cloth].join('，') + `，高清写实摄影，细节丰富，画幅 ${r[2]}`;
  }

  export const R18ZH = { points, annotate, zhPrompt };
