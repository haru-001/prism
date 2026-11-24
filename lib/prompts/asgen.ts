// @ts-nocheck
/* 移植自 haru（用户自己的提示词项目）assets/asgen.js，只在打开 R18 库时按需加载 */
/* haru · 亚洲写真组合库：中英双语词槽，按场景兼容规则组合成完整提示词（含背景、光线、镜头）
 * 人物一律为明确标注年龄的成年女性（22–34 岁）；不含任何校园、未成年、偷拍、非自愿、醉酒/药物题材。
 * 部分词汇参考 ShuaiHui/nsfw-prompt-templates-asian（MIT License）。 */

  // ---------- 场景：c 分类，zh 名称，en/zd 背景描写，p 可用姿势组，o 可用服装组，io 室内/室外 ----------
  const S = [
    // 卧室 / 酒店
    { c: '卧室酒店', zh: '清晨卧室', en: 'a sunlit minimalist bedroom with crumpled white linen sheets, a wooden bedside table with a ceramic cup, sheer curtains moving in the breeze', zd: '简约卧室，揉皱的白色亚麻床单，木质床头柜上放着陶瓷杯，薄纱窗帘随风轻动', p: 'bed seat kneel stand', o: 'home lingerie', io: 'in' },
    { c: '卧室酒店', zh: '高层酒店套房', en: 'a high-floor luxury hotel suite at night, floor-to-ceiling windows showing a glittering city skyline, king-size bed with grey silk bedding, warm bedside lamps', zd: '夜晚高层豪华酒店套房，落地窗外是闪烁的城市天际线，铺着灰色真丝床品的大床，床头暖色台灯', p: 'bed seat stand kneel window', o: 'lingerie formal home', io: 'in' },
    { c: '卧室酒店', zh: '和风旅馆', en: 'a traditional Japanese ryokan room with tatami mats, a futon on the floor, shoji paper screens glowing softly, a low wooden table with a teapot', zd: '传统日式旅馆和室，榻榻米上铺着被褥，障子纸门透出柔光，矮木桌上放着茶壶', p: 'bed seat kneel', o: 'onsen home lingerie', io: 'in' },
    { c: '卧室酒店', zh: '复古公寓', en: 'a vintage Hong Kong style apartment bedroom, green tiled walls, a brass bed frame, neon signs glowing through the window blinds, a rotating desk fan', zd: '复古港式公寓卧室，绿色瓷砖墙，黄铜床架，霓虹招牌的光透过百叶窗，老式摇头风扇', p: 'bed seat stand window', o: 'qipao home lingerie', io: 'in' },
    { c: '卧室酒店', zh: '雨夜窗边', en: 'a dim bedroom on a rainy night, raindrops streaking down a large window, blurred city lights outside, an unmade bed and a reading lamp', zd: '雨夜昏暗的卧室，雨水划过大窗，窗外城市灯光模糊，未整理的床和一盏阅读灯', p: 'window seat bed stand', o: 'home lingerie', io: 'in' },
    { c: '卧室酒店', zh: '衣帽间镜前', en: 'a walk-in closet with warm LED shelf lighting, rows of designer clothes and handbags, a full-length mirror reflecting her', zd: '步入式衣帽间，层架暖色灯带，整排名牌衣物和手袋，落地镜映出她的身影', p: 'stand mirror seat', o: 'lingerie formal office', io: 'in' },
    { c: '卧室酒店', zh: '复古化妆台', en: 'a vintage vanity table with a round mirror framed by bulb lights, perfume bottles, makeup brushes and scattered pearls', zd: '复古梳妆台，圆镜周围一圈灯泡，香水瓶、化妆刷和散落的珍珠', p: 'seat mirror', o: 'lingerie qipao home', io: 'in' },
    // 浴室 / 温泉
    { c: '浴室温泉', zh: '大理石浴缸', en: 'a marble bathroom with a freestanding bathtub filled with milky water and rose petals, candles along the edge, steam rising softly', zd: '大理石浴室，独立浴缸里是乳白色的水和玫瑰花瓣，缸边点着蜡烛，水汽缓缓升起', p: 'water', o: 'nude', io: 'in' },
    { c: '浴室温泉', zh: '玻璃淋浴间', en: 'a modern glass shower cabin with fogged glass, black stone tiles, water streaming down, droplets on the glass', zd: '现代玻璃淋浴间，雾气蒙蒙的玻璃，黑色石砖，水流倾泻，玻璃上挂满水珠', p: 'shower', o: 'nude', io: 'in' },
    { c: '浴室温泉', zh: '露天温泉', en: 'an outdoor hot spring surrounded by natural rocks and snow-covered pine trees, steam drifting over the water, a wooden bucket on the rocks', zd: '露天温泉，四周是天然岩石和积雪的松树，水面雾气缭绕，岩石上放着木桶', p: 'water', o: 'onsen nude', io: 'out' },
    { c: '浴室温泉', zh: '桧木浴池', en: 'a private hinoki cypress wood bath in a Japanese inn, a window open to a moss garden, warm steam and soft wood tones', zd: '日式旅馆的私汤桧木浴池，窗外是苔藓庭院，温暖的水汽和柔和的木色', p: 'water', o: 'onsen nude', io: 'in' },
    { c: '浴室温泉', zh: '桑拿木屋', en: 'a cedar wood sauna room with tiered benches, glowing hot stones, thick steam and warm amber light', zd: '雪松木桑拿房，阶梯式长凳，炽热的石头，浓厚的蒸汽和琥珀色暖光', p: 'seat', o: 'onsen nude', io: 'in' },
    { c: '浴室温泉', zh: '浴室镜前', en: 'a bright bathroom with a large fogged mirror, white towels, a sink with skincare bottles, water droplets on her skin', zd: '明亮的浴室，大镜子蒙着雾气，白毛巾，洗手台上摆着护肤品，皮肤上挂着水珠', p: 'stand mirror', o: 'onsen nude home', io: 'in' },
    // 户外自然
    { c: '户外自然', zh: '热带海滩', en: 'a tropical white-sand beach at golden hour, turquoise waves washing ashore, palm trees swaying, footprints in the wet sand', zd: '黄金时刻的热带白沙滩，碧绿海浪拍岸，棕榈树摇曳，湿沙上留着脚印', p: 'stand beach kneel', o: 'swim nude', io: 'out' },
    { c: '户外自然', zh: '礁石海湾', en: 'a secluded rocky cove with dark volcanic rocks, waves crashing into white foam, sea spray in the air, dramatic clouds', zd: '僻静的礁石海湾，黑色火山岩，海浪拍出白色泡沫，空中飞溅着水雾，云层戏剧化', p: 'stand seat beach', o: 'swim nude', io: 'out' },
    { c: '户外自然', zh: '竹林小径', en: 'a dense green bamboo forest, sunlight filtering through tall stalks in thin beams, a narrow stone path covered with fallen leaves', zd: '茂密的绿色竹林，阳光透过高高的竹竿洒下细细光束，铺满落叶的窄石径', p: 'stand', o: 'qipao home onsen nude', io: 'out' },
    { c: '户外自然', zh: '樱花树下', en: 'under a blooming cherry blossom tree, pink petals drifting in the air and covering the grass, a soft blue spring sky', zd: '盛开的樱花树下，粉色花瓣在空中飘落、铺满草地，柔和的春日蓝天', p: 'stand seat', o: 'onsen qipao home', io: 'out' },
    { c: '户外自然', zh: '山间瀑布', en: 'a hidden waterfall pool in a lush mountain forest, mossy rocks, clear emerald water, mist rising from the falls', zd: '苍翠山林中隐秘的瀑布水潭，长满青苔的岩石，清澈的翡翠色潭水，瀑布升起水雾', p: 'water stand', o: 'swim nude', io: 'out' },
    { c: '户外自然', zh: '向日葵花田', en: 'a vast sunflower field in late summer, tall flowers around her, a few clouds in a bright sky, warm breeze', zd: '夏末一望无际的向日葵花田，高大的花朵环绕身边，明亮天空飘着几朵云，暖风拂过', p: 'stand', o: 'home swim', io: 'out' },
    { c: '户外自然', zh: '秋日红叶', en: 'a Japanese garden in autumn, red maple leaves overhead and on the ground, a small wooden bridge over a koi pond', zd: '秋天的日式庭园，头顶和地面满是红枫叶，锦鲤池上有一座小木桥', p: 'stand seat', o: 'onsen qipao formal', io: 'out' },
    { c: '户外自然', zh: '雪地木屋', en: 'a cozy wooden cabin in a snowy forest, a crackling fireplace, a thick fur rug, frosted windows with snow falling outside', zd: '雪林中的温馨木屋，壁炉噼啪作响，厚厚的皮毛地毯，结霜的窗外飘着雪', p: 'bed seat kneel', o: 'home lingerie nude', io: 'in' },
    { c: '户外自然', zh: '沙漠落日', en: 'endless orange sand dunes at sunset, long shadows and wind-carved ripples in the sand, a deep purple sky on the horizon', zd: '落日下无边的橙色沙丘，长长的影子和风吹出的沙纹，地平线上是深紫色天空', p: 'stand seat', o: 'swim formal nude', io: 'out' },
    // 都市夜景
    { c: '都市夜景', zh: '天台夜景', en: 'a rooftop at night overlooking a neon-lit city, a glass railing, scattered string lights and the distant glow of skyscrapers', zd: '夜晚的天台，俯瞰霓虹闪烁的城市，玻璃护栏，零星的串灯和远处摩天楼的光', p: 'stand seat', o: 'formal lingerie office', io: 'out' },
    { c: '都市夜景', zh: '霓虹小巷', en: 'a narrow Tokyo alley at night, glowing red and blue neon signs, wet pavement reflecting the lights, steam from a ramen shop vent', zd: '夜晚东京的窄巷，红蓝霓虹招牌发光，湿漉漉的路面倒映灯光，拉面店排气口冒着热气', p: 'stand', o: 'formal qipao office', io: 'out' },
    { c: '都市夜景', zh: '无边泳池', en: 'a rooftop infinity pool at dusk, the water edge blending into a city skyline, underwater lights glowing turquoise', zd: '黄昏的屋顶无边泳池，水面边缘与城市天际线相接，水下灯透出碧蓝光', p: 'water pool', o: 'swim nude', io: 'out' },
    { c: '都市夜景', zh: '豪华轿车后座', en: 'the back seat of a luxury car at night, cream leather seats, city lights streaking past the tinted windows', zd: '夜里豪华轿车的后座，奶油色真皮座椅，城市灯光从深色车窗外掠过', p: 'seat', o: 'formal lingerie office', io: 'in' },
    { c: '都市夜景', zh: '爵士酒吧', en: 'a dim jazz bar with a polished wooden counter, rows of whisky bottles backlit in amber, a piano in the corner', zd: '昏暗的爵士酒吧，擦亮的木吧台，一排排威士忌酒瓶被琥珀色灯光背照，角落放着钢琴', p: 'seat stand', o: 'formal qipao', io: 'in' },
    { c: '都市夜景', zh: 'KTV 包厢', en: 'a private karaoke room with velvet sofas, colorful disco lights sweeping the walls, a microphone and cocktail glasses on the table', zd: '私人 KTV 包厢，丝绒沙发，彩色射灯扫过墙面，桌上放着麦克风和鸡尾酒杯', p: 'seat stand', o: 'formal lingerie', io: 'in' },
    // 室内生活
    { c: '居家生活', zh: '厨房早餐', en: 'a bright modern kitchen in the morning, a marble counter with fresh fruit and a coffee machine, sunlight through the window', zd: '清晨明亮的现代厨房，大理石台面上放着新鲜水果和咖啡机，阳光从窗户照进来', p: 'stand counter', o: 'home lingerie', io: 'in' },
    { c: '居家生活', zh: '客厅沙发', en: 'a cozy living room with a large velvet sofa, a knitted blanket, indoor plants and a warm floor lamp', zd: '温馨客厅，宽大的丝绒沙发，针织毯，室内绿植和一盏暖色落地灯', p: 'seat bed kneel', o: 'home lingerie', io: 'in' },
    { c: '居家生活', zh: '阳台晨光', en: 'a balcony with potted plants and a rattan chair, morning sun, laundry gently swaying, a view of low rooftops', zd: '摆满盆栽的阳台和一把藤椅，清晨阳光，晾晒的衣物轻轻摇晃，远处是低矮屋顶', p: 'stand seat', o: 'home lingerie', io: 'out' },
    { c: '居家生活', zh: '画室', en: 'an artist studio loft with large skylights, canvases leaning against brick walls, paint-splattered floor and an easel', zd: '带大天窗的阁楼画室，画布靠在砖墙上，地板溅满颜料，立着画架', p: 'stand seat kneel', o: 'home nude', io: 'in' },
    { c: '居家生活', zh: '书房', en: 'a quiet home library with floor-to-ceiling bookshelves, a leather armchair, a green banker lamp and a glass of red wine', zd: '安静的家庭书房，顶天立地的书架，皮质扶手椅，绿色台灯和一杯红酒', p: 'seat stand', o: 'office home lingerie', io: 'in' },
    { c: '居家生活', zh: '健身房', en: 'a modern gym with mirrored walls, dumbbell racks and rubber floor, late evening and empty', zd: '现代健身房，镜面墙，哑铃架和橡胶地板，傍晚时分空无一人', p: 'stand seat kneel', o: 'sport', io: 'in' },
    { c: '居家生活', zh: '瑜伽室', en: 'a serene yoga studio with wooden floors, large windows, a rolled mat and morning light', zd: '宁静的瑜伽室，木地板，大窗户，卷起的瑜伽垫和清晨的光', p: 'stand kneel seat', o: 'sport', io: 'in' },
    // 摄影棚 / 职场
    { c: '摄影棚', zh: '纯色背景棚拍', en: 'a professional photo studio with a seamless warm beige paper backdrop, softbox lights and a reflector', zd: '专业摄影棚，无缝暖米色背景纸，柔光箱和反光板', p: 'stand seat kneel', o: 'lingerie formal nude qipao', io: 'in' },
    { c: '摄影棚', zh: '黑色背景暗调', en: 'a studio with a pure black backdrop, a single strong key light carving her silhouette, everything else falling into shadow', zd: '纯黑背景的摄影棚，一盏强主光勾勒出身形轮廓，其余部分隐入阴影', p: 'stand seat kneel', o: 'lingerie nude formal', io: 'in' },
    { c: '摄影棚', zh: '杂志封面棚', en: 'a fashion magazine set with a pastel colored backdrop, a vintage chair and scattered flowers on the floor', zd: '时尚杂志拍摄现场，粉彩色背景，一把复古椅子，地上散落着鲜花', p: 'stand seat', o: 'lingerie formal qipao', io: 'in' },
    { c: '职场', zh: '深夜办公室', en: 'an empty office after hours, rows of dark desks, a single desk lamp and a laptop glowing, city lights outside the glass wall', zd: '下班后空荡的办公室，一排排暗着的工位，只亮着一盏台灯和一台笔记本，玻璃幕墙外是城市灯火', p: 'seat stand desk', o: 'office lingerie', io: 'in' },
    { c: '职场', zh: '总裁办公室', en: 'an executive office with a wide walnut desk, a leather chair, panoramic windows and a view over the business district at dusk', zd: '总裁办公室，宽大的胡桃木办公桌，真皮老板椅，全景落地窗外是黄昏的商务区', p: 'seat stand desk window', o: 'office formal lingerie', io: 'in' },
    // 中式 / 和风
    { c: '中式和风', zh: '民国老宅', en: 'an old Republic-era Shanghai mansion, carved rosewood furniture, a gramophone, stained glass windows casting colored light', zd: '民国时期的上海老洋房，雕花红木家具，留声机，彩色玻璃窗投下斑斓光影', p: 'seat stand bed', o: 'qipao lingerie', io: 'in' },
    { c: '中式和风', zh: '江南园林', en: 'a classical Chinese garden with a moon gate, a lotus pond, willow branches and a stone pavilion in light rain', zd: '古典江南园林，月洞门，荷花池，垂柳和石亭，细雨蒙蒙', p: 'stand seat', o: 'qipao hanfu', io: 'out' },
    { c: '中式和风', zh: '古风闺房', en: 'an ancient Chinese boudoir with red silk curtains around a carved wooden bed, paper lanterns and an incense burner with rising smoke', zd: '古风闺房，雕花木床挂着红色纱帐，纸灯笼和袅袅升烟的香炉', p: 'bed seat kneel', o: 'hanfu nude', io: 'in' },
    { c: '中式和风', zh: '京都町屋', en: 'a Kyoto machiya townhouse with wooden lattice, a small inner courtyard garden and paper lanterns at dusk', zd: '京都町屋，木格栅窗，小小的中庭庭园，黄昏时亮起的纸灯笼', p: 'seat stand kneel', o: 'onsen lingerie', io: 'in' },
    { c: '中式和风', zh: '夏日祭夜', en: 'a summer festival riverside at night, fireworks bursting in the sky, paper lanterns lining the path, distant food stalls glowing', zd: '夏日祭的河边夜晚，烟花在空中绽放，路边挂满纸灯笼，远处小吃摊亮着灯', p: 'stand seat', o: 'onsen', io: 'out' },
    // 旅行
    { c: '旅途', zh: '游艇甲板', en: 'the teak deck of a private yacht on open blue sea, white cushions, bright sun and sparkling water', zd: '私人游艇的柚木甲板，开阔的蓝色海面，白色坐垫，阳光明媚，水面波光粼粼', p: 'stand seat bed', o: 'swim nude', io: 'out' },
    { c: '旅途', zh: '海岛别墅', en: 'a Bali villa with an open-air daybed, white mosquito net, a private plunge pool and tropical plants', zd: '巴厘岛别墅，露天卧榻，白色纱帐，私人泳池和热带植物', p: 'bed seat water', o: 'swim lingerie nude', io: 'out' },
    { c: '旅途', zh: '火车卧铺', en: 'a sleeper train compartment at night, a narrow bunk with white sheets, a small window with passing station lights', zd: '夜行火车的卧铺包厢，铺着白床单的窄床，小窗外掠过车站的灯光', p: 'bed seat', o: 'home lingerie', io: 'in' },
  ];

  // ---------- 姿势：g 所属组 ----------
  const P = [
    ['lying on her side on the bed, propped up on one elbow', '侧卧在床上，单肘撑起上身', 'bed'], ['lying on her back, one arm above her head, hair spread across the pillow', '仰躺，一只手臂举过头顶，长发铺在枕上', 'bed'],
    ['lying on her stomach, legs bent up behind her, chin resting on her hands', '趴着，双腿向后翘起，双手托腮', 'bed'], ['stretching lazily in bed, sheets loosely draped over her hips', '在床上慵懒地伸展，床单松松搭在臀部', 'bed'],
    ['kneeling on the bed, sitting back on her heels, hands on her thighs', '跪坐在床上，臀部压在脚跟，双手放在大腿上', 'kneel bed'], ['kneeling upright, arching her back, hands running through her hair', '直身跪着，后仰弓背，双手拨弄头发', 'kneel'],
    ['sitting on the edge, legs crossed elegantly', '坐在边缘，优雅地交叉双腿', 'seat'], ['sitting with one knee drawn up to her chest, arm resting on it', '坐着，一边膝盖收到胸前，手臂搭在上面', 'seat'],
    ['sitting sideways, leaning back on her hands, legs extended', '侧身坐着，双手向后撑，双腿伸直', 'seat'], ['curled up in an armchair, legs tucked beneath her', '蜷在椅子里，双腿收在身下', 'seat'],
    ['standing with her weight on one leg, one hand on her hip', '重心落在一条腿上站立，单手叉腰', 'stand'], ['standing and looking back over her shoulder', '站着回头看向身后', 'stand'],
    ['leaning against the wall, one knee bent, head tilted', '倚着墙，一边膝盖弯曲，头微微侧倾', 'stand'], ['standing with arms raised, gathering her hair up', '站着举起双臂，把头发拢起', 'stand'],
    ['walking slowly toward the camera, mid-step', '缓步走向镜头，正迈出一步', 'stand'], ['standing in profile, back slightly arched', '侧身站立，背部微微弓起', 'stand'],
    ['leaning on the window frame, looking out', '倚在窗框边向外望', 'window'], ['sitting on the windowsill, knees pulled up', '坐在窗台上，双膝收起', 'window'],
    ['standing in front of the mirror, adjusting her hair', '站在镜子前整理头发', 'mirror'], ['taking a mirror selfie with a phone', '对着镜子用手机自拍', 'mirror'],
    ['reclining in the water, shoulders above the surface, arms resting on the edge', '半躺在水中，肩膀露出水面，双臂搭在边缘', 'water'], ['sitting at the edge of the water, legs dangling in', '坐在水边，双腿浸在水里', 'water pool'],
    ['rising from the water, wet hair slicked back, droplets running down her skin', '从水中起身，湿发向后梳，水珠沿皮肤滑落', 'water'], ['floating on her back in the water, eyes closed', '仰浮在水面上，闭着眼睛', 'pool'],
    ['standing under the running water, head tilted back, hands in her hair', '站在水流下，仰起头，双手插进发间', 'shower'], ['leaning one hand on the wet glass, water streaming over her back', '一只手撑在湿玻璃上，水流冲过后背', 'shower'],
    ['walking along the waterline, waves touching her ankles', '沿着水线漫步，海浪拍到脚踝', 'beach'], ['lying on the sand, propped up on her elbows', '躺在沙滩上，双肘撑起', 'beach'],
    ['kneeling in the shallow water, hands brushing the surface', '跪在浅水里，双手拨弄水面', 'beach kneel'], ['leaning back against the kitchen counter, holding a coffee cup', '背靠厨房台面，手里端着咖啡杯', 'counter'],
    ['sitting on the counter, legs swinging', '坐在台面上，双腿轻轻晃动', 'counter'], ['sitting on the edge of the desk, legs crossed', '坐在办公桌边缘，双腿交叉', 'desk'],
    ['leaning forward over the desk on both hands', '双手撑在桌上，身体前倾', 'desk'],
  ];

  // ---------- 服装：g 组，三种裸露状态 [着装, 半裸, 全裸] ----------
  const O = [
    { g: 'home', zh: '男友白衬衫', s: [['wearing an oversized white button-up shirt and nothing else, bare legs', '只穿一件宽大的白衬衫，露出双腿'], ['oversized white shirt unbuttoned and slipping off one shoulder, breasts partially exposed', '宽大白衬衫解开，从一侧肩膀滑落，乳房半露'], ['completely nude, a white shirt dropped on the floor beside her', '全裸，一件白衬衫丢在身旁地上']] },
    { g: 'home', zh: '针织毛衣', s: [['wearing a soft cream knit sweater that falls off one shoulder', '穿着奶油色软针织毛衣，一侧滑落露出肩膀'], ['cream knit sweater pulled up to reveal her bare breasts, no bra', '奶油色毛衣撩起露出乳房，没有穿内衣'], ['nude, wrapped loosely in a knit blanket that leaves her body exposed', '全裸，身上松松裹着针织毯，身体大半裸露']] },
    { g: 'home', zh: '吊带睡裙', s: [['wearing a short silk slip dress with thin straps', '穿着细肩带真丝短睡裙'], ['silk slip dress with one strap fallen, one breast exposed', '真丝睡裙一边肩带滑落，露出一侧乳房'], ['nude, the silk slip dress pooled at her feet', '全裸，真丝睡裙堆在脚边']] },
    { g: 'home', zh: '丝绸睡袍', s: [['wearing a loosely tied black silk robe', '穿着松松系着的黑色丝绸睡袍'], ['black silk robe open at the front, revealing her breasts and stomach', '黑色丝绸睡袍前襟敞开，露出胸部和小腹'], ['nude, a black silk robe sliding off her arms behind her', '全裸，黑色丝绸睡袍从身后手臂滑落']] },
    { g: 'lingerie', zh: '黑色蕾丝内衣', s: [['wearing a black lace bra and matching panties', '穿着黑色蕾丝胸罩和同款内裤'], ['black lace panties only, topless, bra hanging from her hand', '只穿黑色蕾丝内裤，上身赤裸，胸罩挂在手上'], ['nude, black lace lingerie discarded on the bed', '全裸，黑色蕾丝内衣丢在床上']] },
    { g: 'lingerie', zh: '白色蕾丝内衣', s: [['wearing delicate white lace lingerie', '穿着精致的白色蕾丝内衣'], ['white lace bra unclasped and slipping down, breasts exposed', '白色蕾丝胸罩解开下滑，乳房裸露'], ['nude except for a thin white lace choker', '全裸，只戴一条细细的白色蕾丝颈带']] },
    { g: 'lingerie', zh: '酒红吊袜套装', s: [['wearing burgundy lingerie with a garter belt and sheer stockings', '穿着酒红色内衣、吊袜带和薄丝袜'], ['topless in a burgundy garter belt, panties and sheer stockings', '上身赤裸，只穿酒红吊袜带、内裤和薄丝袜'], ['nude except for sheer stockings and a garter belt', '全裸，只留薄丝袜和吊袜带']] },
    { g: 'lingerie', zh: '香槟色缎面', s: [['wearing a champagne satin camisole and shorts', '穿着香槟色缎面吊带背心和短裤'], ['champagne satin camisole pulled down to her waist, breasts bare', '香槟色缎面吊带拉到腰间，胸部裸露'], ['nude, champagne satin set scattered on the floor', '全裸，香槟色缎面睡衣散落在地上']] },
    { g: 'swim', zh: '白色比基尼', s: [['wearing a white string bikini', '穿着白色系带比基尼'], ['white bikini top untied and falling away, topless', '白色比基尼上衣解开滑落，上身赤裸'], ['nude, a white bikini left on the sand', '全裸，白色比基尼留在一旁']] },
    { g: 'swim', zh: '黑色连体泳衣', s: [['wearing a high-cut black one-piece swimsuit', '穿着高开叉黑色连体泳衣'], ['black swimsuit peeled down to her hips, topless', '黑色泳衣褪到胯部，上身赤裸'], ['nude, wet skin glistening', '全裸，湿润的皮肤闪着光']] },
    { g: 'swim', zh: '湿透白T', s: [['wearing a wet white T-shirt clinging to her body', '穿着湿透贴身的白色 T 恤'], ['soaked white T-shirt pulled up above her breasts', '湿透的白 T 恤撩到胸部以上'], ['nude, a wet T-shirt thrown over a rock', '全裸，湿 T 恤搭在一旁']] },
    { g: 'onsen', zh: '夏日浴衣', s: [['wearing a light cotton yukata with a floral pattern, obi loosely tied', '穿着碎花棉质夏日浴衣，腰带松系'], ['yukata slipping off both shoulders, breasts exposed, obi still at her waist', '浴衣从双肩滑落，乳房裸露，腰带仍系在腰间'], ['nude, a floral yukata draped behind her', '全裸，碎花浴衣搭在身后']] },
    { g: 'onsen', zh: '白浴巾', s: [['wrapped in a white bath towel', '裹着一条白浴巾'], ['white towel slipping down, held loosely at her waist, topless', '白浴巾滑落，松松挡在腰间，上身赤裸'], ['nude, a white towel on the edge beside her', '全裸，白浴巾放在身旁边缘']] },
    { g: 'qipao', zh: '真丝旗袍', s: [['wearing a fitted red silk qipao with a high side slit', '穿着修身红色真丝高开衩旗袍'], ['red qipao unfastened at the collar and pulled open, breasts partially exposed', '红色旗袍领口盘扣解开、前襟拉开，乳房半露'], ['nude, a red silk qipao folded over a chair', '全裸，红色真丝旗袍搭在椅背上']] },
    { g: 'qipao', zh: '墨绿丝绒旗袍', s: [['wearing a dark green velvet qipao with gold embroidery', '穿着金线刺绣墨绿丝绒旗袍'], ['green velvet qipao slipping off her shoulders, topless', '墨绿丝绒旗袍滑下肩膀，上身赤裸'], ['nude, a green velvet qipao pooled at her feet', '全裸，墨绿旗袍堆在脚边']] },
    { g: 'hanfu', zh: '轻纱汉服', s: [['wearing a flowing pale pink hanfu with layered chiffon sleeves', '穿着飘逸的淡粉色层叠纱袖汉服'], ['hanfu outer robe open and falling from her shoulders, breasts bare', '汉服外袍敞开从肩头滑落，胸部裸露'], ['nude, a pale chiffon hanfu sash wound loosely around one arm', '全裸，一条淡色纱带松松缠在手臂上']] },
    { g: 'formal', zh: '黑色晚礼服', s: [['wearing a backless black satin evening gown', '穿着露背黑色缎面晚礼服'], ['black evening gown slipped down to her waist, topless', '黑色晚礼服褪到腰间，上身赤裸'], ['nude, a black satin gown pooled around her ankles', '全裸，黑色缎面礼服堆在脚踝']] },
    { g: 'formal', zh: '红色吊带裙', s: [['wearing a short red satin slip dress and heels', '穿着红色缎面短吊带裙和高跟鞋'], ['red slip dress pulled down, one breast exposed', '红色吊带裙拉下，露出一侧乳房'], ['nude except for high heels', '全裸，只穿高跟鞋']] },
    { g: 'office', zh: '白衬衫铅笔裙', s: [['wearing a tailored white blouse, black pencil skirt and sheer black stockings', '穿着修身白衬衫、黑色铅笔裙和黑丝'], ['white blouse unbuttoned, black lace bra showing, skirt hiked up to her thighs', '白衬衫解开露出黑色蕾丝胸罩，裙子撩到大腿'], ['nude except for black stockings, blouse and skirt on the floor', '全裸只留黑丝，衬衫和裙子落在地上']] },
    { g: 'office', zh: '西装外套', s: [['wearing only an oversized black blazer, bare legs', '只穿一件宽大的黑色西装外套，露出双腿'], ['open black blazer with nothing underneath, breasts partially visible', '黑色西装敞开，里面什么都没穿，胸部若隐若现'], ['nude, a black blazer draped over the chair', '全裸，黑西装搭在椅背上']] },
    { g: 'sport', zh: '运动内衣套装', s: [['wearing a fitted sports bra and high-waisted leggings', '穿着贴身运动内衣和高腰紧身裤'], ['sports bra pulled up, topless, leggings low on her hips', '运动内衣撩起，上身赤裸，紧身裤低至胯部'], ['nude, workout clothes tossed on the floor, skin glistening with sweat', '全裸，运动服丢在地上，皮肤沁着汗']] },
  ];
  const NUDE_ONLY = { zh: '无', s: [null, null, ['completely nude', '全裸']] };

  const ETH = [['Chinese', '中国'], ['Japanese', '日本'], ['Korean', '韩国'], ['Taiwanese', '台湾'], ['East Asian', '东亚']];
  const BODY = [['slender figure', '身材纤长'], ['curvy hourglass figure', '沙漏型曲线身材'], ['athletic toned body', '健美紧致'], ['soft full figure', '丰腴柔软'], ['tall model figure', '高挑模特身材'], ['full breasts and narrow waist', '胸部饱满、腰身纤细']];
  const HAIR = [['long straight black hair', '黑长直发'], ['long wavy dark brown hair', '深棕色长卷发'], ['shoulder-length bob', '及肩短发'], ['messy low bun with loose strands', '松散低盘发，碎发垂落'], ['high ponytail', '高马尾'], ['wet hair slicked back', '湿发向后梳'], ['long hair with soft bangs', '带空气刘海的长发'], ['side-swept honey brown hair', '侧分蜜棕色长发']];
  const MAKE = [['natural dewy makeup', '自然水光妆'], ['red lipstick and winged eyeliner', '红唇和上扬眼线'], ['soft peach blush and glossy lips', '蜜桃腮红和水润唇'], ['smoky eyes and nude lips', '烟熏眼妆和裸色唇'], ['minimal makeup, freckles visible', '淡妆，看得见雀斑'], ['rosy cheeks and a beauty mark under her eye', '红润脸颊，眼下一颗泪痣']];
  const EXP = [['gentle smile, looking at the viewer', '温柔微笑，看向镜头'], ['seductive half-lidded gaze', '半垂眼帘的诱惑眼神'], ['shy expression, eyes looking away', '害羞的表情，眼神移开'], ['lips slightly parted, dreamy eyes', '嘴唇微张，眼神迷离'], ['confident smirk', '自信的浅笑'], ['eyes closed, serene', '闭着眼，神情安宁'], ['playful laugh', '俏皮地笑'], ['biting her lower lip', '轻咬下唇']];
  const LIGHT = [
    ['soft morning window light', '柔和的清晨窗光', 'in'], ['warm golden hour sunlight', '温暖的黄金时刻阳光', 'out'], ['diffused overcast daylight', '阴天柔和的散射光', 'out'],
    ['warm candlelight with deep shadows', '温暖的烛光和深沉阴影', 'in'], ['neon pink and blue light', '粉蓝霓虹光', 'any'], ['dramatic side lighting, Rembrandt style', '伦勃朗式戏剧侧光', 'in'],
    ['backlit rim light outlining her body', '逆光勾勒身体轮廓', 'any'], ['dappled sunlight through leaves', '透过树叶的斑驳阳光', 'out'], ['moody low-key lighting', '低调暗光氛围', 'in'],
    ['soft studio softbox lighting', '柔光箱棚拍光', 'in'], ['moonlight and cool blue tones', '月光与冷蓝色调', 'any'], ['warm lamp light, intimate atmosphere', '暖色灯光，私密氛围', 'in'],
  ];
  const COMP = [
    ['full-body shot, eye level', '全身，平视', '2:3'], ['medium shot, waist up', '中景，腰部以上', '3:4'], ['close-up portrait, shallow depth of field', '特写人像，浅景深', '4:5'],
    ['low angle full-body shot', '低角度仰拍全身', '9:16'], ['high angle shot from above', '高角度俯拍', '3:4'], ['three-quarter view, 85mm lens', '四分之三侧，85mm 镜头', '2:3'],
    ['wide environmental shot showing the whole scene', '广角环境人像，展现整个场景', '16:9'], ['shot from behind, looking back', '背后视角，回眸', '2:3'], ['cinematic widescreen composition', '电影宽银幕构图', '21:9'],
  ];
  const STYLE = [
    ['shot on Kodak Portra 400, soft film grain', '柯达 Portra 400 胶片质感，柔和颗粒'], ['Fujifilm Pro 400H, pastel tones', '富士 Pro 400H，粉彩色调'], ['high-end editorial boudoir photography', '高级杂志私房摄影'],
    ['cinematic still, anamorphic lens flare', '电影剧照感，变形宽银幕光晕'], ['Japanese gravure photography style', '日式写真集风格'], ['black and white fine art nude photography', '黑白艺术人体摄影'],
    ['natural candid photography, 35mm', '自然抓拍，35mm'], ['luxury fashion campaign, sharp detail', '奢侈品大片质感，细节锐利'],
  ];

  // ---------- 生成 ----------
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const hit = (tags, g) => g.split(' ').some(x => tags.split(' ').includes(x));
  const ADULT_NEG = 'child, teen, underage, young-looking, school uniform, loli, deformed, extra fingers, bad anatomy, watermark, text';

  /** 生成第 i 条（同一 i 永远得到同一条，收藏和链接稳定） */
  function make(i) {
    const r = rng(0x9e3779b1 ^ (i * 2654435761));
    const sc = S[Math.floor(r() * S.length)];
    // 裸露：全裸 40% / 半裸 40% / 着装 20%；只允许裸体的场景直接全裸
    const roll = r(); let nud = roll < .4 ? 2 : roll < .8 ? 1 : 0;
    let outs = O.filter(o => hit(sc.o, o.g)); let o;
    if (!outs.length || sc.o === 'nude') { o = NUDE_ONLY; nud = 2; } else o = pick(r, outs);
    const poses = P.filter(p => hit(sc.p, p[2])); const po = pick(r, poses.length ? poses : P);
    const lights = LIGHT.filter(l => l[2] === 'any' || l[2] === sc.io); const li = pick(r, lights);
    const eth = pick(r, ETH), age = 22 + Math.floor(r() * 13), body = pick(r, BODY), hair = pick(r, HAIR), mk = pick(r, MAKE), ex = pick(r, EXP), co = pick(r, COMP), sty = pick(r, STYLE);
    const os = o.s[nud];
    const en = `A ${age}-year-old adult ${eth[0]} woman, ${body[0]}, ${hair[0]}, ${mk[0]}, ${os[0]}, ${po[0]}, ${ex[0]}. Setting: ${sc.en}. Lighting: ${li[0]}. ${co[0][0].toUpperCase() + co[0].slice(1)}, ${sty[0]}, photorealistic, detailed natural skin texture, sharp focus.`;
    const zh = `${age}岁的成年${eth[1]}女性，${body[1]}，${hair[1]}，${mk[1]}，${os[1]}，${po[1]}，${ex[1]}。场景：${sc.zd}。光线：${li[1]}。${co[1]}，${sty[1]}，真实摄影质感，皮肤纹理自然细腻，对焦清晰。`;
    const title = `${sc.zh} · ${o.zh === '无' ? '全裸' : o.zh} · ${po[1].split('，')[0]}`;
    const pts = [sc.zh, o.zh === '无' ? '' : o.zh, po[1].split('，')[0], li[1].split('，')[0], co[1].split('，')[0], hair[1].split('，')[0]].filter(Boolean);
    return { en, zh, title, nud, ratio: co[2], cat: sc.c, pts, neg: ADULT_NEG };
  }
  const CATS = [...new Set(S.map(s => s.c))];
  export const ASGEN = { make, CATS, COUNT: 2400, NEG: ADULT_NEG };
