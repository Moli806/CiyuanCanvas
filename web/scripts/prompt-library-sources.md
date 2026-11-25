# 画布提示词来源

词元画布沿用 Infinite Canvas 的 7 个默认图片提示词来源。本次目录对应注册库提交 `e9b9473cfeb32b75109a486b9915b151558dfc5b`，共 1,747 条。登记库发布 JSON 给下游应用读取，其 NOTICE 说明提示词、图片和作者署名沿用各自来源的权利声明。[上游画布的默认来源](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/services/api/prompt-source-presets.ts) · [登记库使用说明](https://github.com/yukkcat/image-prompts/blob/e9b9473cfeb32b75109a486b9915b151558dfc5b/README.md) · [数据声明](https://github.com/yukkcat/image-prompts/blob/e9b9473cfeb32b75109a486b9915b151558dfc5b/NOTICE.md)

| 来源 | 条数 | 正文与出处 |
| --- | ---: | --- |
| Banana Prompt Quicker | 323 | 按需读取登记库正文。项目欢迎第三方网站注明来源引用提示词 JSON。每条链接定位原始 JSON 中的标题，来自项目仓库的图片使用固定提交地址。[说明](https://github.com/glidea/banana-prompt-quicker/blob/93c7997d11ad95b2280c0137adfc336850a501ca/README.md#注意) |
| DavidWu GPT Image 2 Prompts | 494 | 按需读取。条目保留原作者署名，原始 JSON 提供列出作品、作者和收集来源的位置。[原集说明](https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts/blob/228edb6341d978aa2572911adf7e7e147ebf95d3/README.md) |
| Freestylefly GPT Image 2 | 546 | 按需读取。编者说明集合用途为学习与研究，涉及第三方作品的商用需联系原权利人。[版权说明](https://github.com/freestylefly/awesome-gpt-image-2/blob/0999cbfa1f860086db384602ee5ee5485671cb58/README.md) |
| Awesome GPT Image | 53 | 按需读取。README 标有 CC BY 4.0，并说明内容收集自互联网。仓库 LICENSE 标有 MIT。每条可回到原作或固定登记记录。[README](https://github.com/ZeroLu/awesome-gpt-image/blob/1204297b10b9f988e8340fc77d56393fb68cade6/README.md) · [LICENSE](https://github.com/ZeroLu/awesome-gpt-image/blob/1204297b10b9f988e8340fc77d56393fb68cade6/LICENSE) |
| Awesome GPT-4o Image Prompts | 76 | 本站保存提示词正文、作者和来源链接。项目明确将提示词集合以 MIT 许可发布。原许可全文随静态目录分发为 `LICENSE-ImgEdify.txt`，预览及参考图使用原集合的 `cdn.imgedify.com` 地址。[许可范围与贡献者](https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts/blob/d45df616410164a464990081ca0050dd293913c2/README.md#-license) · [许可全文](https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts/blob/d45df616410164a464990081ca0050dd293913c2/LICENSE) |
| YouMind GPT Image 2 | 126 | 按需读取。集合标注 CC BY 4.0，并说明提示词来自社区、供教育使用。条目保留作者和原帖链接。[来源及声明](https://github.com/YouMind-OpenLab/awesome-gpt-image-2/blob/fececc23760e292ade3f338228e32b1da5aa20ef/README.md) |
| YouMind Nano Banana Pro | 129 | 按需读取。集合标注 CC BY 4.0，并说明提示词来自社区、供教育使用。条目保留作者和原帖链接。[来源及声明](https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/blob/b29418d4b2386eab4a6b5901c4fe3dfd13aa21df/README.md) |

## 本地重建

在画布仓库根目录运行 `python3 -B web/scripts/sync-prompt-library.py`。脚本读取固定提交和原始 JSON，校验登记清单、各来源文件和许可文本的 SHA-256，再生成 `web/public/prompt-library/manifest.json` 及每个来源的索引。`python3 -B web/scripts/sync-prompt-library.py --check` 将固定来源重新生成的字节与现存文件逐一对照。升级登记库版本时，更新脚本中的提交和清单哈希，再核对上表的来源和署名约定。

索引中的 `id` 沿用登记库原值。`sourceMode=remote` 的条目通过所属来源的 `nativeUrl` 和 `sha256` 找到经核对的原始 JSON，再按 `id` 读取正文。`sourceMode=local` 的正文在同源索引中。`sourceUrl` 指向原作者或集合，`entryUrl` 在集合只给首页时进一步定位到具体记录。展示媒体使用上表记录的原站 HTTPS 链接。

Banana 的《阿凡达合照》在上游 JSON 中将文件名写作 `afadan`。目录使用该提交内实际存在的 `images/afanda.png` 和 `images/afanda_ref1.jpg`。
