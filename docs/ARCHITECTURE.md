# 構成の方針：共通基盤と種類ごとの機能

画像・ファイルは「探して使う」、フォントは「比べて選ぶ」と使う場面が違う。そこでモードは見え方が根本的に違う
フォントだけに分け、**「すべて」と「フォント」の 2 つ** にしている。画像とファイルは「すべて」の中で種類の絞り込みで見る。
フォントを別アプリに切り出す案は保留中で、そうなっても困らないように、
**共通基盤（core）** と **種類ごとの機能（features）** の境界を明確にしておく。

## モード

- `store.ts` の `mode`（`"all" | "font"`、型と `MODES` は `lib/modes.ts`）。
  サイドバー上部の切替、⌘1 すべて / ⌘2 フォント（`MODES` の順）。
  ライブラリの切り替えは頻度が低いのでサイドバーの一番下（`LibrarySwitcher`）
- **種類の絞り込み**：「すべて」では、ツールバー 2 段目のチップ（`Toolbar.tsx` の `KindFilter`、`KINDS` から作る）で
  `filter.kinds` を選ぶ。クリックでその種類だけ、⌘クリックで足す・外す。ほかの条件と違い、表示（フォルダ・タグなど）を
  移っても残る（モードの代わり）。絞り込みの件数バッジには数えない
- 一覧が持ちうる種類は `listKinds`（`store.ts`）の 1 か所で決める：モードの種類（「すべて」は使う種類、
  `kindsOfMode`）を種類の絞り込みで狭め、開いているスマートフォルダの条件と重複の候補（画像だけ）でさらに狭める。
  問い合わせの `filter.kinds` は `queryKinds`（全種類なら空）
- 画像だけの機能は、一覧が画像だけのとき（`listIs(s, "image")`）に出す：縦横・画像サイズの絞り込み、画像サイズの並び替え。
  ほかの種類が混ざったら、これらの条件と並び順を外す（`fitToKinds`）。重複の候補は、画像を使うライブラリの「すべて」に出し、
  種類の絞り込みにかかわらず画像だけを問い合わせる。回転などの `kinds` 付きの操作は `appliesTo`（`commands.ts`）で、
  一覧がその種類だけなら使え、混ざっていれば選択がその種類だけのときに使える
- **ライブラリごとに記憶する**：ライブラリは最後に開いていたモードで開く（`library.db` の `settings` テーブルの `lastMode`。
  無ければフォントがいちばん多いときだけフォント、ほかは「すべて」。`lib/librarySettings.ts` の `openingMode`）。
  ライブラリごとに「使う種類」（`modes`）を選べ、「すべて」には使う種類だけが出る。
  「フォント」のモードはフォントをほかの種類と使うときだけ出す（`modesFor`）。docs/SETTINGS.md
  - 画像・ファイルのモードがあった版の `lastMode: "image"` などは、「すべて」をその種類に絞って開き、`lastMode` を `"all"` に直す。
    サイドバーで隠した項目は、`hidden:all` が無ければ `hidden:image` / `hidden:file` を引き継ぐ（`parseLibrarySettings`）
- 件数（`get_counts`）、フォルダ・タグ・スマートフォルダの件数、絞り込みバーの形式一覧（`list_exts`）は `kind` 引数で
  モードのものだけを数える（`db.rs` の `kind_where`。「すべて」は `kind` なし）。種類の絞り込みでは変えない
  - `Counts.kinds` だけは常に全種類の件数（モード切替のバッジ用）
- レイアウトとグループ分けはモードごとに保存する（`layout:<mode>`, `groupBy:<mode>`。「すべて」は以前の画像モードのものを引き継ぐ）。
  使える組み合わせは `MODE_LAYOUTS` / `MODE_GROUPS`（`store.ts`）。「すべて」は標準・Pinterest 風・グリッド・リストで、
  ツールバーには画像が入りうるなら標準と Pinterest 風、ファイルだけならグリッドとリストを出す。グループ分けに「種類」がある
- スマートフォルダの `filter.kinds` はほかと同じ条件（種類のチップで選んだもの）。フォントモードで作ったものは `["font"]` で、
  フォントモードには `kinds` が空かフォントを含むものだけが出る（`smartFolderInMode`）。「すべて」ではすべてが出る。
  条件を編集するときは、`kinds` を種類のチップに読み込む

種類を増やすとき（例：ブックマーク・動画）：`ItemKind` と `KINDS`（`lib/api.ts`）、`features/<kind>/` を足す。
チップと「使う種類」は `KINDS` から作られる。見え方が根本的に違うならモードにする（`MODES`、`MODE_LAYOUTS` / `MODE_GROUPS`、
サイドバーの `ModeSwitch`）。

## コマンド

アプリの操作は `src/lib/commands.ts` の `COMMANDS` に 1 つずつ定義する（id・名前・状態に応じた表示名・キー・使える種類・
使えるか・チェック・実行）。次はすべてこの表から作るので、操作を足すときはまずここに足す（docs/MENUS.md）。

- 一覧のキー処理（`Grid.tsx` → `runKey`）。一覧の中だけの移動・評価の数字・Space / Enter は `Grid.tsx` に残す
  - ダイアログ・メニュー・パネルなど一覧の上に重なるものは、外枠に `data-modal` を付ける。それがある間、一覧のキー処理は何もしない（重複の確認中の Delete で後ろの選択がゴミ箱に入らないように）
  - 入力欄のキー処理は `lib/ime.ts` の `composing` で日本語入力の変換中を除く（macOS では確定の Enter で `isComposing` がもう false のため）
- メニューバー（`lib/menuBar.ts`）。⌘ 付きのキーはアクセラレータ、1 文字のキーは表示だけ
- 右クリックメニューの行（`lib/menuItems.ts` の `commandItem` / `commandIcon`）
- ショートカット一覧（`lib/shortcuts.ts` の `shortcutSections`）。マウス操作やビューアだけのキーは説明の行として持つ

「一覧の中身への操作」（書き出し・まとめて出力・作業台にすべて追加・別のライブラリへ）は、対象を `ListSource`
（選択・表示中の一覧・フォルダ・スマートフォルダ・タグ・作業台）で受け、中身は `listTargets`（`lib/actions.ts`）で取る。

## 境界

| 層 | 場所 | 中身 |
|---|---|---|
| 共通基盤（core） | `src/lib/*`, `src/store.ts`, `src/components/*` | ライブラリ・DB・取り込み・フォルダ・タグ・スマートフォルダ・検索・一覧の骨組み（Grid / Sidebar / Toolbar / Inspector / Viewer）・Updater |
| | `src-tauri/src/{db,import,library,search,webimport,loopback,changes,proxy,transfer,commands}.rs` | スキーマ・クエリ、取り込み、受付サーバー、変更の記録と取り消し、ライブラリ間のコピー・移動、共通コマンド |
| | `src-tauri/src/mcp/` | Claude からの整理（MCP サーバー、`--mcp` の中継）。`docs/MCP.md` |
| フォント | `src/features/fonts/` | フォント専用コマンドのラッパ（`api.ts`）、フォントの読み込み（`loader.ts`）、見本の行（`FontRows.tsx`）、ビューア（`FontView.tsx`）、詳細パネルの行（`FontDetails.tsx`）、サイドバーの言語・書体（`FontFilters.tsx`）、見本の文字と大きさ（`SpecimenControls.tsx`） |
| | `src-tauri/src/fonts/` | パース・分類・見本の描画（`mod.rs`）、フォント専用コマンド（`commands.rs`） |
| ファイル | `src/features/files/` | ビューア（`FileView.tsx`：PDF は `<iframe>`、ほかはサムネイルと「既定のアプリで開く」） |
| | `src-tauri/src/files/` | 対応する拡張子、サムネイル（Quick Look／Windows.Data.Pdf（`win_pdf.rs`）／中のプレビュー／種類のカード） |
| 画像 | `src-tauri/src/{formats,orient,similar}.rs`、`components/DuplicateReview.tsx` ほか | デコード、回転・反転、似ている画像の検出（まだ `components/` に混ざっている） |

依存の向きは **features → core** のみ。core が種類ごとの知識を持つのは、DB に入っている語彙（`ItemKind`、`FONT_SCRIPTS` /
`FONT_CATEGORIES` のラベル、`Item` のフォント列、`Filter.fontScripts` など）までにとどめ、振る舞いは features に置く。

共通の UI（`Grid.tsx` / `Sidebar.tsx`）が features の部品を描く箇所（見本の行、言語・書体の節）では、
features 側が core の部品（`Row` / `Section`、`CellProps` / `showItemMenu`）を使うので import が循環する。
いずれも描画時にしか参照しないので問題ないが、core 側の部品を独立したファイルに出せばほどける。

## 外から来るファイルとセキュリティ

取り込むファイルはどこから来たか分からない（ブラウザ拡張で Web から保存したものも入る）ものとして扱う。

- 大きさはファイルに書かれた値をそのまま信じず、上限を設けて読む（WOFF / WOFF2・zip の中のプレビュー・WIC のデコード）。
  リリースビルドは `panic = "abort"` なので、確保の失敗やパニックはアプリごと落ちる
- SVG の `<image href>` は `data:` URL だけを読む（`formats::svg_options`）。PDF は中身を確かめてから iframe に出す（`files::is_pdf`）
- Windows のバックグラウンドの Office 変換は、Web から保存したもの（`source_url` あり）を対象にしない
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
