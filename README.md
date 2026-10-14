# TabLens

把识别得到的吉他六线谱变成可编辑、可跟练的乐谱。当前支持 TAB 编辑、节奏设置和播放跟随。

## 从 GitHub 克隆后

先安装 Python 依赖：`python -m pip install -r requirements.txt`。Windows 可双击 `启动TabLens.cmd`，也可运行 `python app/server.py --open-browser`；打开地址为 `http://127.0.0.1:8765`。Node.js 仅用于开发测试，测试前运行 `npm ci`。

公开仓库包含程序、提示词／实验代码和播放器实际使用的处理后吉他 WAV 采样。个人乐谱库、识别结果、歌曲图片/PDF/MP3、原始 AIFF 录音和实验输出不上传。克隆后首次打开空白乐谱，默认可用吉他采样播放；采样来源与处理方式见 `AUDIO_CREDITS.md`。切勿把 API 密钥放进代码或提交记录。

## 使用

启动后，在浏览器打开 `http://127.0.0.1:8765`。编辑、保存和播放都不需要 API 密钥；只有调用模型识别新谱图时才需要配置。

选择一个入口开始：

- **导入谱图**：选择 PNG、JPG、WebP 或 PDF。PDF 先选页；分析图片、勾选小节，再调用识图模型。
- **打开文件**：导入已保存的 `.tablens.json`，或外部 Agent 按 [读谱模板](AGENT_IMPORT_TEMPLATE.md)生成的 JSON。
- **新建**：从空白小节开始写谱，无须原图。

从谱图开始练习，可以按这四步走：

1. 在“导入谱图”中检查“原图定位 / 已识别 / 待补录”数量和橙色段落。整段漏定位时，用“补漏小节：在原图框选”逐段补入，再点击“作为新谱打开”。已定位但未识别的段落会保留为关联原图的空小节；多页谱可逐页识别并“追加到当前谱”。
2. 打开底部“校对提示”，逐项定位疑问；对照右侧原图，优先核对**弦号、品位、弹奏顺序和同时弹的组合**。修改后逐小节标记“已核对”。
3. 点击 TAB 下方的节奏符号设置时值。问号表示节奏待确认，需补齐后才能整谱播放。
4. 切到“练习”模式，以原谱为主视图、TAB 光标为辅助跟练；也可一键切到 TAB 优先。点击“播放”，按需设置变速、循环和节拍器，最后点击“保存”。

顶部标签可同时打开多首谱；点左侧文件夹图标展开文件栏，橙色圆点提示未保存修改。Ctrl+S 保存当前谱；关闭有修改的标签时，可选择保存、留在本机暂存或放弃修改。“保存”会将乐谱写入项目的 `乐谱库/`；“乐谱库”可重新打开保存的文件和本机自动暂存。“导出”则下载包含原图的 `.tablens.json`。当前自动识别主要面向清晰、水平、带下方符干的电脑排版六线 TAB；识别结果仍需人工核对，节奏及复杂技巧可在工作台补录。

具体的选音、编曲、扫弦、技巧、批量修改、保存与恢复操作见 [完整使用手册](docs/USER_GUIDE.md)。

## 开发验证

```text
npm ci
npm test
npm run test:public
npm run test:layout-pdf
npm run test:agent-import
npm run test:review
npm run test:ui
npm run test:playback
npm run test:techniques
npm run test:ornaments
npm run test:library
npm run test:practice
npm run test:sustain
npm run test:dynamics
npm run test:recognition
python -m unittest discover -s app/tests -p test_audio_preparation.py
python -m unittest discover -s app/tests -p test_recognition.py
python -m unittest discover -s app/tests -p test_pdf_import.py
```

`npm test`、`npm run test:public` 和 `npm run test:layout-pdf` 可在公开仓库的克隆环境运行；`test:public` 需要先启动本地服务和安装 Chrome。其他浏览器测试及部分 Python 识别测试使用未上传的 Duvet/Lullaby 谱图，仅适合放回相应测试素材后的开发环境。浏览器验证使用本机 Chrome，并要求本地服务已启动；这些测试不调用识别 API。

音色扩展入口：`app/web/playback.js` 的 `Player(update, instrument)` 接受可替换的发声函数。未来采样音源接收音高、开始时间、时长及音量，并返回停止函数；循环、节拍器和光标不需要随音源重写。

吉他音源来自 `Guitar.stereo.1644.1/1644stereo/` 的15份 `mf` 和15份 `pp` AIFF录音；原始录音不上传，播放器使用的转换产物随公开仓库提供，每份原始录音可含多个音高。`app/prepare_guitar.py` 使用 NumPy 自动分音、保留来源位置并导出118份中力度44.1kHz/16位/双声道 WAV到 `app/web/audio/guitar/`；`app/prepare_guitar_soft.py` 另外导出117份轻奏 WAV 到 `soft/`，一个原始音高无法可靠提取时回退到中力度采样。转换不改动原始文件，先去除录音中的直流偏移及超低频干扰（20–40Hz平滑过渡），避免干扰污染起音检测和音量归一化。提取时检查下一音高、再次拨弦及持续静音，初步保留最多10秒的实际尾音。上扫使用轻奏采样，并以较轻的中力度起音辅助，辅助层平滑衰减到下一次同弦触弦；下扫、单音及普通同时弹沿用中力度采样。轻奏音源缺失时自动回退，`ff` 力度层暂未接入。自动提取的起音、尾音及听感仍需人工试听；超出某根弦采样范围的音使用最近采样移调。

分音后还会按毫秒级短时能量对齐起音，裁掉前导噪声。前导段足够长时，用它估计底噪并做双声道联动的保守频谱降噪，起音前25毫秒保留原声并平滑过渡，不用硬门限切除尾音。没有可靠噪声参考时只对齐，不强行降噪。采样清单记录 `attackTrimMs` 和 `noiseReduced`；4弦2品此次裁掉约115毫秒前导声。五、六弦随后使用经试听确定的 C 版处理：校准采样响度、增强延音中的清晰音高，压低非谐波杂音，并在尾段平滑淡出；处理结果由 `app/bass_processing.py` 生成，原始 AIFF 不变。音源更新后需刷新页面，释放播放器内存中的旧采样。
