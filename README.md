# 别慌,三十比二 · CPR 按压记录线

一支 27.7 秒、1920×1080 / 30fps 的动态信息设计短片,配任务提供的口播原音。

**构思**:原音的重拍实测是 108 BPM——正好落在"每分钟 100–120 次"里。于是这首歌本身就是按压节拍:一支红色按压笔每拍压下 5–6 cm 再回弹,在向左流走的记录带上画出整段心肺复苏的深度曲线。速率尺的 100–120 区间旋转成深度尺的 5–6 cm 区间;镜头随回弹上仰;第 21–22 拍"靠着没起来"被红色斜线标出;计数翻到 30 后线向上鼓起两次(呼吸),组成 30 : 2;中断计时括号走到 6.7 s,离 10 s 的红墙还远;最后镜头拉远,整条记录就是一张操作海报。分镜与转场见 [TREATMENT.md](TREATMENT.md)。

## 技术
- `src/scene.js`:Canvas 2D 逐帧绘制,每帧只由时间决定(整数哈希代替随机数)。按压波形是一个确定的函数 `depth(t)`(预备上提 → 加速压下 → 到底顿挫 → 回弹轻微超调),记录线按屏幕像素密度采样;镜头是关键帧 + 各段自选缓动(五次方、弹簧、指数);常规 6 子帧、快速运动段 12 子帧累积运动模糊;颗粒与暗角在合成层。
- 节拍:用频谱通量 + ffmpeg astats 能量包络测出重拍 B(k) = 0.536 + k·60/108 s;逐字时刻按字幕区间等分后吸附到最近的能量峰(见 `RUNS` 的 `times`)。
- `init()` 校验画面上的字与 `subtitles.srt` 逐字(含标点)一致,且每段都在自己的字幕时间内登场。
- `render.mjs`:本地 http 服务 → puppeteer-core 驱动本机 Chrome 逐帧截 PNG → 流式写入 FFmpeg(H.264 yuv420p, CRF 16),同时从 0 秒原样混入 `original.mp3`(AAC)。

## 重新渲染
需要 Node 18+、FFmpeg、本机 Google Chrome(或设 `PUPPETEER_EXECUTABLE_PATH`),并把原音放在根目录 `original.mp3`(原音不随仓库分发)。
```bash
npm ci
node render.mjs            # 输出 ./op55-hd.mp4(本机约 1 分钟)
node render.mjs --qa       # 确定性检查 + 关键帧联系表 out/qa/sheet.png
node render.mjs --serve    # 浏览器预览(无声)
```

## 素材与许可
- 字体:思源黑体 Noto Sans SC(npm `@fontsource/noto-sans-sc`)、Inter(npm `@fontsource-variable/inter`),均为 SIL Open Font License 1.1,许可证见 `fonts/`。
- 画面全部由代码生成,无外部图片;不含额外音乐,声音只有任务提供的原音。
