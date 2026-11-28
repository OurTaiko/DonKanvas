import { getIntroPath, getIntroURL, getPageMetadata, getPageURL, getApplicationMetadata, pageLocales } from './locales.js';

const content = {
  'zh-CN': {
    language: '简体中文',
    heading: '免费的在线 TJA 太鼓谱面编辑器',
    intro: '咚咔绘板是免费的在线 TJA 太鼓谱面编辑器，支持手机、平板和桌面。通过触控手势或键盘快捷键便捷制谱，无需安装，也无需上传谱面或音频。',
    open: '打开 TJA 编辑器',
    featuresTitle: '可视化太鼓谱面编辑',
    features: ['结合音频波形放置和调整音符，编辑 BPM、拍号和滚动速度。', '编排谱面分歧，管理难度以及单人、P1/P2 分谱。', '播放预览、撤销重做，并保存编辑后的 TJA 文件。'],
    interactionTitle: '手机、平板、桌面，随手高效制谱',
    interaction: ['响应式布局适配手机、平板和桌面浏览器，兼顾横屏与竖屏；触屏可直接点选音符，桌面可结合鼠标与键盘操作。', '左右滑动浏览时间轴；在音符网格长按后左右滑动，可逐步微调选中位置。点按波形定位，长按波形从该位置开始试听。', '选中位置后用 1–9 输入音符、A/D 前后移动选择，空格播放或暂停；Ctrl+S 保存、Ctrl+Z 撤销。macOS 文件和撤销等组合键也支持 Command。完整按键及适用条件见“设置 → 快捷键帮助”。'],
    stepsTitle: '如何在线编辑 TJA 文件',
    steps: ['打开编辑器，通过“文件”菜单新建歌曲或打开本地 TJA 文件，也可以拖入 TJA 文件。', '新建歌曲后创建难度谱面；按需载入伴奏，在音符编辑与小节源码中编排谱面。', '播放预览检查音符与伴奏的配合，再通过“保存”或“另存为”导出 TJA 文件。'],
    faqTitle: '常见问题',
    faq: [['是否免费，需要安装吗？', '咚咔绘板免费且开源，可直接在线使用。支持的浏览器也可将它安装为 PWA。'], ['谱面和音频会上传吗？', '默认不会，解析和编辑在浏览器本地完成。仅在你使用个人存储保存时，谱面直接上传到你授权的网盘，不经过 DonKanvas 服务器。音频不上传、不修改。'], ['可以离线使用吗？', '首次联网加载完成后可离线编辑。音频刷新后需要重新载入；请主动保存谱面，不要把本地草稿当作文件备份。']],
    languages: '其他语言',
    project: '开源项目'
  },
  en: {
    language: 'English',
    heading: 'Free online TJA editor for Taiko no Tatsujin charts',
    intro: 'DonKanvas is a free online TJA chart editor for Taiko no Tatsujin on phones, tablets and desktops. Create charts with convenient touch gestures or keyboard shortcuts, with no installation or file uploads required.',
    open: 'Open the TJA editor',
    featuresTitle: 'Visual Taiko chart editing',
    features: ['Place and adjust notes alongside audio waveforms, and edit BPM, meter and scroll speed.', 'Create chart branches and manage difficulties and single-player or P1/P2 charts.', 'Preview playback, undo and redo changes, and save edited TJA files.'],
    interactionTitle: 'Create comfortably on phones, tablets and desktops',
    interaction: ['Responsive layouts adapt to phone, tablet and desktop browsers in portrait and landscape. Select notes directly on touchscreens or work with a mouse and keyboard.', 'Swipe left or right to browse the timeline. Press and hold the note grid, then slide to adjust the selected position step by step. Tap the waveform to seek, or hold it to preview playback from that position.', 'With a position selected, use 1–9 to enter notes and A/D to move the selection; use Space for playback, Ctrl+S to save and Ctrl+Z to undo. File and undo shortcuts also support Command on macOS. See Settings → Keyboard shortcuts for the full list and usage conditions.'],
    stepsTitle: 'How to edit a TJA file online',
    steps: ['Open the editor and use the File menu to create a song or open a local TJA file. You can also drag in a TJA file.', 'Create a difficulty chart for a new song, load backing audio if needed, and arrange notes using visual editing and measure source.', 'Preview playback to check notes against the backing audio, then export the TJA file with Save or Save as.'],
    faqTitle: 'Frequently asked questions',
    faq: [['Is it free? Do I need to install it?', 'DonKanvas is free and open source. Use it online or install it as a PWA in supported browsers.'], ['Are my charts or audio uploaded?', 'Not by default: parsing and editing are local. When you save to personal storage, charts upload directly to your authorized provider, not through a DonKanvas server. Audio is never uploaded or modified.'], ['Can I work offline?', 'After the first complete online load, you can edit offline. Reload audio after refreshing, and explicitly save your charts: local drafts are not file backups.']],
    languages: 'Other languages',
    project: 'Open-source project'
  },
  ja: {
    language: '日本語',
    heading: '無料のオンライン TJA エディタ・太鼓の達人譜面作成',
    intro: 'ドンカッボードはスマートフォン・タブレット・デスクトップに対応した無料のオンライン TJA 太鼓譜面エディタです。タッチジェスチャーやキーボードショートカットで手軽に譜面を作成。インストールやファイルのアップロードは不要です。',
    open: 'TJA エディタを開く',
    featuresTitle: '太鼓譜面を視覚的に編集',
    features: ['音声波形を見ながら音符を配置・調整し、BPM・拍子・スクロール速度を編集できます。', '譜面分岐を作成し、難易度やシングル・P1/P2 の譜面を管理できます。', '再生プレビュー、元に戻す・やり直す操作、編集した TJA ファイルの保存に対応します。'],
    interactionTitle: 'スマートフォン・タブレット・デスクトップで快適に作成',
    interaction: ['縦画面・横画面に対応したレスポンシブなレイアウトで、スマートフォン、タブレット、デスクトップのブラウザーから利用できます。タッチで音符を選択したり、マウスとキーボードで編集したりできます。', '左右にスワイプしてタイムラインを移動。音符グリッドを長押ししてから左右にスライドすると、選択位置を少しずつ調整できます。波形をタップして移動し、長押しするとその位置から試聴できます。', '位置を選択した後、1–9 で音符を入力し、A/D で選択を前後に移動。Space で再生・一時停止、Ctrl+S で保存、Ctrl+Z で元に戻せます。macOS ではファイル操作や元に戻す操作に Command も使えます。全ショートカットと使用条件は「設定 → ショートカットヘルプ」で確認できます。'],
    stepsTitle: 'オンラインで TJA ファイルを編集する方法',
    steps: ['エディタのファイルメニューから曲を新規作成するか、ローカルの TJA ファイルを開きます。ドラッグして開くこともできます。', '新しい曲に難易度の譜面を作成し、必要に応じて音声を読み込み、音符編集と小節ソースで譜面を作ります。', '再生プレビューで音符と音声を確認し、保存または名前を付けて保存で TJA ファイルを書き出します。'],
    faqTitle: 'よくある質問',
    faq: [['無料ですか？インストールは必要ですか？', '無料のオープンソースアプリです。オンラインで利用でき、対応ブラウザーでは PWA としてインストールもできます。'], ['譜面や音声はアップロードされますか？', '通常はされません。解析と編集はブラウザー内で行います。個人ストレージに保存する場合のみ、譜面を許可したサービスに直接送信し、DonKanvas サーバーを経由しません。音声はアップロードも変更もしません。'], ['オフラインでも使えますか？', '初回のオンライン読み込み完了後はオフラインで編集できます。再読み込み後は音声を読み込み直してください。下書きはバックアップではないため、譜面を明示的に保存してください。']],
    languages: '他の言語',
    project: 'オープンソースプロジェクト'
  },
  'zh-TW': {
    language: '繁體中文',
    heading: '免費的線上 TJA 太鼓達人譜面編輯器',
    intro: '咚咔繪板是免費的線上 TJA 太鼓達人譜面編輯器，支援手機、平板和桌面。透過觸控手勢或鍵盤快捷鍵輕鬆製譜，無需安裝，也無需上傳譜面或音訊。',
    open: '開啟 TJA 編輯器',
    featuresTitle: '視覺化太鼓譜面編輯',
    features: ['結合音訊波形放置和調整音符，編輯 BPM、拍號和捲動速度。', '編排譜面分歧，管理難度以及單人、P1/P2 分譜。', '播放預覽、復原重做，並儲存編輯後的 TJA 檔案。'],
    interactionTitle: '手機、平板、桌面，隨手高效製譜',
    interaction: ['響應式版面適配手機、平板和桌面瀏覽器，兼顧橫向與直向畫面；觸控螢幕可直接點選音符，桌面可結合滑鼠與鍵盤操作。', '左右滑動瀏覽時間軸；在音符網格長按後左右滑動，可逐步微調選取位置。點按波形定位，長按波形從該位置開始試聽。', '選取位置後用 1–9 輸入音符、A/D 前後移動選取位置，空白鍵播放或暫停；Ctrl+S 儲存、Ctrl+Z 復原。macOS 檔案和復原等組合鍵也支援 Command。完整按鍵及適用條件見「設定 → 快捷鍵說明」。'],
    stepsTitle: '如何線上編輯 TJA 檔案',
    steps: ['開啟編輯器，透過檔案選單新增歌曲或開啟本機 TJA 檔案，也可以拖入 TJA 檔案。', '新增歌曲後建立難度譜面；按需載入伴奏，在音符編輯與小節原始碼中編排譜面。', '播放預覽檢查音符與伴奏的配合，再透過儲存或另存新檔匯出 TJA 檔案。'],
    faqTitle: '常見問題',
    faq: [['是否免費，需要安裝嗎？', '咚咔繪板免費且開源，可直接線上使用。支援的瀏覽器也可將它安裝為 PWA。'], ['譜面和音訊會上傳嗎？', '預設不會，解析和編輯在瀏覽器本機完成。僅在你使用個人儲存空間儲存時，譜面直接上傳到你授權的網盤，不經過 DonKanvas 伺服器。音訊不上傳、不修改。'], ['可以離線使用嗎？', '首次連線載入完成後可離線編輯。音訊重新整理後需要重新載入；請主動儲存譜面，不要把本機草稿當作檔案備份。']],
    languages: '其他語言',
    project: '開源專案'
  },
  ko: {
    language: '한국어',
    heading: '무료 온라인 TJA 편집기 · 태고의 달인 채보 제작',
    intro: '동캇보드는 스마트폰, 태블릿, 데스크톱을 지원하는 무료 온라인 TJA 태고의 달인 채보 편집기입니다. 터치 제스처와 키보드 단축키로 편리하게 채보를 만들 수 있으며, 설치나 파일 업로드가 필요 없습니다.',
    open: 'TJA 편집기 열기',
    featuresTitle: '시각적인 태고 채보 편집',
    features: ['오디오 파형을 보면서 음표를 배치하고 조정하며 BPM, 박자, 스크롤 속도를 편집하세요.', '채보 분기를 만들고 난이도와 싱글 플레이 또는 P1/P2 채보를 관리하세요.', '재생 미리보기, 실행 취소와 다시 실행을 사용하고 편집한 TJA 파일을 저장하세요.'],
    interactionTitle: '스마트폰, 태블릿, 데스크톱에서 편리하게 제작',
    interaction: ['반응형 레이아웃으로 스마트폰, 태블릿, 데스크톱 브라우저의 세로 및 가로 화면에 대응합니다. 터치로 음표를 선택하거나 마우스와 키보드로 편집하세요.', '좌우로 밀어 타임라인을 탐색하세요. 음표 그리드를 길게 누른 뒤 좌우로 밀면 선택 위치를 단계적으로 미세 조정할 수 있습니다. 파형을 탭하면 해당 위치로 이동하고 길게 누르면 그 위치부터 미리듣기를 시작합니다.', '위치를 선택한 뒤 1–9로 음표를 입력하고 A/D로 선택 위치를 이동하세요. Space는 재생 및 일시 정지, Ctrl+S는 저장, Ctrl+Z는 실행 취소입니다. macOS에서는 파일 작업과 실행 취소 등에 Command도 사용할 수 있습니다. 전체 단축키와 사용 조건은 설정 → 단축키 도움말에서 확인하세요.'],
    stepsTitle: '온라인에서 TJA 파일을 편집하는 방법',
    steps: ['편집기의 파일 메뉴에서 곡을 새로 만들거나 로컬 TJA 파일을 여세요. TJA 파일을 끌어다 놓을 수도 있습니다.', '새 곡의 난이도 채보를 만들고 필요한 경우 반주를 불러온 뒤 음표 편집과 마디 소스로 채보를 작성하세요.', '재생 미리보기로 음표와 반주를 확인한 뒤 저장 또는 다른 이름으로 저장으로 TJA 파일을 내보내세요.'],
    faqTitle: '자주 묻는 질문',
    faq: [['무료인가요? 설치해야 하나요?', '동캇보드는 무료 오픈 소스 앱입니다. 온라인으로 사용하거나 지원되는 브라우저에서 PWA로 설치할 수 있습니다.'], ['채보나 오디오가 업로드되나요?', '기본적으로 업로드하지 않으며 분석과 편집은 로컬에서 처리합니다. 개인 저장소에 저장할 때만 채보를 승인한 서비스로 직접 업로드하며 DonKanvas 서버를 거치지 않습니다. 오디오는 업로드하거나 수정하지 않습니다.'], ['오프라인에서도 사용할 수 있나요?', '처음 온라인으로 로딩을 완료한 뒤에는 오프라인 편집이 가능합니다. 새로고침 후에는 오디오를 다시 불러오세요. 로컬 초안은 파일 백업이 아니므로 채보를 직접 저장하세요.']],
    languages: '다른 언어',
    project: '오픈 소스 프로젝트'
  }
};

function escapeHTML(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function renderIntroPage(code) {
  const page = content[code], metadata = getPageMetadata(code), url = getIntroURL(code);
  const editor = code === 'zh-CN' ? './' : `index.${code}.html`;
  const alternates = [...Object.keys(pageLocales), 'x-default'].map(language =>
    `<link rel="alternate" hreflang="${language}" href="${getIntroURL(language === 'x-default' ? 'zh-CN' : language)}">`).join('\n');
  const links = Object.entries(content).map(([language, translation]) =>
    `<a href="./${getIntroPath(language)}" lang="${language}" hreflang="${language}"${language === code ? ' aria-current="page"' : ''}>${translation.language}</a>`).join(' ');
  const list = items => items.map(item => `<li>${escapeHTML(item)}</li>`).join('\n');
  return `<!doctype html>
<html lang="${code}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(page.heading)} - ${escapeHTML(metadata.displayName)}</title>
<meta name="description" content="${escapeHTML(page.intro)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
${alternates}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHTML(metadata.name)}">
<meta property="og:locale" content="${pageLocales[code]}">
<meta property="og:title" content="${escapeHTML(page.heading)} - ${escapeHTML(metadata.displayName)}">
<meta property="og:description" content="${escapeHTML(page.intro)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${getPageURL('zh-CN')}icons/icon-512.png">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHTML(page.heading)} - ${escapeHTML(metadata.displayName)}">
<meta name="twitter:description" content="${escapeHTML(page.intro)}">
<meta name="twitter:image" content="${getPageURL('zh-CN')}icons/icon-512.png">
<link rel="icon" type="image/png" href="./icons/icon-192.png">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'WebPage', name: page.heading, url, inLanguage: code,
    description: page.intro, about: { '@type': 'WebApplication', ...getApplicationMetadata(code),
      applicationCategory: 'MultimediaApplication', operatingSystem: 'Web', isAccessibleForFree: true }
  }).replaceAll('<', '\\u003c')}</script>
<style>
:root{font-family:system-ui,sans-serif;color:#202a28;background:#f5f7f4;line-height:1.8}
*{box-sizing:border-box}body{margin:0}main{max-width:900px;margin:auto;padding:32px 24px 56px}
h1{font-size:clamp(1.7rem,4vw,2.5rem);line-height:1.3}h2{font-size:1.4rem}h3{font-size:1.05rem}
section{margin-top:32px}li{margin:8px 0}a{color:#12634e;text-underline-offset:3px}
a:focus-visible{outline:2px solid #16745b;outline-offset:4px}
.start{display:inline-block;padding:10px 20px;background:#16745b;color:white;border-radius:6px;text-decoration:none}
nav{display:flex;flex-wrap:wrap;gap:8px 20px}nav a[aria-current]{font-weight:bold}
</style>
</head>
<body>
<main>
<header><p>${escapeHTML(metadata.displayName)}</p><h1>${escapeHTML(page.heading)}</h1><p>${escapeHTML(page.intro)}</p><a class="start" href="${editor}">${escapeHTML(page.open)}</a></header>
<section id="devices-and-controls"><h2>${escapeHTML(page.interactionTitle)}</h2>${page.interaction.map(paragraph => `<p>${escapeHTML(paragraph)}</p>`).join('\n')}</section>
<section><h2>${escapeHTML(page.featuresTitle)}</h2><ul>${list(page.features)}</ul></section>
<section><h2>${escapeHTML(page.stepsTitle)}</h2><ol>${list(page.steps)}</ol></section>
<section><h2>${escapeHTML(page.faqTitle)}</h2>${page.faq.map(([question, answer]) => `<h3>${escapeHTML(question)}</h3><p>${escapeHTML(answer)}</p>`).join('\n')}</section>
<section><h2>${escapeHTML(page.languages)}</h2><nav aria-label="${escapeHTML(page.languages)}">${links}</nav></section>
<footer><p><a href="${editor}">${escapeHTML(page.open)}</a> · <a href="https://github.com/OurTaiko/DonKanvas">${escapeHTML(page.project)}</a></p><small>MIT · © 2026 Dafrok</small></footer>
</main>
</body>
</html>`;
}

export function renderSitemap() {
  const urls = Object.keys(pageLocales).flatMap(code => [getPageURL(code), getIntroURL(code)]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `<url><loc>${escapeHTML(url)}</loc></url>`).join('\n')}
</urlset>`;
}
