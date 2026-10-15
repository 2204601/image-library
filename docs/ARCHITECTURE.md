# 構成の方針：共通基盤と種類ごとの機能

画像・ファイルは「探して使う」、フォントは「比べて選ぶ」と使う場面が違う。そこでモードを **［ストック｜フォント］** に分け、
フォルダ・タグ・スマートフォルダも **モードごとに別々に持つ**（docs/MODES.md）。画像とファイルはストックの中で種類の絞り込みで見る。
フォントを別アプリに切り出す案は保留中で、そうなっても困らないように、
**共通基盤（core）** と **種類ごとの機能（features）** の境界を明確にしておく。

## モード

- `store.ts` の `mode`（`"stock" | "font"`、型は `lib/api.ts`、`MODES` は `lib/modes.ts`）。項目のモードは種類で決まる
  （`modeOf`：フォントはフォント、ほかはストック。Rust は `db::Mode::of`）。
  サイドバー上部の切替、⌘1 ストック / ⌘2 フォント（`MODES` の順）。
  ライブラリの切り替えは頻度が低いのでサイドバーの一番下（`LibrarySwitcher`）
- **モードごとのデータ**：`folders` / `tags` / `smart_folders` の `mode` 列（`db.rs`）。一覧は `list_folders(mode)` などで
  そのモードのものだけを取る。
  - フォルダにはそのモードの項目しか入らない（`move_to_folder` / `file_unfiled` がほかを無視する）。サブフォルダは親のモード、
    並び順はモードごとの最上位で別々（`sibling_ids`）。別のモードのフォルダの下へは移せない（`place_folder`）
  - タグは名前と `mode` で 1 つ（`UNIQUE (name, mode)`）。`add_tags` は項目ごとにそのモードのタグを付ける（無ければ作る）ので、
    画像とフォントを一緒に選んで同じ名前を付けると、両方のモードに同じ名前のタグができる
  - スマートフォルダは作ったモードのもの。件数・中身はそのモードの項目の中だけで数える
  - 取り込み・ライブラリ間のコピー・ブラウザ拡張（ストックのフォルダとタグだけを見せる）・MCP も、項目のモードのフォルダとタグを使う。
    フォルダへドロップしたときにほかのモードの項目が混ざっていたら、それは未分類のまま入る（取り込み後に `notifyOtherMode` で知らせる）
  - 分ける前のライブラリは、開いたときに移行する（step 21。`split_modes`）。その前に `library.before-modes.db` へ複製を残す
    （`back_up_before_modes`）
- **種類の絞り込み**：ストックでは、ツールバー 2 段目のチップ（`Toolbar.tsx` の `KindFilter`、`KINDS` のうちストックの種類から作る）で
  `filter.kinds` を選ぶ。クリックでその種類だけ、⌘クリックで足す・外す。ほかの条件と違い、表示（フォルダ・タグなど）を
  移っても残る（モードの代わり）。絞り込みの件数バッジには数えない
- 一覧が持ちうる種類は `listKinds`（`lib/modes.ts`、状態を受け取る純粋関数）の 1 か所で決める：モードの種類（使う種類のうちそのモードのもの、
  `kindsOfMode`）を種類の絞り込みで狭め、開いているスマートフォルダの条件と重複の候補（画像だけ）でさらに狭める。
  問い合わせの `filter.kinds` は `queryKinds`（全種類なら空。ストックとフォントはどちらも全種類にはならない）
- 画像だけの機能は、一覧が画像だけのとき（`listIs(s, "image")`）に出す：縦横・画像サイズの絞り込み、画像サイズの並び替え。
  ほかの種類が混ざったら、これらの条件と並び順を外す（`fitToKinds`）。重複の候補は、画像を使うライブラリのストックに出し、
  種類の絞り込みにかかわらず画像だけを問い合わせる。回転などの `kinds` 付きの操作は `appliesTo`（`commands.ts`）で、
  一覧がその種類だけなら使え、混ざっていれば選択がその種類だけのときに使える
- **ライブラリごとに記憶する**：ライブラリは最後に開いていたモードで開く（`library.db` の `settings` テーブルの `lastMode`。
  無ければフォントがほかの種類より多いときだけフォント、ほかはストック。`lib/librarySettings.ts` の `openingMode`）。
  ライブラリごとに「使う種類」（`modes`）を選べ、使う種類のあるモードだけが切り替えに出る（`modesFor`）。docs/SETTINGS.md
  - 前の版の `lastMode: "all"` と `hidden:all` はストックのものとして読む。画像・ファイルのモードがあった版の `lastMode: "image"` などは、
    ストックをその種類に絞って開く。サイドバーで隠した項目は `hidden:stock`、`hidden:all`、`hidden:image` / `hidden:file` の順に引き継ぐ
    （`parseLibrarySettings`。アプリ全体の設定は `parseSidebarHidden`）
- 件数（`get_counts`）、絞り込みバーの形式一覧（`list_exts`）は `mode` 引数でそのモードの項目だけを数える（`db.rs` の `mode_where`）。
  種類の絞り込みでは変えない
  - `Counts.kinds` だけは常に全種類の件数（モード切替のバッジ用）
- レイアウトとグループ分けはモードごとに保存する（`layout:<mode>`, `groupBy:<mode>`。ストックは `layout:all`、以前の画像モードのものを引き継ぐ）。
  使える組み合わせは `MODE_LAYOUTS` / `MODE_GROUPS`（`store.ts`）。ストックは標準・Pinterest 風・グリッド・リストで、
  ツールバーには画像が入りうるなら標準と Pinterest 風、ファイルだけならグリッドとリストを出す。グループ分けに「種類」がある。
  フォントは見本・グリッドで、グループ分けは書体・言語など。一覧は常に 1 ファミリー 1 行（`groupItems` の `families`、代表の行の
  `familyIds` が全スタイル）で、見本では ▸ で開いたファミリー（`openFamilies`）の太さ違いを行の下に出す（`familyMember`）。
  行が表す ID は `rowIds` で取る（選択・範囲選択・見出しのクリック）。docs/FONT_UI.md
- **シェルフ**（`components/Shelf.tsx`、`store.shelf`）：一覧の下のトレイ。中身は `tray` テーブルを、モードの種類で問い合わせる
  （`refresh` で一覧と一緒に取る）ので、モードごとに別のシェルフになる。一覧として開く表示ではなく、`View` の `tray` はこの問い合わせにだけ使う。
  フォントモードは `FONT_SHELF_MAX`（8）件までで、比較ビュー（`features/fonts/CompareView.tsx`、`store.comparing`）を一覧の場所に出す。
  ファミリーの行をシェルフに置くと代表の 1 件になる（`shelfIds`）
- スマートフォルダの `filter.kinds` はほかと同じ条件（ストックの種類のチップで選んだもの）。フォントモードで作ったものは `kinds` が空。
  条件を編集するときは、`kinds` を種類のチップに読み込む

種類を増やすとき（例：ブックマーク・動画）：`ItemKind` と `KINDS`（`lib/api.ts`）、`features/<kind>/` を足し、`modeOf` と
`db::Mode::of` でどのモードのものかを決める。チップと「使う種類」は `KINDS` から作られる。見え方が根本的に違うならモードにする
（`Mode`、`MODES`、`MODE_LAYOUTS` / `MODE_GROUPS`、サイドバーの `ModeSwitch`、`db.rs` の `Mode` と移行）。

## コマンド

アプリの操作は `src/lib/commands.ts` の `COMMANDS` に 1 つずつ定義する（id・名前・状態に応じた表示名・キー・使える種類・
使えるか・チェック・実行）。次はすべてこの表から作るので、操作を足すときはまずここに足す（docs/MENUS.md）。

- 一覧のキー処理（`Grid.tsx` → `runKey`）。一覧の中だけの移動・評価の数字・Space / Enter は `Grid.tsx` に残す
  - ダイアログ・メニュー・パネルなど一覧の上に重なるものは、外枠に `data-modal` を付ける。それがある間、一覧のキー処理は何もしない（重複の確認中の Delete で後ろの選択がゴミ箱に入らないように）
  - 入力欄のキー処理は `lib/ime.ts` の `composing` で日本語入力の変換中を除く（macOS では確定の Enter で `isComposing` がもう false のため）
- メニューバー（`lib/menuBar.ts`）。⌘ 付きのキーはアクセラレータ、1 文字のキーは表示だけ
- 右クリックメニューの行（`lib/menuItems.ts` の `commandItem` / `commandIcon`）
- ショートカット一覧（`lib/shortcuts.ts` の `shortcutSections`）。マウス操作やビューアだけのキーは説明の行として持つ

「一覧の中身への操作」（書き出し・まとめて出力・シェルフにすべて追加・別のライブラリへ）は、対象を `ListSource`
（選択・表示中の一覧・フォルダ・スマートフォルダ・タグ・シェルフ）で受け、中身は `listTargets`（`lib/actions.ts`）で取る。

## 境界

| 層 | 場所 | 中身 |
|---|---|---|
| 共通基盤（core） | `src/lib/*`, `src/store.ts`, `src/components/*` | ライブラリ・DB・取り込み・フォルダ・タグ・スマートフォルダ・検索・一覧の骨組み（Grid / Sidebar / Toolbar / Inspector / Viewer）・Updater |
| | `src-tauri/src/{db,import,library,search,webimport,share,loopback,changes,proxy,transfer,commands}.rs` | スキーマ・クエリ、取り込み、受付サーバー、フォルダの共有、変更の記録と取り消し、ライブラリ間のコピー・移動、共通コマンド |
| | `src-tauri/src/mcp/` | Claude からの整理（MCP サーバー、`--mcp` の中継）。`docs/MCP.md` |
| フォント | `src/features/fonts/` | フォント専用コマンドのラッパ（`api.ts`）、フォントの読み込み（`loader.ts`）、見本の行とグリッドのタイル（`FontRows.tsx`）、ビューア（`FontView.tsx`）、詳細パネルの行（`FontDetails.tsx`）、サイドバーの言語・書体（`FontFilters.tsx`）、見本の文字の行と大きさ（`SpecimenControls.tsx`）、見本のパターン（`patterns.ts`）、比較ビュー（`CompareView.tsx`）、シェルフの行（`ShelfChip.tsx`）、ウェイト名（`weights.ts`） |
| | `src-tauri/src/fonts/` | パース・分類・見本の描画（`mod.rs`）、フォント専用コマンド（`commands.rs`） |
| ファイル | `src/features/files/` | ビューア（`FileView.tsx`：PDF は `<iframe>`、ほかはサムネイルと「既定のアプリで開く」） |
| | `src-tauri/src/files/` | 対応する拡張子、サムネイル（Quick Look／Windows.Data.Pdf（`win_pdf.rs`）／中のプレビュー／種類のカード） |
| 画像 | `src-tauri/src/{formats,orient,similar}.rs`、`components/DuplicateReview.tsx` ほか | デコード、回転・反転、似ている画像の検出（まだ `components/` に混ざっている） |

依存の向きは **features → core** のみ。core が種類ごとの知識を持つのは、DB に入っている語彙（`ItemKind`、`FONT_SCRIPTS` /
`FONT_CATEGORIES` のラベル、`Item` のフォント列、`Filter.fontScripts` など）までにとどめ、振る舞いは features に置く。

共通の UI（`Grid.tsx` / `Sidebar.tsx` / `Shelf.tsx` / `App.tsx`）が features の部品を描く箇所（見本の行、言語・書体の節、シェルフの行、比較ビュー）では、
features 側が core の部品（`Row` / `Section`、`CellProps` / `showItemMenu`）を使うので import が循環する。
いずれも描画時にしか参照しないので問題ないが、core 側の部品を独立したファイルに出せばほどける。

## 外から来るファイルとセキュリティ

取り込むファイルはどこから来たか分からない（ブラウザ拡張で Web から保存したものも入る）ものとして扱う。

- 大きさはファイルに書かれた値をそのまま信じず、上限を設けて読む（WOFF / WOFF2・zip の中のプレビュー・WIC のデコード）。
  リリースビルドは `panic = "abort"` なので、確保の失敗やパニックはアプリごと落ちる
- SVG の `<image href>` は `data:` URL だけを読む（`formats::svg_options`）。PDF は中身を確かめてから iframe に出す（`files::is_pdf`）
- Windows のバックグラウンドの Office 変換は、Web から保存したもの（`source_url` あり）を対象にしない
- フォルダの共有（`share.rs`）だけは LAN から届く。GET だけで、どの要求も共有したフォルダの中のものかを確かめてから返す。
  ファイルは `Content-Security-Policy: sandbox` 付きで返し（SVG の中のスクリプトを動かさない）、ページの文字はすべて `textContent` で入れる
- Web ビューの CSP は `tauri.conf.json` の `security.csp`。外のリソースを読み込む機能を足すときは、ここにも足す
  （開発時は `devCsp`）

## 今後

- 画像だけの機能（重複の候補・回転）も `features/images/` に寄せる
- システムフォントの読み込み（デザインサンプル用）は、ライブラリに取り込まない **読み取り専用のソース** として
  フォントモードに足す想定。`Item` に入れずに済む形（仮想の一覧）を検討する
- **URL（ブックマーク）を種類として足す**想定。画像・ファイルと同じフォルダに並べたいのでモードにはしない。
  `Item` はファイル前提（`fileName`・`ext`・`size`）なので、データの形は作るときに決める。ブラウザ拡張の保存と
  `Item.sourceUrl`（画像の保存元ページ）とつなげる
- 別アプリに分ける場合は、`features/fonts/` と `src-tauri/src/fonts/` をそのまま持ち出し、core をパッケージとして共有する
