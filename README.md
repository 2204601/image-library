# Image Library

Eagle 風のローカル画像管理アプリ。画像をライブラリにコピーして、サムネイル一覧・フォルダ分け・タグ付け・検索で整理する。
編集機能や AI 機能は持たない、軽量なデスクトップアプリ（Tauri 2 / Mac・Windows）。

## 機能

- **インポート**：ウィンドウへのドラッグ&ドロップ（フォルダは再帰）、「追加」ボタン、クリップボードから貼り付け（⌘V / Ctrl+V）
  - 同じ画像（SHA-256 一致）は重複としてスキップ。ゴミ箱にあるものは復元される
  - フォルダを開いた状態で追加すると、そのフォルダに入る
  - 対応形式：JPEG / PNG / GIF / WebP / BMP
- **一覧**：サムネイルサイズ変更、並び替え（追加日・名前・サイズ）、仮想スクロール
- **整理**：入れ子フォルダ（1 枚を複数フォルダに入れられる）、タグ（補完付き、カンマ区切りで複数）、メモ
  - 画像をサイドバーのフォルダへドラッグで追加、フォルダ同士もドラッグで入れ子に
  - 右クリックメニュー、ダブルクリックで名前変更
- **検索**：名前・メモ・タグ名の部分一致（空白区切りで AND）＋ サイドバーのタグで絞り込み
- **ビューア**：ダブルクリック / Space で拡大、←→ で送り、Esc で閉じる
- **ゴミ箱**：Delete / Backspace で移動、復元・完全削除

### キーボード

| キー | 動作 |
|---|---|
| クリック / Shift+クリック / ⌘(Ctrl)+クリック | 選択 / 範囲選択 / 追加選択 |
| 矢印キー（+Shift） | 選択移動（範囲拡張） |
| ⌘(Ctrl)+A | すべて選択 |
| ⌘(Ctrl)+F | 検索へ |
| Space / Enter | ビューアを開く |
| Delete / Backspace | ゴミ箱へ（ゴミ箱内では完全削除） |

## ライブラリの構造

ライブラリは 1 つのフォルダで完結しているので、フォルダごとコピーすればバックアップ・別 PC への移動ができる。

```
MyPictures.library/
  library.db                 # SQLite（フォルダ・タグ・メモなど）
  images/<id>/<元のファイル名>  # 取り込んだ画像のコピー
  thumbs/<id>.jpg|png        # 長辺 512px のサムネイル（透過画像は PNG）
```

最後に開いたライブラリのパスはアプリ設定（macOS: `~/Library/Application Support/com.local.imagelibrary/settings.json`）に保存される。

## 開発

前提：Node.js 22+、Rust（stable）、[Tauri の前提環境](https://tauri.app/start/prerequisites/)

```bash
npm install
npm run tauri dev      # アプリを起動
npm test               # Rust のユニットテスト + 型チェック
npm run tauri build    # 配布用ビルド（.dmg / .msi）
```

- `npm run dev` でブラウザから開くと、Rust 側の代わりにインメモリのモック（`src/dev/mockBackend.ts`）で動く。UI だけ触りたいとき用（インポートは不可）。
- テスト用ライブラリの生成：`npm run seed -- /path/to/Test.library 10000`
  （1 万枚の取り込み 約 6 秒、検索+並び替えクエリ 約 6ms ／ Apple Silicon・release ビルド）

### 構成

```
src/                    React UI
  App.tsx               レイアウト、ファイルのドロップ・貼り付け
  store.ts              zustand ストア（表示条件・選択・再読込）
  lib/api.ts            Rust コマンドの型付きラッパ
  lib/actions.ts        ダイアログを伴う操作（インポート・削除など）
  components/           Sidebar / Toolbar / Grid / Inspector / Viewer ほか
  dev/mockBackend.ts    ブラウザ開発用モック
src-tauri/src/
  db.rs                 スキーマ・クエリ（＋テスト）
  import.rs             コピー・ハッシュ・サムネイル生成（rayon で並列）
  library.rs            ライブラリの作成・オープン・ファイル削除
  commands.rs           フロントから呼ぶコマンド
src-tauri/examples/seed.rs  テストデータ生成
```

アプリ内のドラッグ&ドロップは HTML5 DnD ではなく pointer イベントで実装している（Windows では Tauri のファイルドロップ受付と HTML5 DnD が両立しないため）。

### Windows 版のビルド

`.github/workflows/build.yml` を GitHub Actions で手動実行（または `v*` タグを push）すると、macOS（Universal）と Windows のインストーラが Artifacts に出る。
