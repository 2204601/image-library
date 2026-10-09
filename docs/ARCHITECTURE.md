# 構成の方針：共通基盤と種類ごとの機能

画像とフォントは使う場面が違う（画像は「探して使う」、フォントは「比べて選ぶ」）ので、
アプリは **1 つの種類（モード）だけを表示する** 作りにしている（全種類をまとめて見る「すべて」モードもある）。
フォントを別アプリに切り出す案は保留中で、そうなっても困らないように、
**共通基盤（core）** と **種類ごとの機能（features）** の境界を明確にしておく。

## モード

- `store.ts` の `mode`（`"all" | "image" | "font" | "file"`、型と `MODES` は `lib/modes.ts`）。
  サイドバー上部の切替、⌘1 すべて / ⌘2 画像 / ⌘3 フォント / ⌘4 ファイル（`MODES` の順）。
  ライブラリの切り替えは頻度が低いのでサイドバーの一番下（`LibrarySwitcher`）
- **ライブラリごとに記憶する**：ライブラリは最後に開いていたモードで開く（`library.db` の `settings` テーブルの `lastMode`。
  無ければ件数の多い種類、`lib/librarySettings.ts` の `openingMode`）。ライブラリごとに「使う種類」（`modes`）を選べ、
  使わない種類はモード切替に出ず、そのキーも何もしない（キーの割り当ては `MODES` のまま）。
  「すべて」は使う種類が 2 つ以上のときだけ出す（`modesFor`）。docs/SETTINGS.md
- 一覧のクエリは常に `filter.kinds = modeKinds(mode)`（「すべて」は空 = 全種類）で問い合わせる。件数（`get_counts`）、
  フォルダ・タグ・スマートフォルダの件数、絞り込みバーの形式一覧（`list_exts`）も `kind` 引数でモードのものだけを数える
  （`db.rs` の `kind_where`。「すべて」は `kind` なし）。「すべて」には使わない設定の種類も出る
  - `Counts.kinds` だけは常に全種類の件数（モード切替のバッジ用）
- レイアウトとグループ分けはモードごとに保存する（`layout:<mode>`, `groupBy:<mode>`）。使える組み合わせは
  `MODE_LAYOUTS` / `MODE_GROUPS`（`store.ts`）
- スマートフォルダは、保存時のルールに `filter.kinds = [mode]` を入れて **作ったモードに属する**。
  モード分け前に作ったものと「すべて」で作ったもの（`kinds` が空）はどのモードにも出る（`smartFolderInMode`）。
  「すべて」ではすべてのスマートフォルダが出る
- 画像だけの機能（重複の候補、縦横・画像サイズの絞り込み、画像サイズの並び替え）は画像モードでだけ出す。
  回転などの `kinds` 付きの操作は、「すべて」では選択がその種類だけのときに使える（`commands.ts` の `appliesTo`）
- 「すべて」のレイアウトはグリッド・標準・リスト（見本は無し）、グループ分けに「種類」がある

モードを増やすとき（例：動画）：`ItemKind` と `KINDS`（`lib/api.ts`）、`MODES`（`lib/modes.ts`）、`MODE_LAYOUTS` / `MODE_GROUPS`、
サイドバーの `ModeSwitch`、`features/<kind>/` を足す。

## コマンド

アプリの操作は `src/lib/commands.ts` の `COMMANDS` に 1 つずつ定義する（id・名前・状態に応じた表示名・キー・使える種類・
使えるか・チェック・実行）。次はすべてこの表から作るので、操作を足すときはまずここに足す（docs/MENUS.md）。

- 一覧のキー処理（`Grid.tsx` → `runKey`）。一覧の中だけの移動・評価の数字・Space / Enter は `Grid.tsx` に残す
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

## 今後

- 画像だけの機能（重複の候補・回転）も `features/images/` に寄せる
- システムフォントの読み込み（デザインサンプル用）は、ライブラリに取り込まない **読み取り専用のソース** として
  フォントモードに足す想定。`Item` に入れずに済む形（仮想の一覧）を検討する
- **種類はモードではなくフィルタへ寄せる**（2026-10-09 に決定）。モードは見え方が根本的に違うもの（フォント）だけにし、
  「すべて」と「フォント」の 2 つにする。画像・ファイルは「すべて」の中で種類のフィルタ（ツールバーのチップ、`filter.kinds`）
  とスマートフォルダで絞る。種類ごとの機能（画像の重複の候補・画像サイズなど）は、一覧がその種類だけに絞られているとき、
  または選択がその種類だけのとき（`appliesTo`）に出す。種類のチップは `KINDS` から作り、判定は 1 か所にまとめる
- **URL（ブックマーク）を種類として足す**想定。画像・ファイルと同じフォルダに並べたいのでモードにはしない。
  `Item` はファイル前提（`fileName`・`ext`・`size`）なので、データの形は作るときに決める。ブラウザ拡張の保存と
  `Item.sourceUrl`（画像の保存元ページ）とつなげる
- 別アプリに分ける場合は、`features/fonts/` と `src-tauri/src/fonts/` をそのまま持ち出し、core をパッケージとして共有する
